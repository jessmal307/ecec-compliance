import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Clock,
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
import { UrgentAttentionList } from './UrgentAttentionList'
import { PageError, PageHeader } from './ui/page'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  ATTENTION_LIMIT,
  buildUrgentItems,
  visibleComplianceItems,
} from '../lib/attention'
import {
  complianceStatus,
  isSiteRequirementType,
  isStaffRequirementType,
  listComplianceItems,
  listRequirementTypes,
} from '../lib/compliance'
import {
  isRequirementExcluded,
  isSiteRequirementExcluded,
  listStaffRequirementExclusionsForOrg,
  listSiteRequirementExclusionsForOrg,
} from '../lib/exclusions'
import { buildOwnerGaps } from '../lib/gaps'
import { firstError } from '../lib/query'
import { listSites } from '../lib/sites'
import { isActiveStaff, listStaff } from '../lib/staff'
import { paths } from '../lib/paths'

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

function coverageTone(recorded, missing) {
  if (missing === 0) return 'ok'
  if (recorded === 0 || missing >= recorded) return 'high'
  return 'warn'
}

function coverageCardClass(tone) {
  if (tone === 'high') {
    return 'border-status-expired/40 bg-status-expired-muted/60'
  }
  if (tone === 'warn') {
    return 'border-status-soon/40 bg-status-soon-muted/60'
  }
  return ''
}

function coverageMissingClass(tone) {
  if (tone === 'high') return 'text-status-expired'
  if (tone === 'warn') return 'text-status-soon'
  return 'text-card-foreground'
}

function coverageRecordedLine(recorded, required) {
  return `${recorded} of ${required} recorded`
}

function coverageHeadline(recorded, required, missing) {
  return `${coverageRecordedLine(recorded, required)} · ${missing} missing`
}

function coverageProgressClass(tone) {
  if (tone === 'ok') {
    return 'h-2 [&_[data-slot=progress-indicator]]:bg-status-valid'
  }
  if (tone === 'warn') {
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

  const dashboard = useMemo(() => {
    const mandatoryStaffTypes = requirementTypes.filter(
      (type) => type.mandatory && isStaffRequirementType(type),
    )
    const mandatorySiteTypes = requirementTypes.filter(
      (type) => type.mandatory && isSiteRequirementType(type),
    )
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

    const missingCount = gaps.reduce((sum, row) => sum + row.missing.length, 0)
    const expiredCount = visibleItems.filter(
      (item) => complianceStatus(item.expiry_date) === 'Expired',
    ).length
    const expiringCount = visibleItems.filter(
      (item) => complianceStatus(item.expiry_date) === 'Expiring soon',
    ).length
    const trackedCount = visibleItems.length
    const currentCount = visibleItems.filter(
      (item) => complianceStatus(item.expiry_date) !== 'Expired',
    ).length
    const compliancePercent =
      trackedCount === 0
        ? null
        : Math.round((currentCount / trackedCount) * 100)

    const { items: urgentItems } = buildUrgentItems({
      visibleItems,
      activeStaff,
      sites,
      requirementTypes,
      exclusions,
      siteExclusions,
    })

    const siteRows = sites.map((site) => {
      const staffAtSite = activeStaff.filter((member) =>
        member.sites.some((assigned) => assigned.id === site.id),
      )
      const staffIds = new Set(staffAtSite.map((member) => member.id))
      const recordedItems = visibleItems.filter(
        (item) =>
          item.site_id === site.id || staffIds.has(item.staff_id),
      )
      const siteMissing = mandatorySiteTypes.filter(
        (type) =>
          !isSiteRequirementExcluded(siteExclusions, site.id, type.id) &&
          !recordedItems.some(
            (item) =>
              item.site_id === site.id &&
              item.requirement_type_id === type.id,
          ),
      ).length
      const staffMissing = staffAtSite.reduce((sum, member) => {
        return (
          sum +
          mandatoryStaffTypes.filter(
            (type) =>
              !isRequirementExcluded(exclusions, member.id, type.id) &&
              !visibleItems.some(
                (item) =>
                  item.staff_id === member.id &&
                  item.requirement_type_id === type.id,
              ),
          ).length
        )
      }, 0)
      const recorded = recordedItems.length
      const missing = siteMissing + staffMissing
      const required = recorded + missing
      const current = recordedItems.filter(
        (item) => complianceStatus(item.expiry_date) !== 'Expired',
      ).length
      const percent =
        recorded === 0 ? null : Math.round((current / recorded) * 100)

      return {
        site,
        percent,
        recorded,
        missing,
        required,
        staffCount: staffAtSite.length,
        tone: coverageTone(recorded, missing),
      }
    })

    return {
      compliancePercent,
      trackedCount,
      requiredCount: trackedCount + missingCount,
      expiredCount,
      expiringCount,
      missingCount,
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
  const orgTone = coverageTone(dashboard.trackedCount, dashboard.missingCount)
  const secondaryStats = [
    {
      label: 'Expired',
      value: dashboard.expiredCount,
      hint: 'Past expiry date',
      icon: AlertTriangle,
    },
    {
      label: 'Expiring in 30 days',
      value: dashboard.expiringCount,
      hint: 'Still in date, due soon',
      icon: Clock,
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardDescription>Compliance</CardDescription>
                <CardTitle className="text-3xl font-semibold tabular-nums tracking-tight">
                  {dashboard.compliancePercent == null
                    ? '—'
                    : `${dashboard.compliancePercent}%`}
                </CardTitle>
                <CardAction>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-card-foreground">
                    <ShieldCheck className="size-4" />
                  </span>
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Of recorded items
                </p>
              </CardContent>
            </Card>

            <Link
              to={dashboard.missingCount > 0 ? paths.gaps : paths.compliance}
              className="min-w-0 no-underline"
            >
              <Card
                className={`h-full transition-colors hover:bg-muted/30 ${coverageCardClass(orgTone)}`}
              >
                <CardHeader>
                  <CardDescription>Coverage</CardDescription>
                  <CardTitle
                    className={`text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl ${coverageMissingClass(orgTone)}`}
                  >
                    {dashboard.trackedCount === 0
                      ? coverageRecordedLine(
                          dashboard.trackedCount,
                          dashboard.requiredCount,
                        )
                      : coverageHeadline(
                          dashboard.trackedCount,
                          dashboard.requiredCount,
                          dashboard.missingCount,
                        )}
                  </CardTitle>
                  <CardAction>
                    <span
                      className={`flex size-9 items-center justify-center rounded-lg ${
                        orgTone === 'high'
                          ? 'bg-status-expired text-status-expired-foreground'
                          : orgTone === 'warn'
                            ? 'bg-status-soon text-status-soon-foreground'
                            : 'bg-muted text-card-foreground'
                      }`}
                    >
                      <UserRoundX className="size-4" />
                    </span>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {dashboard.missingCount === 0
                      ? 'All required records are entered'
                      : missingOwnersHint(
                          dashboard.missingStaffOwners,
                          dashboard.missingSiteOwners,
                        )}
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {secondaryStats.map((stat) => {
              const Icon = stat.icon
              return (
                <Card key={stat.label}>
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
                </Card>
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
                <UrgentAttentionList
                  items={previewUrgentItems}
                  kind="all"
                  requirementTypes={requirementTypes}
                  compact
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
                    Compliance of recorded items, and coverage of required
                    records.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {dashboard.siteRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No sites yet.
                    </p>
                  ) : (
                    <ul className="space-y-5">
                      {dashboard.siteRows.map(
                        ({
                          site,
                          percent,
                          recorded,
                          missing,
                          required,
                          staffCount,
                          tone,
                        }) => {
                          const coveragePercent =
                            required === 0
                              ? 0
                              : Math.round((recorded / required) * 100)

                          return (
                            <li key={site.id} className="space-y-2">
                              <div className="flex items-baseline justify-between gap-3">
                                <Link
                                  to={paths.siteProfile(site.id)}
                                  className="inline-flex min-h-11 items-center font-medium text-card-foreground underline underline-offset-2"
                                >
                                  {site.name}
                                </Link>
                                <Button asChild variant="outline" size="sm">
                                  <Link to={paths.siteProfile(site.id)}>
                                    Profile
                                  </Link>
                                </Button>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <p className="text-xs text-muted-foreground">
                                    Compliance
                                  </p>
                                  <p
                                    className={
                                      percent === null
                                        ? 'text-sm text-muted-foreground'
                                        : 'text-sm font-semibold tabular-nums text-card-foreground'
                                    }
                                  >
                                    {percent === null ? '—' : `${percent}%`}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Of recorded items
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">
                                    Coverage
                                  </p>
                                  <p
                                    className={`text-sm font-semibold tabular-nums ${coverageMissingClass(tone)}`}
                                  >
                                    {recorded === 0
                                      ? coverageRecordedLine(
                                          recorded,
                                          required,
                                        )
                                      : coverageHeadline(
                                          recorded,
                                          required,
                                          missing,
                                        )}
                                  </p>
                                </div>
                              </div>
                              <Progress
                                value={coveragePercent}
                                className={coverageProgressClass(tone)}
                              />
                              <p className="text-xs text-muted-foreground">
                                {countLabel(staffCount, 'staff member', 'staff')}
                              </p>
                            </li>
                          )
                        },
                      )}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
