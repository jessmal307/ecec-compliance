import {
  addDaysIso,
  complianceStatus,
  hasRecheckInterval,
  isRecheckOverdue,
  recheckDueDate,
} from './compliance'
import { formatDate } from './format'

function typeLeadDays(type, item) {
  const fromType = Number(type?.renewal_lead_days)
  if (Number.isInteger(fromType) && fromType > 0) return fromType
  const fromItem = Number(item?.renewal_lead_days)
  if (Number.isInteger(fromItem) && fromItem > 0) return fromItem
  return null
}

function daysLabel(days) {
  return `${days} day${days === 1 ? '' : 's'}`
}

export function alertTimingLine({
  item,
  type,
  status,
  expiryDate,
  lastVerifiedDate,
} = {}) {
  if (status === 'Not applicable') return ''

  const expiry = expiryDate || item?.expiry_date || null
  const verified =
    lastVerifiedDate || item?.last_verified_date || null
  const workingItem = item
    ? {
        ...item,
        expiry_date: expiry ?? item.expiry_date,
        last_verified_date: verified || item.last_verified_date,
      }
    : expiry
      ? { expiry_date: expiry, last_verified_date: verified }
      : null

  if (!workingItem) {
    return "No record on file — we'll keep flagging this until it's added."
  }

  if (complianceStatus(workingItem.expiry_date) === 'Expired') {
    return "This has expired — we'll keep flagging it until it's updated."
  }

  const source = type ?? workingItem
  if (hasRecheckInterval(source) || hasRecheckInterval(workingItem)) {
    if (isRecheckOverdue(workingItem, source)) {
      return "This re-check is due — we'll keep reminding you until it's marked verified."
    }
    const due = recheckDueDate(workingItem, source)
    if (!due) return ''
    return `We'll remind you to re-check this by ${formatDate(due)}.`
  }

  const leadDays = typeLeadDays(type, workingItem)
  if (leadDays == null || !workingItem.expiry_date) return ''
  const around = addDaysIso(workingItem.expiry_date, -leadDays)
  if (!around) return ''
  return `We'll email you ${daysLabel(leadDays)} before this expires — around ${formatDate(around)}.`
}
