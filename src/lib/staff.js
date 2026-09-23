import { supabase } from './supabase'
import { withArchiveScope } from './archive'

const STAFF_FIELDS =
  'id, name, role, employment_status, start_date, end_date, email, phone, notes, org_id, created_at, archived_at'

export const EMPLOYMENT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'on_leave', label: 'On leave' },
]

function emptyToNull(value) {
  const trimmed = typeof value === 'string' ? value.trim() : value
  return trimmed ? trimmed : null
}

function toDateInput(value) {
  return value ? String(value).slice(0, 10) : ''
}

function mapStaffRow(row) {
  const sites = (row.staff_sites ?? [])
    .map((link) => link.sites)
    .filter(Boolean)

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    employment_status: row.employment_status ?? 'active',
    start_date: toDateInput(row.start_date),
    end_date: toDateInput(row.end_date),
    email: row.email ?? '',
    phone: row.phone ?? '',
    notes: row.notes ?? '',
    org_id: row.org_id,
    created_at: row.created_at,
    archived_at: row.archived_at ?? null,
    sites,
  }
}

export function isActiveStaff(member) {
  return member?.employment_status === 'active'
}

export function employmentStatusLabel(status) {
  if (status === 'on_leave') return 'On leave'
  if (status === 'inactive') return 'Inactive'
  return 'Active'
}

export async function listStaff(orgId, { archivedOnly = false } = {}) {
  const { data, error } = await withArchiveScope(
    supabase
      .from('staff')
      .select(
        `
      ${STAFF_FIELDS},
      staff_sites (
        site_id,
        sites ( id, name, archived_at )
      )
    `,
      )
      .eq('org_id', orgId)
      .order('created_at', { ascending: true }),
    { archivedOnly },
  )

  if (error) {
    return { data: null, error }
  }

  return { data: (data ?? []).map(mapStaffRow), error: null }
}

export async function listStaffBySite(orgId, siteId) {
  const { data, error } = await withArchiveScope(
    supabase
      .from('staff')
      .select(
        `
      ${STAFF_FIELDS},
      staff_sites!inner (
        site_id,
        sites ( id, name, archived_at )
      )
    `,
      )
      .eq('org_id', orgId)
      .eq('staff_sites.site_id', siteId)
      .order('created_at', { ascending: true }),
  )

  if (error) {
    return { data: null, error }
  }

  return { data: (data ?? []).map(mapStaffRow), error: null }
}

export async function getStaff(id) {
  const { data, error } = await supabase
    .from('staff')
    .select(
      `
      ${STAFF_FIELDS},
      staff_sites (
        site_id,
        sites ( id, name, archived_at )
      )
    `,
    )
    .eq('id', id)
    .single()

  if (error) {
    return { data: null, error }
  }

  return { data: mapStaffRow(data), error: null }
}

export async function createStaff({
  name,
  role,
  employmentStatus = 'active',
  startDate,
  endDate,
  email,
  phone,
  orgId,
  siteIds = [],
}) {
  const { data, error } = await supabase
    .from('staff')
    .insert({
      name,
      role,
      employment_status: employmentStatus,
      start_date: emptyToNull(startDate),
      end_date: emptyToNull(endDate),
      email: emptyToNull(email),
      phone: emptyToNull(phone),
      org_id: orgId,
    })
    .select(STAFF_FIELDS)
    .single()

  if (error) {
    return { data: null, error }
  }

  if (siteIds.length > 0) {
    const { error: linkError } = await supabase.from('staff_sites').insert(
      siteIds.map((siteId) => ({
        staff_id: data.id,
        site_id: siteId,
      })),
    )

    if (linkError) {
      return { data: null, error: linkError }
    }
  }

  return { data: mapStaffRow(data), error: null }
}

export async function updateStaff({
  id,
  name,
  role,
  employmentStatus = 'active',
  startDate,
  endDate,
  email,
  phone,
  notes,
  siteIds,
}) {
  const payload = {
    name,
    role,
    employment_status: employmentStatus,
  }

  if (startDate !== undefined) payload.start_date = emptyToNull(startDate)
  if (endDate !== undefined) payload.end_date = emptyToNull(endDate)
  if (email !== undefined) payload.email = emptyToNull(email)
  if (phone !== undefined) payload.phone = emptyToNull(phone)
  if (notes !== undefined) payload.notes = emptyToNull(notes)

  const { data, error } = await supabase
    .from('staff')
    .update(payload)
    .eq('id', id)
    .select(STAFF_FIELDS)
    .single()

  if (error) {
    return { data: null, error }
  }

  if (siteIds !== undefined) {
    const { error: deleteLinksError } = await supabase
      .from('staff_sites')
      .delete()
      .eq('staff_id', id)

    if (deleteLinksError) {
      return { data: null, error: deleteLinksError }
    }

    if (siteIds.length > 0) {
      const { error: linkError } = await supabase.from('staff_sites').insert(
        siteIds.map((siteId) => ({
          staff_id: id,
          site_id: siteId,
        })),
      )

      if (linkError) {
        return { data: null, error: linkError }
      }
    }
  }

  return getStaff(id)
}

export async function archiveStaff(id) {
  const { error } = await supabase
    .from('staff')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .is('archived_at', null)

  return { error: error ?? null }
}

export async function restoreStaff(id) {
  const { error } = await supabase
    .from('staff')
    .update({ archived_at: null })
    .eq('id', id)

  return { error: error ?? null }
}

export async function deleteStaff(id) {
  const { error } = await supabase.from('staff').delete().eq('id', id)

  if (error) {
    return { error }
  }

  return { error: null }
}
