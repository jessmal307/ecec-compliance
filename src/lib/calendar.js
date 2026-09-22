import { supabase } from './supabase'

const EVENT_FIELDS = 'id, org_id, title, event_date, notes, created_by, created_at'

function emptyToNull(value) {
  const trimmed = typeof value === 'string' ? value.trim() : value
  return trimmed ? trimmed : null
}

function mapEvent(row) {
  return {
    id: row.id,
    org_id: row.org_id,
    title: row.title,
    event_date: row.event_date,
    notes: row.notes ?? '',
    created_by: row.created_by ?? null,
    created_at: row.created_at,
  }
}

export async function listCalendarEvents(orgId) {
  const { data, error } = await supabase
    .from('calendar_events')
    .select(EVENT_FIELDS)
    .eq('org_id', orgId)
    .order('event_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    return { data: null, error }
  }

  return { data: (data ?? []).map(mapEvent), error: null }
}

export async function createCalendarEvent({ orgId, title, eventDate, notes }) {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) {
    return { data: null, error: userError }
  }

  const { data, error } = await supabase
    .from('calendar_events')
    .insert({
      org_id: orgId,
      title: title.trim(),
      event_date: eventDate,
      notes: emptyToNull(notes),
      created_by: userData.user?.id ?? null,
    })
    .select(EVENT_FIELDS)
    .single()

  if (error) {
    return { data: null, error }
  }

  return { data: mapEvent(data), error: null }
}

export async function updateCalendarEvent(id, { title, eventDate, notes }) {
  const { data, error } = await supabase
    .from('calendar_events')
    .update({
      title: title.trim(),
      event_date: eventDate,
      notes: emptyToNull(notes),
    })
    .eq('id', id)
    .select(EVENT_FIELDS)
    .single()

  if (error) {
    return { data: null, error }
  }

  return { data: mapEvent(data), error: null }
}

export async function deleteCalendarEvent(id) {
  const { error } = await supabase.from('calendar_events').delete().eq('id', id)

  if (error) {
    return { error }
  }

  return { error: null }
}
