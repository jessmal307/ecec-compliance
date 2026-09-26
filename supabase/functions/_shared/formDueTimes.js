// Due-by rules shared by the app and the edge functions. Times are Sydney
// local 'HH:MM', compared to the minute: 9:00:59 is still on time for 9:00.
import {
  normalizeTimeOfDay,
  sydneyIsoDate,
  sydneyMinutesOfDay,
  timeOfDayMinutes,
} from './sydneyTime.js'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right)
}

export function templateTakesDueBy(template) {
  return template?.cadence === 'daily' && template?.scope === 'all_sites'
}

// Mirrors public.form_effective_due_by: the site's time, else the org's
// all-sites time, else the template default.
export function dueByFor(template, siteId, dueTimes = []) {
  if (!templateTakesDueBy(template)) return { dueBy: null, source: null }
  const forTemplate = dueTimes.filter((row) => sameId(row.template_id, template.id))
  const siteRow = forTemplate.find((row) => siteId != null && sameId(row.site_id, siteId))
  const siteTime = normalizeTimeOfDay(siteRow?.due_by)
  if (siteTime) return { dueBy: siteTime, source: 'site' }
  const orgRow = forTemplate.find((row) => row.site_id == null)
  const orgTime = normalizeTimeOfDay(orgRow?.due_by)
  if (orgTime) return { dueBy: orgTime, source: 'org' }
  const defaultTime = normalizeTimeOfDay(template.default_due_by)
  if (defaultTime) return { dueBy: defaultTime, source: 'default' }
  return { dueBy: null, source: null }
}

// 'due' becomes 'overdue' once the Sydney clock passes the due-by on the
// form's day. Every other status, and forms with no due-by, pass through.
export function dueStatusAt({ status, dueBy, forDate, now = new Date() }) {
  if (status !== 'due' || !ISO_DATE.test(forDate ?? '')) return status
  const limit = timeOfDayMinutes(dueBy)
  const today = sydneyIsoDate(now)
  if (limit == null || !today || today < forDate) return status
  if (today > forDate) return 'overdue'
  const minutes = sydneyMinutesOfDay(now)
  return minutes != null && minutes > limit ? 'overdue' : status
}

// Late = submitted on a later day than the form covers, or on the day but
// after its due-by. With no due-by, only the day counts.
export function isLateForDueBy({ forDate, dueBy, submittedAt }) {
  if (!ISO_DATE.test(forDate ?? '') || !submittedAt) return false
  const dateOnly = ISO_DATE.test(String(submittedAt))
  const day = dateOnly ? String(submittedAt) : sydneyIsoDate(submittedAt)
  if (!day) return false
  if (day !== forDate) return day > forDate
  const limit = timeOfDayMinutes(dueBy)
  if (limit == null || dateOnly) return false
  const minutes = sydneyMinutesOfDay(submittedAt)
  return minutes != null && minutes > limit
}
