// One "is this site open on this Sydney date" rule for the app and
// edge functions. Weekdays are ISO: Mon=1 … Sun=7.
import { isoWeekday } from './sydneyTime.js'

export const DEFAULT_OPERATING_DAYS = [1, 2, 3, 4, 5]

export function normalizeOperatingDays(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return [...DEFAULT_OPERATING_DAYS]
  }
  const days = value.map(Number).filter((day) => day >= 1 && day <= 7)
  return days.length ? days : [...DEFAULT_OPERATING_DAYS]
}

export function isSiteOpenOn({ operatingDays, closures = [], siteId, day }) {
  const weekday = isoWeekday(day)
  const operating = normalizeOperatingDays(operatingDays)
  if (weekday == null || !operating.includes(weekday)) return false
  return !(closures ?? []).some((row) => {
    const closureDate = String(row?.closure_date ?? '').slice(0, 10)
    if (closureDate !== day) return false
    if (row.site_id == null || siteId == null) return true
    return String(row.site_id) === String(siteId)
  })
}
