import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ConfirmDeleteDialog,
  PERMANENT_DELETE_PHRASE,
  STAFF_DELETE_WARNING,
  staffDeleteTitle,
} from './ConfirmDeleteDialog'
import {
  EMPLOYMENT_FILTERS,
  ListFilters,
  matchesAnyQuery,
  normalizeQuery,
} from './ListFilters'
import { ListPagination, paginateItems } from './ListPagination'
import { ListTableSkeleton } from './PageSkeletons'
import { ProgressPill } from './ProgressPill'
import { StatusBadge, WorkingTowardsBadge } from './StatusBadge'
import { Table, Td, Th, THead, Tr } from './ui/data-table'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import { paths } from '../lib/paths'
import {
  isStaffRequirementType,
  listComplianceItems,
  listRequirementTypes,
} from '../lib/compliance'
import {
  isRequirementExcluded,
  listStaffRequirementExclusionsForOrg,
  sameId,
} from '../lib/exclusions'
import {
  buildStaffRequirementRows,
  summarizeProfileRequirements,
} from '../lib/profileCompliance'
import { firstError } from '../lib/query'
import {
  employmentStatusLabel,
  isActiveStaff,
  listStaff,
  restoreStaff,
  deleteStaff,
} from '../lib/staff'
import { listSites } from '../lib/sites'
import { isArchived } from '../lib/archive'
import { formatTimestamp } from '../lib/format'

function compareNames(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, {
    sensitivity: 'base',
  })
}

function primarySiteName(member) {
  if (!member.sites?.length) return 'No site assigned'
  return [...member.sites].sort((a, b) => compareNames(a.name, b.name))[0].name
}

function sitesLabel(member) {
  if (member.sites.length === 0) return 'No site'
  const names = [...member.sites].sort((a, b) => compareNames(a.name, b.name))
  if (names.length === 1) return names[0].name
  return `${names[0].name} +${names.length - 1}`
}

export function Staff() {
  const { organizationId } = useAuth()
  const [staff, setStaff] = useState([])
  const [sites, setSites] = useState([])
  const [requirementTypes, setRequirementTypes] = useState([])
  const [items, setItems] = useState([])
  const [exclusions, setExclusions] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [page, setPage] = useState(1)
  const [restoringId, setRestoringId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [pendingPermanentDelete, setPendingPermanentDelete] = useState(null)
  const archivedOnly = statusFilter === 'archived'

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      const [
        sitesResult,
        staffResult,
        typesResult,
        itemsResult,
        exclusionsResult,
      ] = await Promise.all([
        listSites(organizationId),
        listStaff(organizationId, { archivedOnly }),
        listRequirementTypes(organizationId),
        listComplianceItems(organizationId),
        listStaffRequirementExclusionsForOrg(organizationId),
      ])
      if (cancelled) return

      const loadError = firstError(
        sitesResult,
        staffResult,
        typesResult,
        itemsResult,
        exclusionsResult,
      )
      if (loadError) {
        setError(loadError.message)
        setLoading(false)
        return
      }

      setSites(sitesResult.data)
      setStaff(staffResult.data)
      setRequirementTypes(typesResult.data.filter(isStaffRequirementType))
      setItems(itemsResult.data)
      setExclusions(exclusionsResult.data)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId, archivedOnly])

  const progressByStaffId = useMemo(() => {
    return new Map(
      staff.map((member) => {
        const { rows, extraRows } = buildStaffRequirementRows(
          requirementTypes,
          items,
          member.id,
        )
        const summary = summarizeProfileRequirements(
          [...rows, ...extraRows],
          (typeId) => isRequirementExcluded(exclusions, member.id, typeId),
        )
        return [member.id, summary]
      }),
    )
  }, [staff, requirementTypes, items, exclusions])

  const filteredStaff = useMemo(() => {
    const normalized = normalizeQuery(query)
    const matches = staff.filter((member) => {
      if (
        !matchesAnyQuery(
          normalized,
          member.name,
          member.role,
          member.email,
          ...member.sites.map((site) => site.name),
        )
      ) {
        return false
      }
      if (siteFilter === 'unassigned') return member.sites.length === 0
      if (
        siteFilter &&
        !member.sites.some((site) => sameId(site.id, siteFilter))
      ) {
        return false
      }
      if (archivedOnly) return true
      if (statusFilter === 'active' && !isActiveStaff(member)) return false
      if (statusFilter === 'inactive' && member.employment_status !== 'inactive') {
        return false
      }
      if (statusFilter === 'on_leave' && member.employment_status !== 'on_leave') {
        return false
      }
      return true
    })

    const grouped = !siteFilter
    return matches.sort((a, b) => {
      if (grouped) {
        const siteCompare = compareNames(primarySiteName(a), primarySiteName(b))
        if (siteCompare !== 0) {
          if (primarySiteName(a) === 'No site assigned') return 1
          if (primarySiteName(b) === 'No site assigned') return -1
          return siteCompare
        }
      }
      return compareNames(a.name, b.name)
    })
  }, [staff, query, siteFilter, statusFilter, archivedOnly])

  useEffect(() => {
    setPage(1)
  }, [query, statusFilter, siteFilter])

  async function handleRestore(member) {
    setError('')
    setRestoringId(member.id)
    const { error: restoreError } = await restoreStaff(member.id)
    if (restoreError) {
      setError(restoreError.message)
      setRestoringId(null)
      return
    }
    setStaff((current) => current.filter((row) => row.id !== member.id))
    setRestoringId(null)
  }

  async function handlePermanentDelete() {
    if (!pendingPermanentDelete) return
    setError('')
    setDeletingId(pendingPermanentDelete.id)
    const { error: deleteError } = await deleteStaff(pendingPermanentDelete.id)
    if (deleteError) {
      setError(deleteError.message)
      setDeletingId(null)
      return
    }
    setStaff((current) =>
      current.filter((row) => row.id !== pendingPermanentDelete.id),
    )
    setPendingPermanentDelete(null)
    setDeletingId(null)
  }

  const paged = paginateItems(filteredStaff, page)
  const visibleStaff = paged.items
  const groupCounts = useMemo(() => {
    const counts = new Map()
    for (const member of filteredStaff) {
      const key = primarySiteName(member)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [filteredStaff])

  const filtering =
    Boolean(query.trim()) || Boolean(statusFilter) || Boolean(siteFilter)
  const showSiteGroups = !siteFilter

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title="Staff"
        description={
          archivedOnly
            ? 'Archived people are hidden from dashboards and alerts. Restore to bring them back.'
            : 'Open a person to view their profile. Add people with New staff.'
        }
        actions={
          <>
            <Button asChild variant="outline" disabled={!organizationId}>
              <Link to={paths.importStaff}>Import staff</Link>
            </Button>
            <Button asChild disabled={!organizationId}>
              <Link to={paths.newStaff}>New staff</Link>
            </Button>
          </>
        }
      />

      <PageError>{error}</PageError>

      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
          <CardDescription>
            Search, filter by site or employment, 25 per page. Use Archived to
            restore or permanently delete.
          </CardDescription>
          <CardAction>
            <span className="text-sm tabular-nums text-muted-foreground">
              {staff.length === 0
                ? '0'
                : filtering
                  ? `${filteredStaff.length} of ${staff.length}`
                  : staff.length}
            </span>
          </CardAction>
        </CardHeader>
        {!loading && organizationId ? (
          <ListFilters
            query={query}
            onQueryChange={setQuery}
            queryPlaceholder="Search name, role, or site"
            status={statusFilter}
            onStatusChange={setStatusFilter}
            statusOptions={EMPLOYMENT_FILTERS}
            statusLabel="Filter by employment"
            siteId={siteFilter}
            onSiteChange={setSiteFilter}
            sites={sites}
            includeUnassigned
          />
        ) : null}
        <CardContent className="px-0">
          {loading ? (
            <ListTableSkeleton rows={5} columns={5} />
          ) : !organizationId ? (
            <PageMuted>
              No organization yet. Sign out and back in if this persists.
            </PageMuted>
          ) : staff.length === 0 ? (
            <PageMuted>
              {archivedOnly ? 'No archived staff.' : 'No staff yet.'}
            </PageMuted>
          ) : filteredStaff.length === 0 ? (
            <PageMuted>No matching staff.</PageMuted>
          ) : (
            <>
            <Table>
              <THead>
                <Th className="py-1.5">Name</Th>
                <Th className="py-1.5">Role</Th>
                <Th className="py-1.5">Status</Th>
                <Th className="py-1.5">Progress</Th>
                <Th className="py-1.5">Sites</Th>
                {archivedOnly ? <Th className="py-1.5 text-right">Actions</Th> : null}
              </THead>
              <tbody>
                {visibleStaff.map((member, index) => {
                  const inactive = !isActiveStaff(member)
                  const progress = progressByStaffId.get(member.id)
                  const groupKey = primarySiteName(member)
                  const showGroup =
                    showSiteGroups &&
                    (index === 0 ||
                      primarySiteName(visibleStaff[index - 1]) !== groupKey)
                  return (
                    <Fragment key={member.id}>
                      {showGroup ? (
                        <Tr slot="group">
                          <Td
                            slot="group"
                            colSpan={archivedOnly ? 6 : 5}
                            className="bg-muted/50 py-1.5 text-xs font-medium text-muted-foreground max-md:bg-transparent max-md:py-0"
                          >
                            {groupKey}
                            <span className="ml-1.5 tabular-nums font-normal">
                              {groupCounts.get(groupKey) ?? 0}
                            </span>
                          </Td>
                        </Tr>
                      ) : null}
                      <Tr className="hover:bg-muted/40">
                        <Td slot="label" className="py-1.5">
                          <span className="inline-flex min-h-11 flex-wrap items-center gap-1.5">
                            <Link
                              to={paths.staffProfile(member.id)}
                              className="font-medium text-card-foreground underline underline-offset-2"
                            >
                              {member.name}
                            </Link>
                            {!isArchived(member) && inactive ? (
                              <StatusBadge
                                status={employmentStatusLabel(
                                  member.employment_status,
                                )}
                              />
                            ) : null}
                            {!isArchived(member) &&
                            items.some(
                              (item) =>
                                item.staff_id === member.id &&
                                item.working_towards,
                            ) ? (
                              <WorkingTowardsBadge
                                item={{ working_towards: true }}
                              />
                            ) : null}
                          </span>
                          <p className="mt-0.5 text-xs text-muted-foreground md:hidden">
                            {member.role}
                            {sitesLabel(member) ? ` · ${sitesLabel(member)}` : ''}
                          </p>
                        </Td>
                        <Td slot="extra" className="py-1.5 text-muted-foreground">
                          {member.role}
                        </Td>
                        <Td slot="status" className="py-1.5">
                          <StatusBadge
                            status={
                              isArchived(member)
                                ? 'Archived'
                                : employmentStatusLabel(member.employment_status)
                            }
                          />
                          {isArchived(member) ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {formatTimestamp(member.archived_at)}
                            </p>
                          ) : null}
                        </Td>
                        <Td slot="meta" className="py-1.5">
                          {isArchived(member) ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <ProgressPill
                              completed={progress?.completed ?? 0}
                              total={progress?.applicableCount ?? 0}
                              inactive={inactive}
                            />
                          )}
                        </Td>
                        <Td
                          slot="extra"
                          className="max-w-40 truncate py-1.5 text-muted-foreground"
                          title={
                            member.sites.length === 0
                              ? 'No site assigned'
                              : member.sites.map((site) => site.name).join(', ')
                          }
                        >
                          {sitesLabel(member)}
                        </Td>
                        <Td slot="action" className={`py-1.5 ${archivedOnly ? '' : 'md:hidden'}`}>
                          <div className="flex flex-wrap justify-end gap-2 max-md:justify-start">
                            <Button asChild size="sm" className="md:hidden">
                              <Link to={paths.staffProfile(member.id)}>View</Link>
                            </Button>
                            {archivedOnly ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => handleRestore(member)}
                                  disabled={
                                    restoringId === member.id ||
                                    deletingId === member.id
                                  }
                                >
                                  {restoringId === member.id
                                    ? 'Restoring…'
                                    : 'Restore'}
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  onClick={() =>
                                    setPendingPermanentDelete(member)
                                  }
                                  disabled={
                                    restoringId === member.id ||
                                    deletingId === member.id
                                  }
                                >
                                  Delete permanently
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </Td>
                      </Tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </Table>
            <ListPagination
              page={paged.page}
              pageCount={paged.pageCount}
              from={paged.from}
              to={paged.to}
              total={paged.total}
              onPageChange={setPage}
            />
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDeleteDialog
        open={Boolean(pendingPermanentDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingPermanentDelete(null)
        }}
        title={
          pendingPermanentDelete
            ? staffDeleteTitle(pendingPermanentDelete.name)
            : 'Delete permanently?'
        }
        description={STAFF_DELETE_WARNING}
        confirming={Boolean(
          pendingPermanentDelete && deletingId === pendingPermanentDelete.id,
        )}
        onConfirm={handlePermanentDelete}
        confirmLabel="Delete permanently"
        confirmingLabel="Deleting…"
        confirmPhrase={PERMANENT_DELETE_PHRASE}
      />
    </section>
  )
}
