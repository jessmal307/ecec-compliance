import { createClient } from 'npm:@supabase/supabase-js@2'
import { hasCronSecretKey } from '../_shared/cronAuth.ts'
import { retryOnJwtSkew } from '../_shared/retry.ts'

const ALERT_TIME_ZONE = 'Australia/Sydney'
const EXPIRY_KINDS = ['renewal', 'expired'] as const

type AlertKind = 'renewal' | 'expired' | 'recheck'

type ComplianceItemRow = {
  id: string
  expiry_date: string | null
  last_verified_date: string | null
  issued_date: string | null
  created_at: string | null
  org_id: string
  label: string
  staff_id: string | null
  site_id: string | null
  requirement_type_id: string | null
  archived_at: string | null
  document_url: string | null
  working_towards: boolean | null
  requirement_types: {
    name: string
    renewal_lead_days: number | null
    recheck_interval_days: number | null
    perpetual: boolean | null
  } | null
  staff: {
    name: string
    archived_at: string | null
    employment_status: string | null
  } | null
  sites: { name: string; archived_at: string | null } | null
}

type OrganizationRow = {
  id: string
  name: string
  owner_id: string
  alert_email: string | null
  plan: string | null
}

type OverdueFormRow = {
  site_id: string
  template_name: string
  label: string
}

type PendingAlert = {
  item: ComplianceItemRow
  kind: AlertKind
  leadDays?: number
  recheckDays?: number
}

type RequirementTypeRow = {
  id: string
  name: string
  org_id: string
  mandatory: boolean
  applies_to: string
  perpetual: boolean | null
  recheck_interval_days: number | null
  renewal_lead_days: number | null
}

type StaffDigestRow = {
  id: string
  name: string
  employment_status: string
  sites: { id: string; name: string }[]
}

type DigestLine = {
  key: string
  typeName: string
  ownerName: string
  status: string
  urgency: string
}

type DigestSite = {
  id: string
  name: string
  expiredCount: number
  expiringCount: number
  missingCount: number
  recheckDueCount: number
  lines: DigestLine[]
}

type OrgDigest = {
  expiredCount: number
  expiringCount: number
  missingCount: number
  recheckDueCount: number
  sites: DigestSite[]
}

const ATTENTION_STATUSES = new Set([
  'Expired',
  'Missing',
  'Recheck due',
  'Expiring soon',
])

const ATTENTION_RANK: Record<string, number> = {
  Expired: 0,
  Missing: 1,
  'Recheck due': 2,
  'Expiring soon': 3,
}

function isArchived(value: string | null | undefined): boolean {
  return value != null && value !== ''
}

function isActiveEmployment(status: string | null | undefined): boolean {
  return (status ?? 'active') === 'active'
}

function isAlertableItem(item: ComplianceItemRow): boolean {
  if (isArchived(item.archived_at)) return false
  if (isArchived(item.staff?.archived_at)) return false
  if (isArchived(item.sites?.archived_at)) return false
  if (item.staff_id && !isActiveEmployment(item.staff?.employment_status)) {
    return false
  }
  return true
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function dateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) return date.toISOString().slice(0, 10)
  return `${year}-${month}-${day}`
}

function todaySydney(): string {
  return dateInTimeZone(new Date(), ALERT_TIME_ZONE)
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return isoDate
  return date.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: ALERT_TIME_ZONE,
  })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function asNonNegativeInt(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const days = Number(value)
  if (!Number.isInteger(days) || days < 0) return null
  return days
}

function renewalLeadDays(item: ComplianceItemRow): number | null {
  return asNonNegativeInt(item.requirement_types?.renewal_lead_days)
}

const WORKING_TOWARDS_RECHECK_DAYS = 365

function isWorkingTowards(item: ComplianceItemRow): boolean {
  return Boolean(item.working_towards)
}

function hasEvidenceDocument(item: ComplianceItemRow): boolean {
  return Boolean(String(item.document_url ?? '').trim())
}

function workingTowardsNeedsDocument(item: ComplianceItemRow): boolean {
  return isWorkingTowards(item) && !hasEvidenceDocument(item)
}

// Copied from functions/_shared/dashboardCompliance.js so this function
// deploys as a single file. Do not change status maths without updating both.
const DASHBOARD_ATTENTION_RANK: Record<string, number> = {
  Expired: 0,
  'Recheck due': 1,
  'Expiring soon': 2,
  Missing: 3,
}

function isStaffRequirementType(requirementType: { applies_to?: string | null }) {
  return requirementType?.applies_to !== 'site'
}

function isSiteRequirementType(requirementType: { applies_to?: string | null }) {
  return requirementType?.applies_to === 'site'
}

function isActiveStaff(member: { employment_status?: string | null }) {
  return member?.employment_status === 'active'
}

function sameId(left: unknown, right: unknown) {
  return left != null && right != null && String(left) === String(right)
}

function isRequirementExcluded(
  exclusions: { staff_id?: string; requirement_type_id?: string }[] | null | undefined,
  staffId: string,
  requirementTypeId: string,
) {
  return (exclusions ?? []).some(
    (row) =>
      sameId(row.staff_id, staffId) &&
      sameId(row.requirement_type_id, requirementTypeId),
  )
}

function isSiteRequirementExcluded(
  exclusions: { site_id?: string; requirement_type_id?: string }[] | null | undefined,
  siteId: string,
  requirementTypeId: string,
) {
  return (exclusions ?? []).some(
    (row) =>
      sameId(row.site_id, siteId) &&
      sameId(row.requirement_type_id, requirementTypeId),
  )
}

function addDaysIso(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function expiryStatus(
  expiryDate: string | null | undefined,
  todayIso: string,
  perpetual = false,
) {
  if (perpetual) return 'Valid'
  const expiry = String(expiryDate ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    return 'Expired'
  }
  if (expiry < todayIso) return 'Expired'
  const soon = addDaysIso(todayIso, 30)
  if (soon && expiry <= soon) return 'Expiring soon'
  return 'Valid'
}

function visibleComplianceItems({
  items,
  activeStaff,
  exclusions,
  siteExclusions,
}: {
  items: ComplianceItemRow[]
  activeStaff: { id: string }[]
  exclusions: { staff_id: string; requirement_type_id: string }[]
  siteExclusions: { site_id: string; requirement_type_id: string }[]
}) {
  const activeStaffIds = new Set(activeStaff.map((member) => member.id))

  return (items ?? []).filter((item) => {
    if (item.site_id) {
      return !isSiteRequirementExcluded(
        siteExclusions,
        item.site_id,
        item.requirement_type_id ?? '',
      )
    }
    if (!item.staff_id) return true
    if (!activeStaffIds.has(item.staff_id)) return false
    return !isRequirementExcluded(
      exclusions,
      item.staff_id,
      item.requirement_type_id ?? '',
    )
  })
}

function findRequiredItem<T>(
  items: T[],
  matches: (row: T) => boolean,
) {
  return items.find(matches) ?? null
}

function isWorkingTowardsRecheckOverdue(
  item: { working_towards?: boolean | null; last_verified_date?: string | null; issued_date?: string | null; created_at?: string | null } | null,
  todayIso: string,
) {
  if (!item?.working_towards) return false
  const base = String(
    item.last_verified_date || item.issued_date || item.created_at || '',
  ).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return true
  const due = addDaysIso(base, WORKING_TOWARDS_RECHECK_DAYS)
  return Boolean(due && todayIso >= due)
}

function staffItemStatus(
  item: ComplianceItemRow | null,
  todayIso: string,
  type: { perpetual?: boolean | null },
) {
  if (!item) return 'Missing'
  if (item.working_towards && !hasEvidenceDocument(item)) return 'Missing'
  if (isWorkingTowardsRecheckOverdue(item, todayIso)) return 'Recheck due'
  return expiryStatus(item.expiry_date, todayIso, Boolean(type?.perpetual))
}

function staffRequiredSlots(
  member: StaffDigestRow,
  mandatoryStaffTypes: RequirementTypeRow[],
  items: ComplianceItemRow[],
  exclusions: { staff_id: string; requirement_type_id: string }[],
  todayIso: string,
) {
  return mandatoryStaffTypes
    .filter((type) => !isRequirementExcluded(exclusions, member.id, type.id))
    .map((type) => {
      const item = findRequiredItem(
        items,
        (row) =>
          row.staff_id === member.id && row.requirement_type_id === type.id,
      )
      return {
        status: staffItemStatus(item, todayIso, type),
        ownerName: member.name,
        ownerKind: 'staff',
        typeName: type.name,
        expiryDate: item?.expiry_date ?? null,
      }
    })
}

function siteRequiredSlots(
  site: { id: string; name: string },
  mandatorySiteTypes: RequirementTypeRow[],
  items: ComplianceItemRow[],
  siteExclusions: { site_id: string; requirement_type_id: string }[],
  todayIso: string,
) {
  return mandatorySiteTypes
    .filter(
      (type) => !isSiteRequirementExcluded(siteExclusions, site.id, type.id),
    )
    .map((type) => {
      const item = findRequiredItem(
        items,
        (row) =>
          row.site_id === site.id && row.requirement_type_id === type.id,
      )
      return {
        status: item
          ? expiryStatus(item.expiry_date, todayIso, Boolean(type?.perpetual))
          : 'Missing',
        ownerName: site.name,
        ownerKind: 'site',
        typeName: type.name,
        expiryDate: item?.expiry_date ?? null,
      }
    })
}

function allInCompliance(
  slots: { status: string }[],
) {
  const requiredCount = slots.length
  const currentCount = slots.filter((slot) => slot.status === 'Valid').length

  return {
    requiredCount,
    currentCount,
    compliantCount: currentCount,
    expiredCount: slots.filter((slot) => slot.status === 'Expired').length,
    expiringCount: slots.filter((slot) => slot.status === 'Expiring soon')
      .length,
    missingCount: slots.filter((slot) => slot.status === 'Missing').length,
    percent:
      requiredCount === 0
        ? null
        : Math.round((currentCount / requiredCount) * 100),
  }
}

function assignedToSite(
  member: StaffDigestRow,
  siteId: string,
  activeSiteIds: Set<string>,
) {
  return (member.sites ?? []).some(
    (assigned) => assigned.id === siteId && activeSiteIds.has(assigned.id),
  )
}

function attentionItems(
  slots: {
    status: string
    ownerName: string
    typeName: string
    expiryDate: string | null
  }[],
) {
  return slots
    .filter(
      (slot) =>
        slot.status === 'Expired' ||
        slot.status === 'Expiring soon' ||
        slot.status === 'Missing' ||
        slot.status === 'Recheck due',
    )
    .sort((a, b) => {
      const rankA = DASHBOARD_ATTENTION_RANK[a.status] ?? 99
      const rankB = DASHBOARD_ATTENTION_RANK[b.status] ?? 99
      if (rankA !== rankB) return rankA - rankB
      const dateA = a.expiryDate || '9999-12-31'
      const dateB = b.expiryDate || '9999-12-31'
      if (dateA !== dateB) return dateA.localeCompare(dateB)
      const owner = String(a.ownerName ?? '').localeCompare(
        String(b.ownerName ?? ''),
      )
      if (owner !== 0) return owner
      return String(a.typeName ?? '').localeCompare(String(b.typeName ?? ''))
    })
}

function sectionFromSlots(
  id: string,
  name: string,
  slots: {
    status: string
    ownerName: string
    typeName: string
    expiryDate: string | null
  }[],
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    name,
    ...allInCompliance(slots),
    attention: attentionItems(slots),
    ...extra,
  }
}

function buildProviderComplianceReport({
  staff,
  sites,
  items,
  requirementTypes,
  exclusions,
  siteExclusions,
  todayIso,
}: {
  staff: StaffDigestRow[]
  sites: { id: string; name: string }[]
  items: ComplianceItemRow[]
  requirementTypes: RequirementTypeRow[]
  exclusions: { staff_id: string; requirement_type_id: string }[]
  siteExclusions: { site_id: string; requirement_type_id: string }[]
  todayIso: string
}) {
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
  const activeSiteIds = new Set(sites.map((site) => site.id))

  const orgSlots = [
    ...activeStaff.flatMap((member) =>
      staffRequiredSlots(
        member,
        mandatoryStaffTypes,
        visibleItems,
        exclusions,
        todayIso,
      ),
    ),
    ...sites.flatMap((site) =>
      siteRequiredSlots(
        site,
        mandatorySiteTypes,
        visibleItems,
        siteExclusions,
        todayIso,
      ),
    ),
  ]

  const siteSections = sites.map((site) => {
    const staffAtSite = activeStaff.filter((member) =>
      assignedToSite(member, site.id, activeSiteIds),
    )
    const slots = [
      ...siteRequiredSlots(
        site,
        mandatorySiteTypes,
        visibleItems,
        siteExclusions,
        todayIso,
      ),
      ...staffAtSite.flatMap((member) =>
        staffRequiredSlots(
          member,
          mandatoryStaffTypes,
          visibleItems,
          exclusions,
          todayIso,
        ),
      ),
    ]
    return sectionFromSlots(site.id, site.name, slots, {
      staffCount: staffAtSite.length,
    })
  })

  const unassignedStaff = activeStaff.filter(
    (member) =>
      !(member.sites ?? []).some((assigned) => activeSiteIds.has(assigned.id)),
  )
  const unassigned = sectionFromSlots(
    'unassigned',
    'Unassigned',
    unassignedStaff.flatMap((member) =>
      staffRequiredSlots(
        member,
        mandatoryStaffTypes,
        visibleItems,
        exclusions,
        todayIso,
      ),
    ),
    { staffCount: unassignedStaff.length },
  )

  return {
    org: allInCompliance(orgSlots),
    sites: siteSections,
    unassigned,
    hasUnassigned: unassignedStaff.length > 0,
  }
}

function recheckIntervalDays(item: ComplianceItemRow): number | null {
  const fromType = asNonNegativeInt(item.requirement_types?.recheck_interval_days)
  if (fromType != null) return fromType
  if (isWorkingTowards(item)) return WORKING_TOWARDS_RECHECK_DAYS
  return null
}

function dueExpiryKinds(item: ComplianceItemRow, today: string, leadDays: number): AlertKind[] {
  if (item.requirement_types?.perpetual) return []
  const expiry = item.expiry_date
  if (!expiry) return []
  const kinds: AlertKind[] = []
  if (expiry <= addDays(today, leadDays)) {
    kinds.push('renewal')
  }
  if (expiry <= today) {
    kinds.push('expired')
  }
  return kinds
}

function recheckBaseDate(item: ComplianceItemRow): string | null {
  if (item.last_verified_date) return item.last_verified_date
  if (item.created_at) return timestampDate(item.created_at)
  return null
}

function isRecheckDue(item: ComplianceItemRow, today: string, intervalDays: number): boolean {
  if (isWorkingTowards(item) && !hasEvidenceDocument(item)) return true
  const baseDate = recheckBaseDate(item)
  if (!baseDate) return false
  return today >= addDays(baseDate, intervalDays)
}

function timestampDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  return dateInTimeZone(date, ALERT_TIME_ZONE)
}

function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null
  const iso = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null
}

function daysUntil(isoDate: string | null | undefined, today: string): number | null {
  const iso = toIsoDate(isoDate)
  if (!iso) return null
  const expiry = new Date(`${iso}T00:00:00.000Z`)
  const start = new Date(`${today}T00:00:00.000Z`)
  return Math.round((expiry.getTime() - start.getTime()) / 86_400_000)
}

function typeForItem(
  item: ComplianceItemRow,
  requirementTypes: RequirementTypeRow[],
): RequirementTypeRow | ComplianceItemRow['requirement_types'] | ComplianceItemRow {
  return (
    requirementTypes.find((type) => type.id === item.requirement_type_id) ??
    item.requirement_types ??
    item
  )
}

function resolveAttentionRecheckDays(
  type: { name?: string | null; recheck_interval_days?: number | null; working_towards?: boolean | null },
  item: ComplianceItemRow,
): number | null {
  const fromType = Number(type?.recheck_interval_days)
  if (Number.isInteger(fromType) && fromType > 0) return fromType
  const fromItem = Number(item.requirement_types?.recheck_interval_days)
  if (Number.isInteger(fromItem) && fromItem > 0) return fromItem
  const name = String(type?.name ?? item.requirement_types?.name ?? item.label ?? '')
    .toLowerCase()
    .trim()
  if (name.includes('wwcc') || name.includes('working with children')) return 90
  if (isWorkingTowards(item) || Boolean(type?.working_towards)) {
    return WORKING_TOWARDS_RECHECK_DAYS
  }
  return null
}

function attentionRecheckClock(
  item: ComplianceItemRow,
  type: { working_towards?: boolean | null },
): string | null {
  if (isWorkingTowards(item) || Boolean(type?.working_towards)) {
    return (
      toIsoDate(item.last_verified_date) ??
      toIsoDate(item.issued_date) ??
      toIsoDate(item.created_at)
    )
  }
  return toIsoDate(item.last_verified_date)
}

function isAttentionRecheckOverdue(
  item: ComplianceItemRow,
  type: { name?: string | null; recheck_interval_days?: number | null; working_towards?: boolean | null },
  today: string,
): boolean {
  const interval = resolveAttentionRecheckDays(type, item)
  if (!interval) return false
  const clock = attentionRecheckClock(item, type)
  if (!clock) return true
  const due = addDaysIso(clock, interval)
  return Boolean(due && today >= due)
}

function attentionRenewalLeadDays(
  type: { renewal_lead_days?: number | null; name?: string | null },
  item: ComplianceItemRow,
): number {
  const fromType = Number(type?.renewal_lead_days)
  if (Number.isInteger(fromType) && fromType > 0) return fromType
  const fromItem = Number(item.requirement_types?.renewal_lead_days)
  if (Number.isInteger(fromItem) && fromItem > 0) return fromItem
  return 30
}

function isAttentionWithinRenewalWindow(
  item: ComplianceItemRow,
  type: { perpetual?: boolean | null; renewal_lead_days?: number | null; name?: string | null },
  today: string,
): boolean {
  if (type?.perpetual || item.requirement_types?.perpetual) return false
  const expiry = toIsoDate(item.expiry_date)
  if (!expiry || expiry < today) return false
  const windowStart = addDaysIso(expiry, -attentionRenewalLeadDays(type, item))
  return Boolean(windowStart && today >= windowStart)
}

// Same rules as src/lib/compliance.js attentionStatus, using Sydney today.
function attentionStatus(
  item: ComplianceItemRow & { missing?: boolean },
  type: {
    name?: string | null
    recheck_interval_days?: number | null
    renewal_lead_days?: number | null
    perpetual?: boolean | null
    working_towards?: boolean | null
  } | null,
  today: string,
): string {
  if (item?.missing) return 'Missing'
  if (workingTowardsNeedsDocument(item)) return 'Missing'
  const expiry = expiryStatus(
    item.expiry_date,
    today,
    Boolean(type?.perpetual || item.requirement_types?.perpetual),
  )
  if (expiry === 'Expired') return 'Expired'
  if (type && isAttentionRecheckOverdue(item, type, today)) return 'Recheck due'
  if (expiry === 'Expiring soon' || isAttentionWithinRenewalWindow(item, type ?? {}, today)) {
    return 'Expiring soon'
  }
  return expiry
}

function ownerName(item: ComplianceItemRow, staffById: Map<string, StaffDigestRow>): string {
  if (item.staff_id) {
    return staffById.get(item.staff_id)?.name ?? item.staff?.name ?? 'Unknown'
  }
  return item.sites?.name ?? 'Unknown'
}

function requirementName(item: ComplianceItemRow, type?: { name?: string | null }): string {
  return type?.name ?? item.requirement_types?.name ?? item.label ?? 'Requirement'
}

function urgencyLabel(
  status: string,
  item: { expiry_date?: string | null; last_verified_date?: string | null; created_at?: string | null } | null,
  today: string,
): string {
  if (status === 'Missing') return 'No record'
  if (status === 'Recheck due') {
    const verified = toIsoDate(item?.last_verified_date)
    if (verified) return `Last verified ${formatDate(verified)}`
    const recorded = toIsoDate(item?.created_at)
    if (recorded) return `Recorded ${formatDate(recorded)}`
    return 'Recheck due'
  }
  const days = daysUntil(item?.expiry_date ?? null, today)
  if (days == null) return ''
  if (days < 0) {
    const overdue = Math.abs(days)
    return `${overdue} day${overdue === 1 ? '' : 's'} overdue`
  }
  if (days === 0) return 'Expires today'
  return `in ${days} day${days === 1 ? '' : 's'}`
}

function compareSiteUrgency(left: DigestSite, right: DigestSite) {
  return (
    right.expiredCount - left.expiredCount ||
    right.missingCount - left.missingCount ||
    right.expiringCount - left.expiringCount ||
    right.recheckDueCount - left.recheckDueCount
  )
}

function sortDigestLines(lines: DigestLine[]): DigestLine[] {
  return [...lines].sort((left, right) => {
    const rank = (ATTENTION_RANK[left.status] ?? 99) - (ATTENTION_RANK[right.status] ?? 99)
    if (rank !== 0) return rank
    return (
      left.ownerName.localeCompare(right.ownerName) ||
      left.typeName.localeCompare(right.typeName)
    )
  })
}

function countsLine(section: {
  expiredCount: number
  expiringCount: number
  missingCount: number
  recheckDueCount: number
}) {
  return `${section.expiredCount} expired · ${section.expiringCount} expiring · ${section.missingCount} missing · ${section.recheckDueCount} recheck due`
}

function renderLine(line: DigestLine): string {
  const parts = [line.typeName, line.ownerName, line.status]
  if (line.urgency) parts.push(line.urgency)
  return `<li>${escapeHtml(parts.join(' · '))}</li>`
}

function orgHasForms(org: { plan?: string | null }) {
  return org.plan === 'plus' || org.plan === 'pro'
}

function digestHtml(
  orgName: string,
  digest: OrgDigest,
  overdueBySite?: Map<string, OverdueFormRow[]>,
): string {
  const sections = digest.sites
    .map((site) => {
      const rows =
        site.lines.length === 0
          ? '<p>Nothing needs attention.</p>'
          : `<ul>${site.lines.map(renderLine).join('')}</ul>`
      const overdue = overdueBySite?.get(site.id) ?? []
      const forms =
        overdue.length === 0
          ? ''
          : `<h3>Overdue forms</h3><ul>${overdue
              .map(
                (row) =>
                  `<li>${escapeHtml(row.template_name)} — ${escapeHtml(row.label)}</li>`,
              )
              .join('')}</ul>`
      return `<h2>${escapeHtml(site.name)} — ${escapeHtml(countsLine(site))}</h2>${rows}${forms}`
    })
    .join('')

  return `
    <p>Compliance items needing attention for ${escapeHtml(orgName)}.</p>
    <p><strong>${escapeHtml(countsLine(digest))}</strong></p>
    ${sections || '<p>Nothing needs attention.</p>'}
  `
}

function itemBelongsToSite(
  item: ComplianceItemRow,
  siteId: string,
  staffIdsAtSite: Set<string>,
) {
  if (item.site_id) return item.site_id === siteId
  return Boolean(item.staff_id && staffIdsAtSite.has(item.staff_id))
}

function buildOrgDigest({
  items,
  staff,
  sites,
  requirementTypes,
  exclusions,
  siteExclusions,
  today,
}: {
  items: ComplianceItemRow[]
  staff: StaffDigestRow[]
  sites: { id: string; name: string }[]
  requirementTypes: RequirementTypeRow[]
  exclusions: { staff_id: string; requirement_type_id: string }[]
  siteExclusions: { site_id: string; requirement_type_id: string }[]
  today: string
}): OrgDigest {
  const report = buildProviderComplianceReport({
    staff,
    sites,
    items,
    requirementTypes,
    exclusions,
    siteExclusions,
    todayIso: today,
  })
  const visibleItems = visibleComplianceItems({
    items,
    activeStaff: staff.filter((member) => member.employment_status === 'active'),
    exclusions,
    siteExclusions,
  }) as ComplianceItemRow[]
  const staffById = new Map(staff.map((member) => [member.id, member]))
  const activeSiteIds = new Set(sites.map((site) => site.id))

  function recheckDueCountFor(
    predicate: (item: ComplianceItemRow) => boolean,
  ) {
    return visibleItems.filter((item) => {
      if (!predicate(item)) return false
      return (
        attentionStatus(item, typeForItem(item, requirementTypes), today) ===
        'Recheck due'
      )
    }).length
  }

  function recordedLines(
    predicate: (item: ComplianceItemRow) => boolean,
  ): DigestLine[] {
    return visibleItems.flatMap((item) => {
      if (!predicate(item)) return []
      const type = typeForItem(item, requirementTypes)
      const status = attentionStatus(item, type, today)
      if (!ATTENTION_STATUSES.has(status)) return []
      return [
        {
          key: item.id,
          typeName: requirementName(item, type),
          ownerName: ownerName(item, staffById),
          status,
          urgency: urgencyLabel(status, item, today),
        },
      ]
    })
  }

  const siteRows: DigestSite[] = report.sites.map((section) => {
    const staffIdsAtSite = new Set(
      staff
        .filter(
          (member) =>
            member.employment_status === 'active' &&
            member.sites.some(
              (assigned) =>
                assigned.id === section.id && activeSiteIds.has(assigned.id),
            ),
        )
        .map((member) => member.id),
    )
    const atSite = (item: ComplianceItemRow) =>
      itemBelongsToSite(item, section.id, staffIdsAtSite)
    const lines = recordedLines(atSite)
    const recordedKeys = new Set(
      lines.map((line) => `${line.ownerName}::${line.typeName}::${line.status}`),
    )
    for (const slot of section.attention) {
      if (slot.status !== 'Missing') continue
      const key = `${slot.ownerName}::${slot.typeName}::Missing`
      if (recordedKeys.has(key)) continue
      recordedKeys.add(key)
      lines.push({
        key: `missing:${section.id}:${key}`,
        typeName: slot.typeName,
        ownerName: slot.ownerName,
        status: 'Missing',
        urgency: 'No record',
      })
    }

    return {
      id: section.id,
      name: section.name,
      expiredCount: section.expiredCount,
      expiringCount: section.expiringCount,
      missingCount: section.missingCount,
      recheckDueCount: recheckDueCountFor(atSite),
      lines: sortDigestLines(lines),
    }
  })

  if (report.hasUnassigned) {
    const assignedIds = new Set(
      staff
        .filter((member) =>
          member.sites.some((assigned) => activeSiteIds.has(assigned.id)),
        )
        .map((member) => member.id),
    )
    const unassignedItems = (item: ComplianceItemRow) =>
      Boolean(item.staff_id && !assignedIds.has(item.staff_id))
    const lines = recordedLines(unassignedItems)
    const recordedKeys = new Set(
      lines.map((line) => `${line.ownerName}::${line.typeName}::${line.status}`),
    )
    for (const slot of report.unassigned.attention) {
      if (slot.status !== 'Missing') continue
      const key = `${slot.ownerName}::${slot.typeName}::Missing`
      if (recordedKeys.has(key)) continue
      lines.push({
        key: `missing:unassigned:${key}`,
        typeName: slot.typeName,
        ownerName: slot.ownerName,
        status: 'Missing',
        urgency: 'No record',
      })
    }
    const unassignedSite: DigestSite = {
      id: 'unassigned',
      name: 'Unassigned staff',
      expiredCount: report.unassigned.expiredCount,
      expiringCount: report.unassigned.expiringCount,
      missingCount: report.unassigned.missingCount,
      recheckDueCount: recheckDueCountFor(unassignedItems),
      lines: sortDigestLines(lines),
    }
    if (
      unassignedSite.expiredCount +
        unassignedSite.expiringCount +
        unassignedSite.missingCount +
        unassignedSite.recheckDueCount >
        0 ||
      unassignedSite.lines.length > 0
    ) {
      siteRows.push(unassignedSite)
    }
  }

  return {
    expiredCount: report.org.expiredCount,
    expiringCount: report.org.expiringCount,
    missingCount: report.org.missingCount,
    recheckDueCount: recheckDueCountFor(() => true),
    sites: siteRows.sort(compareSiteUrgency),
  }
}

function alertKey(itemId: string, kind: AlertKind) {
  return `${itemId}:${kind}`
}

// Copied from src/lib/formPeriods.js so this function deploys as a single
// file. Keep period maths identical. Overdue period membership uses for_date.
// created_at dates use Australia/Sydney (same as the rest of this digest).
const FORM_DEFAULT_OPERATING_DAYS = [1, 2, 3, 4, 5]
const FORM_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const FORM_MONTHS_SHORT = FORM_MONTHS.map((name) => name.slice(0, 3))

function formIsIsoDate(value: unknown): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))
}

function formPad2(value: number) {
  return String(value).padStart(2, '0')
}

function formFormatIso(year: number, month: number, day: number) {
  return `${year}-${formPad2(month)}-${formPad2(day)}`
}

function formDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function formAddDaysIso(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00`)
  date.setDate(date.getDate() + days)
  return formFormatIso(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

function formIsoWeekday(isoDate: string) {
  if (!formIsIsoDate(isoDate)) return null
  const day = new Date(`${isoDate}T00:00:00`).getDay()
  return day === 0 ? 7 : day
}

function formPeriodBounds(cadence: string, today: string) {
  if (!formIsIsoDate(today)) return null
  const [year, month] = today.split('-').map(Number)

  if (cadence === 'daily') return { start: today, end: today }
  if (cadence === 'weekly') {
    const weekday = formIsoWeekday(today)
    if (weekday == null) return null
    const start = formAddDaysIso(today, 1 - weekday)
    return { start, end: formAddDaysIso(start, 6) }
  }
  if (cadence === 'monthly') {
    return {
      start: formFormatIso(year, month, 1),
      end: formFormatIso(year, month, formDaysInMonth(year, month)),
    }
  }
  if (cadence === 'quarterly') {
    const startMonth = Math.floor((month - 1) / 3) * 3 + 1
    const endMonth = startMonth + 2
    return {
      start: formFormatIso(year, startMonth, 1),
      end: formFormatIso(year, endMonth, formDaysInMonth(year, endMonth)),
    }
  }
  if (cadence === 'annual') {
    return { start: formFormatIso(year, 1, 1), end: formFormatIso(year, 12, 31) }
  }
  if (cadence === 'once') return { start: null, end: null }
  return null
}

function formPreviousPeriodBounds(cadence: string, today: string) {
  const current = formPeriodBounds(cadence, today)
  if (!current?.start) return null
  if (cadence === 'daily') {
    const day = formAddDaysIso(today, -1)
    return { start: day, end: day }
  }
  return formPeriodBounds(cadence, formAddDaysIso(current.start, -1))
}

function formSubmissionDate(value: string | null | undefined) {
  if (!value) return null
  if (formIsIsoDate(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return dateInTimeZone(date, ALERT_TIME_ZONE)
}

function formIsSiteOpenOn(
  site: { id: string; operating_days?: number[] },
  closures: { site_id: string; closure_date: string }[],
  day: string,
) {
  const weekday = formIsoWeekday(day)
  const operating = site.operating_days?.length
    ? site.operating_days
    : FORM_DEFAULT_OPERATING_DAYS
  if (weekday == null || !operating.includes(weekday)) return false
  return !closures.some(
    (row) => sameId(row.site_id, site.id) && row.closure_date === day,
  )
}

function formForDateInPeriod(
  row: { for_date?: string | null },
  bounds: { start: string | null; end: string | null } | null,
) {
  const dated = String(row?.for_date ?? '').slice(0, 10)
  if (!formIsIsoDate(dated)) return false
  if (!bounds || (!bounds.start && !bounds.end)) return true
  if (bounds.start && dated < bounds.start) return false
  if (bounds.end && dated > bounds.end) return false
  return true
}

function formHasStatusInPeriod(
  submissions: { status: string; site_id: string; template_id: string; for_date?: string | null }[],
  siteId: string,
  templateId: string,
  status: string,
  bounds: { start: string | null; end: string | null } | null,
) {
  return submissions.some((row) => {
    if (row.status !== status) return false
    if (!sameId(row.site_id, siteId) || !sameId(row.template_id, templateId)) {
      return false
    }
    return formForDateInPeriod(row, bounds)
  })
}

function formEachDateInclusive(start: string, end: string) {
  const days: string[] = []
  let cursor: string | null = start
  while (cursor && cursor <= end) {
    days.push(cursor)
    cursor = formAddDaysIso(cursor, 1)
  }
  return days
}

function formPeriodHasOpenDay(
  site: { id: string; operating_days?: number[] },
  closures: { site_id: string; closure_date: string }[],
  bounds: { start: string | null; end: string | null } | null,
) {
  if (!bounds?.start || !bounds?.end) return false
  return formEachDateInclusive(bounds.start, bounds.end).some((day) =>
    formIsSiteOpenOn(site, closures, day),
  )
}

function formPreviousOpenDay(
  site: { id: string; operating_days?: number[] },
  closures: { site_id: string; closure_date: string }[],
  today: string,
  notBefore: string,
) {
  let cursor: string | null = formAddDaysIso(today, -1)
  while (cursor && cursor >= notBefore) {
    if (formIsSiteOpenOn(site, closures, cursor)) return cursor
    cursor = formAddDaysIso(cursor, -1)
  }
  return null
}

function formNotBeforeIso(
  site: { created_at?: string | null },
  template: { created_at?: string | null },
) {
  const dates = [formSubmissionDate(site.created_at), formSubmissionDate(template.created_at)].filter(
    (value): value is string => Boolean(value),
  )
  return dates.length
    ? dates.reduce((latest, date) => (date > latest ? date : latest))
    : null
}

function formFormatDayLabel(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number)
  return `${day} ${FORM_MONTHS_SHORT[month - 1]} ${year}`
}

function formMissedPeriodLabel(
  cadence: string,
  bounds: { start: string | null; end: string | null } | null,
  today: string,
) {
  if (!bounds?.start) return 'missed last period'
  if (cadence === 'daily') {
    return bounds.start === formAddDaysIso(today, -1)
      ? 'missed yesterday'
      : `missed ${formFormatDayLabel(bounds.start)}`
  }
  if (cadence === 'weekly') return `missed week of ${formFormatDayLabel(bounds.start)}`
  if (cadence === 'monthly') {
    const [year, month] = bounds.start.split('-').map(Number)
    return `missed ${FORM_MONTHS[month - 1]} ${year}`
  }
  if (cadence === 'quarterly') {
    const [year, month] = bounds.start.split('-').map(Number)
    return `missed ${FORM_MONTHS_SHORT[month - 1]}–${FORM_MONTHS_SHORT[month + 1]} ${year}`
  }
  if (cadence === 'annual') return `missed ${bounds.start.slice(0, 4)}`
  return `missed ${formFormatDayLabel(bounds.start)}`
}

function findOverdueForms({
  sites,
  templates,
  exclusions,
  closures,
  submissions,
  today,
}: {
  sites: { id: string; name: string; operating_days?: number[]; created_at?: string | null }[]
  templates: { id: string; name: string; cadence: string | null; scope: string; created_at?: string | null }[]
  exclusions: { site_id: string; template_id: string }[]
  closures: { site_id: string; closure_date: string }[]
  submissions: { status: string; site_id: string; template_id: string; for_date?: string | null }[]
  today: string
}): OverdueFormRow[] {
  if (!formIsIsoDate(today)) return []

  const rows: OverdueFormRow[] = []
  for (const site of sites) {
    for (const template of templates) {
      if (template.cadence === 'once' || !template.cadence) continue
      if (template.scope !== 'all_sites') continue
      if (
        exclusions.some(
          (row) =>
            sameId(row.site_id, site.id) && sameId(row.template_id, template.id),
        )
      ) {
        continue
      }

      const notBefore = formNotBeforeIso(site, template)
      let bounds: { start: string | null; end: string | null } | null = null

      if (template.cadence === 'daily') {
        const day = formPreviousOpenDay(
          site,
          closures,
          today,
          notBefore || '2000-01-01',
        )
        if (!day) continue
        bounds = { start: day, end: day }
      } else {
        bounds = formPreviousPeriodBounds(template.cadence, today)
        if (!bounds?.start) continue
        if (notBefore && bounds.start < notBefore) continue
        if (!formPeriodHasOpenDay(site, closures, bounds)) continue
      }

      if (
        formHasStatusInPeriod(submissions, site.id, template.id, 'complete', bounds) ||
        formHasStatusInPeriod(submissions, site.id, template.id, 'missed', bounds)
      ) {
        continue
      }

      rows.push({
        site_id: site.id,
        template_name: template.name,
        label: formMissedPeriodLabel(template.cadence, bounds, today),
      })
    }
  }

  return rows
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

async function loadOverdueFormsForOrg(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  today: string,
): Promise<Map<string, OverdueFormRow[]>> {
  const [sitesResult, templatesResult, exclusionsResult] = await Promise.all([
    retryOnJwtSkew(
      () =>
        supabase
          .from('sites')
          .select('id, name, operating_days, created_at, archived_at')
          .eq('org_id', orgId)
          .is('archived_at', null),
      'overdue sites',
    ),
    retryOnJwtSkew(
      () =>
        supabase
          .from('form_templates')
          .select('id, name, cadence, scope, org_id, archived_at, created_at')
          .is('archived_at', null)
          .or(`org_id.eq.${orgId},org_id.is.null`),
      'overdue form_templates',
    ),
    retryOnJwtSkew(
      () =>
        supabase
          .from('form_site_exclusions')
          .select('site_id, template_id')
          .eq('org_id', orgId),
      'overdue form_site_exclusions',
    ),
  ])

  if (sitesResult.error) throw sitesResult.error
  if (templatesResult.error) throw templatesResult.error
  if (exclusionsResult.error) throw exclusionsResult.error

  const sites = (sitesResult.data ?? []).map((site) => ({
    id: site.id as string,
    name: site.name as string,
    created_at: site.created_at as string | null,
    operating_days:
      Array.isArray(site.operating_days) && site.operating_days.length
        ? site.operating_days.map(Number)
        : FORM_DEFAULT_OPERATING_DAYS,
  }))
  const templates = (templatesResult.data ?? []).filter(
    (template) =>
      Boolean(template.cadence) &&
      template.cadence !== 'once' &&
      template.scope === 'all_sites',
  )

  if (!sites.length || !templates.length) return new Map()

  const [closuresResult, submissionsResult] = await Promise.all([
    retryOnJwtSkew(
      () =>
        supabase
          .from('site_closures')
          .select('site_id, closure_date')
          .in(
            'site_id',
            sites.map((site) => site.id),
          ),
      'overdue site_closures',
    ),
    retryOnJwtSkew(
      () =>
        supabase
          .from('form_submissions')
          .select('site_id, template_id, status, for_date')
          .eq('org_id', orgId)
          .in('status', ['complete', 'missed'])
          .in(
            'template_id',
            templates.map((template) => template.id),
          ),
      'overdue form_submissions',
    ),
  ])

  if (closuresResult.error) throw closuresResult.error
  if (submissionsResult.error) throw submissionsResult.error

  const rows = findOverdueForms({
    sites,
    templates: templates as {
      id: string
      name: string
      cadence: string | null
      scope: string
      created_at?: string | null
    }[],
    exclusions: exclusionsResult.data ?? [],
    closures: (closuresResult.data ?? []).map((row) => ({
      site_id: row.site_id,
      closure_date: String(row.closure_date).slice(0, 10),
    })),
    submissions: (submissionsResult.data ?? []).map((row) => ({
      status: row.status,
      site_id: row.site_id,
      template_id: row.template_id,
      for_date: row.for_date ? String(row.for_date).slice(0, 10) : null,
    })),
    today,
  })

  const bySite = new Map<string, OverdueFormRow[]>()
  for (const row of rows) {
    const list = bySite.get(row.site_id) ?? []
    list.push(row)
    bySite.set(row.site_id, list)
  }
  return bySite
}

async function sendResendEmail({
  apiKey,
  from,
  to,
  subject,
  html,
}: {
  apiKey: string
  from: string
  to: string
  subject: string
  html: string
}) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  })

  const payload = await response.json()
  if (!response.ok) {
    return {
      error: new Error(payload?.message ?? `Resend request failed (${response.status})`),
    }
  }

  return { error: null }
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail =
    Deno.env.get('RESEND_FROM_EMAIL') ?? 'ECEC Alerts <onboarding@resend.dev>'

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500)
  }

  if (!hasCronSecretKey(req)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!resendApiKey) {
    return json({ error: 'Missing RESEND_API_KEY' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const today = todaySydney()
  const ownerEmailCache = new Map<string, string | null>()

  const summary = {
    sent: 0,
    skipped: 0,
    errors: [] as string[],
  }

  async function ownerEmail(ownerId: string): Promise<string | null> {
    if (ownerEmailCache.has(ownerId)) {
      return ownerEmailCache.get(ownerId) ?? null
    }

    const { data, error } = await retryOnJwtSkew(
      () => supabase.auth.admin.getUserById(ownerId),
      'owner lookup',
    )
    if (error) {
      summary.errors.push(`Failed to load owner ${ownerId}: ${error.message}`)
      ownerEmailCache.set(ownerId, null)
      return null
    }

    const email = data.user?.email ?? null
    ownerEmailCache.set(ownerId, email)
    return email
  }

  const { data: items, error: itemsError } = await retryOnJwtSkew(
    () =>
      supabase
        .from('compliance_items')
        .select(
          `
      id,
      expiry_date,
      last_verified_date,
      issued_date,
      created_at,
      org_id,
      label,
      staff_id,
      site_id,
      requirement_type_id,
      archived_at,
      document_url,
      working_towards,
      requirement_types ( name, renewal_lead_days, recheck_interval_days, perpetual ),
      staff ( name, archived_at, employment_status ),
      sites ( name, archived_at )
    `,
        )
        .is('archived_at', null),
    'compliance_items',
  )

  if (itemsError) {
    return json({ error: `Failed to load compliance items: ${itemsError.message}` }, 500)
  }

  const allItems = ((items ?? []) as ComplianceItemRow[]).filter(isAlertableItem)
  const pending: PendingAlert[] = []

  const expiryEligible: { item: ComplianceItemRow; leadDays: number; kinds: AlertKind[] }[] = []
  for (const item of allItems) {
    const leadDays = renewalLeadDays(item)
    if (leadDays === null) continue
    const kinds = dueExpiryKinds(item, today, leadDays)
    if (kinds.length === 0) continue
    expiryEligible.push({ item, leadDays, kinds })
  }

  if (expiryEligible.length > 0) {
    const expiryItemIds = [...new Set(expiryEligible.map((entry) => entry.item.id))]
    const { data: existingExpiryAlerts, error: expiryAlertsError } = await retryOnJwtSkew(
      () =>
        supabase
          .from('alerts')
          .select('compliance_item_id, threshold')
          .in('compliance_item_id', expiryItemIds)
          .in('threshold', EXPIRY_KINDS),
      'expiry alerts',
    )

    if (expiryAlertsError) {
      return json({ error: `Failed to load expiry alerts: ${expiryAlertsError.message}` }, 500)
    }

    const alreadySentExpiry = new Set(
      (existingExpiryAlerts ?? []).map(
        (row: { compliance_item_id: string; threshold: AlertKind }) =>
          alertKey(row.compliance_item_id, row.threshold),
      ),
    )

    for (const entry of expiryEligible) {
      for (const kind of entry.kinds) {
        if (alreadySentExpiry.has(alertKey(entry.item.id, kind))) {
          summary.skipped += 1
          continue
        }
        pending.push({ item: entry.item, kind, leadDays: entry.leadDays })
      }
    }
  }

  const recheckEligible: { item: ComplianceItemRow; recheckDays: number }[] = []
  for (const item of allItems) {
    const intervalDays = recheckIntervalDays(item)
    if (intervalDays === null) continue
    if (!isRecheckDue(item, today, intervalDays)) continue
    recheckEligible.push({ item, recheckDays: intervalDays })
  }

  if (recheckEligible.length > 0) {
    const recheckItemIds = [...new Set(recheckEligible.map((entry) => entry.item.id))]
    const { data: existingRecheckAlerts, error: recheckAlertsError } = await retryOnJwtSkew(
      () =>
        supabase
          .from('alerts')
          .select('compliance_item_id, threshold, sent_at')
          .in('compliance_item_id', recheckItemIds)
          .eq('threshold', 'recheck'),
      'recheck alerts',
    )

    if (recheckAlertsError) {
      return json({ error: `Failed to load recheck alerts: ${recheckAlertsError.message}` }, 500)
    }

    for (const entry of recheckEligible) {
      const baseDate = recheckBaseDate(entry.item)
      const alreadySentSinceVerified = (existingRecheckAlerts ?? []).some(
        (row: { compliance_item_id: string; sent_at: string | null }) =>
          row.compliance_item_id === entry.item.id &&
          Boolean(baseDate) &&
          timestampDate(row.sent_at) >= baseDate,
      )

      if (alreadySentSinceVerified) {
        summary.skipped += 1
        continue
      }

      pending.push({ item: entry.item, kind: 'recheck', recheckDays: entry.recheckDays })
    }
  }

  if (pending.length === 0) {
    return json(summary)
  }

  const orgIds = [...new Set(pending.map((entry) => entry.item.org_id))]
  const [
    orgsResult,
    sitesResult,
    staffResult,
    typesResult,
    staffExclusionsResult,
    siteExclusionsResult,
  ] = await Promise.all([
    retryOnJwtSkew(
      () =>
        supabase
          .from('organizations')
          .select('id, name, owner_id, alert_email, plan')
          .in('id', orgIds),
      'organizations',
    ),
    retryOnJwtSkew(
      () =>
        supabase
          .from('sites')
          .select('id, name, org_id, archived_at')
          .in('org_id', orgIds)
          .is('archived_at', null)
          .order('name', { ascending: true }),
      'sites',
    ),
    retryOnJwtSkew(
      () =>
        supabase
          .from('staff')
          .select(
            `
        id, name, employment_status, org_id, archived_at,
        staff_sites (
          site_id,
          sites ( id, name, archived_at )
        )
      `,
          )
          .in('org_id', orgIds)
          .is('archived_at', null),
      'staff',
    ),
    retryOnJwtSkew(
      () =>
        supabase
          .from('requirement_types')
          .select(
            'id, name, org_id, mandatory, applies_to, perpetual, recheck_interval_days, renewal_lead_days, archived_at',
          )
          .in('org_id', orgIds)
          .is('archived_at', null),
      'requirement_types',
    ),
    retryOnJwtSkew(
      () => supabase.from('staff_requirement_exclusions').select('staff_id, requirement_type_id'),
      'staff_requirement_exclusions',
    ),
    retryOnJwtSkew(
      () => supabase.from('site_requirement_exclusions').select('site_id, requirement_type_id'),
      'site_requirement_exclusions',
    ),
  ])

  for (const [label, result] of [
    ['organizations', orgsResult],
    ['sites', sitesResult],
    ['staff', staffResult],
    ['requirement types', typesResult],
    ['staff exclusions', staffExclusionsResult],
    ['site exclusions', siteExclusionsResult],
  ] as const) {
    if (result.error) {
      return json({ error: `Failed to load ${label}: ${result.error.message}` }, 500)
    }
  }

  const organizations = orgsResult.data
  const sitesByOrg = new Map<string, { id: string; name: string }[]>()
  for (const site of sitesResult.data ?? []) {
    const list = sitesByOrg.get(site.org_id) ?? []
    list.push({ id: site.id, name: site.name })
    sitesByOrg.set(site.org_id, list)
  }

  const staffByOrg = new Map<string, StaffDigestRow[]>()
  for (const row of staffResult.data ?? []) {
    const sites = (
      (row.staff_sites ?? []) as {
        sites: { id: string; name: string; archived_at: string | null } | null
      }[]
    )
      .map((link) => link.sites)
      .filter(
        (site): site is { id: string; name: string; archived_at: string | null } =>
          Boolean(site) && !isArchived(site.archived_at),
      )
      .map((site) => ({ id: site.id, name: site.name }))
    const list = staffByOrg.get(row.org_id) ?? []
    list.push({
      id: row.id,
      name: row.name,
      employment_status: row.employment_status ?? 'active',
      sites,
    })
    staffByOrg.set(row.org_id, list)
  }

  const typesByOrg = new Map<string, RequirementTypeRow[]>()
  for (const type of (typesResult.data ?? []) as RequirementTypeRow[]) {
    const list = typesByOrg.get(type.org_id) ?? []
    list.push(type)
    typesByOrg.set(type.org_id, list)
  }

  const staffIdsByOrg = new Map<string, Set<string>>()
  for (const [id, members] of staffByOrg) {
    staffIdsByOrg.set(id, new Set(members.map((member) => member.id)))
  }
  const siteIdsByOrg = new Map<string, Set<string>>()
  for (const [id, orgSites] of sitesByOrg) {
    siteIdsByOrg.set(id, new Set(orgSites.map((site) => site.id)))
  }

  const staffExclusionsByOrg = new Map<
    string,
    { staff_id: string; requirement_type_id: string }[]
  >()
  for (const row of staffExclusionsResult.data ?? []) {
    const orgId = [...staffIdsByOrg.entries()].find(([, ids]) =>
      ids.has(row.staff_id),
    )?.[0]
    if (!orgId) continue
    const list = staffExclusionsByOrg.get(orgId) ?? []
    list.push(row)
    staffExclusionsByOrg.set(orgId, list)
  }

  const siteExclusionsByOrg = new Map<
    string,
    { site_id: string; requirement_type_id: string }[]
  >()
  for (const row of siteExclusionsResult.data ?? []) {
    const orgId = [...siteIdsByOrg.entries()].find(([, ids]) =>
      ids.has(row.site_id),
    )?.[0]
    if (!orgId) continue
    const list = siteExclusionsByOrg.get(orgId) ?? []
    list.push(row)
    siteExclusionsByOrg.set(orgId, list)
  }

  const itemsByOrg = new Map<string, ComplianceItemRow[]>()
  for (const item of allItems) {
    const list = itemsByOrg.get(item.org_id) ?? []
    list.push(item)
    itemsByOrg.set(item.org_id, list)
  }

  const orgById = new Map(
    ((organizations ?? []) as OrganizationRow[]).map((org) => [org.id, org]),
  )

  const digestByOrg = new Map<string, OrgDigest>()
  for (const orgId of orgIds) {
    digestByOrg.set(
      orgId,
      buildOrgDigest({
        items: itemsByOrg.get(orgId) ?? [],
        staff: staffByOrg.get(orgId) ?? [],
        sites: sitesByOrg.get(orgId) ?? [],
        requirementTypes: typesByOrg.get(orgId) ?? [],
        exclusions: staffExclusionsByOrg.get(orgId) ?? [],
        siteExclusions: siteExclusionsByOrg.get(orgId) ?? [],
        today,
      }),
    )
  }

  const pendingByOrg = new Map<string, PendingAlert[]>()
  for (const entry of pending) {
    const current = pendingByOrg.get(entry.item.org_id) ?? []
    current.push(entry)
    pendingByOrg.set(entry.item.org_id, current)
  }

  for (const [orgId, entries] of pendingByOrg) {
    const org = orgById.get(orgId)
    if (!org?.owner_id) {
      summary.errors.push(`No organization owner for org ${orgId}`)
      continue
    }

    const configuredAlertEmail = org.alert_email?.trim()
    const to = configuredAlertEmail || (await ownerEmail(org.owner_id))
    if (!to) {
      summary.errors.push(`No alert email for org ${orgId}`)
      continue
    }

    const count = entries.length
    const itemWord = count === 1 ? 'item' : 'items'
    const subject = `Compliance digest: ${count} ${itemWord} need attention — ${org.name}`

    const digest = digestByOrg.get(orgId)
    if (!digest) {
      summary.errors.push(`Failed to build digest for org ${orgId}`)
      continue
    }

    let overdueBySite: Map<string, OverdueFormRow[]> | undefined
    if (orgHasForms(org)) {
      try {
        overdueBySite = await loadOverdueFormsForOrg(supabase, orgId, today)
      } catch (error) {
        const message = errorMessage(error)
        summary.errors.push(`Skipped overdue forms for org ${orgId}: ${message}`)
      }
    }

    const { error: sendError } = await sendResendEmail({
      apiKey: resendApiKey,
      from: fromEmail,
      to,
      subject,
      html: digestHtml(org.name, digest, overdueBySite),
    })

    if (sendError) {
      summary.errors.push(`Failed to email digest for org ${orgId}: ${sendError.message}`)
      continue
    }

    const sentAt = new Date().toISOString()
    const { error: insertError } = await supabase.from('alerts').insert(
      entries.map((entry) => ({
        compliance_item_id: entry.item.id,
        threshold: entry.kind,
        sent_at: sentAt,
      })),
    )

    if (insertError) {
      summary.errors.push(
        `Sent digest but failed to record alerts for org ${orgId}: ${insertError.message}`,
      )
      continue
    }

    summary.sent += 1
  }

  return json(summary)
})
