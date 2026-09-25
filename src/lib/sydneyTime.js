export const TIME_ZONE = 'Australia/Sydney'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const sydneyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
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
