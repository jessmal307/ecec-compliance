import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Download, Paperclip, Printer } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { STATUS_FILTERS } from './ListFilters'
import { ListTableSkeleton } from './PageSkeletons'
import { StatusBadge, StatusLegend, WorkingTowardsBadge } from './StatusBadge'
import {
  ComplianceItemForm,
  EMPTY_COMPLIANCE_ITEM_VALUES,
} from './ComplianceItemFields'
import { PageError, PageMuted } from './ui/page'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select } from './ui/form'
import { sydneyToday } from '../lib/sydneyTime'
import {
  filterMatrix,
  filterSiteMatrix,
  matrixCsv,
  matrixSites,
  matrixSiteTypes,
  matrixStaff,
  matrixStaffTypes,
} from '../lib/complianceMatrix'
import {
  formValuesFromItem,
  isWorkingTowards,
  itemFormSaveFields,
  listComplianceItems,
  listRequirementTypes,
  saveComplianceItem,
  tracksVerification,
} from '../lib/compliance'
import {
  listSiteRequirementExclusionsForOrg,
  listStaffRequirementExclusionsForOrg,
} from '../lib/exclusions'
import { formatDate } from '../lib/format'
import { paths } from '../lib/paths'
import { firstError } from '../lib/query'
import { listSites } from '../lib/sites'
import { listStaff } from '../lib/staff'

const MATRIX_STATUS_FILTERS = STATUS_FILTERS.filter(
  (option) => option.value !== 'archived',
)

const CELL_CLASS = {
  Valid: 'bg-status-valid text-status-valid-foreground hover:brightness-95',
  'Expiring soon':
    'bg-status-soon text-status-soon-foreground hover:brightness-95',
  Expired:
    'bg-status-expired text-status-expired-foreground hover:brightness-95',
  Missing:
    'bg-card text-muted-foreground hover:bg-muted/60',
}

function cellLabel({ type, member, cell }) {
  if (cell.kind === 'na') {
    return `${type.name} for ${member.name}: not applicable`
  }
  if (cell.kind === 'missing') {
    return `${type.name} for ${member.name}: missing, add record`
  }
  if (!cell.item.expiry_date) {
    return `${type.name} for ${member.name}: ${cell.status}`
  }
  return `${type.name} for ${member.name}: ${cell.status}, expires ${formatDate(cell.item.expiry_date)}`
}

function MatrixCell({ type, member, cell, onOpen }) {
  if (cell.kind === 'na') {
    return (
      <div
        className="flex min-h-14 min-w-24 flex-col items-center justify-center border border-dashed border-border/80 bg-background px-1.5 py-2 text-xs text-muted-foreground"
        aria-label={cellLabel({ type, member, cell })}
      >
        <span aria-hidden>—</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`flex min-h-14 min-w-24 flex-col items-center justify-center gap-0.5 border border-foreground/15 px-1.5 py-2 text-center text-xs font-semibold tabular-nums ${CELL_CLASS[cell.status] ?? CELL_CLASS.Missing}`}
      onClick={() => onOpen({ type, member, cell })}
      aria-label={cellLabel({ type, member, cell })}
    >
      {cell.kind === 'item' ? (
        <>
          <span>{formatDate(cell.item.expiry_date)}</span>
          {cell.item.document_url ? (
            <Paperclip className="size-3 shrink-0" aria-hidden />
          ) : null}
        </>
      ) : (
        <span>Add</span>
      )}
    </button>
  )
}

function MatrixLegend() {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
      <StatusLegend />
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span
          className="inline-block size-4 shrink-0 border border-dashed border-border"
          aria-hidden
        />
        Not applicable
      </p>
    </div>
  )
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function ComplianceMatrix() {
  const { organizationId } = useAuth()
  const [staff, setStaff] = useState([])
  const [sites, setSites] = useState([])
  const [requirementTypes, setRequirementTypes] = useState([])
  const [items, setItems] = useState([])
  const [exclusions, setExclusions] = useState([])
  const [siteExclusions, setSiteExclusions] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState('staff')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [staffFilter, setStaffFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [draft, setDraft] = useState(null)
  const [formValues, setFormValues] = useState(EMPTY_COMPLIANCE_ITEM_VALUES)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    if (!organizationId) return { error: null }

    const [
      sitesResult,
      staffResult,
      typesResult,
      itemsResult,
      exclusionsResult,
      siteExclusionsResult,
    ] = await Promise.all([
      listSites(organizationId),
      listStaff(organizationId),
      listRequirementTypes(organizationId),
      listComplianceItems(organizationId),
      listStaffRequirementExclusionsForOrg(organizationId),
      listSiteRequirementExclusionsForOrg(organizationId),
    ])

    const loadError = firstError(
      sitesResult,
      staffResult,
      typesResult,
      itemsResult,
      exclusionsResult,
      siteExclusionsResult,
    )
    if (loadError) return { error: loadError }

    setSites(matrixSites(sitesResult.data))
    setStaff(matrixStaff(staffResult.data))
    setRequirementTypes(typesResult.data ?? [])
    setItems(itemsResult.data)
    setExclusions(exclusionsResult.data)
    setSiteExclusions(siteExclusionsResult.data)
    return { error: null }
  }, [organizationId])

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function run() {
      setLoading(true)
      setError('')
      const { error: loadError } = await refresh()
      if (cancelled) return
      if (loadError) setError(loadError.message)
      setLoading(false)
    }

    run()

    return () => {
      cancelled = true
    }
  }, [organizationId, refresh])

  const staffTypes = useMemo(
    () => matrixStaffTypes(requirementTypes),
    [requirementTypes],
  )
  const siteTypes = useMemo(
    () => matrixSiteTypes(requirementTypes),
    [requirementTypes],
  )
  const siteView = view === 'sites'

  const matrix = useMemo(() => {
    if (siteView) {
      const result = filterSiteMatrix({
        types: siteTypes,
        sites,
        items,
        exclusions: siteExclusions,
        typeId: typeFilter,
        status: statusFilter,
        siteId: siteFilter,
      })
      return {
        types: result.types,
        owners: result.sites,
        cells: result.cells,
      }
    }

    const result = filterMatrix({
      types: staffTypes,
      staff,
      items,
      exclusions,
      typeId: typeFilter,
      status: statusFilter,
      staffId: staffFilter,
      siteId: siteFilter,
    })
    return {
      types: result.types,
      owners: result.staff,
      cells: result.cells,
    }
  }, [
    siteView,
    siteTypes,
    sites,
    items,
    siteExclusions,
    staffTypes,
    staff,
    exclusions,
    typeFilter,
    statusFilter,
    staffFilter,
    siteFilter,
  ])

  const viewTypes = siteView ? siteTypes : staffTypes
  const viewOwners = siteView ? sites : staff
  const filtering = Boolean(
    typeFilter ||
      statusFilter ||
      siteFilter ||
      (!siteView && staffFilter),
  )

  const showLastVerified = tracksVerification(draft?.type)
  const editingItem = draft?.cell.item ?? null

  function openDraft({ type, member, cell }) {
    setError('')
    setDraft({ type, member, cell })
    setFormValues(
      cell.item
        ? formValuesFromItem(cell.item)
        : { ...EMPTY_COMPLIANCE_ITEM_VALUES, label: type.name },
    )
  }

  function closeDraft() {
    setDraft(null)
    setFormValues(EMPTY_COMPLIANCE_ITEM_VALUES)
  }

  function handleViewChange(next) {
    setView(next)
    setTypeFilter('')
    setStatusFilter('')
    setStaffFilter('')
    setSiteFilter('')
    closeDraft()
  }

  async function handleSave(event) {
    event.preventDefault()
    if (!organizationId || !draft) return

    setError('')
    setSaving(true)

    const { error: saveError } = await saveComplianceItem({
      id: editingItem?.id,
      requirementTypeId: draft.type.id,
      ...itemFormSaveFields(formValues, draft.type),
      staffId: siteView ? null : draft.member.id,
      siteId: siteView ? draft.member.id : null,
      orgId: organizationId,
    })

    if (saveError) {
      setError(saveError.message)
      setSaving(false)
      return
    }

    const { error: reloadError } = await refresh()
    if (reloadError) {
      setError(reloadError.message)
      setSaving(false)
      return
    }

    setSaving(false)
    setDraft(null)
    setFormValues(EMPTY_COMPLIANCE_ITEM_VALUES)
  }

  function handleExport() {
    downloadCsv(
      matrixCsv({
        ...matrix,
        ownerHeader: siteView ? 'Site' : 'Staff',
      }),
      `compliance-${siteView ? 'site' : 'staff'}-matrix-${sydneyToday()}.csv`,
    )
  }

  function ownerHref(owner) {
    return siteView ? paths.siteProfile(owner.id) : paths.staffProfile(owner.id)
  }

  const emptyMessage = !organizationId
    ? 'No organization yet. Sign out and back in if this persists.'
    : viewOwners.length === 0
      ? siteView
        ? 'Add sites to see the matrix.'
        : 'Add staff to see the matrix.'
      : viewTypes.length === 0
        ? siteView
          ? 'Add site requirement types to see the matrix.'
          : 'Add staff requirement types to see the matrix.'
        : filtering
          ? siteView
            ? 'No matching sites or requirements.'
            : 'No matching staff or requirements.'
          : 'Nothing to show yet.'

  const isEmpty =
    !loading &&
    (viewOwners.length === 0 ||
      viewTypes.length === 0 ||
      matrix.owners.length === 0 ||
      matrix.types.length === 0)

  return (
    <Card className="compliance-matrix">
      <CardHeader>
        <CardTitle>{siteView ? 'Site matrix' : 'Staff matrix'}</CardTitle>
        <CardDescription>
          {siteView
            ? 'Site requirement types across services.'
            : 'Staff requirement types across people. Default view is all sites.'}
        </CardDescription>
        <CardAction className="no-print flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            disabled={isEmpty}
          >
            <Printer data-icon="inline-start" />
            Print
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={isEmpty}
          >
            <Download data-icon="inline-start" />
            Export
          </Button>
        </CardAction>
      </CardHeader>

      {loading || !organizationId ? null : (
        <div className="no-print flex flex-col gap-3 border-b border-border px-(--card-spacing) pb-(--card-spacing)">
          <Tabs value={view} onValueChange={handleViewChange}>
            <TabsList>
              <TabsTrigger value="staff">Staff requirements</TabsTrigger>
              <TabsTrigger value="sites">Site requirements</TabsTrigger>
            </TabsList>
          </Tabs>
          <div
            className={
              siteView
                ? 'grid grid-cols-1 gap-2 sm:grid-cols-3'
                : 'grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4'
            }
          >
            <Select
              value={siteFilter}
              onChange={(event) => setSiteFilter(event.target.value)}
              aria-label="Filter by site"
            >
              <option value="">All sites</option>
              {siteView ? null : (
                <option value="unassigned">No site assigned</option>
              )}
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </Select>
            <Select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              aria-label="Filter by requirement type"
            >
              <option value="">All requirement types</option>
              {viewTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Select>
            {siteView ? null : (
              <Select
                value={staffFilter}
                onChange={(event) => setStaffFilter(event.target.value)}
                aria-label="Filter by staff"
              >
                <option value="">All staff</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            )}
            <Select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter by status"
            >
              {MATRIX_STATUS_FILTERS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <MatrixLegend />
        </div>
      )}

      <CardContent className="px-0">
        {error ? (
          <div className="px-(--card-spacing)">
            <PageError>{error}</PageError>
          </div>
        ) : null}

        {loading ? (
          <ListTableSkeleton rows={6} columns={6} />
        ) : isEmpty ? (
          <PageMuted>{emptyMessage}</PageMuted>
        ) : (
          <>
            <div className="hidden md:block print:block">
              <div className="compliance-matrix-scroll max-h-[min(70vh,44rem)] overflow-auto">
                <table className="min-w-full border-separate border-spacing-0 text-left">
                  <thead>
                    <tr>
                      <th className="sticky top-0 left-0 z-30 min-w-40 bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-[1px_1px_0_0_var(--border)]">
                        Requirement
                      </th>
                      {matrix.owners.map((member) => (
                        <th
                          key={member.id}
                          className="sticky top-0 z-20 min-w-24 bg-card px-1.5 py-2 text-center text-xs font-medium shadow-[0_1px_0_0_var(--border)]"
                        >
                          <Link
                            to={ownerHref(member)}
                            className="line-clamp-2 text-card-foreground no-underline hover:underline"
                          >
                            {member.name}
                          </Link>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.types.map((type) => (
                      <tr key={type.id}>
                        <th className="sticky left-0 z-10 min-w-40 bg-card px-3 py-0 text-left text-sm font-medium text-card-foreground shadow-[1px_0_0_0_var(--border)]">
                          {type.name}
                        </th>
                        {matrix.owners.map((member) => {
                          const cell = matrix.cells.get(`${type.id}:${member.id}`)
                          if (!cell) return <td key={member.id} />
                          return (
                            <td key={member.id} className="p-0">
                              <MatrixCell
                                type={type}
                                member={member}
                                cell={cell}
                                onOpen={openDraft}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-col gap-4 px-(--card-spacing) md:hidden print:hidden">
              {matrix.owners.map((member) => (
                <section key={member.id} className="space-y-2">
                  <h3 className="text-sm font-semibold text-card-foreground">
                    <Link
                      to={ownerHref(member)}
                      className="underline underline-offset-2"
                    >
                      {member.name}
                    </Link>
                  </h3>
                  <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                    {matrix.types.map((type) => {
                      const cell = matrix.cells.get(`${type.id}:${member.id}`)
                      if (!cell) return null
                      return (
                        <li key={type.id}>
                          {cell.kind === 'na' ? (
                            <div className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
                              <span className="text-sm text-muted-foreground">
                                {type.name}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                Not applicable
                              </span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left"
                              onClick={() => openDraft({ type, member, cell })}
                              aria-label={cellLabel({ type, member, cell })}
                            >
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-card-foreground">
                                  {type.name}
                                </span>
                                {cell.item ? (
                                  <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                                    {formatDate(cell.item.expiry_date)}
                                    {cell.item.document_url ? (
                                      <Paperclip
                                        className="size-3 shrink-0"
                                        aria-hidden
                                      />
                                    ) : null}
                                  </span>
                                ) : null}
                                {isWorkingTowards(cell.item) ? (
                                  <span className="mt-1 block">
                                    <WorkingTowardsBadge item={cell.item} />
                                  </span>
                                ) : null}
                              </span>
                              <StatusBadge status={cell.status} />
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </CardContent>

      <DialogPrimitive.Root
        open={Boolean(draft)}
        onOpenChange={(open) => {
          if (saving) return
          if (!open) closeDraft()
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
          <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-[60] max-h-[min(100svh-2rem,40rem)] w-[min(100%-2rem,36rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            {draft ? (
              <>
                <div className="mb-4 flex flex-col gap-1.5 text-left">
                  <DialogPrimitive.Title className="text-base font-medium text-card-foreground">
                    {editingItem ? 'Edit item' : 'Add item'}
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="text-sm text-muted-foreground">
                    {draft.type.name} · {draft.member.name}
                  </DialogPrimitive.Description>
                </div>
                <ComplianceItemForm
                  onSubmit={handleSave}
                  onCancel={closeDraft}
                  saving={saving}
                  values={formValues}
                  onChange={setFormValues}
                  showLastVerified={showLastVerified}
                  validityMonths={draft.type.validity_months}
                  disabled={saving}
                  item={editingItem}
                  requirementType={draft.type}
                  documentContext={
                    editingItem
                      ? { itemId: editingItem.id, orgId: organizationId }
                      : null
                  }
                  onDocumentChange={(path) =>
                    setFormValues((current) => ({
                      ...current,
                      documentUrl: path ?? '',
                      documentFile: null,
                    }))
                  }
                />
              </>
            ) : null}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </Card>
  )
}
