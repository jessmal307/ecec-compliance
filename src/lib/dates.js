import { todayIsoDate } from './compliance'
import { formatIso } from './sydneyTime'

export const MIN_REASONABLE_DATE = '2000-01-01'

export function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
}

function addYearsIso(isoDate, years) {
  if (!isIsoDate(isoDate)) return isoDate
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year + years, month - 1, day))
  return formatIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
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
