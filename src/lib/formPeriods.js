export const DEFAULT_OPERATING_DAYS = [1, 2, 3, 4, 5]

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

export function formatIso(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

export function addDaysIso(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00`)
  date.setDate(date.getDate() + days)
  return formatIso(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

export function addCalendarMonthsIso(isoDate, months) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const total = year * 12 + (month - 1) + months
  const nextYear = Math.floor(total / 12)
  const nextMonth = (total % 12) + 1
  const nextDay = Math.min(day, daysInMonth(nextYear, nextMonth))
  return formatIso(nextYear, nextMonth, nextDay)
}

export function isoWeekday(isoDate) {
  if (!isIsoDate(isoDate)) return null
  const day = new Date(`${isoDate}T00:00:00`).getDay()
  return day === 0 ? 7 : day
}

export function periodBounds(cadence, today) {
  if (!isIsoDate(today)) return null
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

export function previousPeriodBounds(cadence, today) {
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
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return formatIso(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right)
}

export function isSiteOpenOn(site, closures, day) {
  const weekday = isoWeekday(day)
  const operating = site.operating_days?.length
    ? site.operating_days
    : DEFAULT_OPERATING_DAYS
  if (!operating.includes(weekday)) return false
  return !closures.some(
    (row) => sameId(row.site_id, site.id) && row.closure_date === day,
  )
}

export function coverageDate(row) {
  const explicit = String(row?.for_date ?? '').slice(0, 10)
  if (isIsoDate(explicit)) return explicit
  return submissionLocalDate(row?.submitted_at)
}

export function isSubmissionLate(row) {
  if (row?.status !== 'complete') return false
  const explicit = String(row?.for_date ?? '').slice(0, 10)
  if (!isIsoDate(explicit)) return false
  const submitted = submissionLocalDate(row.submitted_at)
  return Boolean(submitted && submitted > explicit)
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

function forDateInPeriod(row, bounds) {
  const dated = String(row?.for_date ?? '').slice(0, 10)
  return isIsoDate(dated) && dateInPeriod(dated, bounds)
}

function hasForDateStatusInPeriod(submissions, siteId, templateId, status, bounds) {
  return matchingRows(submissions, siteId, templateId, status).some((row) =>
    forDateInPeriod(row, bounds),
  )
}

export function hasCompleteInPeriod(submissions, siteId, templateId, bounds) {
  return matchingRows(submissions, siteId, templateId, 'complete').some((row) =>
    dateInPeriod(coverageDate(row), bounds),
  )
}

export function hasMissedInPeriod(submissions, siteId, templateId, bounds) {
  return matchingRows(submissions, siteId, templateId, 'missed').some((row) =>
    dateInPeriod(coverageDate(row), bounds),
  )
}

export function periodStatus(submissions, siteId, templateId, bounds) {
  if (hasCompleteInPeriod(submissions, siteId, templateId, bounds)) return 'done'
  if (hasMissedInPeriod(submissions, siteId, templateId, bounds)) return 'missed'
  return 'due'
}

export function isLateInPeriod(submissions, siteId, templateId, bounds) {
  return matchingRows(submissions, siteId, templateId, 'complete').some(
    (row) => dateInPeriod(coverageDate(row), bounds) && isSubmissionLate(row),
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
  if (cadence === 'monthly') {
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
}) {
  if (!isIsoDate(today)) return []

  const rows = []
  for (const site of sites) {
    for (const template of templates) {
      if (template.cadence === 'once' || !template.cadence) continue
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
        bounds = previousPeriodBounds(template.cadence, today)
        if (!bounds?.start) continue
        if (notBefore && bounds.start < notBefore) continue
        if (!periodHasOpenDay(site, closures, bounds)) continue
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
