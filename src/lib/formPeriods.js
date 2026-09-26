import {
  addDaysIso,
  addMonthsIso,
  daysInMonth,
  formatIso,
  isoWeekday,
  sydneyIsoDate,
} from './sydneyTime.js'
import { isLateForDueBy } from './formDueTimes.js'
import { DEFAULT_OPERATING_DAYS, isSiteOpenOn as siteIsOpenOn } from './siteOpen.js'
import {
  anchoredPeriodBounds,
  isAnchoredCadence,
  isMonthLongCadence,
  monthTrackingBoundary,
  normalizeCadenceMonths,
  periodIsOwed,
  previousAnchoredPeriodBounds,
} from '../../supabase/functions/_shared/formPeriods.js'

export {
  isAnchoredCadence,
  isMonthLongCadence,
  monthTrackingBoundary,
  normalizeCadenceMonths,
  periodIsOwed,
}

export { addDaysIso, daysInMonth, formatIso, isoWeekday, DEFAULT_OPERATING_DAYS }

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
}

export function addCalendarMonthsIso(isoDate, months) {
  return addMonthsIso(isoDate, months)
}

export function periodBounds(cadence, today, months) {
  if (!isIsoDate(today)) return null
  if (isAnchoredCadence(cadence)) return anchoredPeriodBounds(months, today)
  const [year, month] = today.split('-').map(Number)

  if (cadence === 'daily') return { start: today, end: today }
  if (cadence === 'weekly') {
    const weekday = isoWeekday(today)
    const start = addDaysIso(today, 1 - weekday)
    return { start, end: addDaysIso(start, 6) }
  }
  if (cadence === 'monthly') {
    return {
      start: formatIso(year, month, 1),
      end: formatIso(year, month, daysInMonth(year, month)),
    }
  }
  if (cadence === 'quarterly') {
    const startMonth = Math.floor((month - 1) / 3) * 3 + 1
    const endMonth = startMonth + 2
    return {
      start: formatIso(year, startMonth, 1),
      end: formatIso(year, endMonth, daysInMonth(year, endMonth)),
    }
  }
  if (cadence === 'annual') {
    return { start: formatIso(year, 1, 1), end: formatIso(year, 12, 31) }
  }
  if (cadence === 'once') return { start: null, end: null }
  return null
}

export function previousPeriodBounds(cadence, today, months) {
  if (isAnchoredCadence(cadence)) return previousAnchoredPeriodBounds(months, today)
  const current = periodBounds(cadence, today)
  if (!current?.start) return null
  if (cadence === 'daily') {
    const day = addDaysIso(today, -1)
    return { start: day, end: day }
  }
  return periodBounds(cadence, addDaysIso(current.start, -1))
}

export function submissionLocalDate(value) {
  if (!value) return null
  if (isIsoDate(value)) return value
  return sydneyIsoDate(value)
}

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right)
}

export function isSiteOpenOn(site, closures, day) {
  return siteIsOpenOn({
    operatingDays: site?.operating_days,
    closures,
    siteId: site?.id,
    day,
  })
}

export function coverageDate(row) {
  const explicit = String(row?.for_date ?? '').slice(0, 10)
  return isIsoDate(explicit) ? explicit : null
}

export function isSubmissionLate(row) {
  if (row?.status !== 'complete') return false
  const explicit = String(row?.for_date ?? '').slice(0, 10)
  if (!isIsoDate(explicit)) return false
  return isLateForDueBy({
    forDate: explicit,
    dueBy: row.due_by,
    submittedAt: row.submitted_at,
  })
}

function dateInPeriod(isoDate, bounds) {
  if (!isoDate) return false
  if (!bounds || (!bounds.start && !bounds.end)) return true
  if (bounds.start && isoDate < bounds.start) return false
  if (bounds.end && isoDate > bounds.end) return false
  return true
}

function matchingRows(submissions, siteId, templateId, status) {
  return submissions.filter(
    (row) =>
      row.status === status &&
      sameId(row.site_id, siteId) &&
      sameId(row.template_id, templateId),
  )
}

export function forDateInPeriod(row, bounds) {
  return dateInPeriod(coverageDate(row), bounds)
}

function hasForDateStatusInPeriod(submissions, siteId, templateId, status, bounds) {
  return matchingRows(submissions, siteId, templateId, status).some((row) =>
    forDateInPeriod(row, bounds),
  )
}

export function hasCompleteInPeriod(submissions, siteId, templateId, bounds) {
  return hasForDateStatusInPeriod(submissions, siteId, templateId, 'complete', bounds)
}

export function hasMissedInPeriod(submissions, siteId, templateId, bounds) {
  return hasForDateStatusInPeriod(submissions, siteId, templateId, 'missed', bounds)
}

export function periodStatus(submissions, siteId, templateId, bounds) {
  if (hasCompleteInPeriod(submissions, siteId, templateId, bounds)) return 'done'
  if (hasMissedInPeriod(submissions, siteId, templateId, bounds)) return 'missed'
  return 'due'
}

export function isLateInPeriod(submissions, siteId, templateId, bounds) {
  return matchingRows(submissions, siteId, templateId, 'complete').some(
    (row) => forDateInPeriod(row, bounds) && isSubmissionLate(row),
  )
}

function eachDateInclusive(start, end) {
  const days = []
  let cursor = start
  while (cursor && cursor <= end) {
    days.push(cursor)
    cursor = addDaysIso(cursor, 1)
  }
  return days
}

export function periodHasOpenDay(site, closures, bounds) {
  if (!bounds?.start || !bounds?.end) return false
  return eachDateInclusive(bounds.start, bounds.end).some((day) =>
    isSiteOpenOn(site, closures, day),
  )
}

export function previousOpenDay(site, closures, today, notBefore) {
  let cursor = addDaysIso(today, -1)
  while (cursor && cursor >= notBefore) {
    if (isSiteOpenOn(site, closures, cursor)) return cursor
    cursor = addDaysIso(cursor, -1)
  }
  return null
}

function createdIso(value) {
  return submissionLocalDate(value)
}

function notBeforeIso(site, template) {
  const dates = [createdIso(site.created_at), createdIso(template.created_at)].filter(
    Boolean,
  )
  return dates.length ? dates.reduce((latest, date) => (date > latest ? date : latest)) : null
}

export function scheduleNotBefore(site, template) {
  return notBeforeIso(site, template)
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const MONTHS_SHORT = MONTHS.map((name) => name.slice(0, 3))

function formatDayLabel(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number)
  return `${day} ${MONTHS_SHORT[month - 1]} ${year}`
}

export function missedPeriodLabel(cadence, bounds, today) {
  if (!bounds?.start) return 'missed last period'
  if (cadence === 'daily') {
    return bounds.start === addDaysIso(today, -1)
      ? 'missed yesterday'
      : `missed ${formatDayLabel(bounds.start)}`
  }
  if (cadence === 'weekly') return `missed week of ${formatDayLabel(bounds.start)}`
  if (cadence === 'monthly' || cadence === 'half_yearly' || cadence === 'annually') {
    const [year, month] = bounds.start.split('-').map(Number)
    return `missed ${MONTHS[month - 1]} ${year}`
  }
  if (cadence === 'quarterly') {
    const [year, month] = bounds.start.split('-').map(Number)
    return `missed ${MONTHS_SHORT[month - 1]}–${MONTHS_SHORT[month + 1]} ${year}`
  }
  if (cadence === 'annual') return `missed ${bounds.start.slice(0, 4)}`
  return `missed ${formatDayLabel(bounds.start)}`
}

export function findOverdueForms({
  sites,
  templates,
  exclusions,
  closures,
  submissions,
  today,
  trackingStart = null,
}) {
  if (!isIsoDate(today)) return []

  const rows = []
  for (const site of sites) {
    for (const template of templates) {
      if (template.cadence === 'once' || template.cadence === 'each_time' || !template.cadence) {
        continue
      }
      if (template.scope !== 'all_sites') continue
      if (
        exclusions.some(
          (row) =>
            sameId(row.site_id, site.id) && sameId(row.template_id, template.id),
        )
      ) {
        continue
      }

      const notBefore = notBeforeIso(site, template)
      let bounds = null

      if (template.cadence === 'daily') {
        const day = previousOpenDay(site, closures, today, notBefore || '2000-01-01')
        if (!day) continue
        bounds = { start: day, end: day }
      } else {
        bounds = previousPeriodBounds(template.cadence, today, template.cadence_months)
        if (!bounds?.start) continue
        const monthLong = isMonthLongCadence(template.cadence)
        const boundary = monthLong
          ? monthTrackingBoundary(trackingStart, createdIso(site.created_at))
          : notBefore
        if (!periodIsOwed(bounds, boundary, monthLong)) continue
        if (!monthLong && !periodHasOpenDay(site, closures, bounds)) continue
      }

      if (
        hasForDateStatusInPeriod(
          submissions,
          site.id,
          template.id,
          'complete',
          bounds,
        ) ||
        hasForDateStatusInPeriod(
          submissions,
          site.id,
          template.id,
          'missed',
          bounds,
        )
      ) {
        continue
      }

      rows.push({
        site_id: site.id,
        site_name: site.name,
        template_id: template.id,
        template_name: template.name,
        cadence: template.cadence,
        period_start: bounds.start,
        period_end: bounds.end,
        label: missedPeriodLabel(template.cadence, bounds, today),
      })
    }
  }

  return rows
}
