import { todayIsoDate } from './compliance'
import { isIsoDate } from './dates'
import { checklistItemType, evidenceActionErrors, yesNoNaErrors } from './formAnswers'
import { evidenceCompletionErrors } from './evidenceCompletion'
import {
  addCalendarMonthsIso,
  addDaysIso,
  findOverdueForms,
  forDateInPeriod,
  isAnchoredCadence,
  isLateInPeriod,
  isMonthLongCadence,
  isSiteOpenOn,
  isSubmissionLate,
  monthPeriodIsOwed,
  periodBounds,
  periodStatus,
  previousOpenDay,
  previousPeriodBounds,
  scheduleNotBefore,
} from './formPeriods'
import { dueByFor, dueStatusAt, templateTakesDueBy } from './formDueTimes'
import { effectiveCadenceMonths, scheduleEnabled } from './formSchedule'
import { isSignatureDataUrl } from './formUploads'
import { fetchAllPages, firstError } from './query'
import { listSiteClosuresForSites, listSites } from './sites'
import { supabase } from './supabase'
import { normalizeTimeOfDay } from './sydneyTime'

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
  'id, org_id, name, archetype, schema, reg_ref, description, is_system, cadence, cadence_months, scope, default_due_by, category, quality_area, nqs_refs, completed_by, archived_at, created_at'

const CADENCE_LABELS = {
  half_yearly: 'Half-yearly',
  annually: 'Annually',
  each_time: 'Each time',
}

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
    cadence_months: Array.isArray(row.cadence_months)
      ? row.cadence_months.map(Number)
      : null,
    category: row.category ?? null,
    quality_area: row.quality_area ?? null,
    nqs_refs: Array.isArray(row.nqs_refs) ? row.nqs_refs : [],
    completed_by: row.completed_by ?? '',
    scope: row.scope || 'on_demand',
    default_due_by: normalizeTimeOfDay(row.default_due_by),
    archived_at: row.archived_at ?? null,
    created_at: row.created_at,
  }
}

export function isScheduledAllSitesTemplate(template) {
  return (
    Boolean(template?.cadence) &&
    template.cadence !== 'each_time' &&
    template.scope === 'all_sites'
  )
}

export function archetypeLabel(archetype) {
  if (archetype === 'register') return 'Register'
  if (archetype === 'checklist') return 'Checklist'
  if (archetype === 'risk_matrix') return 'Risk matrix'
  if (archetype === 'evidence') return 'Evidence'
  return 'Form'
}

const SCHEDULE_FIELDS = 'id, org_id, template_id, enabled, cadence_months'

function mapSchedule(row) {
  return {
    id: row.id,
    org_id: row.org_id,
    template_id: row.template_id,
    enabled: Boolean(row.enabled),
    cadence_months: Array.isArray(row.cadence_months) ? row.cadence_months.map(Number) : null,
  }
}

export async function listFormOrgSchedules(orgId) {
  if (!orgId) return { data: [], error: null }
  const { data, error } = await supabase
    .from('form_org_schedule')
    .select(SCHEDULE_FIELDS)
    .eq('org_id', orgId)
  if (error) return { data: [], error }
  return { data: (data ?? []).map(mapSchedule), error: null }
}

export async function saveFormOrgSchedule(orgId, templateId, { enabled, cadenceMonths }) {
  const { data, error } = await supabase
    .from('form_org_schedule')
    .upsert(
      {
        org_id: orgId,
        template_id: templateId,
        enabled,
        cadence_months: cadenceMonths?.length ? cadenceMonths : null,
      },
      { onConflict: 'org_id,template_id' },
    )
    .select(SCHEDULE_FIELDS)
    .single()
  if (error) return { data: null, error }
  return { data: mapSchedule(data), error: null }
}

export async function listFormTemplates() {
  const { data, error } = await fetchAllPages(() =>
    supabase.from('form_templates').select(TEMPLATE_FIELDS).is('archived_at', null),
  )

  if (error) return { data: [], error }
  return {
    data: (data ?? [])
      .map(mapTemplate)
      .sort((left, right) => left.name.localeCompare(right.name)),
    error: null,
  }
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
  return (
    FORM_CADENCES.find((item) => item.value === cadence)?.label ||
    CADENCE_LABELS[cadence] ||
    cadence
  )
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

const DUE_TIME_FIELDS = 'id, org_id, site_id, template_id, due_by, created_at'

function mapDueTime(row) {
  return {
    id: row.id,
    org_id: row.org_id,
    site_id: row.site_id ?? null,
    template_id: row.template_id,
    due_by: normalizeTimeOfDay(row.due_by),
    created_at: row.created_at,
  }
}

export async function listFormDueTimes(orgId) {
  if (!orgId) return { data: [], error: null }
  const { data, error } = await supabase
    .from('form_site_due_times')
    .select(DUE_TIME_FIELDS)
    .eq('org_id', orgId)

  if (error) return { data: [], error }
  return { data: (data ?? []).map(mapDueTime), error: null }
}

// siteId null = the org's time for all its sites.
export async function setFormDueTime(orgId, siteId, templateId, dueBy) {
  const time = normalizeTimeOfDay(dueBy)
  if (!time) return { data: null, error: { message: 'Enter a time.' } }
  const { data, error } = await supabase
    .from('form_site_due_times')
    .upsert(
      { org_id: orgId, site_id: siteId ?? null, template_id: templateId, due_by: time },
      { onConflict: 'org_id,site_id,template_id' },
    )
    .select(DUE_TIME_FIELDS)
    .single()

  if (error) return { data: null, error }
  return { data: mapDueTime(data), error: null }
}

export async function clearFormDueTime(orgId, siteId, templateId) {
  let query = supabase
    .from('form_site_due_times')
    .delete()
    .eq('org_id', orgId)
    .eq('template_id', templateId)
  query = siteId == null ? query.is('site_id', null) : query.eq('site_id', siteId)
  const { error } = await query
  return { error }
}

function mapDueSubmission(row) {
  return {
    site_id: row.site_id,
    template_id: row.template_id,
    status: row.status,
    for_date: row.for_date ? String(row.for_date).slice(0, 10) : '',
    due_by: normalizeTimeOfDay(row.due_by),
    submitted_at: row.submitted_at ?? null,
  }
}

async function listPeriodicDueSubmissions(orgId, templates, today) {
  if (!templates.length) return { data: [], error: null }

  const starts = []
  for (const template of templates) {
    const current = periodBounds(template.cadence, today, template.cadence_months)?.start
    if (current) starts.push(current)
    if (isMonthLongCadence(template.cadence)) {
      const previous = previousPeriodBounds(
        template.cadence,
        today,
        template.cadence_months,
      )?.start
      if (previous) starts.push(previous)
    }
  }
  const earliestStart = starts.reduce(
    (earliest, start) => (start < earliest ? start : earliest),
    today,
  )
  const templateIds = templates.map((template) => template.id)
  const rows = []
  for (let index = 0; index < templateIds.length; index += 100) {
    const batch = templateIds.slice(index, index + 100)
    const { data, error } = await fetchAllPages(() =>
      supabase
        .from('form_submissions')
        .select('id, site_id, template_id, status, for_date, due_by, submitted_at')
        .eq('org_id', orgId)
        .in('status', ['complete', 'missed'])
        .in('template_id', batch)
        .gte('for_date', earliestStart)
        .lte('for_date', today),
    )
    if (error) return { data: [], error }
    rows.push(...(data ?? []))
  }
  return { data: rows.map(mapDueSubmission), error: null }
}

async function listOnceDueSubmissions(orgId, pairs) {
  if (!pairs.length) return { data: [], error: null }

  const results = await Promise.all(
    pairs.map(async ({ siteId, templateId }) => {
      const completes = await fetchAllPages(() =>
        supabase
          .from('form_submissions')
          .select('id, site_id, template_id, status, for_date, due_by, submitted_at')
          .eq('org_id', orgId)
          .eq('site_id', siteId)
          .eq('template_id', templateId)
          .eq('status', 'complete'),
      )

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

  const [sitesResult, templatesResult, exclusionsResult, dueTimesResult, schedulesResult, orgResult] =
    await Promise.all([
      listSites(orgId),
      listFormTemplates(),
      listFormSiteExclusions(orgId),
      listFormDueTimes(orgId),
      listFormOrgSchedules(orgId),
      supabase.from('organizations').select('audit_tracking_start').eq('id', orgId).maybeSingle(),
    ])
  const setupError = firstError(
    sitesResult,
    templatesResult,
    exclusionsResult,
    dueTimesResult,
    schedulesResult,
    orgResult,
  )
  if (setupError) return { data: [], error: setupError }

  const sites = sitesResult.data ?? []
  const scheduleByTemplate = new Map(
    (schedulesResult.data ?? []).map((row) => [String(row.template_id), row]),
  )
  const trackingStart = orgResult.data?.audit_tracking_start
    ? String(orgResult.data.audit_tracking_start).slice(0, 10)
    : null
  const templates = (templatesResult.data ?? [])
    .filter(isScheduledAllSitesTemplate)
    .filter((template) => scheduleEnabled(template, scheduleByTemplate.get(String(template.id))))
    .map((template) => ({
      ...template,
      cadence_months: effectiveCadenceMonths(
        template,
        scheduleByTemplate.get(String(template.id)),
      ),
    }))
  const exclusions = exclusionsResult.data ?? []
  const dueTimes = dueTimesResult.data ?? []

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
      if (isMonthLongCadence(template.cadence)) {
        pushMonthLongDueRows(rows, { site, template, submissions, today, trackingStart })
        continue
      }
      if (template.cadence === 'daily' && !isSiteOpenOn(site, closures, today)) {
        continue
      }

      const bounds = periodBounds(template.cadence, today)
      const periodResult = periodStatus(submissions, site.id, template.id, bounds)
      const dueBy = templateTakesDueBy(template)
        ? dueByFor(template, site.id, dueTimes).dueBy
        : null
      const forDate = template.cadence === 'daily' ? today : ''
      rows.push({
        site_id: site.id,
        site_name: site.name,
        template_id: template.id,
        template_name: template.name,
        cadence: template.cadence,
        status: dueStatusAt({ status: periodResult, dueBy, forDate }),
        due_by: dueBy,
        for_date: forDate,
        late:
          periodResult === 'done' &&
          isLateInPeriod(submissions, site.id, template.id, bounds),
      })
    }
  }

  return { data: rows, error: null }
}

function pushMonthLongDueRows(rows, { site, template, submissions, today, trackingStart }) {
  const months = template.cadence_months
  const created = site.created_at
  const current = periodBounds(template.cadence, today, months)
  if (current?.start && monthPeriodIsOwed(current, trackingStart, created)) {
    rows.push({
      site_id: site.id,
      site_name: site.name,
      template_id: template.id,
      template_name: template.name,
      cadence: template.cadence,
      status: periodStatus(submissions, site.id, template.id, current),
      due_by: null,
      for_date: current.start,
      late: false,
    })
  }

  const previous = previousPeriodBounds(template.cadence, today, months)
  if (!previous?.start) return
  if (!monthPeriodIsOwed(previous, trackingStart, created)) return
  if (periodStatus(submissions, site.id, template.id, previous) !== 'due') return
  rows.push({
    site_id: site.id,
    site_name: site.name,
    template_id: template.id,
    template_name: template.name,
    cadence: template.cadence,
    status: 'overdue',
    due_by: null,
    for_date: previous.start,
    late: false,
  })
}

export async function computeOverdueForms(orgId, today = todayIsoDate()) {
  if (!orgId) return { data: [], error: null }
  if (!isIsoDate(today)) {
    return { data: [], error: { message: 'Enter a valid date.' } }
  }

  const [sitesResult, templatesResult, exclusionsResult, schedulesResult, orgResult] =
    await Promise.all([
      listSites(orgId),
      listFormTemplates(),
      listFormSiteExclusions(orgId),
      listFormOrgSchedules(orgId),
      supabase.from('organizations').select('audit_tracking_start').eq('id', orgId).maybeSingle(),
    ])
  const setupError = firstError(
    sitesResult,
    templatesResult,
    exclusionsResult,
    schedulesResult,
    orgResult,
  )
  if (setupError) return { data: [], error: setupError }

  const sites = sitesResult.data ?? []
  const scheduleByTemplate = new Map(
    (schedulesResult.data ?? []).map((row) => [String(row.template_id), row]),
  )
  const trackingStart = orgResult.data?.audit_tracking_start
    ? String(orgResult.data.audit_tracking_start).slice(0, 10)
    : null
  const templates = (templatesResult.data ?? [])
    .filter(isScheduledAllSitesTemplate)
    .filter((template) => scheduleEnabled(template, scheduleByTemplate.get(String(template.id))))
    .map((template) => ({
      ...template,
      cadence_months: effectiveCadenceMonths(
        template,
        scheduleByTemplate.get(String(template.id)),
      ),
    }))
  const exclusions = exclusionsResult.data ?? []

  if (!sites.length || !templates.length) return { data: [], error: null }

  const closuresResult = await listSiteClosuresForSites(sites.map((site) => site.id))
  if (closuresResult.error) return { data: [], error: closuresResult.error }
  const closures = closuresResult.data ?? []
  const window = overdueForDateWindow(sites, templates, closures, today)
  const templateIds = templates.map((template) => template.id)
  const submissionRows = []
  if (window.min && window.max) {
    for (let index = 0; index < templateIds.length; index += 100) {
      const batch = templateIds.slice(index, index + 100)
      const page = await fetchAllPages(() =>
        supabase
          .from('form_submissions')
          .select('id, site_id, template_id, status, for_date')
          .eq('org_id', orgId)
          .in('status', ['complete', 'missed'])
          .in('template_id', batch)
          .gte('for_date', window.min)
          .lte('for_date', window.max),
      )
      if (page.error) return { data: [], error: page.error }
      submissionRows.push(...(page.data ?? []))
    }
  }

  return {
    data: findOverdueForms({
      sites,
      templates,
      exclusions,
      closures,
      submissions: submissionRows.map(mapSubmission),
      today,
      trackingStart,
    }),
    error: null,
  }
}

function overdueForDateWindow(sites, templates, closures, today) {
  let min = null
  let max = null
  const consider = (start, end) => {
    if (!start || !end) return
    if (!min || start < min) min = start
    if (!max || end > max) max = end
  }

  for (const site of sites) {
    for (const template of templates) {
      if (template.cadence === 'once' || template.cadence === 'each_time' || !template.cadence) {
        continue
      }
      if (template.cadence === 'daily') {
        const day = previousOpenDay(
          site,
          closures,
          today,
          scheduleNotBefore(site, template) || '2000-01-01',
        )
        if (day) consider(day, day)
        continue
      }
      const bounds = previousPeriodBounds(template.cadence, today, template.cadence_months)
      if (bounds?.start && bounds.end) consider(bounds.start, bounds.end)
    }
  }

  return { min, max }
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
  'id, org_id, assignment_id, template_id, site_id, staff_id, submitted_by, data, status, signed_off_by, signed_off_at, signed_by_staff_id, evidence, submitted_at, for_date, due_by, created_at'

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
    completed_on: typeof payload.completed_on === 'string' ? payload.completed_on.slice(0, 10) : '',
    action_details:
      payload.action_details && typeof payload.action_details === 'object'
        ? payload.action_details
        : {},
    actions: Array.isArray(payload.actions) ? payload.actions : [],
    status: row.status,
    signed_off_by: row.signed_off_by,
    signed_off_at: row.signed_off_at,
    signed_by_staff_id: row.signed_by_staff_id ?? null,
    signer_name: row.signer?.name || '',
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    submitted_at: row.submitted_at,
    for_date: forDate,
    due_by: normalizeTimeOfDay(row.due_by),
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
    actionDetails: {},
  }
}

export function buildSubmissionData({ room, values, notes, signoff, rows, actionDetails, actions }) {
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
    action_details: actionDetails || {},
    actions: Array.isArray(actions) ? actions : [],
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
  if (archetype === 'evidence') {
    return [
      ...evidenceCompletionErrors(state?.fileCount),
      ...evidenceActionErrors(state?.actions),
    ]
  }
  const errors = []
  const fields =
    archetype === 'checklist'
      ? (schema?.items ?? []).map((item) => ({ ...item, type: checklistItemType(item) }))
      : Array.isArray(schema?.fields)
        ? schema.fields
        : Array.isArray(schema?.items)
          ? schema.items
          : []

  for (const field of fields) {
    if (field.type === 'yes_no_na') continue
    if (!field.required) continue
    if (!fieldFilled(field, state.values?.[field.id])) {
      errors.push(`Fill ${field.label || 'required fields'}.`)
    }
  }

  if (archetype === 'checklist') {
    errors.push(...yesNoNaErrors(schema, state.values, state.notes))
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
  { templateId = '', siteId = '', page = 1, pageSize = 25 } = {},
) {
  if (!orgId) return { data: [], count: 0, error: null }

  const size = Math.max(1, pageSize)
  const current = Math.max(1, page)
  const from = (current - 1) * size
  let query = supabase
    .from('form_submissions')
    .select(`${SUBMISSION_FIELDS}, form_templates ( id, name ), sites ( id, name )`, {
      count: 'exact',
    })
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + size - 1)

  if (templateId) query = query.eq('template_id', templateId)
  if (siteId) query = query.eq('site_id', siteId)

  const { data, error, count } = await query
  if (error) return { data: [], count: 0, error }
  return { data: (data ?? []).map(mapSubmission), count: count ?? 0, error: null }
}

export async function getFormSubmission(id) {
  const { data, error } = await supabase
    .from('form_submissions')
    .select(
      `${SUBMISSION_FIELDS}, form_templates ( id, name ), sites ( id, name ), signer:staff!form_submissions_signed_by_staff_id_fkey ( id, name )`,
    )
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
  months,
}) {
  if (!orgId || !templateId || !siteId) return { data: null, error: null }
  if (cadence && cadence !== 'once' && !isIsoDate(forDate)) {
    return { data: null, error: null }
  }

  const bounds = periodBounds(cadence || 'once', forDate || todayIsoDate(), months)
  if (isAnchoredCadence(cadence) && !bounds?.start) return { data: null, error: null }
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
  if (excludeId) query = query.neq('id', excludeId)
  query = query.limit(1)

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
