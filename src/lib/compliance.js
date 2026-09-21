import {
  deleteComplianceDocument,
  persistComplianceDocument,
} from './documents'
import { isListedComplianceItem, withArchiveScope } from './archive'
import { supabase } from './supabase'

export const DEFAULT_REQUIREMENT_TYPES = [
  { name: 'First Aid', mandatory: true, applies_to: 'staff', recheck_interval_months: null, recheck_interval_days: null, validity_months: 36, renewal_lead_days: 45 },
  { name: 'CPR', mandatory: true, applies_to: 'staff', recheck_interval_months: null, recheck_interval_days: null, validity_months: 12, renewal_lead_days: 30 },
  { name: 'Anaphylaxis Management', mandatory: true, applies_to: 'staff', recheck_interval_months: null, recheck_interval_days: null, validity_months: 36, renewal_lead_days: 45 },
  { name: 'Asthma Management', mandatory: true, applies_to: 'staff', recheck_interval_months: null, recheck_interval_days: null, validity_months: 36, renewal_lead_days: 45 },
  { name: 'WWCC', mandatory: true, applies_to: 'staff', recheck_interval_months: null, recheck_interval_days: 90, validity_months: 60, renewal_lead_days: 90 },
  { name: 'Child Protection Training', mandatory: true, applies_to: 'staff', recheck_interval_months: null, recheck_interval_days: null, validity_months: null, renewal_lead_days: 60 },
  { name: 'Qualification', mandatory: true, applies_to: 'staff', recheck_interval_months: null, recheck_interval_days: null, validity_months: null, renewal_lead_days: null },
  { name: 'Teacher Accreditation', mandatory: false, applies_to: 'staff', recheck_interval_months: null, recheck_interval_days: null, validity_months: null, renewal_lead_days: null },
  { name: 'Police Check', mandatory: true, applies_to: 'staff', recheck_interval_months: null, recheck_interval_days: null, validity_months: 36, renewal_lead_days: 30 },
  { name: 'Other', mandatory: false, applies_to: 'staff', recheck_interval_months: null, recheck_interval_days: null, validity_months: null, renewal_lead_days: null },
  { name: 'Fire Safety', mandatory: true, applies_to: 'site', recheck_interval_months: null, recheck_interval_days: null, validity_months: 12, renewal_lead_days: 45 },
  { name: 'Public Liability Insurance', mandatory: true, applies_to: 'site', recheck_interval_months: null, recheck_interval_days: null, validity_months: 12, renewal_lead_days: 30 },
  { name: 'Workers Compensation', mandatory: true, applies_to: 'site', recheck_interval_months: null, recheck_interval_days: null, validity_months: 12, renewal_lead_days: 30 },
  { name: 'Service Approval', mandatory: true, applies_to: 'site', recheck_interval_months: null, recheck_interval_days: null, validity_months: null, renewal_lead_days: null },
  { name: 'QIP Review', mandatory: true, applies_to: 'site', recheck_interval_months: null, recheck_interval_days: null, validity_months: 12, renewal_lead_days: 30 },
  { name: 'Fire Equipment Servicing', mandatory: true, applies_to: 'site', recheck_interval_months: null, recheck_interval_days: 180, validity_months: null, renewal_lead_days: 30 },
  { name: 'Evacuation Drills', mandatory: true, applies_to: 'site', recheck_interval_months: null, recheck_interval_days: 90, validity_months: null, renewal_lead_days: null },
  { name: 'Electrical Test & Tag', mandatory: true, applies_to: 'site', recheck_interval_months: null, recheck_interval_days: null, validity_months: 12, renewal_lead_days: 30 },
  { name: 'Food Safety Registration', mandatory: false, applies_to: 'site', recheck_interval_months: null, recheck_interval_days: null, validity_months: 12, renewal_lead_days: 30 },
]

export const COMPLIANCE_ITEM_STATUSES = [
  { value: 'current', label: 'Current' },
  { value: 'expired', label: 'Expired' },
  { value: 'pending', label: 'Pending' },
  { value: 'revoked', label: 'Revoked' },
]

const REQUIREMENT_TYPE_FIELDS =
  'id, name, org_id, mandatory, applies_to, recheck_interval_months, recheck_interval_days, validity_months, renewal_lead_days, archived_at'

function emptyToNull(value) {
  const trimmed = typeof value === 'string' ? value.trim() : value
  return trimmed ? trimmed : null
}

function optionalInt(value) {
  if (value === '' || value == null) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

function mapRequirementType(row) {
  return {
    ...row,
    archived_at: row.archived_at ?? null,
  }
}

export async function listRequirementTypes(
  orgId,
  { archivedOnly = false, includeArchived = false } = {},
) {
  let query = supabase
    .from('requirement_types')
    .select(REQUIREMENT_TYPE_FIELDS)
    .eq('org_id', orgId)
    .order('name', { ascending: true })

  if (!includeArchived) {
    query = withArchiveScope(query, { archivedOnly })
  }

  const { data, error } = await query

  if (error) {
    return { data: null, error }
  }

  if ((data ?? []).length > 0) {
    return { data: data.map(mapRequirementType), error: null }
  }

  const { count, error: countError } = await supabase
    .from('requirement_types')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)

  if (countError) {
    return { data: null, error: countError }
  }

  if ((count ?? 0) > 0) {
    return { data: [], error: null }
  }

  const { error: insertError } = await supabase.from('requirement_types').insert(
    DEFAULT_REQUIREMENT_TYPES.map((requirementType) => ({
      org_id: orgId,
      name: requirementType.name,
      mandatory: requirementType.mandatory,
      applies_to: requirementType.applies_to,
      recheck_interval_months: requirementType.recheck_interval_months,
      recheck_interval_days: requirementType.recheck_interval_days,
      validity_months: requirementType.validity_months,
      renewal_lead_days: requirementType.renewal_lead_days,
    })),
  )

  if (insertError) {
    return { data: null, error: insertError }
  }

  const { data: seeded, error: seededError } = await supabase
    .from('requirement_types')
    .select(REQUIREMENT_TYPE_FIELDS)
    .eq('org_id', orgId)
    .order('name', { ascending: true })

  if (seededError) {
    return { data: null, error: seededError }
  }

  return { data: (seeded ?? []).map(mapRequirementType), error: null }
}

export async function countComplianceItemsForRequirementType(typeId) {
  const { count, error } = await supabase
    .from('compliance_items')
    .select('id', { count: 'exact', head: true })
    .eq('requirement_type_id', typeId)

  if (error) {
    return { count: 0, error }
  }

  return { count: count ?? 0, error: null }
}

export async function updateRequirementType(id, values) {
  const { data, error } = await supabase
    .from('requirement_types')
    .update({
      name: values.name.trim(),
      applies_to: values.applies_to,
      mandatory: Boolean(values.mandatory),
      validity_months: optionalInt(values.validity_months),
      renewal_lead_days: optionalInt(values.renewal_lead_days),
      recheck_interval_days: optionalInt(values.recheck_interval_days),
    })
    .eq('id', id)
    .select(REQUIREMENT_TYPE_FIELDS)
    .single()

  if (error) {
    return { data: null, error }
  }

  return { data: mapRequirementType(data), error: null }
}

export async function archiveRequirementType(id) {
  const { error } = await supabase
    .from('requirement_types')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .is('archived_at', null)

  return { error: error ?? null }
}

export async function restoreRequirementType(id) {
  const { error } = await supabase
    .from('requirement_types')
    .update({ archived_at: null })
    .eq('id', id)

  return { error: error ?? null }
}

export async function deleteRequirementType(id) {
  const { count, error: countError } =
    await countComplianceItemsForRequirementType(id)
  if (countError) {
    return { error: countError }
  }
  if (count > 0) {
    return {
      error: {
        message:
          'This type has recorded items. Archive it instead of deleting.',
      },
    }
  }

  const { error } = await supabase
    .from('requirement_types')
    .delete()
    .eq('id', id)

  return { error: error ?? null }
}

const ITEM_SELECT = `
  id,
  requirement_type_id,
  label,
  expiry_date,
  reference_number,
  issued_date,
  issuer,
  status,
  last_verified_date,
  document_url,
  created_at,
  org_id,
  staff_id,
  site_id,
  archived_at,
  requirement_types ( id, name, recheck_interval_months, recheck_interval_days, validity_months, renewal_lead_days ),
  staff ( id, name, employment_status, archived_at ),
  sites ( id, name, archived_at )
`

const ITEM_SELECT_AT_SITE = `
  id,
  requirement_type_id,
  label,
  expiry_date,
  reference_number,
  issued_date,
  issuer,
  status,
  last_verified_date,
  document_url,
  created_at,
  org_id,
  staff_id,
  site_id,
  archived_at,
  requirement_types ( id, name, recheck_interval_months, recheck_interval_days, validity_months, renewal_lead_days ),
  staff!inner (
    id,
    name,
    employment_status,
    archived_at,
    staff_sites!inner ( site_id )
  ),
  sites ( id, name, archived_at )
`

function mapItem(row) {
  return {
    id: row.id,
    requirement_type_id: row.requirement_type_id,
    typeName: row.requirement_types?.name ?? 'Unknown',
    recheck_interval_months: row.requirement_types?.recheck_interval_months ?? null,
    recheck_interval_days: row.requirement_types?.recheck_interval_days ?? null,
    validity_months: row.requirement_types?.validity_months ?? null,
    renewal_lead_days: row.requirement_types?.renewal_lead_days ?? null,
    label: row.label,
    expiry_date: row.expiry_date,
    reference_number: row.reference_number,
    issued_date: row.issued_date,
    issuer: row.issuer,
    status: row.status ?? 'current',
    last_verified_date: row.last_verified_date,
    document_url: row.document_url ?? null,
    created_at: row.created_at,
    org_id: row.org_id,
    staff_id: row.staff_id,
    site_id: row.site_id,
    ownerName: row.staff?.name ?? row.sites?.name ?? 'Unknown',
    ownerKind: row.staff_id ? 'staff' : 'site',
    ownerEmploymentStatus: row.staff?.employment_status ?? null,
    archived_at: row.archived_at ?? null,
    ownerArchivedAt: row.staff?.archived_at ?? row.sites?.archived_at ?? null,
  }
}

function listMappedItems(data, { archivedOnly = false } = {}) {
  return (data ?? [])
    .map(mapItem)
    .filter((item) => isListedComplianceItem(item, { archivedOnly }))
}

export async function listComplianceItems(orgId, { archivedOnly = false } = {}) {
  const { data, error } = await withArchiveScope(
    supabase
      .from('compliance_items')
      .select(ITEM_SELECT)
      .eq('org_id', orgId)
      .order('expiry_date', { ascending: true }),
    { archivedOnly },
  )

  if (error) {
    return { data: null, error }
  }

  return { data: listMappedItems(data, { archivedOnly }), error: null }
}

export async function listStaffComplianceItems(orgId, staffId) {
  const { data, error } = await withArchiveScope(
    supabase
      .from('compliance_items')
      .select(ITEM_SELECT)
      .eq('org_id', orgId)
      .eq('staff_id', staffId)
      .order('expiry_date', { ascending: true }),
  )

  if (error) {
    return { data: null, error }
  }

  return { data: listMappedItems(data), error: null }
}

export async function listStaffComplianceItemsAtSite(orgId, siteId) {
  const { data, error } = await withArchiveScope(
    supabase
      .from('compliance_items')
      .select(ITEM_SELECT_AT_SITE)
      .eq('org_id', orgId)
      .eq('staff.staff_sites.site_id', siteId)
      .is('staff.archived_at', null)
      .not('staff_id', 'is', null)
      .order('expiry_date', { ascending: true }),
  )

  if (error) {
    return { data: null, error }
  }

  return { data: listMappedItems(data), error: null }
}

export async function listSiteComplianceItems(orgId, siteId) {
  const { data, error } = await withArchiveScope(
    supabase
      .from('compliance_items')
      .select(ITEM_SELECT)
      .eq('org_id', orgId)
      .eq('site_id', siteId)
      .order('expiry_date', { ascending: true }),
  )

  if (error) {
    return { data: null, error }
  }

  return { data: listMappedItems(data), error: null }
}

export function isSiteRequirementType(requirementType) {
  return requirementType?.applies_to === 'site'
}

export function isStaffRequirementType(requirementType) {
  return requirementType?.applies_to !== 'site'
}

export function isOtherRequirementType(requirementType) {
  return String(requirementType?.name ?? '').trim().toLowerCase() === 'other'
}

export function suggestedExpiryFromIssuedDate(issuedDate, validityMonths) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(issuedDate ?? '')
  const months = Number(validityMonths)
  if (!match || !Number.isInteger(months) || months <= 0) return ''

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  const totalMonths = year * 12 + monthIndex + months
  const nextYear = Math.floor(totalMonths / 12)
  const nextMonth = totalMonths % 12
  const lastDay = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate()
  const nextDay = Math.min(day, lastDay)

  return [
    String(nextYear).padStart(4, '0'),
    String(nextMonth + 1).padStart(2, '0'),
    String(nextDay).padStart(2, '0'),
  ].join('-')
}

export function tracksVerification(entry) {
  return Boolean(entry?.recheck_interval_days || entry?.recheck_interval_months)
}

export function hasRecheckInterval(entry) {
  return tracksVerification(entry)
}

export function recheckIntervalDays(entry) {
  const days = Number(entry?.recheck_interval_days)
  if (!Number.isInteger(days) || days <= 0) return null
  return days
}

function catalogRecheckDays(name) {
  if (!name) return null
  const normalized = String(name).toLowerCase().trim()
  const catalog = DEFAULT_REQUIREMENT_TYPES.find(
    (type) => type.name.toLowerCase() === normalized,
  )
  if (catalog) return recheckIntervalDays(catalog)
  if (
    normalized.includes('wwcc') ||
    normalized.includes('working with children')
  ) {
    return 90
  }
  return null
}

export function resolveRecheckDays(type, item = type) {
  const name = type?.name ?? item?.typeName ?? item?.name
  return (
    catalogRecheckDays(name) ??
    recheckIntervalDays(type) ??
    recheckIntervalDays(item)
  )
}

function toIsoDate(value) {
  if (!value) return null
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return todayIsoDateFrom(date)
}

function todayIsoDateFrom(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addDaysIso(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  date.setDate(date.getDate() + days)
  return todayIsoDateFrom(date)
}

export function recheckBaseDate(item) {
  return (
    toIsoDate(item?.last_verified_date) ??
    toIsoDate(item?.issued_date) ??
    toIsoDate(item?.created_at)
  )
}

function recheckClockDate(item) {
  return toIsoDate(item?.last_verified_date)
}

export function canMarkVerifiedToday(item, type = item) {
  if (item?.missing) return false
  if (!resolveRecheckDays(type, item)) return false
  return attentionStatus(item, type) === 'Recheck due'
}

export function recheckDueDate(item, type = item) {
  const interval = resolveRecheckDays(type, item)
  if (!interval) return null
  const clock = recheckClockDate(item)
  if (clock) return addDaysIso(clock, interval)
  return todayIsoDate()
}

export function isRecheckOverdue(item, type = item, today = todayIsoDate()) {
  const interval = resolveRecheckDays(type, item)
  if (!interval) return false

  const clock = recheckClockDate(item)
  if (!clock) return true

  const due = addDaysIso(clock, interval)
  return Boolean(due && today >= due)
}

export function renewalLeadDays(type, item = type) {
  const fromType = Number(type?.renewal_lead_days)
  if (Number.isInteger(fromType) && fromType > 0) return fromType
  const fromItem = Number(item?.renewal_lead_days)
  if (Number.isInteger(fromItem) && fromItem > 0) return fromItem
  const name = type?.name ?? item?.typeName ?? item?.name
  const catalog = DEFAULT_REQUIREMENT_TYPES.find(
    (entry) => entry.name.toLowerCase() === String(name ?? '').toLowerCase(),
  )
  const fromCatalog = Number(catalog?.renewal_lead_days)
  if (Number.isInteger(fromCatalog) && fromCatalog > 0) return fromCatalog
  return 30
}

export function isWithinRenewalWindow(item, type = item, today = todayIsoDate()) {
  const expiry = toIsoDate(item?.expiry_date)
  if (!expiry || expiry < today) return false
  const windowStart = addDaysIso(expiry, -renewalLeadDays(type, item))
  return Boolean(windowStart && today >= windowStart)
}

export function attentionStatus(item, type = item) {
  if (item?.missing) return 'Missing'
  const expiryStatus = complianceStatus(item?.expiry_date)
  if (expiryStatus === 'Expired') return 'Expired'
  if (isRecheckOverdue(item, type)) return 'Recheck due'
  if (expiryStatus === 'Expiring soon' || isWithinRenewalWindow(item, type)) {
    return 'Expiring soon'
  }
  return expiryStatus
}

export function todayIsoDate() {
  return todayIsoDateFrom(new Date())
}

export function complianceStatus(expiryDate) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(`${expiryDate}T00:00:00`)

  if (Number.isNaN(expiry.getTime()) || expiry < today) {
    return 'Expired'
  }

  const soon = new Date(today)
  soon.setDate(soon.getDate() + 30)
  if (expiry <= soon) {
    return 'Expiring soon'
  }

  return 'Valid'
}

function itemWriteFields({
  requirementTypeId,
  label,
  expiryDate,
  referenceNumber,
  issuedDate,
  issuer,
  status = 'current',
  lastVerifiedDate,
}) {
  return {
    requirement_type_id: requirementTypeId,
    label,
    expiry_date: expiryDate,
    reference_number: emptyToNull(referenceNumber),
    issued_date: emptyToNull(issuedDate),
    issuer: emptyToNull(issuer),
    status,
    last_verified_date: emptyToNull(lastVerifiedDate),
  }
}

export function formValuesFromItem(item) {
  function toDateInput(value) {
    return value ? String(value).slice(0, 10) : ''
  }

  return {
    label: item.label ?? '',
    expiryDate: toDateInput(item.expiry_date),
    referenceNumber: item.reference_number ?? '',
    issuedDate: toDateInput(item.issued_date),
    issuer: item.issuer ?? '',
    status: item.status ?? 'current',
    lastVerifiedDate: toDateInput(item.last_verified_date),
    documentUrl: item.document_url ?? '',
    documentFile: null,
  }
}

export async function createComplianceItem({
  requirementTypeId,
  label,
  expiryDate,
  referenceNumber,
  issuedDate,
  issuer,
  status = 'current',
  lastVerifiedDate,
  orgId,
  staffId,
  siteId,
}) {
  const { data, error } = await supabase
    .from('compliance_items')
    .insert({
      ...itemWriteFields({
        requirementTypeId,
        label,
        expiryDate,
        referenceNumber,
        issuedDate,
        issuer,
        status,
        lastVerifiedDate,
      }),
      org_id: orgId,
      staff_id: staffId,
      site_id: siteId,
    })
    .select(
      'id, requirement_type_id, label, expiry_date, reference_number, issued_date, issuer, status, last_verified_date, document_url, org_id, staff_id, site_id',
    )
    .single()

  if (error) {
    return { data: null, error }
  }

  return { data, error: null }
}

export async function updateComplianceItem(id, {
  requirementTypeId,
  label,
  expiryDate,
  referenceNumber,
  issuedDate,
  issuer,
  status = 'current',
  lastVerifiedDate,
  staffId,
  siteId,
}) {
  const payload = itemWriteFields({
    requirementTypeId,
    label,
    expiryDate,
    referenceNumber,
    issuedDate,
    issuer,
    status,
    lastVerifiedDate,
  })

  if (staffId !== undefined) {
    payload.staff_id = staffId
    payload.site_id = siteId
  }

  const { data, error } = await supabase
    .from('compliance_items')
    .update(payload)
    .eq('id', id)
    .select(
      'id, requirement_type_id, label, expiry_date, reference_number, issued_date, issuer, status, last_verified_date, document_url, org_id, staff_id, site_id',
    )
    .single()

  if (error) {
    return { data: null, error }
  }

  return { data, error: null }
}

export async function markItemVerifiedToday(id) {
  const { data, error } = await supabase
    .from('compliance_items')
    .update({ last_verified_date: todayIsoDate() })
    .eq('id', id)
    .select(
      'id, requirement_type_id, label, expiry_date, reference_number, issued_date, issuer, status, last_verified_date, document_url, org_id, staff_id, site_id',
    )
    .single()

  if (error) {
    return { data: null, error }
  }

  return { data, error: null }
}

export async function saveComplianceItem({
  id,
  documentFile,
  currentDocumentPath,
  ...fields
}) {
  const result = id
    ? await updateComplianceItem(id, fields)
    : await createComplianceItem(fields)

  if (result.error) return result
  if (!documentFile) return result

  const { error } = await persistComplianceDocument({
    orgId: result.data.org_id ?? fields.orgId,
    itemId: result.data.id,
    file: documentFile,
    currentPath: currentDocumentPath ?? result.data.document_url,
  })

  if (error) return { data: result.data, error }
  return result
}

export async function archiveComplianceItem(id) {
  const { error } = await supabase
    .from('compliance_items')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .is('archived_at', null)

  return { error: error ?? null }
}

export async function restoreComplianceItem(id) {
  const { error } = await supabase
    .from('compliance_items')
    .update({ archived_at: null })
    .eq('id', id)

  return { error: error ?? null }
}

export async function deleteComplianceItem(id) {
  const { data, error: selectError } = await supabase
    .from('compliance_items')
    .select('document_url')
    .eq('id', id)
    .maybeSingle()

  if (selectError) {
    return { error: selectError }
  }

  const { error } = await supabase.from('compliance_items').delete().eq('id', id)

  if (error) {
    return { error }
  }

  if (data?.document_url) {
    await deleteComplianceDocument(data.document_url)
  }

  return { error: null }
}
