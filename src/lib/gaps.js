import {
  itemComplianceStatus,
  isSiteRequirementType,
  isStaffRequirementType,
  workingTowardsNeedsDocument,
} from './compliance'
import {
  isRequirementExcluded,
  isSiteRequirementExcluded,
} from './exclusions'
import { paths } from './paths'

function expiredForOwner(visibleItems, predicate) {
  return visibleItems.filter(
    (item) =>
      predicate(item) && itemComplianceStatus(item) === 'Expired',
  )
}

export function buildOwnerGaps({
  activeStaff,
  sites,
  visibleItems,
  requirementTypes,
  exclusions,
  siteExclusions,
}) {
  const staffTypes = requirementTypes.filter(
    (type) => type.mandatory && isStaffRequirementType(type),
  )
  const siteTypes = requirementTypes.filter(
    (type) => type.mandatory && isSiteRequirementType(type),
  )

  const staffGaps = activeStaff.map((member) => {
    const missing = staffTypes.filter(
      (type) =>
        !isRequirementExcluded(exclusions, member.id, type.id) &&
        !visibleItems.some(
          (item) =>
            item.staff_id === member.id &&
            item.requirement_type_id === type.id &&
            !workingTowardsNeedsDocument(item),
        ),
    )
    const expired = expiredForOwner(
      visibleItems,
      (item) => item.staff_id === member.id,
    )

    return {
      id: member.id,
      kind: 'staff',
      name: member.name,
      detail: member.role,
      missing,
      expired,
      count: missing.length + expired.length,
      href: paths.staffProfile(member.id),
    }
  })

  const siteGaps = sites.map((site) => {
    const missing = siteTypes.filter(
      (type) =>
        !isSiteRequirementExcluded(siteExclusions, site.id, type.id) &&
        !visibleItems.some(
          (item) =>
            item.site_id === site.id && item.requirement_type_id === type.id,
        ),
    )
    const expired = expiredForOwner(
      visibleItems,
      (item) => item.site_id === site.id,
    )

    return {
      id: site.id,
      kind: 'site',
      name: site.name,
      detail: '',
      missing,
      expired,
      count: missing.length + expired.length,
      href: paths.siteProfile(site.id),
    }
  })

  return [...staffGaps, ...siteGaps]
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export function countStaffGaps(member, { requirementTypes, items, exclusions }) {
  const staffTypes = requirementTypes.filter(
    (type) => type.mandatory && isStaffRequirementType(type),
  )
  const missing = staffTypes.filter(
    (type) =>
      !isRequirementExcluded(exclusions, member.id, type.id) &&
      !items.some(
        (item) =>
          item.staff_id === member.id &&
          item.requirement_type_id === type.id &&
          !workingTowardsNeedsDocument(item),
      ),
  ).length
  const expired = items.filter(
    (item) =>
      item.staff_id === member.id &&
      !isRequirementExcluded(exclusions, member.id, item.requirement_type_id) &&
      itemComplianceStatus(item) === 'Expired',
  ).length

  return missing + expired
}
