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

// Month-long periods are owed when the template existed on any day of that
// month (period end on or after creation). Other cadences still require the
// period to start on or after creation.
export function periodIsOwed(bounds, notBefore, monthLong) {
  if (!bounds?.start || !bounds?.end) return false
  if (!notBefore) return true
  if (monthLong) return bounds.end >= notBefore
  return bounds.start >= notBefore
}
