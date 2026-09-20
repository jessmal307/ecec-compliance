import { complianceStatus, isOtherRequirementType } from './compliance'

const URGENCY_RANK = {
  Expired: 0,
  Missing: 1,
  'Expiring soon': 2,
  Valid: 3,
}

function compareUrgent(a, b) {
  const rankDiff = URGENCY_RANK[a.status] - URGENCY_RANK[b.status]
  if (rankDiff !== 0) return rankDiff

  if (a.status === 'Missing') {
    const mandatoryDiff =
      Number(Boolean(b.requirementType.mandatory)) -
      Number(Boolean(a.requirementType.mandatory))
    if (mandatoryDiff !== 0) return mandatoryDiff
    return a.requirementType.name.localeCompare(b.requirementType.name)
  }

  return (a.item?.expiry_date ?? '').localeCompare(b.item?.expiry_date ?? '')
}

export function buildStaffRequirementRows(requirementTypes, items, staffId) {
  const forStaff = (entry) =>
    staffId == null || String(entry.staff_id) === String(staffId)

  const otherType = requirementTypes.find(isOtherRequirementType) ?? null
  const rows = requirementTypes
    .filter((type) => !isOtherRequirementType(type))
    .map((requirementType) => ({
      requirementType,
      item: items.find(
        (entry) =>
          forStaff(entry) &&
          String(entry.requirement_type_id) === String(requirementType.id),
      ),
    }))

  const extraRows = otherType
    ? items
        .filter(
          (entry) =>
            forStaff(entry) &&
            String(entry.requirement_type_id) === String(otherType.id),
        )
        .map((item) => ({ requirementType: otherType, item }))
    : []

  return { otherType, rows, extraRows }
}

export function summarizeProfileRequirements(rows, isExcluded) {
  const applicable = rows
    .filter(({ requirementType }) => !isExcluded(requirementType.id))
    .map(({ requirementType, item }) => ({
      requirementType,
      item,
      status: item ? complianceStatus(item.expiry_date) : 'Missing',
    }))

  const counts = {
    current: applicable.filter((row) => row.status === 'Valid').length,
    expiring: applicable.filter((row) => row.status === 'Expiring soon').length,
    expired: applicable.filter((row) => row.status === 'Expired').length,
    missing: applicable.filter((row) => row.status === 'Missing').length,
  }

  const mostUrgent =
    applicable
      .filter((row) => row.status !== 'Valid')
      .sort(compareUrgent)[0] ?? null

  const applicableCount = applicable.length
  const completed = counts.current + counts.expiring
  const percent =
    applicableCount === 0 ? 100 : Math.round((completed / applicableCount) * 100)

  return {
    counts,
    overall: mostUrgent ? 'Action needed' : 'Compliant',
    mostUrgent,
    applicableCount,
    completed,
    percent,
  }
}
