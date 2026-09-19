import { Fragment, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ComplianceItemFields,
  EMPTY_COMPLIANCE_ITEM_VALUES,
  validateComplianceItemValues,
} from './ComplianceItemFields'
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
} from './ui/form'
import { PageError, PageHeader } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import {
  complianceStatus,
  saveComplianceItem,
  isStaffRequirementType,
  listRequirementTypes,
  resolveRecheckDays,
} from '../lib/compliance'
import { paths } from '../lib/paths'
import { firstError } from '../lib/query'
import { validateIsoDate } from '../lib/dates'
import { listSites } from '../lib/sites'
import { createStaff } from '../lib/staff'

const EMPTY_STAFF_FORM = {
  name: '',
  role: '',
  employmentStatus: 'active',
  startDate: '',
  email: '',
  phone: '',
  selectedSiteIds: [],
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function NewStaff() {
  const { organizationId } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY_STAFF_FORM)
  const [sites, setSites] = useState([])
  const [requirementTypes, setRequirementTypes] = useState([])
  const [drafts, setDrafts] = useState({})
  const [fillingTypeId, setFillingTypeId] = useState(null)
  const [draftValues, setDraftValues] = useState(EMPTY_COMPLIANCE_ITEM_VALUES)
  const [draftErrors, setDraftErrors] = useState({})
  const [staffErrors, setStaffErrors] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  function setFormField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    if (staffErrors[field]) {
      setStaffErrors((current) => {
        const next = { ...current }
        delete next[field]
        return next
      })
    }
  }

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      const [sitesResult, typesResult] = await Promise.all([
        listSites(organizationId),
        listRequirementTypes(organizationId),
      ])
      if (cancelled) return

      const loadError = firstError(sitesResult, typesResult)
      if (loadError) {
        setError(loadError.message)
        setLoading(false)
        return
      }

      setSites(sitesResult.data)
      setRequirementTypes(typesResult.data.filter(isStaffRequirementType))
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId])

  function toggleSite(siteId) {
    setForm((current) => ({
      ...current,
      selectedSiteIds: current.selectedSiteIds.includes(siteId)
        ? current.selectedSiteIds.filter((id) => id !== siteId)
        : [...current.selectedSiteIds, siteId],
    }))
  }

  function startFillIn(requirementType) {
    setError('')
    setDraftErrors({})
    setFillingTypeId(requirementType.id)
    setDraftValues(
      drafts[requirementType.id] ?? {
        ...EMPTY_COMPLIANCE_ITEM_VALUES,
        label: requirementType.name,
      },
    )
  }

  function cancelFillIn() {
    setFillingTypeId(null)
    setDraftValues(EMPTY_COMPLIANCE_ITEM_VALUES)
    setDraftErrors({})
  }

  function updateDraftValues(next) {
    setDraftValues(next)
    if (Object.keys(draftErrors).length > 0) setDraftErrors({})
  }

  function commitDraft() {
    if (!fillingTypeId) return null
    const fieldErrors = validateComplianceItemValues(draftValues)
    if (Object.keys(fieldErrors).length > 0) {
      setDraftErrors(fieldErrors)
      return null
    }

    const next = { ...drafts, [fillingTypeId]: { ...draftValues } }
    setDrafts(next)
    cancelFillIn()
    return next
  }

  function removeDraft(typeId) {
    setDrafts((current) => {
      const next = { ...current }
      delete next[typeId]
      return next
    })
    if (fillingTypeId === typeId) cancelFillIn()
  }

  function draftsToSave() {
    if (fillingTypeId && Object.keys(validateComplianceItemValues(draftValues)).length === 0) {
      return { ...drafts, [fillingTypeId]: { ...draftValues } }
    }
    return drafts
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!organizationId) return

    if (fillingTypeId) {
      const fieldErrors = validateComplianceItemValues(draftValues)
      if (Object.keys(fieldErrors).length > 0) {
        setDraftErrors(fieldErrors)
        return
      }
    }

    const startDateError = validateIsoDate(form.startDate, {
      invalidLabel: 'start date',
    })
    if (startDateError) {
      setStaffErrors({ startDate: startDateError })
      return
    }

    setStaffErrors({})
    setError('')
    setSaving(true)

    const { data: member, error: insertError } = await createStaff({
      name: form.name.trim(),
      role: form.role.trim(),
      employmentStatus: form.employmentStatus,
      startDate: form.startDate,
      email: form.email,
      phone: form.phone,
      siteIds: form.selectedSiteIds,
      orgId: organizationId,
    })
    if (insertError) {
      setError(insertError.message)
      setSaving(false)
      return
    }

    const pendingDrafts = draftsToSave()
    for (const requirementType of requirementTypes) {
      const values = pendingDrafts[requirementType.id]
      if (!values) continue

      const { error: itemError } = await saveComplianceItem({
        documentFile: values.documentFile,
        requirementTypeId: requirementType.id,
        label: values.label.trim() || requirementType.name,
        expiryDate: values.expiryDate,
        referenceNumber: values.referenceNumber,
        issuedDate: values.issuedDate,
        issuer: values.issuer,
        status: values.status,
        lastVerifiedDate: resolveRecheckDays(requirementType)
          ? values.lastVerifiedDate
          : null,
        orgId: organizationId,
        staffId: member.id,
        siteId: null,
      })
      if (itemError) {
        setError(
          `${requirementType.name} could not be saved: ${itemError.message}`,
        )
        navigate(paths.staffProfile(member.id))
        return
      }
    }

    navigate(paths.staff)
  }

  const busy = !organizationId || saving || loading

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title="New staff"
        description="Add a person, assign sites, and record their current certificates or checks."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={paths.staff}>Back to staff</Link>
          </Button>
        }
      />

      <PageError>{error}</PageError>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Staff details</CardTitle>
            <CardDescription>
              Name, role, employment, contact, and site assignment.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <FormSection title="Details">
              <FieldGrid>
                <Field label="Name">
                  <Input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={(event) => setFormField('name', event.target.value)}
                    required
                    disabled={busy}
                  />
                </Field>
                <Field label="Role">
                  <Input
                    type="text"
                    name="role"
                    value={form.role}
                    onChange={(event) => setFormField('role', event.target.value)}
                    required
                    disabled={busy}
                  />
                </Field>
              </FieldGrid>
            </FormSection>

            <FormSection title="Employment">
              <FieldGrid>
                <Field label="Status">
                  <ChoiceRow disabled={busy}>
                    <Choice
                      type="radio"
                      name="employment_status"
                      value="active"
                      checked={form.employmentStatus === 'active'}
                      onChange={() => setFormField('employmentStatus', 'active')}
                      disabled={busy}
                    >
                      Active
                    </Choice>
                    <Choice
                      type="radio"
                      name="employment_status"
                      value="inactive"
                      checked={form.employmentStatus === 'inactive'}
                      onChange={() => setFormField('employmentStatus', 'inactive')}
                      disabled={busy}
                    >
                      Inactive
                    </Choice>
                  </ChoiceRow>
                </Field>
                <Field label="Start date" error={staffErrors.startDate}>
                  <DateInput
                    name="start_date"
                    value={form.startDate}
                    onChange={(event) =>
                      setFormField('startDate', event.target.value)
                    }
                    aria-invalid={Boolean(staffErrors.startDate)}
                    disabled={busy}
                  />
                </Field>
              </FieldGrid>
            </FormSection>

            <FormSection title="Contact">
              <FieldGrid>
                <Field label="Email">
                  <Input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={(event) =>
                      setFormField('email', event.target.value)
                    }
                    disabled={busy}
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    type="tel"
                    name="phone"
                    value={form.phone}
                    onChange={(event) =>
                      setFormField('phone', event.target.value)
                    }
                    disabled={busy}
                  />
                </Field>
              </FieldGrid>
            </FormSection>

            <FormSection title="Sites they work at">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading sites…</p>
              ) : sites.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No sites yet. Add a site first, or save without a site
                  assignment.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
                  {sites.map((site) => (
                    <Choice
                      key={site.id}
                      type="checkbox"
                      checked={form.selectedSiteIds.includes(site.id)}
                      onChange={() => toggleSite(site.id)}
                      disabled={busy}
                    >
                      {site.name}
                    </Choice>
                  ))}
                </div>
              )}
            </FormSection>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Requirements</CardTitle>
            <CardDescription>
              Fill in certificates and checks you already have. You can add the
              rest later from their profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {loading ? (
              <p className="px-4 pb-4 text-sm text-muted-foreground">
                Loading requirements…
              </p>
            ) : requirementTypes.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted-foreground">
                No staff requirement types yet.
              </p>
            ) : (
              <Table>
                <THead>
                  <Th>Requirement</Th>
                  <Th>Expiry</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </THead>
                <tbody>
                  {requirementTypes.map((requirementType) => {
                    const draft = drafts[requirementType.id]
                    const isFilling = fillingTypeId === requirementType.id
                    return (
                      <Fragment key={requirementType.id}>
                        <Tr className="hover:bg-muted/40">
                          <Td slot="label">
                            <p className="font-medium text-card-foreground">
                              {requirementType.name}
                            </p>
                            {requirementType.mandatory ? (
                              <p className="text-xs text-muted-foreground">
                                Mandatory
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Optional
                              </p>
                            )}
                          </Td>
                          <Td
                            slot="expiry"
                            label="Expiry"
                            className="tabular-nums text-muted-foreground"
                          >
                            {draft ? formatDate(draft.expiryDate) : '—'}
                          </Td>
                          <Td slot="status">
                            <StatusBadge
                              status={
                                draft
                                  ? complianceStatus(draft.expiryDate)
                                  : 'Missing'
                              }
                            />
                          </Td>
                          <Td slot="action" className="text-right">
                            <div className="flex flex-wrap justify-end gap-2 max-md:justify-start">
                              {isFilling ? null : (
                                <Button
                                  type="button"
                                  variant={draft ? 'outline' : 'default'}
                                  size="sm"
                                  onClick={() => startFillIn(requirementType)}
                                  disabled={busy}
                                >
                                  {draft ? 'Edit' : 'Fill in'}
                                </Button>
                              )}
                              {draft ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeDraft(requirementType.id)}
                                  disabled={busy}
                                >
                                  Remove
                                </Button>
                              ) : null}
                            </div>
                          </Td>
                        </Tr>
                        {isFilling ? (
                          <Tr slot="expand">
                            <Td slot="expand" colSpan={4} className="bg-muted/30 max-md:bg-transparent">
                              <div className="space-y-5">
                                <ComplianceItemFields
                                  values={draftValues}
                                  onChange={updateDraftValues}
                                  errors={draftErrors}
                                  showLastVerified={Boolean(
                                    resolveRecheckDays(requirementType),
                                  )}
                                  validityMonths={
                                    requirementType.validity_months
                                  }
                                  disabled={busy}
                                />
                                <FormActions>
                                  <Button
                                    type="button"
                                    onClick={commitDraft}
                                    disabled={busy}
                                  >
                                    Add requirement
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={cancelFillIn}
                                    disabled={busy}
                                  >
                                    Cancel
                                  </Button>
                                </FormActions>
                              </div>
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

        <FormActions>
          <Button type="submit" disabled={busy}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button asChild variant="outline" disabled={saving}>
            <Link to={paths.staff}>Cancel</Link>
          </Button>
        </FormActions>
      </form>
    </section>
  )
}
