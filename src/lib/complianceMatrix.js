import { isArchived } from './archive'
import {
  complianceStatus,
  isOtherRequirementType,
  isSiteRequirementType,
  isStaffRequirementType,
} from './compliance'
import {
  isRequirementExcluded,
  isSiteRequirementExcluded,
  sameId,
} from './exclusions'
import { isActiveStaff } from './staff'

function matchesStatusFilter(statusFilter, computedStatus) {
  if (!statusFilter) return true
  if (statusFilter === 'current') return computedStatus === 'Valid'
  if (statusFilter === 'expiring') return computedStatus === 'Expiring soon'
  if (statusFilter === 'expired') return computedStatus === 'Expired'
  if (statusFilter === 'missing') return computedStatus === 'Missing'
  return true
}

function compareNames(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, {
    sensitivity: 'base',
  })
}

export function matrixStaffTypes(requirementTypes) {
  return (requirementTypes ?? [])
    .filter(isStaffRequirementType)
    .filter((type) => !isOtherRequirementType(type))
    .filter((type) => !isArchived(type))
    .slice()
    .sort((a, b) => compareNames(a.name, b.name))
}

export function matrixStaff(staff) {
  return (staff ?? [])
    .filter((member) => !isArchived(member))
    .filter(isActiveStaff)
    .slice()
    .sort((a, b) => compareNames(a.name, b.name))
}

export function matrixSiteTypes(requirementTypes) {
  return (requirementTypes ?? [])
    .filter(isSiteRequirementType)
    .filter((type) => !isOtherRequirementType(type))
    .filter((type) => !isArchived(type))
    .slice()
    .sort((a, b) => compareNames(a.name, b.name))
}

export function matrixSites(sites) {
  return (sites ?? [])
    .filter((site) => !isArchived(site))
    .slice()
    .sort((a, b) => compareNames(a.name, b.name))
}

export function activeStaffSites(member) {
  return (member?.sites ?? []).filter((site) => !isArchived(site))
}

export function staffMatchesSite(member, siteId) {
  const sites = activeStaffSites(member)
  if (!siteId) return true
  if (siteId === 'unassigned') return sites.length === 0
  return sites.some((site) => sameId(site.id, siteId))
}

export function itemForStaffType(items, staffId, typeId) {
  return (
    (items ?? []).find(
      (item) =>
        sameId(item.staff_id, staffId) &&
        sameId(item.requirement_type_id, typeId),
    ) ?? null
  )
}

export function itemForSiteType(items, siteId, typeId) {
  return (
    (items ?? []).find(
      (item) =>
        sameId(item.site_id, siteId) &&
        sameId(item.requirement_type_id, typeId),
    ) ?? null
  )
}

export function matrixCell({ member, type, item, exclusions }) {
  if (isRequirementExcluded(exclusions, member.id, type.id)) {
    return {
      kind: 'na',
      status: 'Not applicable',
      item: null,
    }
  }

  if (!item) {
    return {
      kind: 'missing',
      status: 'Missing',
      item: null,
    }
  }

  return {
    kind: 'item',
    status: complianceStatus(item.expiry_date),
    item,
  }
}

export function buildMatrixCells({ types, staff, items, exclusions }) {
  const cells = new Map()

  for (const type of types) {
    for (const member of staff) {
      const item = itemForStaffType(items, member.id, type.id)
      cells.set(
        `${type.id}:${member.id}`,
        matrixCell({ member, type, item, exclusions }),
      )
    }
  }

  return cells
}

export function matrixSiteCell({ site, type, item, exclusions }) {
  if (isSiteRequirementExcluded(exclusions, site.id, type.id)) {
    return {
      kind: 'na',
      status: 'Not applicable',
      item: null,
    }
  }

  if (!item) {
    return {
      kind: 'missing',
      status: 'Missing',
      item: null,
    }
  }

  return {
    kind: 'item',
    status: complianceStatus(item.expiry_date),
    item,
  }
}

export function buildSiteMatrixCells({ types, sites, items, exclusions }) {
  const cells = new Map()

  for (const type of types) {
    for (const site of sites) {
      const item = itemForSiteType(items, site.id, type.id)
      cells.set(
        `${type.id}:${site.id}`,
        matrixSiteCell({ site, type, item, exclusions }),
      )
    }
  }

  return cells
}

export function filterMatrix({
  types,
  staff,
  items,
  exclusions,
  typeId = '',
  status = '',
  staffId = '',
  siteId = '',
}) {
  const scopedTypes = typeId
    ? types.filter((type) => sameId(type.id, typeId))
    : types
  const scopedStaff = staff.filter((member) => {
    if (staffId && !sameId(member.id, staffId)) return false
    return staffMatchesSite(member, siteId)
  })

  const cells = buildMatrixCells({
    types: scopedTypes,
    staff: scopedStaff,
    items,
    exclusions,
  })

  if (!status) {
    return { types: scopedTypes, staff: scopedStaff, cells }
  }

  const matchingTypeIds = new Set()
  const matchingStaffIds = new Set()

  for (const type of scopedTypes) {
    for (const member of scopedStaff) {
      const cell = cells.get(`${type.id}:${member.id}`)
      if (cell && matchesStatusFilter(status, cell.status)) {
        matchingTypeIds.add(type.id)
        matchingStaffIds.add(member.id)
      }
    }
  }

  const visibleTypes = scopedTypes.filter((type) => matchingTypeIds.has(type.id))
  const visibleStaff = scopedStaff.filter((member) =>
    matchingStaffIds.has(member.id),
  )

  return {
    types: visibleTypes,
    staff: visibleStaff,
    cells: buildMatrixCells({
      types: visibleTypes,
      staff: visibleStaff,
      items,
      exclusions,
    }),
  }
}

export function filterSiteMatrix({
  types,
  sites,
  items,
  exclusions,
  typeId = '',
  status = '',
  siteId = '',
}) {
  const scopedTypes = typeId
    ? types.filter((type) => sameId(type.id, typeId))
    : types
  const scopedSites = sites.filter((site) => {
    if (siteId && !sameId(site.id, siteId)) return false
    return true
  })

  const cells = buildSiteMatrixCells({
    types: scopedTypes,
    sites: scopedSites,
    items,
    exclusions,
  })

  if (!status) {
    return { types: scopedTypes, sites: scopedSites, cells }
  }

  const matchingTypeIds = new Set()
  const matchingSiteIds = new Set()

  for (const type of scopedTypes) {
    for (const site of scopedSites) {
      const cell = cells.get(`${type.id}:${site.id}`)
      if (cell && matchesStatusFilter(status, cell.status)) {
        matchingTypeIds.add(type.id)
        matchingSiteIds.add(site.id)
      }
    }
  }

  const visibleTypes = scopedTypes.filter((type) => matchingTypeIds.has(type.id))
  const visibleSites = scopedSites.filter((site) => matchingSiteIds.has(site.id))

  return {
    types: visibleTypes,
    sites: visibleSites,
    cells: buildSiteMatrixCells({
      types: visibleTypes,
      sites: visibleSites,
      items,
      exclusions,
    }),
  }
}

function csvCell(value) {
  const text = String(value ?? '')
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

export function matrixCsv({
  types,
  owners,
  staff,
  cells,
  ownerHeader = 'Staff',
}) {
  const columns = owners ?? staff
  const header = ['Requirement', ownerHeader, 'Status', 'Expiry', 'Document']
  const rows = [header.map(csvCell).join(',')]

  for (const type of types) {
    for (const member of columns) {
      const cell = cells.get(`${type.id}:${member.id}`)
      if (!cell) continue
      rows.push(
        [
          type.name,
          member.name,
          cell.status,
          cell.item?.expiry_date ?? '',
          cell.item?.document_url ? 'Yes' : '',
        ]
          .map(csvCell)
          .join(','),
      )
    }
  }

  return `${rows.join('\n')}\n`
}
