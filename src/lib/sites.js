import { supabase } from './supabase'

const SITE_FIELDS =
  'id, name, address, service_approval_number, phone, nominated_supervisor, org_id, created_at'

function emptyToNull(value) {
  const trimmed = typeof value === 'string' ? value.trim() : value
  return trimmed ? trimmed : null
}

function mapSite(row) {
  return {
    id: row.id,
    name: row.name,
    address: row.address ?? '',
    service_approval_number: row.service_approval_number ?? '',
    phone: row.phone ?? '',
    nominated_supervisor: row.nominated_supervisor ?? '',
    org_id: row.org_id,
    created_at: row.created_at,
  }
}

export async function listSites(orgId) {
  const { data, error } = await supabase
    .from('sites')
    .select(SITE_FIELDS)
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })

  if (error) {
    return { data: null, error }
  }

  return { data: (data ?? []).map(mapSite), error: null }
}

export async function getSite(id) {
  const { data, error } = await supabase
    .from('sites')
    .select(SITE_FIELDS)
    .eq('id', id)
    .single()

  if (error) {
    return { data: null, error }
  }

  return { data: mapSite(data), error: null }
}

export async function createSite({
  name,
  orgId,
  address,
  serviceApprovalNumber,
  phone,
  nominatedSupervisor,
}) {
  const { data, error } = await supabase
    .from('sites')
    .insert({
      name,
      org_id: orgId,
      address: emptyToNull(address),
      service_approval_number: emptyToNull(serviceApprovalNumber),
      phone: emptyToNull(phone),
      nominated_supervisor: emptyToNull(nominatedSupervisor),
    })
    .select(SITE_FIELDS)
    .single()

  if (error) {
    return { data: null, error }
  }

  return { data: mapSite(data), error: null }
}

export async function updateSite(id, {
  name,
  address,
  serviceApprovalNumber,
  phone,
  nominatedSupervisor,
}) {
  const { data, error } = await supabase
    .from('sites')
    .update({
      name,
      address: emptyToNull(address),
      service_approval_number: emptyToNull(serviceApprovalNumber),
      phone: emptyToNull(phone),
      nominated_supervisor: emptyToNull(nominatedSupervisor),
    })
    .eq('id', id)
    .select(SITE_FIELDS)
    .single()

  if (error) {
    return { data: null, error }
  }

  return { data: mapSite(data), error: null }
}

export async function deleteSite(id) {
  const { error } = await supabase.from('sites').delete().eq('id', id)

  if (error) {
    return { error }
  }

  return { error: null }
}
