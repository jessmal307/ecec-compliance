import { useEffect, useMemo, useState } from 'react'
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
  ComplianceItemForm,
  EMPTY_COMPLIANCE_ITEM_VALUES,
  MarkVerifiedButton,
} from './ComplianceItemFields'
import {
  ConfirmDeleteDialog,
  ITEM_ARCHIVE_WARNING,
  ITEM_DELETE_WARNING,
  PERMANENT_DELETE_PHRASE,
  itemArchiveTitle,
  itemArchiveWarning,
  itemDeleteTitle,
  itemDeleteWarning,
} from './ConfirmDeleteDialog'
import {
  ListFilters,
  matchesItemStatus,
  matchesQuery,
  normalizeQuery,
} from './ListFilters'
import { DocumentActions } from './DocumentLink'
import { StatusBadge } from './StatusBadge'
import { Table, Td, Th, THead, Tr } from './ui/data-table'
import {
  Choice,
  ChoiceRow,
  Field,
  FieldGrid,
  FormSection,
  Select,
} from './ui/form'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import {
  complianceStatus,
  saveComplianceItem,
  archiveComplianceItem,
  restoreComplianceItem,
  deleteComplianceItem,
  formValuesFromItem,
  hasRecheckInterval,
  listComplianceItems,
  listRequirementTypes,
  markItemVerifiedToday,
  suggestedExpiryFromIssuedDate,
  todayIsoDate,
  tracksVerification,
} from '../lib/compliance'
import { formatDate } from '../lib/format'
import { paths } from '../lib/paths'
import { listStaff } from '../lib/staff'
import { listSites } from '../lib/sites'

export function ComplianceItems() {
  const { organizationId } = useAuth()
  const [requirementTypeId, setRequirementTypeId] = useState('')
  const [formValues, setFormValues] = useState(EMPTY_COMPLIANCE_ITEM_VALUES)
  const [ownerKind, setOwnerKind] = useState('staff')
  const [staffId, setStaffId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [requirementTypes, setRequirementTypes] = useState([])
  const [items, setItems] = useState([])
  const [staff, setStaff] = useState([])
  const [sites, setSites] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [verifyingId, setVerifyingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [restoringId, setRestoringId] = useState(null)
  const [pendingArchive, setPendingArchive] = useState(null)
  const [pendingPermanentDelete, setPendingPermanentDelete] = useState(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const archivedOnly = statusFilter === 'archived'

  const selectedType = requirementTypes.find((type) => type.id === requirementTypeId)
  const showLastVerified = tracksVerification(selectedType)

  function handleRequirementTypeChange(nextId) {
    setRequirementTypeId(nextId)
    const nextType = requirementTypes.find((type) => type.id === nextId)
    setFormValues((current) => {
      const next = { ...current }
      if (!tracksVerification(nextType)) {
        next.lastVerifiedDate = ''
      }
      const suggested = suggestedExpiryFromIssuedDate(
        current.issuedDate,
        nextType?.validity_months,
      )
      if (suggested) {
        next.expiryDate = suggested
      }
      return next
    })
  }

  function resetForm() {
    setEditingId(null)
    setFormValues(EMPTY_COMPLIANCE_ITEM_VALUES)
  }

  function startEdit(item) {
    setEditingId(item.id)
    setRequirementTypeId(item.requirement_type_id)
    setFormValues(formValuesFromItem(item))
    setOwnerKind(item.staff_id ? 'staff' : 'site')
    if (item.staff_id) setStaffId(item.staff_id)
    if (item.site_id) setSiteId(item.site_id)
    setError('')
  }

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      const { data: typeRows, error: typesError } =
        await listRequirementTypes(organizationId)
      if (cancelled) return
      if (typesError) {
        setError(typesError.message)
        setLoading(false)
        return
      }

      const { data: staffRows, error: staffError } = await listStaff(organizationId)
      if (cancelled) return
      if (staffError) {
        setError(staffError.message)
        setLoading(false)
        return
      }

      const { data: siteRows, error: sitesError } = await listSites(organizationId)
      if (cancelled) return
      if (sitesError) {
        setError(sitesError.message)
        setLoading(false)
        return
      }

      const { data: itemRows, error: itemsError } =
        await listComplianceItems(organizationId, { archivedOnly })
      if (cancelled) return
      if (itemsError) {
        setError(itemsError.message)
        setLoading(false)
        return
      }

      setRequirementTypes(typeRows)
      setStaff(staffRows)
      setSites(siteRows)
      setItems(itemRows)
      setRequirementTypeId((current) => current || typeRows[0]?.id || '')
      setStaffId((current) => current || staffRows[0]?.id || '')
      setSiteId((current) => current || siteRows[0]?.id || '')
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId, archivedOnly])

  async function refreshItems() {
    const { data, error: selectError } = await listComplianceItems(
      organizationId,
      { archivedOnly },
    )
    if (selectError) {
      return { error: selectError }
    }
    setItems(data)
    return { error: null }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!organizationId) return

    if (!requirementTypeId) {
      setError('No requirement types found for this organization.')
      return
    }

    const belongsToStaff = ownerKind === 'staff'
    if (belongsToStaff && !staffId) {
      setError('Add a staff member first.')
      return
    }
    if (!belongsToStaff && !siteId) {
      setError('Add a site first.')
      return
    }

    setError('')
    setSaving(true)

    const payload = {
      requirementTypeId,
      label: formValues.label.trim(),
      expiryDate: formValues.expiryDate,
      referenceNumber: formValues.referenceNumber,
      issuedDate: formValues.issuedDate,
      issuer: formValues.issuer,
      status: formValues.status,
      lastVerifiedDate: showLastVerified ? formValues.lastVerifiedDate : null,
      staffId: belongsToStaff ? staffId : null,
      siteId: belongsToStaff ? null : siteId,
    }

    const { error: saveError } = await saveComplianceItem({
      id: editingId,
      documentFile: formValues.documentFile,
      currentDocumentPath: formValues.documentUrl,
      ...payload,
      orgId: organizationId,
    })

    if (saveError) {
      setError(saveError.message)
      setSaving(false)
      return
    }

    const { error: selectError } = await refreshItems()
    if (selectError) {
      setError(selectError.message)
      setSaving(false)
      return
    }

    resetForm()
    setSaving(false)
  }

  async function handleMarkVerified(item) {
    setError('')
    setVerifyingId(item.id)

    const { error: saveError } = await markItemVerifiedToday(item.id)
    if (saveError) {
      setError(saveError.message)
      setVerifyingId(null)
      return
    }

    const { error: selectError } = await refreshItems()
    if (selectError) {
      setError(selectError.message)
      setVerifyingId(null)
      return
    }

    if (editingId === item.id) {
      setFormValues((current) => ({
        ...current,
        lastVerifiedDate: todayIsoDate(),
      }))
    }

    setVerifyingId(null)
  }

  async function handleArchive() {
    if (!pendingArchive) return

    setError('')
    setDeletingId(pendingArchive.id)
    const { error: archiveError } = await archiveComplianceItem(pendingArchive.id)
    if (archiveError) {
      setError(archiveError.message)
      setDeletingId(null)
      return
    }

    if (editingId === pendingArchive.id) {
      resetForm()
    }

    setPendingArchive(null)
    const { error: selectError } = await refreshItems()
    if (selectError) {
      setError(selectError.message)
    }
    setDeletingId(null)
  }

  async function handleRestore(item) {
    setError('')
    setRestoringId(item.id)
    const { error: restoreError } = await restoreComplianceItem(item.id)
    if (restoreError) {
      setError(restoreError.message)
      setRestoringId(null)
      return
    }
    const { error: selectError } = await refreshItems()
    if (selectError) {
      setError(selectError.message)
    }
    setRestoringId(null)
  }

  async function handlePermanentDelete() {
    if (!pendingPermanentDelete) return

    setError('')
    setDeletingId(pendingPermanentDelete.id)
    const { error: deleteError } = await deleteComplianceItem(
      pendingPermanentDelete.id,
    )
    if (deleteError) {
      setError(deleteError.message)
      setDeletingId(null)
      return
    }

    if (editingId === pendingPermanentDelete.id) {
      resetForm()
    }

    setPendingPermanentDelete(null)
    const { error: selectError } = await refreshItems()
    if (selectError) {
      setError(selectError.message)
    }
    setDeletingId(null)
  }

  const staffById = useMemo(
    () => new Map(staff.map((member) => [member.id, member])),
    [staff],
  )

  const filteredItems = useMemo(() => {
    const normalized = normalizeQuery(query)
    return items.filter((item) => {
      if (
        !matchesQuery(item.ownerName, normalized) &&
        !matchesQuery(item.typeName, normalized) &&
        !matchesQuery(item.label, normalized)
      ) {
        return false
      }
      if (
        statusFilter &&
        statusFilter !== 'archived' &&
        !matchesItemStatus(statusFilter, complianceStatus(item.expiry_date))
      ) {
        return false
      }
      if (siteFilter) {
        if (item.site_id) return item.site_id === siteFilter
        const member = staffById.get(item.staff_id)
        return Boolean(member?.sites.some((site) => site.id === siteFilter))
      }
      return true
    })
  }, [items, query, statusFilter, siteFilter, staffById])

  const formBusy = !organizationId || saving
  const filtering =
    Boolean(query.trim()) || Boolean(statusFilter) || Boolean(siteFilter)

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title="Compliance items"
        description="Track certificates and checks. Each item belongs to one staff member or one site."
      />

      <PageError>{error}</PageError>

      {archivedOnly ? null : (
      <Card>
        <CardHeader>
          <CardTitle>{editingId ? 'Edit item' : 'Add item'}</CardTitle>
          <CardDescription>
            Assign a requirement type, then fill in certificate details and dates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ComplianceItemForm
            onSubmit={handleSubmit}
            onCancel={editingId ? resetForm : undefined}
            saving={saving}
            submitLabel={editingId ? 'Save' : 'Save'}
            values={formValues}
            onChange={setFormValues}
            showLastVerified={showLastVerified}
            validityMonths={selectedType?.validity_months}
            disabled={formBusy}
            documentContext={
              editingId
                ? {
                    itemId: editingId,
                    orgId: organizationId,
                  }
                : null
            }
            onDocumentChange={() => refreshItems()}
          >
            <FormSection title="Assignment">
              <FieldGrid>
                <Field label="Type">
                  <Select
                    name="requirement_type_id"
                    value={requirementTypeId}
                    onChange={(event) =>
                      handleRequirementTypeChange(event.target.value)
                    }
                    required
                    disabled={formBusy || requirementTypes.length === 0}
                  >
                    {requirementTypes.length === 0 ? (
                      <option value="">No requirement types yet</option>
                    ) : (
                      requirementTypes.map((requirementType) => (
                        <option key={requirementType.id} value={requirementType.id}>
                          {requirementType.name}
                        </option>
                      ))
                    )}
                  </Select>
                </Field>
                <Field label="Belongs to">
                  <ChoiceRow disabled={formBusy}>
                    <Choice
                      type="radio"
                      name="owner_kind"
                      value="staff"
                      checked={ownerKind === 'staff'}
                      onChange={() => setOwnerKind('staff')}
                      disabled={formBusy}
                    >
                      Staff member
                    </Choice>
                    <Choice
                      type="radio"
                      name="owner_kind"
                      value="site"
                      checked={ownerKind === 'site'}
                      onChange={() => setOwnerKind('site')}
                      disabled={formBusy}
                    >
                      Site
                    </Choice>
                  </ChoiceRow>
                </Field>
                {ownerKind === 'staff' ? (
                  <Field label="Staff member">
                    <Select
                      name="staff_id"
                      value={staffId}
                      onChange={(event) => setStaffId(event.target.value)}
                      required
                      disabled={formBusy || staff.length === 0}
                    >
                      {staff.length === 0 ? (
                        <option value="">No staff yet</option>
                      ) : (
                        staff.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))
                      )}
                    </Select>
                  </Field>
                ) : (
                  <Field label="Site">
                    <Select
                      name="site_id"
                      value={siteId}
                      onChange={(event) => setSiteId(event.target.value)}
                      required
                      disabled={formBusy || sites.length === 0}
                    >
                      {sites.length === 0 ? (
                        <option value="">No sites yet</option>
                      ) : (
                        sites.map((site) => (
                          <option key={site.id} value={site.id}>
                            {site.name}
                          </option>
                        ))
                      )}
                    </Select>
                  </Field>
                )}
              </FieldGrid>
            </FormSection>
          </ComplianceItemForm>
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recorded items</CardTitle>
          <CardDescription>
            {archivedOnly
              ? 'Archived records are hidden from dashboards and alerts. Restore to bring them back.'
              : 'Status is calculated from expiry dates. Archive hides a record without deleting it.'}
          </CardDescription>
          <CardAction>
            <span className="text-sm tabular-nums text-muted-foreground">
              {items.length === 0 || !filtering
                ? items.length
                : `${filteredItems.length} of ${items.length}`}
            </span>
          </CardAction>
        </CardHeader>
        {!loading ? (
          <ListFilters
            query={query}
            onQueryChange={setQuery}
            queryPlaceholder="Search by name"
            status={statusFilter}
            onStatusChange={setStatusFilter}
            siteId={siteFilter}
            onSiteChange={setSiteFilter}
            sites={sites}
          />
        ) : null}
        <CardContent className="px-0">
          {loading ? (
            <PageMuted>Loading items…</PageMuted>
          ) : !organizationId ? (
            <PageMuted>
              No organization yet. Sign out and back in if this persists.
            </PageMuted>
          ) : items.length === 0 ? (
            <PageMuted>
              {archivedOnly
                ? 'No archived compliance items.'
                : 'No compliance items yet.'}
            </PageMuted>
          ) : filteredItems.length === 0 ? (
            <PageMuted>No matching items.</PageMuted>
          ) : (
            <Table>
              <THead>
                <Th>Type</Th>
                <Th>Owner</Th>
                <Th>Expiry</Th>
                <Th>Last verified</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </THead>
              <tbody>
                {filteredItems.map((item) => {
                  const status = complianceStatus(item.expiry_date)
                  const profilePath = item.staff_id
                    ? paths.staffProfile(item.staff_id)
                    : paths.siteProfile(item.site_id)
                  return (
                    <Tr key={item.id} className="hover:bg-muted/40">
                      <Td slot="label">
                        <p className="font-medium text-card-foreground">
                          {item.typeName}
                        </p>
                        {item.label && item.label !== item.typeName ? (
                          <p className="text-xs text-muted-foreground">{item.label}</p>
                        ) : null}
                        <p className="mt-0.5 text-xs text-muted-foreground md:hidden">
                          {item.ownerName}
                          {' · '}
                          {item.ownerKind === 'staff' ? 'Staff' : 'Site'}
                        </p>
                      </Td>
                      <Td slot="extra">
                        <Link
                          to={profilePath}
                          className="inline-flex min-h-11 items-center text-card-foreground underline underline-offset-2"
                        >
                          {item.ownerName}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {item.ownerKind === 'staff' ? 'Staff' : 'Site'}
                        </p>
                      </Td>
                      <Td
                        slot="expiry"
                        label="Expiry"
                        className="tabular-nums text-muted-foreground"
                      >
                        {formatDate(item.expiry_date)}
                      </Td>
                      <Td slot="extra" className="tabular-nums text-muted-foreground">
                        {hasRecheckInterval(item)
                          ? formatDate(item.last_verified_date)
                          : '—'}
                      </Td>
                      <Td slot="status">
                        <StatusBadge status={status} />
                      </Td>
                      <Td slot="action">
                        <div className="flex flex-wrap justify-end gap-2 max-md:justify-start">
                          {archivedOnly ? null : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => startEdit(item)}
                              disabled={Boolean(verifyingId)}
                            >
                              Edit
                            </Button>
                          )}
                          {editingId === item.id ? null : (
                            <DocumentActions
                              path={item.document_url}
                              itemId={item.id}
                              orgId={item.org_id ?? organizationId}
                              disabled={Boolean(verifyingId)}
                              onChanged={() => refreshItems()}
                            />
                          )}
                          {archivedOnly || !hasRecheckInterval(item) ? null : (
                            <MarkVerifiedButton
                              onClick={() => handleMarkVerified(item)}
                              disabled={Boolean(verifyingId) && verifyingId !== item.id}
                              saving={verifyingId === item.id}
                            />
                          )}
                          {archivedOnly ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => handleRestore(item)}
                                disabled={
                                  restoringId === item.id ||
                                  deletingId === item.id
                                }
                              >
                                {restoringId === item.id
                                  ? 'Restoring…'
                                  : 'Restore'}
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={() => setPendingPermanentDelete(item)}
                                disabled={
                                  restoringId === item.id ||
                                  deletingId === item.id
                                }
                              >
                                Delete permanently
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setPendingArchive(item)}
                              disabled={
                                Boolean(verifyingId) || deletingId === item.id
                              }
                            >
                              {deletingId === item.id ? 'Archiving…' : 'Archive'}
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDeleteDialog
        open={Boolean(pendingArchive)}
        onOpenChange={(open) => {
          if (!open) setPendingArchive(null)
        }}
        title={
          pendingArchive ? itemArchiveTitle(pendingArchive) : 'Archive item?'
        }
        description={
          pendingArchive
            ? itemArchiveWarning(pendingArchive)
            : ITEM_ARCHIVE_WARNING
        }
        confirming={Boolean(pendingArchive && deletingId === pendingArchive.id)}
        onConfirm={handleArchive}
        confirmLabel="Archive"
        confirmingLabel="Archiving…"
        variant="default"
      />
      <ConfirmDeleteDialog
        open={Boolean(pendingPermanentDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingPermanentDelete(null)
        }}
        title={
          pendingPermanentDelete
            ? itemDeleteTitle(pendingPermanentDelete)
            : 'Delete permanently?'
        }
        description={
          pendingPermanentDelete
            ? itemDeleteWarning(pendingPermanentDelete)
            : ITEM_DELETE_WARNING
        }
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
