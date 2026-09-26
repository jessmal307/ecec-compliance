import { formatTimestamp } from './format'
import { employmentStatusLabel } from './staff'
import { supabase } from './supabase'
import { formatTimeOfDay } from './sydneyTime'

const AUDIT_FIELDS =
  'id, org_id, actor_id, actor_name, entity, entity_id, action, before, after, created_at'

export const AUDIT_ENTITIES = [
  { value: '', label: 'All records' },
  { value: 'staff', label: 'Staff' },
  { value: 'sites', label: 'Sites' },
  { value: 'requirement_types', label: 'Requirement types' },
  { value: 'compliance_items', label: 'Compliance items' },
]

export const AUDIT_DATE_WINDOWS = [
  { value: '', label: 'All time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

function uniqueIds(values) {
  return [...new Set(values.filter(Boolean))]
}

function snapshotOf(entry) {
  return entry?.after || entry?.before || {}
}

function onlyFieldChanged(before, after, field) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  const changed = [...keys].filter((key) => before?.[key] !== after?.[key])
  return changed.length === 1 && changed[0] === field
}

function recordName(row, fallback = 'record') {
  return String(row?.name || row?.label || fallback).trim() || fallback
}

function ownerName(row, names) {
  if (row?.staff_id) return names.staff[row.staff_id] || 'staff'
  if (row?.site_id) return names.sites[row.site_id] || 'site'
  return 'record'
}

function requirementLabel(row, names) {
  return (
    recordName(row, '') ||
    names.types[row?.requirement_type_id] ||
    'requirement'
  )
}

export function formatRelativeTime(value, now = Date.now()) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  const seconds = Math.round((now - date.getTime()) / 1000)
  if (seconds < 45) return 'just now'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`

  return formatTimestamp(value)
}

export function formatAuditSentence(entry, names = { staff: {}, sites: {}, types: {} }) {
  const actor = entry?.actor_name || 'System'
  const before = entry?.before || {}
  const after = entry?.after || {}
  const snapshot = snapshotOf(entry)

  if (entry.entity === 'staff') {
    const name = recordName(snapshot, 'staff member')
    if (entry.action === 'insert') return `${actor} added staff ${name}`
    if (entry.action === 'delete') return `${actor} deleted staff ${name}`
    if (!before.archived_at && after.archived_at) {
      return `${actor} archived staff ${name}`
    }
    if (before.archived_at && !after.archived_at) {
      return `${actor} restored staff ${name}`
    }
    if (before.employment_status !== after.employment_status) {
      return `${actor} set ${name} to ${employmentStatusLabel(after.employment_status)}`
    }
    return `${actor} updated staff ${name}`
  }

  if (entry.entity === 'staff_pins') {
    const name = names.staff[entry.entity_id] || 'a staff member'
    return after.pin === 'reset'
      ? `${actor} reset the floor PIN for ${name}`
      : `${actor} set the floor PIN for ${name}`
  }

  if (entry.entity === 'form_site_due_times') {
    const form = names.templates?.[snapshot.template_id] || 'a form'
    const where = snapshot.site_id
      ? `at ${names.sites[snapshot.site_id] || 'a site'}`
      : 'for all sites'
    const time = (row) => formatTimeOfDay(row?.due_by) || 'no time'
    if (entry.action === 'insert') return `${actor} set ${form} due by ${time(after)} ${where}`
    if (entry.action === 'delete') return `${actor} removed the ${form} due-by time ${where}`
    return `${actor} changed ${form} due by from ${time(before)} to ${time(after)} ${where}`
  }

  if (entry.entity === 'sites') {
    const name = recordName(snapshot, 'site')
    if (entry.action === 'insert') return `${actor} added site ${name}`
    if (entry.action === 'delete') return `${actor} deleted site ${name}`
    if (!before.archived_at && after.archived_at) {
      return `${actor} archived site ${name}`
    }
    if (before.archived_at && !after.archived_at) {
      return `${actor} restored site ${name}`
    }
    if (onlyFieldChanged(before, after, 'alert_email')) {
      return after.alert_email
        ? `${actor} set the alert email for ${name}`
        : `${actor} cleared the alert email for ${name}`
    }
    return `${actor} updated site ${name}`
  }

  if (entry.entity === 'requirement_types') {
    const name = recordName(snapshot, 'requirement type')
    if (entry.action === 'insert') return `${actor} added requirement type ${name}`
    if (entry.action === 'delete') return `${actor} deleted requirement type ${name}`
    if (!before.archived_at && after.archived_at) {
      return `${actor} archived requirement type ${name}`
    }
    if (before.archived_at && !after.archived_at) {
      return `${actor} restored requirement type ${name}`
    }
    return `${actor} updated requirement type ${name}`
  }

  if (entry.entity === 'compliance_items') {
    const label = requirementLabel(snapshot, names)
    const owner = ownerName(snapshot, names)
    if (entry.action === 'insert') return `${actor} added ${label} for ${owner}`
    if (entry.action === 'delete') return `${actor} deleted ${label} for ${owner}`
    if (!before.archived_at && after.archived_at) {
      return `${actor} archived ${label} for ${owner}`
    }
    if (before.archived_at && !after.archived_at) {
      return `${actor} restored ${label} for ${owner}`
    }
    if (before.last_verified_date !== after.last_verified_date && after.last_verified_date) {
      return `${actor} marked ${label} verified for ${owner}`
    }
    return `${actor} updated ${label} for ${owner}`
  }

  return `${actor} ${entry.action} ${entry.entity}`
}

async function loadRelatedNames(entries) {
  const snapshots = entries.map(snapshotOf)
  const staffIds = uniqueIds([
    ...snapshots.map((row) => row.staff_id),
    ...entries
      .filter((entry) => entry.entity === 'staff_pins')
      .map((entry) => entry.entity_id),
  ])
  const siteIds = uniqueIds(snapshots.map((row) => row.site_id))
  const typeIds = uniqueIds(snapshots.map((row) => row.requirement_type_id))
  const templateIds = uniqueIds(
    entries
      .filter((entry) => entry.entity === 'form_site_due_times')
      .map((entry) => snapshotOf(entry).template_id),
  )

  const names = { staff: {}, sites: {}, types: {}, templates: {} }

  const [staffResult, siteResult, typeResult, templateResult] = await Promise.all([
    staffIds.length
      ? supabase.from('staff').select('id, name').in('id', staffIds)
      : Promise.resolve({ data: [], error: null }),
    siteIds.length
      ? supabase.from('sites').select('id, name').in('id', siteIds)
      : Promise.resolve({ data: [], error: null }),
    typeIds.length
      ? supabase.from('requirement_types').select('id, name').in('id', typeIds)
      : Promise.resolve({ data: [], error: null }),
    templateIds.length
      ? supabase.from('form_templates').select('id, name').in('id', templateIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  for (const row of staffResult.data ?? []) names.staff[row.id] = row.name
  for (const row of siteResult.data ?? []) names.sites[row.id] = row.name
  for (const row of typeResult.data ?? []) names.types[row.id] = row.name
  for (const row of templateResult.data ?? []) names.templates[row.id] = row.name

  return names
}

export async function listAuditLog(
  orgId,
  { entity = '', days = '' } = {},
) {
  if (!orgId) return { data: [], error: null }

  let query = supabase
    .from('audit_log')
    .select(AUDIT_FIELDS)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (entity) query = query.eq('entity', entity)

  const windowDays = Number(days)
  if (windowDays > 0) {
    const since = new Date()
    since.setDate(since.getDate() - windowDays)
    query = query.gte('created_at', since.toISOString())
  }

  const { data, error } = await query
  if (error) return { data: [], error }

  const entries = data ?? []
  const names = await loadRelatedNames(entries)

  return {
    data: entries.map((entry) => ({
      ...entry,
      sentence: formatAuditSentence(entry, names),
      relativeTime: formatRelativeTime(entry.created_at),
    })),
    error: null,
  }
}
