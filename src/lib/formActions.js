import { supabase } from './supabase'
import { actionHasOwner, actionIsOverdue } from './formAnswers'

const ACTION_FIELDS =
  'id, org_id, site_id, submission_id, template_id, source_item_id, description, action_required, quality_area, owner_staff_id, owner_name, due_date, status, added_to_qip, closed_at, closed_note, created_at, created_by_staff_id'

function mapAction(row) {
  return {
    id: row.id,
    org_id: row.org_id,
    site_id: row.site_id,
    site_name: '',
    submission_id: row.submission_id,
    template_id: row.template_id,
    source_item_id: row.source_item_id,
    description: row.description,
    action_required: row.action_required || '',
    quality_area: row.quality_area ?? null,
    owner_staff_id: row.owner_staff_id,
    owner_staff_name: '',
    owner_name: row.owner_name || '',
    due_date: row.due_date ? String(row.due_date).slice(0, 10) : '',
    status: row.status,
    added_to_qip: Boolean(row.added_to_qip),
    closed_at: row.closed_at,
    closed_note: row.closed_note || '',
    created_at: row.created_at,
    created_by_staff_id: row.created_by_staff_id,
  }
}

export function actionOwnerLabel(action) {
  if (action.owner_staff_name) return action.owner_staff_name
  if (String(action.owner_name || '').trim()) return action.owner_name.trim()
  return 'Unassigned'
}

export function actionCountLabel(counts) {
  const open = counts?.open ?? 0
  if (!open) return ''
  const noun = open === 1 ? 'action' : 'actions'
  return `${open} open ${noun}, ${counts.overdue} overdue, ${counts.unassigned} unassigned`
}

export function summarizeOpenActions(actions, today) {
  const bySite = new Map()
  for (const action of actions) {
    if (action.status !== 'open' || !action.site_id) continue
    const current = bySite.get(action.site_id) ?? { open: 0, overdue: 0, unassigned: 0 }
    current.open += 1
    if (actionIsOverdue(action, today)) current.overdue += 1
    if (!actionHasOwner(action)) current.unassigned += 1
    bySite.set(action.site_id, current)
  }
  return bySite
}

export async function listFormActions(orgId, { siteId = '', submissionId = '', status = '' } = {}) {
  if (!orgId) return { data: [], error: null }
  let query = supabase
    .from('form_actions')
    .select(ACTION_FIELDS)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
  if (siteId) query = query.eq('site_id', siteId)
  if (submissionId) query = query.eq('submission_id', submissionId)
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) return { data: [], error }
  return { data: (data ?? []).map(mapAction), error: null }
}

export async function createFormAction(orgId, fields) {
  const { data, error } = await supabase
    .from('form_actions')
    .insert({
      org_id: orgId,
      site_id: fields.siteId,
      submission_id: fields.submissionId || null,
      template_id: fields.templateId || null,
      description: String(fields.description || '').trim(),
      action_required: String(fields.actionRequired || '').trim(),
      quality_area: fields.qualityArea || null,
      owner_staff_id: fields.ownerStaffId || null,
      owner_name: String(fields.ownerName || '').trim() || null,
      due_date: fields.dueDate || null,
      added_to_qip: Boolean(fields.addedToQip),
    })
    .select(ACTION_FIELDS)
    .single()
  if (error) return { data: null, error }
  return { data: mapAction(data), error: null }
}

export async function updateFormAction(id, fields) {
  const patch = {}
  if (fields.ownerStaffId !== undefined) patch.owner_staff_id = fields.ownerStaffId || null
  if (fields.ownerName !== undefined) patch.owner_name = String(fields.ownerName || '').trim() || null
  if (fields.dueDate !== undefined) patch.due_date = fields.dueDate || null
  if (fields.addedToQip !== undefined) patch.added_to_qip = Boolean(fields.addedToQip)
  if (fields.description !== undefined) patch.description = String(fields.description || '').trim()
  if (fields.actionRequired !== undefined) patch.action_required = String(fields.actionRequired || '').trim()
  const { data, error } = await supabase
    .from('form_actions')
    .update(patch)
    .eq('id', id)
    .select(ACTION_FIELDS)
    .single()
  if (error) return { data: null, error }
  return { data: mapAction(data), error: null }
}

export async function closeFormAction(id, note) {
  const { data, error } = await supabase
    .from('form_actions')
    .update({
      status: 'closed',
      closed_note: String(note || '').trim(),
    })
    .eq('id', id)
    .select(ACTION_FIELDS)
    .single()
  if (error) return { data: null, error }
  return { data: mapAction(data), error: null }
}
