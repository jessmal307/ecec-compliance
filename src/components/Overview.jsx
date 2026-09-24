import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Clock,
  RefreshCw,
  ShieldCheck,
  UserRoundX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { GapCategories } from './GapCategories'
import { GetStarted, setupProgress } from './GetStarted'
import { DashboardSkeleton } from './PageSkeletons'
import { StatusBadge, StatusLegend } from './StatusBadge'
import { PageError, PageHeader } from './ui/page'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  ATTENTION_LIMIT,
  buildUrgentItems,
  visibleComplianceItems,
} from '../lib/attention'
import {
  attentionStatus,
  listComplianceItems,
  listRequirementTypes,
  todayIsoDate,
} from '../lib/compliance'
import { buildProviderComplianceReport } from '../lib/dashboardCompliance'
import {
  listStaffRequirementExclusionsForOrg,
  listSiteRequirementExclusionsForOrg,
} from '../lib/exclusions'
import { buildOwnerGaps } from '../lib/gaps'
import { computeDueForms } from '../lib/forms'
import { daysUntil } from '../lib/format'
import { getOrganization } from '../lib/organizations'
import { formsHref, ownerRequirementPath, paths } from '../lib/paths'
import { can } from '../lib/plans'
import { firstError } from '../lib/query'
import { listSites } from '../lib/sites'
import { isActiveStaff, listStaff } from '../lib/staff'

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`
}

function missingOwnersHint(staffOwners, siteOwners) {
  if (staffOwners === 0 && siteOwners === 0) return 'No mandatory gaps'

  const parts = []
  if (staffOwners > 0) {
    parts.push(countLabel(staffOwners, 'person', 'people'))
  }
  if (siteOwners > 0) {
    parts.push(countLabel(siteOwners, 'site', 'sites'))
  }
  return `Across ${parts.join(' and ')}`
}

function typeForItem(requirementTypes, item) {
  return (
    requirementTypes.find((type) => type.id === item.requirement_type_id) ??
    item
  )
}

function isRecheckDueItem(item, requirementTypes) {
  return attentionStatus(item, typeForItem(requirementTypes, item)) ===
    'Recheck due'
}

function staffAssignedToSite(member, siteId, activeSiteIds) {
  return (member.sites ?? []).some(
    (assigned) => assigned.id === siteId && activeSiteIds.has(assigned.id),
  )
}

function countRecheckDue(visibleItems, requirementTypes) {
  return visibleItems.filter((item) =>
    isRecheckDueItem(item, requirementTypes),
  ).length
}

function countRecheckDueForSite(
  visibleItems,
  requirementTypes,
  siteId,
  staffIdsAtSite,
) {
  return visibleItems.filter((item) => {
    if (!isRecheckDueItem(item, requirementTypes)) return false
    if (item.site_id) return item.site_id === siteId
    return staffIdsAtSite.has(item.staff_id)
  }).length
}

function compareSiteUrgency(left, right) {
  return (
    right.expiredCount - left.expiredCount ||
    right.missingCount - left.missingCount ||
    right.expiringCount - left.expiringCount ||
    right.recheckDueCount - left.recheckDueCount
  )
}

function summarizeDueBySite(rows) {
  const bySite = new Map()
  for (const row of rows) {
    const existing = bySite.get(row.site_id)
    if (existing) {
      existing.total += 1
      if (row.status === 'due') existing.due += 1
      else existing.done += 1
    } else {
      bySite.set(row.site_id, {
        site_id: row.site_id,
        site_name: row.site_name,
        total: 1,
        due: row.status === 'due' ? 1 : 0,
        done: row.status === 'done' ? 1 : 0,
      })
    }
  }

  return [...bySite.values()].sort(
    (left, right) =>
      right.due - left.due || left.site_name.localeCompare(right.site_name),
  )
}

function formsDueCountLabel(row) {
  if (row.due === 0 || row.done > 0) {
    return `${row.done} of ${row.total} done`
  }
  return countLabel(row.due, 'due', 'due')
}

function overviewUrgency(item, status) {
  if (status === 'Missing') return 'No record'
  if (status === 'Recheck due') return 'Recheck due'
  const days = daysUntil(item.expiry_date)
  if (days == null) return ''
  if (days < 0) {
    const overdue = Math.abs(days)
    return `${overdue} day${overdue === 1 ? '' : 's'} overdue`
  }
  if (days === 0) return 'Expires today'
  return `in ${days} day${days === 1 ? '' : 's'}`
}

function OverviewAttentionList({ items, requirementTypes }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nothing needs attention.</p>
    )
  }

  return (
    <ul className="divide-y divide-border">
      {items.map((item) => {
        const requirementType = requirementTypes.find(
          (type) => type.id === item.requirement_type_id,
        )
        const status = attentionStatus(item, requirementType)
        const urgency = overviewUrgency(item, status)
        const accent =
          status === 'Expired' ||
          status === 'Recheck due' ||
          status === 'Missing'
            ? 'border-l-status-expired'
            : 'border-l-status-soon'

        return (
          <li
            key={item.id}
            className={`border-l-4 py-2 pl-3 first:pt-0 last:pb-0 ${accent}`}
          >
            <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Link
                to={ownerRequirementPath(item)}
                className="min-w-0 font-medium text-card-foreground underline underline-offset-2"
              >
                {item.typeName}
                <span className="font-normal text-muted-foreground">
                  {' '}
                  · {item.ownerName}
                </span>
              </Link>
              <StatusBadge status={status} />
              {urgency ? (
                <span className="text-xs text-muted-foreground">{urgency}</span>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function progressClass(percent) {
  if (percent >= 90) {
    return 'h-2 [&_[data-slot=progress-indicator]]:bg-status-valid'
  }
  if (percent >= 70) {
    return 'h-2 [&_[data-slot=progress-indicator]]:bg-status-soon'
  }
  return 'h-2 [&_[data-slot=progress-indicator]]:bg-status-expired'
}

export function Overview() {
  const { organizationId } = useAuth()
  const [items, setItems] = useState([])
  const [staff, setStaff] = useState([])
  const [sites, setSites] = useState([])
  const [requirementTypes, setRequirementTypes] = useState([])
  const [exclusions, setExclusions] = useState([])
  const [siteExclusions, setSiteExclusions] = useState([])
  const [organization, setOrganization] = useState(null)
  const [dueRows, setDueRows] = useState([])
  const [formsError, setFormsError] = useState('')
  const [formsLoading, setFormsLoading] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      const [
        itemsResult,
        staffResult,
        sitesResult,
        typesResult,
        exclusionsResult,
        siteExclusionsResult,
      ] = await Promise.all([
        listComplianceItems(organizationId),
        listStaff(organizationId),
        listSites(organizationId),
        listRequirementTypes(organizationId),
        listStaffRequirementExclusionsForOrg(organizationId),
        listSiteRequirementExclusionsForOrg(organizationId),
      ])
      if (cancelled) return

      const loadError = firstError(
        itemsResult,
        staffResult,
        sitesResult,
        typesResult,
        exclusionsResult,
        siteExclusionsResult,
      )
      if (loadError) {
        setError(loadError.message)
        setLoading(false)
        return
      }

      setItems(itemsResult.data)
      setStaff(staffResult.data)
      setSites(sitesResult.data)
      setRequirementTypes(typesResult.data)
      setExclusions(exclusionsResult.data)
      setSiteExclusions(siteExclusionsResult.data)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId])

  useEffect(() => {
    if (!organizationId) {
      setOrganization(null)
      return
    }

    let cancelled = false

    async function load() {
      const { data } = await getOrganization(organizationId)
      if (!cancelled) setOrganization(data)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId])

  const dashboard = useMemo(() => {
    const activeStaff = staff.filter(isActiveStaff)

    const visibleItems = visibleComplianceItems({
      items,
      activeStaff,
      exclusions,
      siteExclusions,
    })

    const gaps = buildOwnerGaps({
      activeStaff,
      sites,
      visibleItems,
      requirementTypes,
      exclusions,
      siteExclusions,
    })

    const report = buildProviderComplianceReport({
      staff,
      sites,
      items,
      requirementTypes,
      exclusions,
      siteExclusions,
      todayIso: todayIsoDate(),
    })

    const { items: urgentItems } = buildUrgentItems({
      visibleItems,
      activeStaff,
      sites,
      requirementTypes,
      exclusions,
      siteExclusions,
    })

    const siteById = new Map(sites.map((site) => [site.id, site]))
    const activeSiteIds = new Set(sites.map((site) => site.id))
    const siteRows = report.sites
      .map((section) => {
        const staffIdsAtSite = new Set(
          activeStaff
            .filter((member) =>
              staffAssignedToSite(member, section.id, activeSiteIds),
            )
            .map((member) => member.id),
        )
        return {
          site: siteById.get(section.id) ?? {
            id: section.id,
            name: section.name,
          },
          percent: section.percent,
          expiredCount: section.expiredCount,
          expiringCount: section.expiringCount,
          missingCount: section.missingCount,
          recheckDueCount: countRecheckDueForSite(
            visibleItems,
            requirementTypes,
            section.id,
            staffIdsAtSite,
          ),
          staffCount: section.staffCount,
        }
      })
      .sort(compareSiteUrgency)

    return {
      compliancePercent: report.org.percent,
      requiredCount: report.org.requiredCount,
      expiredCount: report.org.expiredCount,
      expiringCount: report.org.expiringCount,
      missingCount: report.org.missingCount,
      recheckDueCount: countRecheckDue(visibleItems, requirementTypes),
      missingStaffOwners: gaps.filter(
        (row) => row.kind === 'staff' && row.missing.length > 0,
      ).length,
      missingSiteOwners: gaps.filter(
        (row) => row.kind === 'site' && row.missing.length > 0,
      ).length,
      gaps,
      topGaps: gaps.slice(0, 5),
      urgentItems,
      siteRows,
    }
  }, [items, staff, sites, requirementTypes, exclusions, siteExclusions])

  const setup = setupProgress({ sites, staff, requirementTypes })
  const showFormsDue = can(organization, 'forms')

  useEffect(() => {
    if (!organizationId || !showFormsDue) {
      setDueRows([])
      setFormsError('')
      setFormsLoading(false)
      return
    }
    if (loading || !setup.complete) return

    let cancelled = false

    async function load() {
      setFormsLoading(true)
      setFormsError('')
      const { data, error: loadError } = await computeDueForms(
        organizationId,
        todayIsoDate(),
      )
      if (cancelled) return
      if (loadError) {
        setFormsError(loadError.message)
        setDueRows([])
        setFormsLoading(false)
        return
      }
      setDueRows(data)
      setFormsLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId, showFormsDue, loading, setup.complete])

  const dueSites = useMemo(() => summarizeDueBySite(dueRows), [dueRows])
  const stats = [
    {
      label: 'Overall compliance',
      value:
        dashboard.compliancePercent == null
          ? '—'
          : `${dashboard.compliancePercent}%`,
      hint:
        dashboard.requiredCount === 0
          ? 'No required items yet'
          : 'Valid and in date, of all required items',
      icon: ShieldCheck,
    },
    {
      label: 'Expired',
      value: dashboard.expiredCount,
      hint: 'Past expiry date',
      icon: AlertTriangle,
      href:
        dashboard.expiredCount > 0
          ? `${paths.attention}?status=expired`
          : null,
    },
    {
      label: 'Expiring in 30 days',
      value: dashboard.expiringCount,
      hint: 'Still in date, due soon',
      icon: Clock,
      href:
        dashboard.expiringCount > 0
          ? `${paths.attention}?status=expiring`
          : null,
    },
    {
      label: 'Recheck due',
      value: dashboard.recheckDueCount,
      hint: 'Periodic verification is overdue',
      icon: RefreshCw,
      href: dashboard.recheckDueCount > 0 ? paths.attention : null,
    },
    {
      label: 'Missing',
      value: dashboard.missingCount,
      hint:
        dashboard.missingCount === 0
          ? 'All required records are entered'
          : `${missingOwnersHint(
              dashboard.missingStaffOwners,
              dashboard.missingSiteOwners,
            )}. Add them`,
      icon: UserRoundX,
      href: dashboard.missingCount > 0 ? paths.gaps : null,
    },
  ]

  const urgentTotal = dashboard.urgentItems.length
  const previewUrgentItems = dashboard.urgentItems.slice(0, ATTENTION_LIMIT)

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title="Overview"
        description={
          !loading && !setup.complete
            ? 'Set up your organisation, then this page becomes a live compliance dashboard.'
            : 'Live compliance across your organisation. Status is calculated from expiry dates — expired, within 30 days, or valid.'
        }
      />

      <PageError>{error}</PageError>

      {loading ? (
        <DashboardSkeleton />
      ) : !setup.complete ? (
        <GetStarted steps={setup.steps} />
      ) : (
        <>
          <StatusLegend />

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5 xl:gap-4">
            {stats.map((stat) => {
              const Icon = stat.icon
              const body = (
                <>
                  <CardHeader>
                    <CardDescription>{stat.label}</CardDescription>
                    <CardTitle className="text-3xl font-semibold tabular-nums tracking-tight">
                      {stat.value}
                    </CardTitle>
                    <CardAction>
                      <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-card-foreground">
                        <Icon className="size-4" />
                      </span>
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">{stat.hint}</p>
                  </CardContent>
                </>
              )

              return stat.href ? (
                <Link
                  key={stat.label}
                  to={stat.href}
                  className="min-w-0 no-underline"
                >
                  <Card className="h-full transition-colors hover:bg-muted/30">
                    {body}
                  </Card>
                </Link>
              ) : (
                <Card key={stat.label}>{body}</Card>
              )
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Needs attention now</CardTitle>
                <CardDescription>
                  {urgentTotal > ATTENTION_LIMIT
                    ? `Showing ${ATTENTION_LIMIT} of ${urgentTotal} · expired first, then soonest`
                    : 'Expired first, then soonest to expire.'}
                </CardDescription>
                {urgentTotal > 0 ? (
                  <CardAction>
                    <Button asChild variant="link" size="sm">
                      <Link to={paths.attention}>View all</Link>
                    </Button>
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent>
                <OverviewAttentionList
                  items={previewUrgentItems}
                  requirementTypes={requirementTypes}
                />
              </CardContent>
            </Card>

            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Compliance gaps</CardTitle>
                  <CardDescription>
                    Missing and expired items, most first.
                  </CardDescription>
                  {dashboard.gaps.length > 0 ? (
                    <CardAction>
                      <Button asChild variant="link" size="sm">
                        <Link to={paths.gaps}>View all</Link>
                      </Button>
                    </CardAction>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {dashboard.topGaps.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No gaps.</p>
                  ) : (
                    <ul className="-mx-1 divide-y divide-border">
                      {dashboard.topGaps.map((row) => (
                        <li key={`${row.kind}-${row.id}`}>
                          <Link
                            to={row.href}
                            className="block min-h-11 rounded-md px-1 py-2"
                          >
                            <span className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                              <span className="min-w-0 truncate">
                                <span className="font-medium text-card-foreground">
                                  {row.name}
                                </span>
                                <span className="text-muted-foreground">
                                  {' '}
                                  · {row.kind === 'staff' ? 'Staff' : 'Site'}
                                </span>
                              </span>
                              <GapCategories
                                className="flex items-center gap-2 sm:shrink-0"
                                missing={row.missing.length}
                                expired={row.expired.length}
                              />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>By site</CardTitle>
                  <CardDescription>
                    Valid and in date, of all required items at that site.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {dashboard.siteRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No sites yet.
                    </p>
                  ) : (
                    <ul className="space-y-4">
                      {dashboard.siteRows.map(
                        ({
                          site,
                          percent,
                          expiredCount,
                          expiringCount,
                          missingCount,
                          recheckDueCount,
                          staffCount,
                        }) => (
                          <li key={site.id} className="space-y-2">
                            <div className="flex items-baseline justify-between gap-3">
                              <Link
                                to={paths.siteProfile(site.id)}
                                className="inline-flex min-h-11 items-center font-medium text-card-foreground underline underline-offset-2"
                              >
                                {site.name}
                              </Link>
                              <div className="flex items-center gap-2">
                                <p
                                  className={
                                    percent === null
                                      ? 'text-sm text-muted-foreground'
                                      : 'text-sm tabular-nums text-card-foreground'
                                  }
                                >
                                  {percent === null ? '—' : `${percent}%`}
                                </p>
                                <Button asChild variant="outline" size="sm">
                                  <Link to={paths.siteProfile(site.id)}>
                                    Profile
                                  </Link>
                                </Button>
                              </div>
                            </div>
                            <Progress
                              value={percent ?? 0}
                              className={
                                percent === null
                                  ? 'h-2'
                                  : progressClass(percent)
                              }
                            />
                            <p className="text-xs text-muted-foreground">
                              {countLabel(staffCount, 'staff member', 'staff')}
                              {' · '}
                              {expiredCount} expired · {expiringCount} expiring
                              {' · '}
                              {missingCount} missing
                              {' · '}
                              {recheckDueCount} recheck due
                            </p>
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {showFormsDue ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Forms due today</CardTitle>
                    <CardDescription>
                      Scheduled forms for the current period, by site.
                    </CardDescription>
                    {dueSites.length > 0 ? (
                      <CardAction>
                        <Button asChild variant="link" size="sm">
                          <Link to={formsHref({ tab: 'due' })}>View all</Link>
                        </Button>
                      </CardAction>
                    ) : null}
                  </CardHeader>
                  <CardContent>
                    {formsError ? (
                      <p className="text-sm text-status-expired">{formsError}</p>
                    ) : formsLoading ? (
                      <p className="text-sm text-muted-foreground">
                        Loading forms…
                      </p>
                    ) : dueSites.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nothing applicable today.
                      </p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {dueSites.map((row) => {
                          const outstanding = row.due > 0
                          return (
                            <li
                              key={row.site_id}
                              className={`border-l-4 py-2 pl-3 first:pt-0 last:pb-0 ${
                                outstanding
                                  ? 'border-l-status-expired'
                                  : 'border-l-status-valid'
                              }`}
                            >
                              <Link
                                to={formsHref({ tab: 'due', site: row.site_id })}
                                className="flex min-h-11 min-w-0 items-center justify-between gap-3"
                              >
                                <span className="min-w-0 truncate font-medium text-card-foreground underline underline-offset-2">
                                  {row.site_name}
                                </span>
                                <span
                                  className={
                                    outstanding
                                      ? 'shrink-0 text-sm tabular-nums text-card-foreground'
                                      : 'shrink-0 text-sm tabular-nums text-muted-foreground'
                                  }
                                >
                                  {formsDueCountLabel(row)}
                                </span>
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
