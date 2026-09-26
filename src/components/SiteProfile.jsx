import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
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
  PERMANENT_DELETE_PHRASE,
  SITE_ARCHIVE_WARNING,
  SITE_DELETE_WARNING,
  itemArchiveTitle,
  itemArchiveWarning,
  siteArchiveTitle,
  siteDeleteTitle,
} from './ConfirmDeleteDialog'
import { ProfileComplianceHeader } from './ProfileComplianceHeader'
import { AlertTimingHint } from './AlertTimingHint'
import { ProfileSkeleton } from './PageSkeletons'
import { ProgressPill } from './ProgressPill'
import { DocumentAttached } from './DocumentLink'
import { StatusBadge } from './StatusBadge'
import { Table, Td, Th, THead, Tr } from './ui/data-table'
import { Field, FieldGrid, FormActions, FormSection, Input } from './ui/form'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { useAuth } from '../hooks/useAuth'
import { paths } from '../lib/paths'
import { formatDate } from '../lib/format'
import {
  attentionStatus,
  archiveComplianceItem,
  formValuesFromItem,
  hasRecheckInterval,
  isSiteRequirementType,
  isStaffRequirementType,
  listRequirementTypes,
  listSiteComplianceItems,
  listStaffComplianceItemsAtSite,
  markItemVerifiedToday,
  todayIsoDate,
  saveComplianceItem,
  tracksVerification,
} from '../lib/compliance'
import {
  addSiteRequirementExclusion,
  isRequirementExcluded,
  isSiteRequirementExcluded,
  listStaffRequirementExclusionsAtSite,
  listSiteRequirementExclusions,
  removeSiteRequirementExclusion,
} from '../lib/exclusions'
import { countStaffGaps } from '../lib/gaps'
import {
  buildStaffRequirementRows,
  summarizeProfileRequirements,
} from '../lib/profileCompliance'
import { firstError } from '../lib/query'
import { isActiveStaff, listStaffBySite } from '../lib/staff'
import { SiteFloorLinks } from './SiteFloorLinks'
import { SiteHoursSettings } from './SiteHoursSettings'
import {
  archiveSite,
  DEFAULT_OPERATING_DAYS,
  deleteSite,
  EMPTY_OPERATING_DAYS_MESSAGE,
  getSite,
  restoreSite,
  updateSite,
} from '../lib/sites'
import { isArchived } from '../lib/archive'

function siteInfoFromSite(site) {
  return {
    name: site?.name ?? '',
    address: site?.address ?? '',
    serviceApprovalNumber: site?.service_approval_number ?? '',
    phone: site?.phone ?? '',
    nominatedSupervisor: site?.nominated_supervisor ?? '',
    alertEmail: site?.alert_email ?? '',
    operatingDays: site?.operating_days ?? DEFAULT_OPERATING_DAYS,
  }
}

export function SiteProfile() {
  const { siteId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { organizationId } = useAuth()
  const [site, setSite] = useState(null)
  const [info, setInfo] = useState(siteInfoFromSite(null))
  const [requirementTypes, setRequirementTypes] = useState([])
  const [staffTypes, setStaffTypes] = useState([])
  const [items, setItems] = useState([])
  const [exclusions, setExclusions] = useState([])
  const [siteStaff, setSiteStaff] = useState([])
  const [staffItems, setStaffItems] = useState([])
  const [staffExclusions, setStaffExclusions] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingInfo, setSavingInfo] = useState(false)
  const [fillingTypeId, setFillingTypeId] = useState(null)
  const [editingItemId, setEditingItemId] = useState(null)
  const [togglingTypeId, setTogglingTypeId] = useState(null)
  const [formValues, setFormValues] = useState(EMPTY_COMPLIANCE_ITEM_VALUES)
  const [saving, setSaving] = useState(false)
  const [verifyingId, setVerifyingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [deletingSite, setDeletingSite] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [pendingSiteArchive, setPendingSiteArchive] = useState(false)
  const [pendingPermanentDelete, setPendingPermanentDelete] = useState(false)
  const [pendingItemArchive, setPendingItemArchive] = useState(null)
  const deepLinkTab =
    searchParams.get('tab') === 'requirements' ? 'requirements' : null
  const deepLinkKey = deepLinkTab
    ? `${siteId}:${deepLinkTab}:${location.hash}`
    : `${siteId}:none`
  const [profileTab, setProfileTab] = useState(deepLinkTab ?? 'details')
  const [appliedDeepLink, setAppliedDeepLink] = useState(deepLinkKey)

  if (appliedDeepLink !== deepLinkKey) {
    setAppliedDeepLink(deepLinkKey)
    setProfileTab(deepLinkTab ?? 'details')
  }

  useEffect(() => {
    if (!organizationId || !siteId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      const [
        siteResult,
        typesResult,
        itemsResult,
        exclusionsResult,
        staffResult,
        staffItemsResult,
        staffExclusionsResult,
      ] = await Promise.all([
        getSite(siteId),
        listRequirementTypes(organizationId, { includeArchived: true }),
        listSiteComplianceItems(organizationId, siteId),
        listSiteRequirementExclusions([siteId]),
        listStaffBySite(organizationId, siteId),
        listStaffComplianceItemsAtSite(organizationId, siteId),
        listStaffRequirementExclusionsAtSite(siteId),
      ])
      if (cancelled) return

      const loadError = firstError(
        siteResult,
        typesResult,
        itemsResult,
        exclusionsResult,
        staffResult,
        staffItemsResult,
        staffExclusionsResult,
      )
      if (loadError) {
        setError(loadError.message)
        setLoading(false)
        return
      }

      setSite(siteResult.data)
      setInfo(siteInfoFromSite(siteResult.data))
      setRequirementTypes(typesResult.data.filter(isSiteRequirementType))
      setStaffTypes(typesResult.data.filter(isStaffRequirementType))
      setItems(itemsResult.data)
      setExclusions(exclusionsResult.data)
      setSiteStaff(staffResult.data)
      setStaffItems(staffItemsResult.data)
      setStaffExclusions(staffExclusionsResult.data)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId, siteId])

  useEffect(() => {
    if (loading) return
    const id = location.hash.replace(/^#/, '')
    if (!id || searchParams.get('tab') !== 'requirements') return

    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }, 80)

    return () => window.clearTimeout(timer)
  }, [loading, location.hash, searchParams, items])

  const rows = useMemo(() => {
    return requirementTypes
      .filter(
        (type) =>
          !isArchived(type) ||
          items.some((entry) => entry.requirement_type_id === type.id),
      )
      .map((requirementType) => {
        const item = items.find(
          (entry) => entry.requirement_type_id === requirementType.id,
        )
        return { requirementType, item }
      })
  }, [requirementTypes, items])

  const complianceSummary = useMemo(
    () =>
      summarizeProfileRequirements(rows, (typeId) =>
        isSiteRequirementExcluded(exclusions, siteId, typeId),
      ),
    [rows, exclusions, siteId],
  )

  const staffRows = useMemo(() => {
    return siteStaff
      .map((member) => {
        const active = isActiveStaff(member)
        const { rows: requirementRows, extraRows } = buildStaffRequirementRows(
          staffTypes,
          staffItems,
          member.id,
        )
        const progress = summarizeProfileRequirements(
          [...requirementRows, ...extraRows],
          (typeId) => isRequirementExcluded(staffExclusions, member.id, typeId),
        )
        return {
          member,
          active,
          progress,
          gapCount: active
            ? countStaffGaps(member, {
                requirementTypes: staffTypes,
                items: staffItems,
                exclusions: staffExclusions,
              })
            : 0,
        }
      })
      .sort(
        (a, b) =>
          Number(b.active) - Number(a.active) ||
          b.gapCount - a.gapCount ||
          a.member.name.localeCompare(b.member.name),
      )
  }, [siteStaff, staffTypes, staffItems, staffExclusions])

  const staffWithGaps = staffRows.filter(
    (row) => row.active && row.gapCount > 0,
  ).length
  const activeStaffCount = staffRows.filter((row) => row.active).length

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
    const { data, error: selectError } = await listSiteComplianceItems(
      organizationId,
      siteId,
    )
    if (selectError) {
      return { error: selectError }
    }
    setItems(data)
    return { error: null }
  }

  async function handleSaveInfo(event) {
    event.preventDefault()
    if (!siteId) return

    if (!(info.operatingDays ?? []).length) {
      setError(EMPTY_OPERATING_DAYS_MESSAGE)
      return
    }

    setError('')
    setSavingInfo(true)

    const { data, error: saveError } = await updateSite(siteId, {
      name: info.name.trim(),
      address: info.address,
      serviceApprovalNumber: info.serviceApprovalNumber,
      phone: info.phone,
      nominatedSupervisor: info.nominatedSupervisor,
      alertEmail: info.alertEmail,
      operatingDays: info.operatingDays,
    })

    if (saveError) {
      setError(saveError.message)
      setSavingInfo(false)
      return
    }

    setSite(data)
    setInfo(siteInfoFromSite(data))
    setSavingInfo(false)
  }

  async function handleSave(event, requirementType) {
    event.preventDefault()
    if (!organizationId || !siteId) return

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
      staffId: null,
      siteId,
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

  async function handleArchiveItem() {
    if (!pendingItemArchive) return

    setError('')
    setDeletingId(pendingItemArchive.id)

    const { error: archiveError } = await archiveComplianceItem(
      pendingItemArchive.id,
    )
    if (archiveError) {
      setError(archiveError.message)
      setDeletingId(null)
      return
    }

    if (editingItemId === pendingItemArchive.id) {
      resetForm()
    }

    setPendingItemArchive(null)
    const { error: selectError } = await refreshItems()
    if (selectError) {
      setError(selectError.message)
    }
    setDeletingId(null)
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
    const { data, error: selectError } = await listSiteRequirementExclusions([
      siteId,
    ])
    if (selectError) {
      return { error: selectError }
    }
    setExclusions(data)
    return { error: null }
  }

  async function handleToggleNotApplicable(requirementType) {
    if (!siteId) return

    setError('')
    setTogglingTypeId(requirementType.id)
    resetForm()

    const excluded = isSiteRequirementExcluded(
      exclusions,
      siteId,
      requirementType.id,
    )
    const previous = exclusions
    setExclusions((current) =>
      excluded
        ? current.filter(
            (row) =>
              !(
                String(row.site_id) === String(siteId) &&
                String(row.requirement_type_id) === String(requirementType.id)
              ),
          )
        : [
            ...current,
            { site_id: siteId, requirement_type_id: requirementType.id },
          ],
    )

    const { error: toggleError } = excluded
      ? await removeSiteRequirementExclusion(siteId, requirementType.id)
      : await addSiteRequirementExclusion(siteId, requirementType.id)

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

  async function handleArchiveSite() {
    if (!siteId) return

    setError('')
    setDeletingSite(true)

    const { error: archiveError } = await archiveSite(siteId)
    if (archiveError) {
      setError(archiveError.message)
      setDeletingSite(false)
      return
    }

    navigate(paths.sites, { replace: true })
  }

  async function handleRestoreSite() {
    if (!siteId) return

    setError('')
    setRestoring(true)
    const { error: restoreError } = await restoreSite(siteId)
    if (restoreError) {
      setError(restoreError.message)
      setRestoring(false)
      return
    }

    const { data, error: selectError } = await getSite(siteId)
    if (selectError) {
      setError(selectError.message)
      setRestoring(false)
      return
    }
    setSite(data)
    setRestoring(false)
  }

  async function handleDeleteSite() {
    if (!siteId) return

    setError('')
    setDeletingSite(true)

    const { error: deleteError } = await deleteSite(siteId)
    if (deleteError) {
      setError(deleteError.message)
      setDeletingSite(false)
      return
    }

    navigate(paths.sites, { replace: true })
  }

  function setInfoField(field, value) {
    setInfo((current) => ({ ...current, [field]: value }))
  }

  const infoBusy = savingInfo || loading
  const siteArchived = isArchived(site)

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title={site?.name ?? 'Site profile'}
        description={
          siteArchived
            ? 'This site is archived, so it is hidden from lists, dashboards, and alerts.'
            : 'Site details and every site-level requirement type for your organization.'
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to={paths.sites}>Back to sites</Link>
            </Button>
            {siteArchived ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleRestoreSite}
                  disabled={loading || restoring || deletingSite}
                >
                  {restoring ? 'Restoring…' : 'Restore'}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setPendingPermanentDelete(true)}
                  disabled={loading || restoring || deletingSite}
                >
                  Delete permanently
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPendingSiteArchive(true)}
                disabled={loading || deletingSite}
              >
                Archive site
              </Button>
            )}
          </>
        }
      />

      <PageError>{error}</PageError>

      {loading ? (
        <ProfileSkeleton showStaff />
      ) : (
        <div className="flex flex-col gap-4">
          {siteArchived ? null : (
          <ProfileComplianceHeader
            summary={complianceSummary}
            onReviewUrgent={() => {
              const urgent = complianceSummary.mostUrgent
              if (!urgent) return
              setProfileTab('requirements')
              if (urgent.item) startEdit(urgent.item)
              else startFillIn(urgent.requirementType)
              window.setTimeout(() => {
                document
                  .getElementById(`requirement-${urgent.requirementType.id}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }, 50)
            }}
          />
          )}
          <Tabs value={profileTab} onValueChange={setProfileTab}>
            <TabsList>
              <TabsTrigger value="details">Site information</TabsTrigger>
              <TabsTrigger value="requirements">
                Requirements
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  {rows.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="staff">
                Staff
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  {siteStaff.length}
                </span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="details">
          <Card>
            <CardHeader>
              <CardTitle>Site information</CardTitle>
              <CardDescription>Service details and contact.</CardDescription>
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
                        disabled={infoBusy}
                      />
                    </Field>
                    <Field label="Address">
                      <Input
                        type="text"
                        name="address"
                        value={info.address}
                        onChange={(event) =>
                          setInfoField('address', event.target.value)
                        }
                        disabled={infoBusy}
                      />
                    </Field>
                  </FieldGrid>
                </FormSection>

                <FormSection title="Contact">
                  <FieldGrid>
                    <Field label="Phone">
                      <Input
                        type="tel"
                        name="phone"
                        value={info.phone}
                        onChange={(event) =>
                          setInfoField('phone', event.target.value)
                        }
                        disabled={infoBusy}
                      />
                    </Field>
                    <Field label="Nominated supervisor">
                      <Input
                        type="text"
                        name="nominated_supervisor"
                        value={info.nominatedSupervisor}
                        onChange={(event) =>
                          setInfoField('nominatedSupervisor', event.target.value)
                        }
                        disabled={infoBusy}
                      />
                    </Field>
                    <Field
                      label="Alert email"
                      hint="Overdue form emails go here. If empty, the organisation alert email is used."
                      className="col-span-full"
                    >
                      <Input
                        type="email"
                        name="alert_email"
                        value={info.alertEmail}
                        onChange={(event) =>
                          setInfoField('alertEmail', event.target.value)
                        }
                        disabled={infoBusy}
                      />
                    </Field>
                    <Field
                      label="Service approval number"
                      className="col-span-full"
                    >
                      <Input
                        type="text"
                        name="service_approval_number"
                        value={info.serviceApprovalNumber}
                        onChange={(event) =>
                          setInfoField('serviceApprovalNumber', event.target.value)
                        }
                        disabled={infoBusy}
                      />
                    </Field>
                  </FieldGrid>
                </FormSection>

                <SiteHoursSettings
                  organizationId={organizationId}
                  siteId={siteId}
                  operatingDays={info.operatingDays ?? DEFAULT_OPERATING_DAYS}
                  onOperatingDaysChange={(next) =>
                    setInfoField('operatingDays', next)
                  }
                  disabled={infoBusy}
                />

                <FormActions>
                  <Button type="submit" disabled={infoBusy}>
                    {savingInfo ? 'Saving…' : 'Save'}
                  </Button>
                </FormActions>
              </form>
              <SiteFloorLinks
                organizationId={organizationId}
                siteId={siteId}
                siteName={site?.name ?? ''}
                disabled={infoBusy || siteArchived}
              />
            </CardContent>
          </Card>
            </TabsContent>
            <TabsContent value="requirements">
          <Card>
            <CardHeader>
              <CardTitle>Requirements</CardTitle>
              <CardDescription>
                Coloured status is calculated from expiry dates.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {rows.length === 0 ? (
                <PageMuted>No site-level requirement types yet.</PageMuted>
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
                      const excluded = isSiteRequirementExcluded(
                        exclusions,
                        siteId,
                        requirementType.id,
                      )
                      const missing = !excluded && !item
                      const itemStatus = excluded
                        ? 'Not applicable'
                        : missing
                          ? 'Missing'
                          : attentionStatus(item, requirementType)
                      const isEditing = Boolean(item) && editingItemId === item.id
                      const isFilling =
                        missing && fillingTypeId === requirementType.id
                      const showForm = isEditing || isFilling
                      const busy =
                        saving ||
                        togglingTypeId === requirementType.id ||
                        verifyingId === item?.id ||
                        deletingId === item?.id

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
                                  className="min-h-11 text-left font-medium text-card-foreground underline underline-offset-2 disabled:opacity-50"
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
                              <AlertTimingHint
                                className="mt-1"
                                item={item}
                                type={requirementType}
                                status={itemStatus}
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
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        setPendingItemArchive({
                                          ...item,
                                          typeName:
                                            item.typeName ?? requirementType.name,
                                        })
                                      }
                                      disabled={busy}
                                    >
                                      {deletingId === item.id
                                        ? 'Archiving…'
                                        : 'Archive'}
                                    </Button>
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
                                  item={item}
                                  requirementType={requirementType}
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
            </TabsContent>
            <TabsContent value="staff">
          <Card>
            <CardHeader>
              <CardTitle>Staff</CardTitle>
              <CardDescription>
                {siteStaff.length === 0
                  ? 'No staff are assigned to this site yet.'
                  : activeStaffCount === 0
                    ? 'Assigned staff are inactive, so their requirements are not tracked.'
                    : staffWithGaps === 0
                      ? 'No compliance gaps among assigned staff.'
                      : `${staffWithGaps} of ${activeStaffCount} active staff have compliance gaps.`}
              </CardDescription>
              <CardAction>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {siteStaff.length}
                </span>
              </CardAction>
            </CardHeader>
            <CardContent className="px-0">
              {siteStaff.length === 0 ? (
                <PageMuted>Assign people from a staff profile or New staff.</PageMuted>
              ) : (
                <Table>
                  <THead>
                    <Th>Name</Th>
                    <Th>Role</Th>
                    <Th>Status</Th>
                    <Th>Progress</Th>
                    <Th className="text-right">Gaps</Th>
                  </THead>
                  <tbody>
                    {staffRows.map(({ member, active, progress, gapCount }) => (
                      <Tr key={member.id} className="hover:bg-muted/40">
                        <Td slot="label">
                          <Link
                            to={paths.staffProfile(member.id)}
                            className="inline-flex min-h-11 items-center font-medium text-card-foreground underline underline-offset-2"
                          >
                            {member.name}
                          </Link>
                          <p className="mt-0.5 text-xs text-muted-foreground md:hidden">
                            {member.role}
                          </p>
                        </Td>
                        <Td slot="extra" className="text-muted-foreground">
                          {member.role}
                        </Td>
                        <Td slot="status">
                          <StatusBadge status={active ? 'Active' : 'Inactive'} />
                        </Td>
                        <Td slot="meta">
                          <ProgressPill
                            completed={progress?.completed ?? 0}
                            total={progress?.applicableCount ?? 0}
                            inactive={!active}
                          />
                        </Td>
                        <Td slot="extra" className="text-right tabular-nums">
                          {!active ? (
                            <span className="text-muted-foreground">—</span>
                          ) : gapCount === 0 ? (
                            <span className="text-muted-foreground">No gaps</span>
                          ) : (
                            <span className="text-status-expired">
                              {gapCount} {gapCount === 1 ? 'gap' : 'gaps'}
                            </span>
                          )}
                        </Td>
                        <Td slot="action" className="md:hidden">
                          <Button asChild size="sm">
                            <Link to={paths.staffProfile(member.id)}>View</Link>
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardContent>
          </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}

      <ConfirmDeleteDialog
        open={pendingSiteArchive}
        onOpenChange={setPendingSiteArchive}
        title={siteArchiveTitle(site?.name ?? 'this site')}
        description={SITE_ARCHIVE_WARNING}
        confirming={deletingSite}
        onConfirm={handleArchiveSite}
        confirmLabel="Archive"
        confirmingLabel="Archiving…"
        variant="default"
      />
      <ConfirmDeleteDialog
        open={pendingPermanentDelete}
        onOpenChange={setPendingPermanentDelete}
        title={siteDeleteTitle(site?.name ?? 'this site')}
        description={SITE_DELETE_WARNING}
        confirming={deletingSite}
        onConfirm={handleDeleteSite}
        confirmLabel="Delete permanently"
        confirmingLabel="Deleting…"
        confirmPhrase={PERMANENT_DELETE_PHRASE}
      />
      <ConfirmDeleteDialog
        open={Boolean(pendingItemArchive)}
        onOpenChange={(open) => {
          if (!open) setPendingItemArchive(null)
        }}
        title={
          pendingItemArchive
            ? itemArchiveTitle(pendingItemArchive)
            : 'Archive item?'
        }
        description={
          pendingItemArchive
            ? itemArchiveWarning(pendingItemArchive)
            : ITEM_ARCHIVE_WARNING
        }
        confirming={Boolean(
          pendingItemArchive && deletingId === pendingItemArchive.id,
        )}
        onConfirm={handleArchiveItem}
        confirmLabel="Archive"
        confirmingLabel="Archiving…"
        variant="default"
      />
    </section>
  )
}
