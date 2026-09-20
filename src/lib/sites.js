import { supabase } from './supabase'
import { withArchiveScope } from './archive'

const SITE_FIELDS =
  'id, name, address, service_approval_number, phone, nominated_supervisor, org_id, created_at, archived_at'

export const SITES_CHANGED_EVENT = 'ecec:sites-changed'

function notifySitesChanged() {
  window.dispatchEvent(new Event(SITES_CHANGED_EVENT))
}

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
    archived_at: row.archived_at ?? null,
  }
}

export async function listSites(orgId, { archivedOnly = false } = {}) {
  const { data, error } = await withArchiveScope(
    supabase
      .from('sites')
      .select(SITE_FIELDS)
      .eq('org_id', orgId)
      .order('created_at', { ascending: true }),
    { archivedOnly },
  )

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

  notifySitesChanged()
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

export async function archiveSite(id) {
  const { error } = await supabase
    .from('sites')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .is('archived_at', null)

  if (error) {
    return { error }
  }

  notifySitesChanged()
  return { error: null }
}

export async function restoreSite(id) {
  const { error } = await supabase
    .from('sites')
    .update({ archived_at: null })
    .eq('id', id)

  if (error) {
    return { error }
  }

  notifySitesChanged()
  return { error: null }
}

export async function deleteSite(id) {
  const { error } = await supabase.from('sites').delete().eq('id', id)

  if (error) {
    return { error }
  }

  notifySitesChanged()
  return { error: null }
}
