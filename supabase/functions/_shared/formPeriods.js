// Period bounds shared by the app, the floor link, and the digest.
// half_yearly / annually are whole calendar months. `annual` is not this.
import {
  addDaysIso,
  daysInMonth,
  formatIso,
  isoWeekday,
  sydneyIsoDate,
} from './sydneyTime.js'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isAnchoredCadence(cadence) {
  return cadence === 'half_yearly' || cadence === 'annually'
}

export function isMonthLongCadence(cadence) {
  return cadence === 'monthly' || isAnchoredCadence(cadence)
}

export function normalizeCadenceMonths(months) {
  if (!Array.isArray(months)) return []
  const unique = []
  for (const value of months) {
    const month = Number(value)
    if (!Number.isInteger(month) || month < 1 || month > 12) continue
    if (!unique.includes(month)) unique.push(month)
  }
  unique.sort((left, right) => left - right)
  return unique
}

export function calendarMonthBounds(year, month) {
  if (!Number.isInteger(year) || month < 1 || month > 12) return null
  return {
    start: formatIso(year, month, 1),
    end: formatIso(year, month, daysInMonth(year, month)),
  }
}

// The anchor month that contains today, or null when today is outside one.
export function anchoredPeriodBounds(months, today) {
  if (!ISO_DATE.test(today ?? '')) return null
  const anchors = normalizeCadenceMonths(months)
  if (!anchors.length) return null
  const [year, month] = today.split('-').map(Number)
  if (!anchors.includes(month)) return null
  return calendarMonthBounds(year, month)
}

// The most recently ended anchor month. The current month is not overdue.
export function previousAnchoredPeriodBounds(months, today) {
  if (!ISO_DATE.test(today ?? '')) return null
  const anchors = normalizeCadenceMonths(months)
  if (!anchors.length) return null
  let year = Number(today.slice(0, 4))
  let month = Number(today.slice(5, 7))
  for (let step = 0; step < 24; step += 1) {
    const bounds = calendarMonthBounds(year, month)
    if (anchors.includes(month) && bounds && bounds.end < today) return bounds
    month -= 1
    if (month < 1) {
      month = 12
      year -= 1
    }
  }
  return null
}

function localIsoDate(value) {
  if (value == null || value === '') return null
  const text = String(value)
  if (ISO_DATE.test(text)) return text
  return sydneyIsoDate(value)
}

// A month is owed when it starts on or after the org tracking date and ends
// on or after the centre's Sydney created date. A centre added on 20 Nov owes
// November and does not owe October. A missing tracking date or centre date
// does not owe the month.
export function monthPeriodIsOwed(bounds, trackingStart, siteCreated) {
  if (!bounds?.start || !bounds?.end) return false
  const tracking = localIsoDate(trackingStart)
  const created = localIsoDate(siteCreated)
  if (!tracking || !created) return false
  return bounds.start >= tracking && bounds.end >= created
}

// Owed when the period starts on or after notBefore. Month-long periods use
// monthPeriodIsOwed. With no boundary a month is not owed. Other cadences
// with no boundary stay owed.
export function periodIsOwed(bounds, notBefore, monthLong) {
  if (!bounds?.start || !bounds?.end) return false
  if (!notBefore) return !monthLong
  return bounds.start >= notBefore
}

function isIsoDate(value) {
  return ISO_DATE.test(value ?? '')
}

// The period that contains `today`. Anchored cadences need their months.
// `once`, `each_time`, and unknown cadences have no period.
export function periodBounds(cadence, today, months) {
  if (!isIsoDate(today)) return null
  if (isAnchoredCadence(cadence)) return anchoredPeriodBounds(months, today)
  const [year, month] = today.split('-').map(Number)

  if (cadence === 'daily') return { start: today, end: today }
  if (cadence === 'weekly') {
    const weekday = isoWeekday(today)
    if (weekday == null) return null
    const start = addDaysIso(today, 1 - weekday)
    if (!start) return null
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
    return day ? { start: day, end: day } : null
  }
  const previousStart = addDaysIso(current.start, -1)
  return previousStart ? periodBounds(cadence, previousStart) : null
}
