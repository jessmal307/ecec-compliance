import { todayIsoDate } from './compliance'
import { isIsoDate } from './dates'
import {
  addCalendarMonthsIso,
  addDaysIso,
  findOverdueForms,
  forDateInPeriod,
  isLateInPeriod,
  isSiteOpenOn,
  isSubmissionLate,
  periodBounds,
  periodStatus,
} from './formPeriods'
import { isSignatureDataUrl } from './formUploads'
import { firstError } from './query'
import { listSiteClosuresForSites, listSites } from './sites'
import { supabase } from './supabase'

export {
  isoWeekday,
  isSubmissionLate,
  periodBounds,
  submissionLocalDate,
} from './formPeriods'

export const ALREADY_COMPLETED_MESSAGE = 'Already completed for this period'
export const COMPLETED_BY_SOMEONE_ELSE_MESSAGE =
  'This was just completed by someone else.'

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
  'id, org_id, name, archetype, schema, reg_ref, description, is_system, cadence, scope, archived_at, created_at'

const EXCLUSION_FIELDS = 'id, org_id, site_id, template_id, created_at'

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
    cadence: row.cadence ?? null,
    scope: row.scope || 'on_demand',
    archived_at: row.archived_at ?? null,
    created_at: row.created_at,
  }
}

export function isScheduledAllSitesTemplate(template) {
  return Boolean(template?.cadence) && template.scope === 'all_sites'
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

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right)
}

export function isFormSiteExcluded(exclusions, siteId, templateId) {
  return exclusions.some(
    (row) => sameId(row.site_id, siteId) && sameId(row.template_id, templateId),
  )
}

export async function listFormSiteExclusions(orgId) {
  if (!orgId) return { data: [], error: null }

  const { data, error } = await supabase
    .from('form_site_exclusions')
    .select(EXCLUSION_FIELDS)
    .eq('org_id', orgId)

  if (error) return { data: [], error }
  return { data: data ?? [], error: null }
}

export async function addFormSiteExclusion(orgId, siteId, templateId) {
  const { data, error } = await supabase
    .from('form_site_exclusions')
    .insert({ org_id: orgId, site_id: siteId, template_id: templateId })
    .select(EXCLUSION_FIELDS)
    .single()

  if (error && error.code !== '23505') return { data: null, error }
  return { data: data ?? null, error: null }
}

export async function removeFormSiteExclusion(orgId, siteId, templateId) {
  const { error } = await supabase
    .from('form_site_exclusions')
    .delete()
    .eq('org_id', orgId)
    .eq('site_id', siteId)
    .eq('template_id', templateId)

  return { error }
}

function mapDueSubmission(row) {
  return {
    site_id: row.site_id,
    template_id: row.template_id,
    status: row.status,
    for_date: row.for_date ? String(row.for_date).slice(0, 10) : '',
    submitted_at: row.submitted_at ?? null,
  }
}

async function listPeriodicDueSubmissions(orgId, templates, today) {
  if (!templates.length) return { data: [], error: null }

  const earliestStart = templates
    .map((template) => periodBounds(template.cadence, today)?.start)
    .filter(Boolean)
    .reduce((earliest, start) => (start < earliest ? start : earliest), today)
  const { data, error } = await supabase
    .from('form_submissions')
    .select('site_id, template_id, status, for_date, submitted_at')
    .eq('org_id', orgId)
    .in('status', ['complete', 'missed'])
    .in(
      'template_id',
      templates.map((template) => template.id),
    )
    .gte('for_date', earliestStart)

  if (error) return { data: [], error }
  return { data: (data ?? []).map(mapDueSubmission), error: null }
}

async function listOnceDueSubmissions(orgId, pairs) {
  if (!pairs.length) return { data: [], error: null }

  const results = await Promise.all(
    pairs.map(async ({ siteId, templateId }) => {
      const completes = await supabase
        .from('form_submissions')
        .select('site_id, template_id, status, for_date, submitted_at')
        .eq('org_id', orgId)
        .eq('site_id', siteId)
        .eq('template_id', templateId)
        .eq('status', 'complete')

      if (completes.error) return { data: [], error: completes.error }
      if (completes.data?.length) {
        return { data: completes.data.map(mapDueSubmission), error: null }
      }

      const missed = await supabase
        .from('form_submissions')
        .select('id')
        .eq('org_id', orgId)
        .eq('site_id', siteId)
        .eq('template_id', templateId)
        .eq('status', 'missed')
        .limit(1)
        .maybeSingle()

      if (missed.error) return { data: [], error: missed.error }
      if (!missed.data) return { data: [], error: null }
      return {
        data: [
          {
            site_id: siteId,
            template_id: templateId,
            status: 'missed',
            for_date: '',
            submitted_at: null,
          },
        ],
        error: null,
      }
    }),
  )

  const loadError = results.find((result) => result.error)?.error
  if (loadError) return { data: [], error: loadError }
  return { data: results.flatMap((result) => result.data), error: null }
}

export async function computeDueForms(orgId, today = todayIsoDate()) {
  if (!orgId) return { data: [], error: null }
  if (!isIsoDate(today)) {
    return { data: [], error: { message: 'Enter a valid date.' } }
  }

  const [sitesResult, templatesResult, exclusionsResult] = await Promise.all([
    listSites(orgId),
    listFormTemplates(),
    listFormSiteExclusions(orgId),
  ])
  const setupError = firstError(sitesResult, templatesResult, exclusionsResult)
  if (setupError) return { data: [], error: setupError }

  const sites = sitesResult.data ?? []
  const templates = (templatesResult.data ?? []).filter(isScheduledAllSitesTemplate)
  const exclusions = exclusionsResult.data ?? []

  if (!sites.length || !templates.length) return { data: [], error: null }

  const periodicTemplates = templates.filter((template) => template.cadence !== 'once')
  const oncePairs = templates
    .filter((template) => template.cadence === 'once')
    .flatMap((template) =>
      sites
        .filter((site) => !isFormSiteExcluded(exclusions, site.id, template.id))
        .map((site) => ({ siteId: site.id, templateId: template.id })),
    )

  const [closuresResult, periodicResult, onceResult] = await Promise.all([
    listSiteClosuresForSites(
      sites.map((site) => site.id),
      { date: today },
    ),
    listPeriodicDueSubmissions(orgId, periodicTemplates, today),
    listOnceDueSubmissions(orgId, oncePairs),
  ])

  const fetchError = firstError(closuresResult, periodicResult, onceResult)
  if (fetchError) return { data: [], error: fetchError }

  const closures = closuresResult.data ?? []
  const submissions = [...periodicResult.data, ...onceResult.data]
  const rows = []

  for (const site of sites) {
    for (const template of templates) {
      if (isFormSiteExcluded(exclusions, site.id, template.id)) continue
      if (template.cadence === 'daily' && !isSiteOpenOn(site, closures, today)) {
        continue
      }

      const bounds = periodBounds(template.cadence, today)
      const status = periodStatus(submissions, site.id, template.id, bounds)
      rows.push({
        site_id: site.id,
        site_name: site.name,
        template_id: template.id,
        template_name: template.name,
        cadence: template.cadence,
        status,
        late: status === 'done' && isLateInPeriod(submissions, site.id, template.id, bounds),
      })
    }
  }

  return { data: rows, error: null }
}

export async function computeOverdueForms(orgId, today = todayIsoDate()) {
  if (!orgId) return { data: [], error: null }
  if (!isIsoDate(today)) {
    return { data: [], error: { message: 'Enter a valid date.' } }
  }

  const [sitesResult, templatesResult, exclusionsResult] = await Promise.all([
    listSites(orgId),
    listFormTemplates(),
    listFormSiteExclusions(orgId),
  ])
  const setupError = firstError(sitesResult, templatesResult, exclusionsResult)
  if (setupError) return { data: [], error: setupError }

  const sites = sitesResult.data ?? []
  const templates = (templatesResult.data ?? []).filter(isScheduledAllSitesTemplate)
  const exclusions = exclusionsResult.data ?? []

  if (!sites.length || !templates.length) return { data: [], error: null }

  const [closuresResult, submissionsResult] = await Promise.all([
    listSiteClosuresForSites(sites.map((site) => site.id)),
    supabase
      .from('form_submissions')
      .select(`${SUBMISSION_FIELDS}, form_templates ( id, name ), sites ( id, name )`)
      .eq('org_id', orgId)
      .in('status', ['complete', 'missed'])
      .in(
        'template_id',
        templates.map((template) => template.id),
      ),
  ])

  if (closuresResult.error) return { data: [], error: closuresResult.error }
  if (submissionsResult.error) return { data: [], error: submissionsResult.error }

  return {
    data: findOverdueForms({
      sites,
      templates,
      exclusions,
      closures: closuresResult.data ?? [],
      submissions: (submissionsResult.data ?? []).map(mapSubmission),
      today,
    }),
    error: null,
  }
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
  'id, org_id, assignment_id, template_id, site_id, staff_id, submitted_by, data, status, signed_off_by, signed_off_at, evidence, submitted_at, for_date, created_at'

function mapSubmission(row) {
  const payload = row.data && typeof row.data === 'object' ? row.data : {}
  const forDate = row.for_date ? String(row.for_date).slice(0, 10) : ''
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
    values: payload.fields || payload.values || {},
    notes: payload.notes || {},
    signoff: payload.signoff || { name: '', date: '', note: '', signature: '' },
    rows: Array.isArray(payload.hazards)
      ? payload.hazards
      : Array.isArray(payload.rows)
        ? payload.rows
        : [],
    missed_reason: String(payload.missedReason || '').trim(),
    status: row.status,
    signed_off_by: row.signed_off_by,
    signed_off_at: row.signed_off_at,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    submitted_at: row.submitted_at,
    for_date: forDate,
    late: isSubmissionLate({ ...row, for_date: forDate, status: row.status }),
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
  const fields = values || {}
  const hazards = rows || []
  return {
    room: String(room || '').trim(),
    values: fields,
    fields,
    notes: notes || {},
    signoff: {
      name: signoff?.name || '',
      date: signoff?.date || '',
      note: signoff?.note || '',
      signature: signoff?.signature || '',
    },
    rows: hazards,
    hazards,
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

export async function createFormSubmission(orgId, { templateId, siteId, userId, forDate }) {
  const { data, error } = await supabase
    .from('form_submissions')
    .insert({
      org_id: orgId,
      template_id: templateId,
      site_id: siteId || null,
      submitted_by: userId || null,
      for_date: forDate || null,
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

  if (error?.code === '23505') {
    return { data: null, error: { message: COMPLETED_BY_SOMEONE_ELSE_MESSAGE, code: '23505' } }
  }
  if (error) return { data: null, error }
  return { data: mapSubmission(data), error: null }
}

export async function findCompleteInPeriod({
  orgId,
  templateId,
  siteId,
  cadence,
  forDate,
  excludeId,
}) {
  if (!orgId || !templateId || !siteId) return { data: null, error: null }
  if (cadence && cadence !== 'once' && !isIsoDate(forDate)) {
    return { data: null, error: null }
  }

  const bounds = periodBounds(cadence || 'once', forDate || todayIsoDate())
  let query = supabase
    .from('form_submissions')
    .select(`${SUBMISSION_FIELDS}, form_templates ( id, name ), sites ( id, name )`)
    .eq('org_id', orgId)
    .eq('template_id', templateId)
    .eq('site_id', siteId)
    .eq('status', 'complete')
    .order('submitted_at', { ascending: false, nullsFirst: false })

  if (bounds?.start) query = query.gte('for_date', bounds.start)
  if (bounds?.end) query = query.lte('for_date', bounds.end)

  const { data, error } = await query

  if (error) return { data: null, error }

  const match = (data ?? [])
    .map(mapSubmission)
    .find(
      (row) =>
        (!excludeId || String(row.id) !== String(excludeId)) &&
        forDateInPeriod(row, bounds),
    )

  return { data: match ?? null, error: null }
}

export async function createMissedSubmission(orgId, {
  templateId,
  siteId,
  userId,
  forDate,
  reason,
}) {
  const missedReason = String(reason || '').trim()
  if (!siteId) return { data: null, error: { message: 'Choose a site.' } }
  if (!isIsoDate(forDate)) {
    return { data: null, error: { message: 'Enter the date this covers.' } }
  }
  if (forDate > todayIsoDate()) {
    return { data: null, error: { message: 'Cannot be in the future.' } }
  }
  if (!missedReason) return { data: null, error: { message: 'Enter a reason.' } }

  const { data, error } = await supabase
    .from('form_submissions')
    .insert({
      org_id: orgId,
      template_id: templateId,
      site_id: siteId,
      submitted_by: userId || null,
      for_date: forDate,
      status: 'missed',
      submitted_at: new Date().toISOString(),
      data: { missedReason },
      evidence: [],
    })
    .select(`${SUBMISSION_FIELDS}, form_templates ( id, name ), sites ( id, name )`)
    .single()

  if (error) return { data: null, error }
  return { data: mapSubmission(data), error: null }
}
