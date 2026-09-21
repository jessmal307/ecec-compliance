// Shared with Overview. Do not change status maths here without updating the dashboard.

  Expired: 0,
  'Expiring soon': 1,
  Missing: 2,
}

export function isStaffRequirementType(requirementType) {
  return requirementType?.applies_to !== 'site'
}

export function isSiteRequirementType(requirementType) {
  return requirementType?.applies_to === 'site'
}

export function isActiveStaff(member) {
  return member?.employment_status !== 'inactive'
}

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right)
}

export function isRequirementExcluded(exclusions, staffId, requirementTypeId) {
  return (exclusions ?? []).some(
    (row) =>
      sameId(row.staff_id, staffId) &&
      sameId(row.requirement_type_id, requirementTypeId),
  )
}

export function isSiteRequirementExcluded(
  exclusions,
  siteId,
  requirementTypeId,
) {
  return (exclusions ?? []).some(
    (row) =>
      sameId(row.site_id, siteId) &&
      sameId(row.requirement_type_id, requirementTypeId),
  )
}

export function addDaysIso(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Same rules as Overview: expiry vs today, then within 30 days.
export function expiryStatus(expiryDate, todayIso) {
  const expiry = String(expiryDate ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return 'Expired'
  if (expiry < todayIso) return 'Expired'
  const soon = addDaysIso(todayIso, 30)
  if (soon && expiry <= soon) return 'Expiring soon'
  return 'Valid'
}

export function visibleComplianceItems({
  items,
  activeStaff,
  exclusions,
  siteExclusions,
}) {
  const activeStaffIds = new Set(activeStaff.map((member) => member.id))

  return (items ?? []).filter((item) => {
    if (item.site_id) {
      return !isSiteRequirementExcluded(
        siteExclusions,
        item.site_id,
        item.requirement_type_id,
      )
    }
    if (!item.staff_id) return true
    if (!activeStaffIds.has(item.staff_id)) return false
    return !isRequirementExcluded(
      exclusions,
      item.staff_id,
      item.requirement_type_id,
    )
  })
}

function findRequiredItem(visibleItems, matches) {
  return visibleItems.find(matches) ?? null
}

function staffRequiredSlots(
  member,
  mandatoryStaffTypes,
  visibleItems,
  exclusions,
  todayIso,
) {
  return mandatoryStaffTypes
    .filter((type) => !isRequirementExcluded(exclusions, member.id, type.id))
    .map((type) => {
      const item = findRequiredItem(
        visibleItems,
        (row) =>
          row.staff_id === member.id && row.requirement_type_id === type.id,
      )
      return {
        status: item ? expiryStatus(item.expiry_date, todayIso) : 'Missing',
        ownerName: member.name,
        ownerKind: 'staff',
        typeName: type.name,
        expiryDate: item?.expiry_date ?? null,
      }
    })
}

function siteRequiredSlots(
  site,
  mandatorySiteTypes,
  visibleItems,
  siteExclusions,
  todayIso,
) {
  return mandatorySiteTypes
    .filter(
      (type) => !isSiteRequirementExcluded(siteExclusions, site.id, type.id),
    )
    .map((type) => {
      const item = findRequiredItem(
        visibleItems,
        (row) =>
          row.site_id === site.id && row.requirement_type_id === type.id,
      )
      return {
        status: item ? expiryStatus(item.expiry_date, todayIso) : 'Missing',
        ownerName: site.name,
        ownerKind: 'site',
        typeName: type.name,
        expiryDate: item?.expiry_date ?? null,
      }
    })
}

export function allInCompliance(slots) {
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

function assignedToSite(member, siteId, activeSiteIds) {
  return (member.sites ?? []).some(
    (assigned) => assigned.id === siteId && activeSiteIds.has(assigned.id),
  )
}

function attentionItems(slots) {
  return slots
    .filter(
      (slot) =>
        slot.status === 'Expired' ||
        slot.status === 'Expiring soon' ||
        slot.status === 'Missing',
    )
    .sort((a, b) => {
      const rankA = ATTENTION_RANK[a.status] ?? 99
      const rankB = ATTENTION_RANK[b.status] ?? 99
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

function sectionFromSlots(id, name, slots, extra = {}) {
  return {
    id,
    name,
    ...allInCompliance(slots),
    attention: attentionItems(slots),
    ...extra,
  }
}

export function buildProviderComplianceReport({
  staff,
  sites,
  items,
  requirementTypes,
  exclusions,
  siteExclusions,
  todayIso,
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

  const siteSections = sites
    .map((site) => {
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
