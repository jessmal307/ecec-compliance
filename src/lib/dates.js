import { todayIsoDate } from './compliance'

export const MIN_REASONABLE_DATE = '2000-01-01'

export function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
}

function addYearsIso(isoDate, years) {
  const date = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return isoDate
  date.setFullYear(date.getFullYear() + years)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function maxReasonableDate(today = todayIsoDate()) {
  return addYearsIso(today, 15)
}

export function datePickerMax({ allowFuture = true } = {}) {
  return allowFuture ? maxReasonableDate() : todayIsoDate()
}

export function validateIsoDate(
  value,
  {
    required = false,
    allowFuture = true,
    emptyLabel = 'date',
    invalidLabel = 'date',
  } = {},
) {
  const trimmed = typeof value === 'string' ? value.trim() : value ?? ''
  if (!trimmed) {
    return required ? `Enter a ${emptyLabel}.` : null
  }
  if (!isIsoDate(trimmed)) {
    return `Enter a valid ${invalidLabel}.`
  }
  if (trimmed < MIN_REASONABLE_DATE) return 'Cannot be before 2000.'
  if (trimmed > maxReasonableDate()) {
    return 'Cannot be more than 15 years in the future.'
  }
  if (!allowFuture && trimmed > todayIsoDate()) {
    return 'Cannot be in the future.'
  }
  return null
}
