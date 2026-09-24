import { todayIsoDate } from './compliance'
import { isIsoDate } from './dates'
import { isSignatureDataUrl } from './formUploads'
import { supabase } from './supabase'

export const FORM_CADENCES = [
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
]

export const FORM_TARGET_TYPES = [
  { value: 'site', label: 'A site' },
  { value: 'staff', label: 'A staff member' },
  { value: 'role', label: 'A role' },
  { value: 'org', label: 'Whole organisation' },
]

export const FORM_MEMBER_ROLES = ['owner', 'admin', 'director']

const ASSIGNMENT_FIELDS =
  'id, org_id, template_id, target_type, target_id, target_role, cadence, next_due, active, created_at'

const TEMPLATE_FIELDS =
  'id, org_id, name, archetype, schema, reg_ref, description, is_system, archived_at, created_at'

function mapTemplate(row) {
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    archetype: row.archetype,
    schema: row.schema ?? {},
    reg_ref: row.reg_ref ?? '',
    description: row.description ?? '',
    is_system: Boolean(row.is_system),
    archived_at: row.archived_at ?? null,
    created_at: row.created_at,
  }
}

export function archetypeLabel(archetype) {
  if (archetype === 'register') return 'Register'
  if (archetype === 'checklist') return 'Checklist'
  if (archetype === 'risk_matrix') return 'Risk matrix'
  return 'Form'
}

export async function listFormTemplates() {
  const { data, error } = await supabase
    .from('form_templates')
    .select(TEMPLATE_FIELDS)
    .is('archived_at', null)
    .order('name')

  if (error) return { data: [], error }
  return { data: (data ?? []).map(mapTemplate), error: null }
}

export async function getFormTemplate(id) {
  const { data, error } = await supabase
    .from('form_templates')
    .select(TEMPLATE_FIELDS)
    .eq('id', id)
    .maybeSingle()

  if (error) return { data: null, error }
  if (!data) return { data: null, error: null }
  return { data: mapTemplate(data), error: null }
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function formatIso(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function addDaysIso(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00`)
  date.setDate(date.getDate() + days)
  return formatIso(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

function addCalendarMonthsIso(isoDate, months) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const total = year * 12 + (month - 1) + months
  const nextYear = Math.floor(total / 12)
  const nextMonth = (total % 12) + 1
  const nextDay = Math.min(day, daysInMonth(nextYear, nextMonth))
  return formatIso(nextYear, nextMonth, nextDay)
}

export function computeNextDue(cadence, fromDate = todayIsoDate()) {
  if (!isIsoDate(fromDate)) return null
  if (cadence === 'daily') return addDaysIso(fromDate, 1)
  if (cadence === 'weekly') return addDaysIso(fromDate, 7)
  if (cadence === 'monthly') return addCalendarMonthsIso(fromDate, 1)
  if (cadence === 'quarterly') return addCalendarMonthsIso(fromDate, 3)
  if (cadence === 'annual') return addCalendarMonthsIso(fromDate, 12)
  return fromDate
}

export function cadenceLabel(cadence) {
  return FORM_CADENCES.find((item) => item.value === cadence)?.label || cadence
}

export function assignmentTargetLabel(assignment, { sites = [], staff = [] } = {}) {
  if (assignment.target_type === 'org') return 'Whole organisation'
  if (assignment.target_type === 'role') {
    return assignment.target_role || 'Role'
  }
  if (assignment.target_type === 'site') {
    return sites.find((site) => site.id === assignment.target_id)?.name || 'Unknown site'
  }
  if (assignment.target_type === 'staff') {
    return staff.find((member) => member.id === assignment.target_id)?.name || 'Unknown staff'
  }
  return 'Unknown'
}

function mapAssignment(row) {
  return {
    id: row.id,
    org_id: row.org_id,
    template_id: row.template_id,
    template_name: row.form_templates?.name || 'Form',
    target_type: row.target_type,
    target_id: row.target_id,
    target_role: row.target_role ?? '',
    cadence: row.cadence,
    next_due: row.next_due ? String(row.next_due).slice(0, 10) : null,
    active: row.active !== false,
    created_at: row.created_at,
  }
}

export async function listAssignments(orgId, { activeOnly = true } = {}) {
  if (!orgId) return { data: [], error: null }

  let query = supabase
    .from('form_assignments')
    .select(`${ASSIGNMENT_FIELDS}, form_templates ( id, name )`)
    .eq('org_id', orgId)
    .order('next_due', { ascending: true, nullsFirst: false })

  if (activeOnly) query = query.eq('active', true)

  const { data, error } = await query
  if (error) return { data: [], error }
  return { data: (data ?? []).map(mapAssignment), error: null }
}

export async function createAssignment(orgId, payload) {
  const nextDue =
    payload.cadence === 'once'
      ? computeNextDue('once', payload.next_due)
      : payload.next_due || todayIsoDate()

  const { data, error } = await supabase
    .from('form_assignments')
    .insert({
      org_id: orgId,
      template_id: payload.template_id,
      target_type: payload.target_type,
      target_id:
        payload.target_type === 'site' || payload.target_type === 'staff'
          ? payload.target_id || null
          : null,
      target_role:
        payload.target_type === 'role' ? payload.target_role?.trim() || null : null,
      cadence: payload.cadence,
      next_due: nextDue,
      active: true,
    })
    .select(`${ASSIGNMENT_FIELDS}, form_templates ( id, name )`)
    .single()

  if (error) return { data: null, error }
  return { data: mapAssignment(data), error: null }
}

export async function setAssignmentActive(id, active) {
  const { data, error } = await supabase
    .from('form_assignments')
    .update({ active })
    .eq('id', id)
    .select(`${ASSIGNMENT_FIELDS}, form_templates ( id, name )`)
    .single()

  if (error) return { data: null, error }
  return { data: mapAssignment(data), error: null }
}

const SUBMISSION_FIELDS =
  'id, org_id, assignment_id, template_id, site_id, staff_id, submitted_by, data, status, signed_off_by, signed_off_at, evidence, submitted_at, created_at'

function mapSubmission(row) {
  const payload = row.data && typeof row.data === 'object' ? row.data : {}
  return {
    id: row.id,
    org_id: row.org_id,
    assignment_id: row.assignment_id,
    template_id: row.template_id,
    template_name: row.form_templates?.name || 'Form',
    site_id: row.site_id,
    site_name: row.sites?.name || '',
    staff_id: row.staff_id,
    submitted_by: row.submitted_by,
    data: payload,
    room: payload.room || '',
    values: payload.values || {},
    notes: payload.notes || {},
    signoff: payload.signoff || { name: '', date: '', note: '', signature: '' },
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    status: row.status,
    signed_off_by: row.signed_off_by,
    signed_off_at: row.signed_off_at,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    submitted_at: row.submitted_at,
    created_at: row.created_at,
  }
}

export function emptyFormState() {
  return {
    values: {},
    notes: {},
    signoff: { name: '', date: todayIsoDate(), note: '', signature: '' },
    rows: [],
  }
}

export function buildSubmissionData({ room, values, notes, signoff, rows }) {
  return {
    room: String(room || '').trim(),
    values: values || {},
    notes: notes || {},
    signoff: {
      name: signoff?.name || '',
      date: signoff?.date || '',
      note: signoff?.note || '',
      signature: signoff?.signature || '',
    },
    rows: rows || [],
  }
}

function fieldFilled(field, value) {
  if (field.type === 'checkbox') return Boolean(value)
  if (field.type === 'signature') {
    return isSignatureDataUrl(value) || Boolean(String(value || '').trim())
  }
  return String(value ?? '').trim() !== ''
}

export function validateFormSubmission(schema, archetype, state) {
  const errors = []
  const fields =
    archetype === 'checklist'
      ? (schema?.items ?? []).map((item) => ({ ...item, type: 'checkbox' }))
      : Array.isArray(schema?.fields)
        ? schema.fields
        : Array.isArray(schema?.items)
          ? schema.items
          : []

  for (const field of fields) {
    if (!field.required) continue
    if (!fieldFilled(field, state.values?.[field.id])) {
      errors.push(`Fill ${field.label || 'required fields'}.`)
    }
  }

  if (schema?.signoff?.required) {
    if (!String(state.signoff?.name || '').trim()) {
      errors.push('Enter the sign-off name.')
    }
    if (!state.signoff?.date) {
      errors.push('Enter the sign-off date.')
    }
    if (
      schema.signoff.signature !== false &&
      !fieldFilled({ type: 'signature' }, state.signoff?.signature)
    ) {
      errors.push('Draw the sign-off signature.')
    }
  }

  return [...new Set(errors)]
}

export async function listFormSubmissions(
  orgId,
  { templateId = '', siteId = '' } = {},
) {
  if (!orgId) return { data: [], error: null }

  let query = supabase
    .from('form_submissions')
    .select(`${SUBMISSION_FIELDS}, form_templates ( id, name ), sites ( id, name )`)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (templateId) query = query.eq('template_id', templateId)
  if (siteId) query = query.eq('site_id', siteId)

  const { data, error } = await query
  if (error) return { data: [], error }
  return { data: (data ?? []).map(mapSubmission), error: null }
}

export async function getFormSubmission(id) {
  const { data, error } = await supabase
    .from('form_submissions')
    .select(`${SUBMISSION_FIELDS}, form_templates ( id, name ), sites ( id, name )`)
    .eq('id', id)
    .maybeSingle()

  if (error) return { data: null, error }
  if (!data) return { data: null, error: null }
  return { data: mapSubmission(data), error: null }
}

export async function createFormSubmission(orgId, { templateId, siteId, userId }) {
  const { data, error } = await supabase
    .from('form_submissions')
    .insert({
      org_id: orgId,
      template_id: templateId,
      site_id: siteId || null,
      submitted_by: userId || null,
      data: {},
      status: 'draft',
      evidence: [],
    })
    .select(`${SUBMISSION_FIELDS}, form_templates ( id, name ), sites ( id, name )`)
    .single()

  if (error) return { data: null, error }
  return { data: mapSubmission(data), error: null }
}

export async function updateFormSubmission(id, payload) {
  const { data, error } = await supabase
    .from('form_submissions')
    .update(payload)
    .eq('id', id)
    .select(`${SUBMISSION_FIELDS}, form_templates ( id, name ), sites ( id, name )`)
    .single()

  if (error) return { data: null, error }
  return { data: mapSubmission(data), error: null }
}
