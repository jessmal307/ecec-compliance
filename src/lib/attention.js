import {
  attentionStatus,
  complianceStatus,
  isSiteRequirementType,
  isStaffRequirementType,
  recheckDueDate,
  resolveRecheckDays,
} from './compliance'
import {
  isRequirementExcluded,
  isSiteRequirementExcluded,
} from './exclusions'

export const ATTENTION_LIMIT = 8

const STATUS_RANK = {
  Expired: 0,
  Missing: 1,
  'Recheck due': 2,
  'Expiring soon': 3,
  Valid: 4,
}

export function buildUrgentItems({
  visibleItems,
  activeStaff,
  sites,
  requirementTypes,
  exclusions,
  siteExclusions,
}) {
  const typeById = (id, fallback) =>
    requirementTypes.find((requirementType) => requirementType.id === id) ??
    fallback

  const recordedUrgent = visibleItems.filter((item) => {
    const status = attentionStatus(item, typeById(item.requirement_type_id, item))
    return (
      status === 'Expired' ||
      status === 'Recheck due' ||
      status === 'Expiring soon'
    )
  })

  const missingRecheckItems = []
  const recheckTypes = requirementTypes.filter((type) =>
    resolveRecheckDays(type),
  )

  for (const member of activeStaff) {
    for (const type of recheckTypes.filter(isStaffRequirementType)) {
      if (isRequirementExcluded(exclusions, member.id, type.id)) continue
      const recorded = visibleItems.some(
        (item) =>
          item.staff_id === member.id && item.requirement_type_id === type.id,
      )
      if (recorded) continue
      missingRecheckItems.push({
        id: `missing-staff-${member.id}-${type.id}`,
        missing: true,
        requirement_type_id: type.id,
        typeName: type.name,
        staff_id: member.id,
        site_id: null,
        ownerName: member.name,
        ownerKind: 'staff',
        expiry_date: null,
        last_verified_date: null,
      })
    }
  }

  for (const site of sites) {
    for (const type of recheckTypes.filter(
      (requirementType) => !isStaffRequirementType(requirementType),
    )) {
      if (isSiteRequirementExcluded(siteExclusions, site.id, type.id)) continue
      const recorded = visibleItems.some(
        (item) =>
          item.site_id === site.id && item.requirement_type_id === type.id,
      )
      if (recorded) continue
      missingRecheckItems.push({
        id: `missing-site-${site.id}-${type.id}`,
        missing: true,
        requirement_type_id: type.id,
        typeName: type.name,
        staff_id: null,
        site_id: site.id,
        ownerName: site.name,
        ownerKind: 'site',
        expiry_date: null,
        last_verified_date: null,
      })
    }
  }

  const urgentItems = [...recordedUrgent, ...missingRecheckItems].sort((a, b) => {
    const typeA = typeById(a.requirement_type_id, a)
    const typeB = typeById(b.requirement_type_id, b)
    const statusA = attentionStatus(a, typeA)
    const statusB = attentionStatus(b, typeB)
    if (STATUS_RANK[statusA] !== STATUS_RANK[statusB]) {
      return STATUS_RANK[statusA] - STATUS_RANK[statusB]
    }
    const dateA =
      statusA === 'Recheck due'
        ? (recheckDueDate(a, typeA) ?? a.expiry_date ?? '')
        : (a.expiry_date ?? '')
    const dateB =
      statusB === 'Recheck due'
        ? (recheckDueDate(b, typeB) ?? b.expiry_date ?? '')
        : (b.expiry_date ?? '')
    return dateA.localeCompare(dateB)
  })

  return {
    items: urgentItems,
    staffItems: urgentItems.filter((item) => item.ownerKind === 'staff'),
    siteItems: urgentItems.filter((item) => item.ownerKind !== 'staff'),
  }
}

function buildRequiredItemsByStatus(
  status,
  {
    visibleItems,
    activeStaff,
    sites,
    requirementTypes,
    exclusions,
    siteExclusions,
  },
) {
  const mandatoryStaffTypes = requirementTypes.filter(
    (type) => type.mandatory && isStaffRequirementType(type),
  )
  const mandatorySiteTypes = requirementTypes.filter(
    (type) => type.mandatory && isSiteRequirementType(type),
  )

  const matched = []

  for (const member of activeStaff) {
    for (const type of mandatoryStaffTypes) {
      if (isRequirementExcluded(exclusions, member.id, type.id)) continue
      const item = visibleItems.find(
        (row) =>
          row.staff_id === member.id && row.requirement_type_id === type.id,
      )
      if (!item) continue
      if (complianceStatus(item.expiry_date) !== status) continue
      matched.push(item)
    }
  }

  for (const site of sites) {
    for (const type of mandatorySiteTypes) {
      if (isSiteRequirementExcluded(siteExclusions, site.id, type.id)) continue
      const item = visibleItems.find(
        (row) =>
          row.site_id === site.id && row.requirement_type_id === type.id,
      )
      if (!item) continue
      if (complianceStatus(item.expiry_date) !== status) continue
      matched.push(item)
    }
  }

  matched.sort((a, b) =>
    String(a.expiry_date ?? '').localeCompare(String(b.expiry_date ?? '')),
  )

  return {
    items: matched,
    staffItems: matched.filter((item) => item.ownerKind === 'staff'),
    siteItems: matched.filter((item) => item.ownerKind !== 'staff'),
  }
}

export function buildExpiringSoonItems(args) {
  return buildRequiredItemsByStatus('Expiring soon', args)
}

export function buildExpiredItems(args) {
  return buildRequiredItemsByStatus('Expired', args)
}

export function visibleComplianceItems({
  items,
  activeStaff,
  exclusions,
  siteExclusions,
}) {
  const activeStaffIds = new Set(activeStaff.map((member) => member.id))

  return items.filter((item) => {
    if (item.site_id) {
      return !isSiteRequirementExcluded(
        siteExclusions,
        item.site_id,
        item.requirement_type_id,
      )
    }
    if (!item.staff_id) return true
    if (!activeStaffIds.has(item.staff_id)) return false
    return !isRequirementExcluded(exclusions, item.staff_id, item.requirement_type_id)
  })
}
