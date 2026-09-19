import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Card,
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
  STAFF_DELETE_WARNING,
  staffDeleteTitle,
} from './ConfirmDeleteDialog'
import { ProfileComplianceHeader } from './ProfileComplianceHeader'
import { ProfileSkeleton } from './PageSkeletons'
import { DocumentAttached } from './DocumentLink'
import { StatusBadge } from './StatusBadge'
import { Table, Td, Th, THead, Tr } from './ui/data-table'
import {
  Choice,
  ChoiceRow,
  DateInput,
  Field,
  FieldGrid,
  FormActions,
  FormSection,
  Input,
  Textarea,
} from './ui/form'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import { paths } from '../lib/paths'
import { formatDate } from '../lib/format'
import { validateIsoDate } from '../lib/dates'
import {
  complianceStatus,
  saveComplianceItem,
  formValuesFromItem,
  hasRecheckInterval,
  listRequirementTypes,
  listStaffComplianceItems,
  markItemVerifiedToday,
  todayIsoDate,
  tracksVerification,
  isStaffRequirementType,
} from '../lib/compliance'
import {
  addStaffRequirementExclusion,
  isRequirementExcluded,
  listStaffRequirementExclusions,
  removeStaffRequirementExclusion,
} from '../lib/exclusions'
import { summarizeProfileRequirements } from '../lib/profileCompliance'
import { firstError } from '../lib/query'
import { listSites } from '../lib/sites'
import { deleteStaff, getStaff, isActiveStaff, updateStaff } from '../lib/staff'

function staffInfoFromMember(member) {
  return {
    name: member?.name ?? '',
    role: member?.role ?? '',
    employmentStatus: member?.employment_status ?? 'active',
    startDate: member?.start_date ?? '',
    email: member?.email ?? '',
    phone: member?.phone ?? '',
    notes: member?.notes ?? '',
    selectedSiteIds: (member?.sites ?? []).map((site) => site.id),
  }
}

export function StaffProfile() {
  const { staffId } = useParams()
  const navigate = useNavigate()
  const { organizationId } = useAuth()
  const [member, setMember] = useState(null)
  const [info, setInfo] = useState(staffInfoFromMember(null))
  const [requirementTypes, setRequirementTypes] = useState([])
  const [items, setItems] = useState([])
  const [exclusions, setExclusions] = useState([])
  const [sites, setSites] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingInfo, setSavingInfo] = useState(false)
  const [infoErrors, setInfoErrors] = useState({})
  const [fillingTypeId, setFillingTypeId] = useState(null)
  const [editingItemId, setEditingItemId] = useState(null)
  const [togglingTypeId, setTogglingTypeId] = useState(null)
  const [formValues, setFormValues] = useState(EMPTY_COMPLIANCE_ITEM_VALUES)
  const [saving, setSaving] = useState(false)
  const [verifyingId, setVerifyingId] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)

  useEffect(() => {
    if (!organizationId || !staffId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      const [
        staffResult,
        typesResult,
        itemsResult,
        exclusionsResult,
        sitesResult,
      ] = await Promise.all([
        getStaff(staffId),
        listRequirementTypes(organizationId),
        listStaffComplianceItems(organizationId, staffId),
        listStaffRequirementExclusions([staffId]),
        listSites(organizationId),
      ])
      if (cancelled) return

      const loadError = firstError(
        staffResult,
        typesResult,
        itemsResult,
        exclusionsResult,
        sitesResult,
      )
      if (loadError) {
        setError(loadError.message)
        setLoading(false)
        return
      }

      setMember(staffResult.data)
      setInfo(staffInfoFromMember(staffResult.data))
      setRequirementTypes(typesResult.data.filter(isStaffRequirementType))
      setItems(itemsResult.data)
      setExclusions(exclusionsResult.data)
      setSites(sitesResult.data)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId, staffId])

  const rows = useMemo(() => {
    return requirementTypes.map((requirementType) => {
      const item = items.find(
        (entry) => entry.requirement_type_id === requirementType.id,
      )
      return { requirementType, item }
    })
  }, [requirementTypes, items])

  const complianceSummary = useMemo(
    () =>
      summarizeProfileRequirements(rows, (typeId) =>
        isRequirementExcluded(exclusions, staffId, typeId),
      ),
    [rows, exclusions, staffId],
  )

  function resetForm() {
    setFillingTypeId(null)
    setEditingItemId(null)
    setFormValues(EMPTY_COMPLIANCE_ITEM_VALUES)
  }

  function startFillIn(requirementType) {
    setEditingItemId(null)
    setFillingTypeId(requirementType.id)
    setFormValues({
      ...EMPTY_COMPLIANCE_ITEM_VALUES,
      label: requirementType.name,
    })
    setError('')
  }

  function startEdit(item) {
    setFillingTypeId(null)
    setEditingItemId(item.id)
    setFormValues(formValuesFromItem(item))
    setError('')
  }

  async function refreshItems() {
    const { data, error: selectError } = await listStaffComplianceItems(
      organizationId,
      staffId,
    )
    if (selectError) {
      return { error: selectError }
    }
    setItems(data)
    return { error: null }
  }

  function setInfoField(field, value) {
    setInfo((current) => ({ ...current, [field]: value }))
    if (infoErrors[field]) {
      setInfoErrors((current) => {
        const next = { ...current }
        delete next[field]
        return next
      })
    }
  }

  async function handleSaveInfo(event) {
    event.preventDefault()
    if (!staffId) return

    const startDateError = validateIsoDate(info.startDate, {
      invalidLabel: 'start date',
    })
    if (startDateError) {
      setInfoErrors({ startDate: startDateError })
      return
    }

    setInfoErrors({})
    setError('')
    setSavingInfo(true)

    const { data, error: saveError } = await updateStaff({
      id: staffId,
      name: info.name.trim(),
      role: info.role.trim(),
      employmentStatus: info.employmentStatus,
      startDate: info.startDate,
      email: info.email,
      phone: info.phone,
      notes: info.notes,
      siteIds: info.selectedSiteIds,
    })

    if (saveError) {
      setError(saveError.message)
      setSavingInfo(false)
      return
    }

    setMember(data)
    setInfo(staffInfoFromMember(data))
    setSavingInfo(false)
  }

  async function handleSave(event, requirementType) {
    event.preventDefault()
    if (!organizationId || !staffId) return

    setError('')
    setSaving(true)

    const payload = {
      requirementTypeId: requirementType.id,
      label: formValues.label.trim(),
      expiryDate: formValues.expiryDate,
      referenceNumber: formValues.referenceNumber,
      issuedDate: formValues.issuedDate,
      issuer: formValues.issuer,
      status: formValues.status,
      lastVerifiedDate: tracksVerification(requirementType)
        ? formValues.lastVerifiedDate
        : null,
    }

    const { error: saveError } = await saveComplianceItem({
      id: editingItemId,
      documentFile: formValues.documentFile,
      currentDocumentPath: formValues.documentUrl,
      ...payload,
      orgId: organizationId,
      staffId,
      siteId: null,
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

    if (editingItemId === item.id) {
      setFormValues((current) => ({
        ...current,
        lastVerifiedDate: todayIsoDate(),
      }))
    }

    setVerifyingId(null)
  }

  async function refreshExclusions() {
    const { data, error: selectError } = await listStaffRequirementExclusions([
      staffId,
    ])
    if (selectError) {
      return { error: selectError }
    }
    setExclusions(data)
    return { error: null }
  }

  async function handleToggleNotApplicable(requirementType) {
    if (!staffId) return

    setError('')
    setTogglingTypeId(requirementType.id)
    resetForm()

    const excluded = isRequirementExcluded(exclusions, staffId, requirementType.id)
    const previous = exclusions
    setExclusions((current) =>
      excluded
        ? current.filter(
            (row) =>
              !(
                String(row.staff_id) === String(staffId) &&
                String(row.requirement_type_id) === String(requirementType.id)
              ),
          )
        : [
            ...current,
            { staff_id: staffId, requirement_type_id: requirementType.id },
          ],
    )

    const { error: toggleError } = excluded
      ? await removeStaffRequirementExclusion(staffId, requirementType.id)
      : await addStaffRequirementExclusion(staffId, requirementType.id)

    if (toggleError) {
      setExclusions(previous)
      setError(toggleError.message)
      setTogglingTypeId(null)
      return
    }

    const { error: selectError } = await refreshExclusions()
    if (selectError) {
      setError(selectError.message)
    }
    setTogglingTypeId(null)
  }

  async function handleDeleteStaff() {
    if (!staffId) return

    setError('')
    setDeleting(true)

    const { error: deleteError } = await deleteStaff(staffId)
    if (deleteError) {
      setError(deleteError.message)
      setDeleting(false)
      return
    }

    navigate(paths.staff, { replace: true })
  }

  const active = isActiveStaff(member)
  const memberName = member?.name ?? 'this staff member'

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title={member?.name ?? 'Staff profile'}
        description={
          member
            ? `${member.role}. ${
                active
                  ? 'Every requirement type for your organization, with this person’s status.'
                  : 'This staff member is inactive, so their requirements are not tracked.'
              }`
            : 'Staff details and requirements.'
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to={paths.staff}>Back to staff</Link>
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setPendingDelete(true)}
              disabled={loading || deleting}
            >
              {deleting ? 'Deleting…' : 'Delete staff'}
            </Button>
          </>
        }
      />

      <PageError>{error}</PageError>

      {loading ? (
        <ProfileSkeleton />
      ) : (
        <div className="flex flex-col gap-4">
          {active ? (
            <ProfileComplianceHeader
              summary={complianceSummary}
              onReviewUrgent={() => {
                const urgent = complianceSummary.mostUrgent
                if (!urgent) return
                if (urgent.item) startEdit(urgent.item)
                else startFillIn(urgent.requirementType)
                window.setTimeout(() => {
                  document
                    .getElementById(
                      `requirement-${urgent.requirementType.id}`,
                    )
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }, 50)
              }}
            />
          ) : null}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
            <div className="min-w-0">
          <Card>
            <CardHeader>
              <CardTitle>Personal information</CardTitle>
              <CardDescription>Contact, employment, sites, and notes.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={handleSaveInfo}>
                <FormSection title="Details">
                  <FieldGrid>
                    <Field label="Name">
                      <Input
                        type="text"
                        name="name"
                        value={info.name}
                        onChange={(event) =>
                          setInfoField('name', event.target.value)
                        }
                        required
                        disabled={savingInfo}
                      />
                    </Field>
                    <Field label="Role">
                      <Input
                        type="text"
                        name="role"
                        value={info.role}
                        onChange={(event) =>
                          setInfoField('role', event.target.value)
                        }
                        required
                        disabled={savingInfo}
                      />
                    </Field>
                    <Field label="Email">
                      <Input
                        type="email"
                        name="email"
                        value={info.email}
                        onChange={(event) =>
                          setInfoField('email', event.target.value)
                        }
                        disabled={savingInfo}
                      />
                    </Field>
                    <Field label="Phone">
                      <Input
                        type="tel"
                        name="phone"
                        value={info.phone}
                        onChange={(event) =>
                          setInfoField('phone', event.target.value)
                        }
                        disabled={savingInfo}
                      />
                    </Field>
                  </FieldGrid>
                </FormSection>

                <FormSection title="Employment">
                  <FieldGrid>
                    <Field label="Status">
                      <ChoiceRow disabled={savingInfo}>
                        <Choice
                          type="radio"
                          name="employment_status"
                          value="active"
                          checked={info.employmentStatus === 'active'}
                          onChange={() =>
                            setInfoField('employmentStatus', 'active')
                          }
                          disabled={savingInfo}
                        >
                          Active
                        </Choice>
                        <Choice
                          type="radio"
                          name="employment_status"
                          value="inactive"
                          checked={info.employmentStatus === 'inactive'}
                          onChange={() =>
                            setInfoField('employmentStatus', 'inactive')
                          }
                          disabled={savingInfo}
                        >
                          Inactive
                        </Choice>
                      </ChoiceRow>
                    </Field>
                    <Field label="Start date" error={infoErrors.startDate}>
                      <DateInput
                        name="start_date"
                        value={info.startDate}
                        onChange={(event) =>
                          setInfoField('startDate', event.target.value)
                        }
                        aria-invalid={Boolean(infoErrors.startDate)}
                        disabled={savingInfo}
                      />
                    </Field>
                  </FieldGrid>
                </FormSection>

                <FormSection title="Sites they work at">
                  {sites.length === 0 ? (
                    <p className="text-sm font-normal text-muted-foreground">
                      No sites yet. Add a site first.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {sites.map((site) => {
                        const selected = info.selectedSiteIds.includes(site.id)
                        return (
                          <button
                            key={site.id}
                            type="button"
                            onClick={() =>
                              setInfoField(
                                'selectedSiteIds',
                                selected
                                  ? info.selectedSiteIds.filter(
                                      (id) => id !== site.id,
                                    )
                                  : [...info.selectedSiteIds, site.id],
                              )
                            }
                            disabled={savingInfo}
                            className={[
                              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                              selected
                                ? 'border-transparent bg-primary text-primary-foreground'
                                : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                            ].join(' ')}
                          >
                            {site.name}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </FormSection>

                <FormSection title="Notes">
                  <Field label="Notes" className="sm:col-span-2">
                    <Textarea
                      name="notes"
                      value={info.notes}
                      onChange={(event) =>
                        setInfoField('notes', event.target.value)
                      }
                      disabled={savingInfo}
                    />
                  </Field>
                </FormSection>

                <FormActions>
                  <Button type="submit" disabled={savingInfo}>
                    {savingInfo ? 'Saving…' : 'Save'}
                  </Button>
                </FormActions>
              </form>
            </CardContent>
          </Card>
            </div>
            <div className="min-w-0">
          <Card>
            <CardHeader>
              <CardTitle>Requirements</CardTitle>
              <CardDescription>
                Coloured status is calculated from expiry dates.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {!active ? (
                <PageMuted>
                  Inactive staff are excluded from compliance tracking.
                </PageMuted>
              ) : rows.length === 0 ? (
                <PageMuted>No requirement types yet.</PageMuted>
              ) : (
                <Table>
                  <THead>
                    <Th>Requirement</Th>
                    <Th>Expiry</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </THead>
                  <tbody>
                    {rows.map(({ requirementType, item }) => {
                      const excluded = isRequirementExcluded(
                        exclusions,
                        staffId,
                        requirementType.id,
                      )
                      const missing = !excluded && !item
                      const itemStatus = excluded
                        ? 'Not applicable'
                        : missing
                          ? 'Missing'
                          : complianceStatus(item.expiry_date)
                      const isEditing = Boolean(item) && editingItemId === item.id
                      const isFilling =
                        missing && fillingTypeId === requirementType.id
                      const showForm = isEditing || isFilling
                      const busy =
                        saving ||
                        togglingTypeId === requirementType.id ||
                        verifyingId === item?.id

                      return (
                        <Fragment key={requirementType.id}>
                          <Tr
                            id={`requirement-${requirementType.id}`}
                            className={
                              missing
                                ? 'bg-status-expired-muted hover:bg-status-expired/10'
                                : 'hover:bg-muted/40'
                            }
                          >
                            <Td slot="label">
                              {excluded ? (
                                <p className="font-medium text-card-foreground">
                                  {requirementType.name}
                                </p>
                              ) : (
                                <button
                                  type="button"
                                  className="text-left font-medium text-card-foreground underline-offset-2 hover:underline disabled:opacity-50"
                                  onClick={() => {
                                    if (showForm) resetForm()
                                    else if (item) startEdit(item)
                                    else startFillIn(requirementType)
                                  }}
                                  disabled={busy}
                                  aria-expanded={showForm}
                                >
                                  {requirementType.name}
                                </button>
                              )}
                              {item?.label && item.label !== requirementType.name ? (
                                <p className="text-xs text-muted-foreground">
                                  {item.label}
                                </p>
                              ) : null}
                              <DocumentAttached
                                path={item?.document_url}
                                disabled={busy}
                              />
                            </Td>
                            <Td
                              slot="expiry"
                              label="Expiry"
                              className="tabular-nums text-muted-foreground"
                            >
                              {excluded || missing
                                ? '—'
                                : formatDate(item.expiry_date)}
                            </Td>
                            <Td slot="status">
                              <StatusBadge status={itemStatus} />
                            </Td>
                            <Td slot="action">
                              <div className="flex flex-wrap justify-end gap-2 max-md:justify-start">
                                {excluded ? null : missing ? (
                                  showForm ? null : (
                                    <Button
                                      type="button"
                                      size="sm"
                                      onClick={() => startFillIn(requirementType)}
                                      disabled={busy}
                                    >
                                      Fill in
                                    </Button>
                                  )
                                ) : (
                                  <>
                                    {showForm ? null : (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="md:hidden"
                                        onClick={() => startEdit(item)}
                                        disabled={busy}
                                      >
                                        Edit
                                      </Button>
                                    )}
                                    {hasRecheckInterval(requirementType) ? (
                                      <MarkVerifiedButton
                                        onClick={() => handleMarkVerified(item)}
                                        disabled={busy}
                                        saving={verifyingId === item.id}
                                      />
                                    ) : null}
                                  </>
                                )}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleToggleNotApplicable(requirementType)
                                  }
                                  disabled={busy}
                                >
                                  {togglingTypeId === requirementType.id
                                    ? 'Saving…'
                                    : excluded
                                      ? 'Mark as applicable'
                                      : 'Not applicable'}
                                </Button>
                              </div>
                            </Td>
                          </Tr>
                          {showForm ? (
                            <Tr slot="expand">
                              <Td slot="expand" colSpan={4} className="bg-muted/30 max-md:bg-transparent">
                                <ComplianceItemForm
                                  onSubmit={(event) =>
                                    handleSave(event, requirementType)
                                  }
                                  onCancel={resetForm}
                                  saving={saving}
                                  values={formValues}
                                  onChange={setFormValues}
                                  showLastVerified={tracksVerification(
                                    requirementType,
                                  )}
                                  validityMonths={requirementType.validity_months}
                                  disabled={saving}
                                  documentContext={
                                    item
                                      ? {
                                          itemId: item.id,
                                          orgId: item.org_id ?? organizationId,
                                        }
                                      : null
                                  }
                                  onDocumentChange={() => refreshItems()}
                                />
                              </Td>
                            </Tr>
                          ) : null}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </Table>
              )}
            </CardContent>
          </Card>
            </div>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        open={pendingDelete}
        onOpenChange={setPendingDelete}
        title={staffDeleteTitle(memberName)}
        description={STAFF_DELETE_WARNING}
        confirming={deleting}
        onConfirm={handleDeleteStaff}
      />
    </section>
  )
}
