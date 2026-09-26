// Shared by the app (via src/lib/sydneyTime.js) and the edge functions.
// Every "today" or "now" is Sydney local time, never the browser's or UTC.
export const TIME_ZONE = 'Australia/Sydney'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)(?::00(?:\.0+)?)?$/

const sydneyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const sydneyClockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function pad2(value) {
  return String(value).padStart(2, '0')
}

export function formatIso(year, month, day) {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`
}

export function sydneyIsoDate(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) return null
  const parts = sydneyFormatter.formatToParts(value)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) return null
  return `${year}-${month}-${day}`
}

export function sydneyToday() {
  return sydneyIsoDate(new Date())
}

// Minutes since Sydney midnight (0–1439), or null for an invalid date.
export function sydneyMinutesOfDay(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) return null
  const parts = sydneyClockFormatter.formatToParts(value)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  return (hour % 24) * 60 + minute
}

// 'HH:MM' from 'HH:MM' or Postgres 'HH:MM:00'; null if not a whole-minute time.
export function normalizeTimeOfDay(value) {
  const match = TIME_OF_DAY.exec(String(value ?? '').trim())
  return match ? `${match[1]}:${match[2]}` : null
}

export function timeOfDayMinutes(value) {
  const normal = normalizeTimeOfDay(value)
  if (!normal) return null
  const [hour, minute] = normal.split(':').map(Number)
  return hour * 60 + minute
}

// '09:00' -> '9:00am', '13:30' -> '1:30pm', '00:00' -> '12:00am'.
export function formatTimeOfDay(value) {
  const normal = normalizeTimeOfDay(value)
  if (!normal) return ''
  const [hour, minute] = normal.split(':').map(Number)
  const suffix = hour < 12 ? 'am' : 'pm'
  return `${hour % 12 || 12}:${pad2(minute)}${suffix}`
}

function utcDate(isoDate) {
  if (!ISO_DATE.test(isoDate ?? '')) return null
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function fromUtcDate(date) {
  return formatIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function addDaysIso(isoDate, days) {
  const date = utcDate(isoDate)
  if (!date) return null
  date.setUTCDate(date.getUTCDate() + days)
  return fromUtcDate(date)
}

export function addMonthsIso(isoDate, months) {
  if (!ISO_DATE.test(isoDate ?? '')) return null
  const [year, month, day] = isoDate.split('-').map(Number)
  const total = year * 12 + (month - 1) + months
  const nextYear = Math.floor(total / 12)
  const nextMonth = (total % 12) + 1
  return formatIso(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)))
}

export function isoWeekday(isoDate) {
  const date = utcDate(isoDate)
  if (!date) return null
  const day = date.getUTCDay()
  return day === 0 ? 7 : day
}
