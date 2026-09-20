export function formatDate(isoDate) {
  if (!isoDate) return '—'
  const date = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return isoDate

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatTimestamp(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function daysUntil(isoDate) {
  if (!isoDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const date = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  return Math.round((date.getTime() - today.getTime()) / 86_400_000)
}

export function formatRelativeExpiry(isoDate) {
  const days = daysUntil(isoDate)
  if (days == null) return ''
  if (days < 0) {
    const overdue = Math.abs(days)
    return `${overdue} day${overdue === 1 ? '' : 's'} overdue`
  }
  if (days === 0) return 'Expires today'
  return `Expires in ${days} day${days === 1 ? '' : 's'}`
}
