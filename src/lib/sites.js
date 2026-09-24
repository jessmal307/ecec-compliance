import { supabase } from './supabase'
import { withArchiveScope } from './archive'

const SITE_FIELDS =
  'id, name, address, service_approval_number, phone, nominated_supervisor, operating_days, org_id, created_at, archived_at'

export const DEFAULT_OPERATING_DAYS = [1, 2, 3, 4, 5]

export const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
]

function mapOperatingDays(value) {
  if (!Array.isArray(value) || value.length === 0) return [...DEFAULT_OPERATING_DAYS]
  return value.map(Number).filter((day) => day >= 1 && day <= 7)
}

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
    operating_days: mapOperatingDays(row.operating_days),
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
  operatingDays,
}) {
  const payload = {
    name,
    address: emptyToNull(address),
    service_approval_number: emptyToNull(serviceApprovalNumber),
    phone: emptyToNull(phone),
    nominated_supervisor: emptyToNull(nominatedSupervisor),
  }
  if (operatingDays !== undefined) {
    payload.operating_days = mapOperatingDays(operatingDays)
  }

  const { data, error } = await supabase
    .from('sites')
    .update(payload)
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

function mapClosure(row) {
  return {
    id: row.id,
    org_id: row.org_id,
    site_id: row.site_id,
    closure_date: row.closure_date ? String(row.closure_date).slice(0, 10) : '',
    note: row.note ?? '',
    created_at: row.created_at,
  }
}

export async function listSiteClosures(siteId, { upcomingOnly = true } = {}) {
  if (!siteId) return { data: [], error: null }

  let query = supabase
    .from('site_closures')
    .select('id, org_id, site_id, closure_date, note, created_at')
    .eq('site_id', siteId)
    .order('closure_date', { ascending: true })

  if (upcomingOnly) {
    const today = new Date()
    const iso = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-')
    query = query.gte('closure_date', iso)
  }

  const { data, error } = await query
  if (error) return { data: [], error }
  return { data: (data ?? []).map(mapClosure), error: null }
}

export async function createSiteClosure({ orgId, siteId, closureDate, note }) {
  const { data, error } = await supabase
    .from('site_closures')
    .insert({
      org_id: orgId,
      site_id: siteId,
      closure_date: closureDate,
      note: emptyToNull(note),
    })
    .select('id, org_id, site_id, closure_date, note, created_at')
    .single()

  if (error) return { data: null, error }
  return { data: mapClosure(data), error: null }
}

export async function deleteSiteClosure(id) {
  const { error } = await supabase.from('site_closures').delete().eq('id', id)
  return { error }
}

export async function listSiteClosuresForSites(siteIds, { date } = {}) {
  if (!siteIds?.length) return { data: [], error: null }

  let query = supabase
    .from('site_closures')
    .select('id, org_id, site_id, closure_date, note, created_at')
    .in('site_id', siteIds)
    .order('closure_date', { ascending: true })

  if (date) query = query.eq('closure_date', date)

  const { data, error } = await query
  if (error) return { data: [], error }
  return { data: (data ?? []).map(mapClosure), error: null }
}
