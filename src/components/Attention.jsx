import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EMPTY_COMPLIANCE_ITEM_VALUES } from './ComplianceItemFields'
import { ListTableSkeleton } from './PageSkeletons'
import { UrgentAttentionList } from './UrgentAttentionList'
import { PageError, PageHeader } from './ui/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { useAuth } from '../hooks/useAuth'
import { buildUrgentItems, visibleComplianceItems } from '../lib/attention'
import {
  formValuesFromItem,
  listComplianceItems,
  listRequirementTypes,
  markItemVerifiedToday,
  todayIsoDate,
  saveComplianceItem,
  tracksVerification,
} from '../lib/compliance'
import {
  listStaffRequirementExclusionsForOrg,
  listSiteRequirementExclusionsForOrg,
} from '../lib/exclusions'
import { firstError } from '../lib/query'
import { listSites } from '../lib/sites'
import { isActiveStaff, listStaff } from '../lib/staff'

export function Attention() {
  const { organizationId } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'sites' ? 'sites' : 'staff'
  const [items, setItems] = useState([])
  const [staff, setStaff] = useState([])
  const [sites, setSites] = useState([])
  const [requirementTypes, setRequirementTypes] = useState([])
  const [exclusions, setExclusions] = useState([])
  const [siteExclusions, setSiteExclusions] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [editingItemId, setEditingItemId] = useState(null)
  const [editValues, setEditValues] = useState(EMPTY_COMPLIANCE_ITEM_VALUES)
  const [savingItem, setSavingItem] = useState(false)
  const [verifyingId, setVerifyingId] = useState(null)

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

  async function refreshItems() {
    const { data, error: selectError } = await listComplianceItems(organizationId)
    if (selectError) {
      return { error: selectError }
    }
    setItems(data)
    return { error: null }
  }

  function startEditItem(item) {
    setEditingItemId(item.id)
    setEditValues(formValuesFromItem(item))
    setError('')
  }

  function cancelEditItem() {
    setEditingItemId(null)
    setEditValues(EMPTY_COMPLIANCE_ITEM_VALUES)
  }

  async function handleSaveItem(event, item) {
    event.preventDefault()
    setError('')
    setSavingItem(true)

    const { error: saveError } = await saveComplianceItem({
      id: item.id,
      documentFile: editValues.documentFile,
      currentDocumentPath: editValues.documentUrl,
      orgId: item.org_id ?? organizationId,
      requirementTypeId: item.requirement_type_id,
      label: editValues.label.trim(),
      expiryDate: editValues.expiryDate,
      referenceNumber: editValues.referenceNumber,
      issuedDate: editValues.issuedDate,
      issuer: editValues.issuer,
      status: editValues.status,
      lastVerifiedDate: tracksVerification(item)
        ? editValues.lastVerifiedDate
        : null,
    })

    if (saveError) {
      setError(saveError.message)
      setSavingItem(false)
      return
    }

    const { error: selectError } = await refreshItems()
    if (selectError) {
      setError(selectError.message)
      setSavingItem(false)
      return
    }

    cancelEditItem()
    setSavingItem(false)
  }

  async function handleMarkVerified(item) {
    setError('')
    setVerifyingId(item.id)

    const { data, error: saveError } = await markItemVerifiedToday(item.id)
    if (saveError) {
      setError(saveError.message)
      setVerifyingId(null)
      return
    }

    const verifiedOn = data?.last_verified_date ?? todayIsoDate()
    setItems((current) =>
      current.map((row) =>
        row.id === item.id
          ? { ...row, last_verified_date: verifiedOn }
          : row,
      ),
    )

    const { error: selectError } = await refreshItems()
    if (selectError) {
      setError(selectError.message)
      setVerifyingId(null)
      return
    }

    if (editingItemId === item.id) {
      setEditValues((current) => ({
        ...current,
        lastVerifiedDate: todayIsoDate(),
      }))
    }

    setVerifyingId(null)
  }

  const { staffItems, siteItems } = useMemo(() => {
    const activeStaff = staff.filter(isActiveStaff)
    const visibleItems = visibleComplianceItems({
      items,
      activeStaff,
      exclusions,
      siteExclusions,
    })

    return buildUrgentItems({
      visibleItems,
      activeStaff,
      sites,
      requirementTypes,
      exclusions,
      siteExclusions,
    })
  }, [items, staff, sites, requirementTypes, exclusions, siteExclusions])

  const listProps = {
    requirementTypes,
    editingItemId,
    editValues,
    onEditValuesChange: setEditValues,
    onStartEdit: startEditItem,
    onCancelEdit: cancelEditItem,
    onSaveItem: handleSaveItem,
    onMarkVerified: handleMarkVerified,
    onDocumentChanged: () => refreshItems(),
    savingItem,
    verifyingId,
    organizationId,
  }

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title="Needs attention"
        description="Expired items first, then overdue rechecks, then soonest to expire."
      />

      <PageError>{error}</PageError>

      {loading ? (
        <Card>
          <CardContent>
            <ListTableSkeleton rows={8} columns={3} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All urgent items</CardTitle>
            <CardDescription>
              Staff-level and site-level records that are expired, overdue for
              recheck, or coming due.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs
              value={tab}
              onValueChange={(next) => {
                cancelEditItem()
                setSearchParams(next === 'sites' ? { tab: 'sites' } : {}, {
                  replace: true,
                })
              }}
            >
              <TabsList className="grid h-auto w-full grid-cols-2 sm:w-full">
                <TabsTrigger value="staff" className="px-2 py-2">
                  Staff-level
                  <span className="ml-1.5 tabular-nums text-muted-foreground">
                    {staffItems.length}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="sites" className="px-2 py-2">
                  Site-level
                  <span className="ml-1.5 tabular-nums text-muted-foreground">
                    {siteItems.length}
                  </span>
                </TabsTrigger>
              </TabsList>
              <TabsContent value="staff">
                <UrgentAttentionList
                  items={staffItems}
                  kind="staff"
                  {...listProps}
                />
              </TabsContent>
              <TabsContent value="sites">
                <UrgentAttentionList
                  items={siteItems}
                  kind="sites"
                  {...listProps}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </section>
  )
}
