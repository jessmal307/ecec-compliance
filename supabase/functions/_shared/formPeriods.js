// Anchored-month periods shared by the app and the digest.
// half_yearly / annually are whole calendar months. `annual` is not this.
import { daysInMonth, formatIso } from './sydneyTime.js'

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

// Later of the org's audit tracking date and the centre's created date.
// A missing tracking date does not owe a month (callers pass it for month-long
// periods). The period is owed only when it starts on or after this boundary.
export function monthTrackingBoundary(trackingStart, siteCreatedIso) {
  const tracking = ISO_DATE.test(String(trackingStart ?? '').slice(0, 10))
    ? String(trackingStart).slice(0, 10)
    : null
  const site = ISO_DATE.test(String(siteCreatedIso ?? '').slice(0, 10))
    ? String(siteCreatedIso).slice(0, 10)
    : null
  if (!tracking) return null
  if (!site) return tracking
  return tracking > site ? tracking : site
}

// Owed when the period starts on or after notBefore. Month-long callers pass
// monthTrackingBoundary; with no boundary a month is not owed. Other cadences
// with no boundary stay owed.
export function periodIsOwed(bounds, notBefore, monthLong) {
  if (!bounds?.start || !bounds?.end) return false
  if (!notBefore) return !monthLong
  return bounds.start >= notBefore
}
