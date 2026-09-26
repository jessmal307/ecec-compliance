import {
  addDaysIso,
  formatIso,
  isAnchoredCadence,
  isMonthLongCadence,
  isSiteOpenOn,
  isoWeekday,
  monthPeriodIsOwed,
  periodBounds,
  periodHasOpenDay,
  periodIsOwed,
  scheduleNotBefore,
  submissionLocalDate,
} from './formPeriods.js'

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right)
}

function yearOf(today) {
  return today.slice(0, 4)
}

function closedPeriodsThisYear(template, today) {
  const cadence = template?.cadence
  if (!cadence || cadence === 'once' || cadence === 'each_time') return []
  const year = yearOf(today)
  const months = template.cadence_months

  if (cadence === 'monthly' || isAnchoredCadence(cadence)) {
    const list =
      cadence === 'monthly'
        ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
        : months ?? []
    return list
      .map((month) => periodBounds(cadence, formatIso(Number(year), month, 15), months))
      .filter((bounds) => bounds?.end && bounds.end < today && bounds.start.startsWith(year))
  }

  if (cadence === 'quarterly') {
    return [1, 4, 7, 10]
      .map((month) => periodBounds('quarterly', formatIso(Number(year), month, 1)))
      .filter((bounds) => bounds?.end && bounds.end < today && bounds.start.startsWith(year))
  }

  if (cadence === 'annual') {
    const bounds = periodBounds('annual', `${year}-06-01`)
    return bounds?.end && bounds.end < today ? [bounds] : []
  }

  if (cadence === 'weekly') {
    const jan1 = `${year}-01-01`
    const weekday = isoWeekday(jan1)
    if (weekday == null) return []
    let start = addDaysIso(jan1, weekday === 1 ? 0 : 8 - weekday)
    const periods = []
    while (start && start.slice(0, 4) === year) {
      const end = addDaysIso(start, 6)
      if (end && end < today) periods.push({ start, end })
      start = addDaysIso(start, 7)
    }
    return periods
  }

  if (cadence === 'daily') {
    let cursor = `${year}-01-01`
    const periods = []
    while (cursor && cursor < today) {
      periods.push({ start: cursor, end: cursor })
      cursor = addDaysIso(cursor, 1)
    }
    return periods
  }

  return []
}

function auditPeriodOwed({ template, bounds, site, trackingStart, closures }) {
  if (isMonthLongCadence(template.cadence)) {
    return monthPeriodIsOwed(bounds, trackingStart, site?.created_at)
  }
  if (!periodIsOwed(bounds, scheduleNotBefore(site, template), false)) return false
  if (template.cadence === 'daily') return isSiteOpenOn(site, closures, bounds.start)
  return periodHasOpenDay(site, closures, bounds)
}

function periodCompletedOnTime(submissions, siteId, templateId, bounds) {
  return submissions.some((row) => {
    if (row.status !== 'complete') return false
    if (!sameId(row.site_id, siteId) || !sameId(row.template_id, templateId)) return false
    const covered = String(row.for_date || '').slice(0, 10)
    if (!covered || covered < bounds.start || covered > bounds.end) return false
    const submitted = submissionLocalDate(row.submitted_at)
    return Boolean(submitted) && submitted <= bounds.end
  })
}

// Closed owed audit periods this Sydney year, completed on or before the
// period end. An in-progress period is not in the percentage. No owed
// periods returns a null percent.
export function auditCompliancePercent({
  site,
  templates,
  trackingStart = null,
  closures = [],
  submissions = [],
  today,
}) {
  let owed = 0
  let onTime = 0
  for (const template of templates ?? []) {
    if (template.category !== 'audit') continue
    for (const bounds of closedPeriodsThisYear(template, today)) {
      if (!auditPeriodOwed({ template, bounds, site, trackingStart, closures })) continue
      owed += 1
      if (periodCompletedOnTime(submissions, site.id, template.id, bounds)) onTime += 1
    }
  }
  return {
    owed,
    onTime,
    percent: owed === 0 ? null : Math.round((onTime / owed) * 100),
  }
}
