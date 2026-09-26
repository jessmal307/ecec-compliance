import { supabase } from './supabase'

export function sameId(left, right) {
  return left != null && right != null && String(left) === String(right)
}

function isUniqueViolation(error) {
  return error?.code === '23505'
}

export function isRequirementExcluded(exclusions, staffId, requirementTypeId) {
  return exclusions.some(
    (row) =>
      sameId(row.staff_id, staffId) &&
      sameId(row.requirement_type_id, requirementTypeId),
  )
}

export async function listStaffRequirementExclusions(staffIds) {
  if (!staffIds?.length) {
    return { data: [], error: null }
  }

  const { data, error } = await supabase
    .from('staff_requirement_exclusions')
    .select('staff_id, requirement_type_id')
    .in('staff_id', staffIds)

  if (error) {
    return { data: null, error }
  }

  return { data: data ?? [], error: null }
}

export async function listStaffRequirementExclusionsForOrg(orgId) {
  const { data, error } = await supabase
    .from('staff_requirement_exclusions')
    .select('staff_id, requirement_type_id, staff!inner ( org_id )')
    .eq('staff.org_id', orgId)

  if (error) {
    return { data: null, error }
  }

  return {
    data: (data ?? []).map((row) => ({
      staff_id: row.staff_id,
      requirement_type_id: row.requirement_type_id,
    })),
    error: null,
  }
}

export async function listStaffRequirementExclusionsAtSite(siteId) {
  const { data, error } = await supabase
    .from('staff_requirement_exclusions')
    .select(
      'staff_id, requirement_type_id, staff!inner ( staff_sites!inner ( site_id ) )',
    )
    .eq('staff.staff_sites.site_id', siteId)

  if (error) {
    return { data: null, error }
  }

  return {
    data: (data ?? []).map((row) => ({
      staff_id: row.staff_id,
      requirement_type_id: row.requirement_type_id,
    })),
    error: null,
  }
}

async function orgIdForStaff(staffId) {
  const { data, error } = await supabase
    .from('staff')
    .select('org_id')
    .eq('id', staffId)
    .single()

  if (error) return { orgId: null, error }
  if (!data?.org_id) {
    return {
      orgId: null,
      error: { message: 'This staff member is missing an organisation.' },
    }
  }

  return { orgId: data.org_id, error: null }
}

export async function addStaffRequirementExclusion(staffId, requirementTypeId) {
  const resolved = await orgIdForStaff(staffId)
  if (resolved.error) {
    return { error: resolved.error }
  }

  const payload = {
    staff_id: staffId,
    requirement_type_id: requirementTypeId,
    org_id: resolved.orgId,
  }

  const { error } = await supabase
    .from('staff_requirement_exclusions')
    .insert(payload)

  if (error && !isUniqueViolation(error)) {
    return { error }
  }

  return { error: null }
}

export async function removeStaffRequirementExclusion(staffId, requirementTypeId) {
  const { error } = await supabase
    .from('staff_requirement_exclusions')
    .delete()
    .eq('staff_id', staffId)
    .eq('requirement_type_id', requirementTypeId)

  if (error) {
    return { error }
  }

  return { error: null }
}

export function isSiteRequirementExcluded(exclusions, siteId, requirementTypeId) {
  return exclusions.some(
    (row) =>
      sameId(row.site_id, siteId) &&
      sameId(row.requirement_type_id, requirementTypeId),
  )
}

export async function listSiteRequirementExclusions(siteIds) {
  if (!siteIds?.length) {
    return { data: [], error: null }
  }

  const { data, error } = await supabase
    .from('site_requirement_exclusions')
    .select('site_id, requirement_type_id')
    .in('site_id', siteIds)

  if (error) {
    return { data: null, error }
  }

  return { data: data ?? [], error: null }
}

export async function listSiteRequirementExclusionsForOrg(orgId) {
  const { data, error } = await supabase
    .from('site_requirement_exclusions')
    .select('site_id, requirement_type_id, sites!inner ( org_id )')
    .eq('sites.org_id', orgId)

  if (error) {
    return { data: null, error }
  }

  return {
    data: (data ?? []).map((row) => ({
      site_id: row.site_id,
      requirement_type_id: row.requirement_type_id,
    })),
    error: null,
  }
}

async function orgIdForSite(siteId) {
  const { data, error } = await supabase
    .from('sites')
    .select('org_id')
    .eq('id', siteId)
    .single()

  if (error) return { orgId: null, error }
  if (!data?.org_id) {
    return {
      orgId: null,
      error: { message: 'This centre is missing an organisation.' },
    }
  }

  return { orgId: data.org_id, error: null }
}

export async function addSiteRequirementExclusion(siteId, requirementTypeId) {
  const resolved = await orgIdForSite(siteId)
  if (resolved.error) {
    return { error: resolved.error }
  }

  const { error } = await supabase.from('site_requirement_exclusions').insert({
    site_id: siteId,
    requirement_type_id: requirementTypeId,
    org_id: resolved.orgId,
  })

  if (error && !isUniqueViolation(error)) {
    return { error }
  }

  return { error: null }
}

export async function removeSiteRequirementExclusion(siteId, requirementTypeId) {
  const { error } = await supabase
    .from('site_requirement_exclusions')
    .delete()
    .eq('site_id', siteId)
    .eq('requirement_type_id', requirementTypeId)

  if (error) {
    return { error }
  }

  return { error: null }
}
