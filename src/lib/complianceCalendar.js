import {
  complianceStatus,
  recheckDueDate,
  todayIsoDate,
} from './compliance'
import { ownerRequirementPath } from './paths'

function pad2(value) {
  return String(value).padStart(2, '0')
}

export function isoDateFromParts(year, month, day) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`
}

export function parseIsoDate(isoDate) {
  const [year, month, day] = String(isoDate).split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function addMonths(year, month, delta) {
  const next = new Date(year, month + delta, 1)
  return { year: next.getFullYear(), month: next.getMonth() }
}

export function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

export function monthCells(year, month) {
  const first = new Date(year, month, 1)
  const startOffset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []

  for (let i = 0; i < startOffset; i += 1) {
    const date = new Date(year, month, 1 - (startOffset - i))
    cells.push({
      date: isoDateFromParts(date.getFullYear(), date.getMonth(), date.getDate()),
      inMonth: false,
    })
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      date: isoDateFromParts(year, month, day),
      inMonth: true,
    })
  }

  while (cells.length % 7 !== 0) {
    const last = parseIsoDate(cells[cells.length - 1].date)
    last.setDate(last.getDate() + 1)
    cells.push({
      date: isoDateFromParts(last.getFullYear(), last.getMonth(), last.getDate()),
      inMonth: false,
    })
  }

  return cells
}

function recheckStatus(dueDate) {
  return complianceStatus(dueDate) === 'Expired' ? 'Recheck due' : complianceStatus(dueDate)
}

export function calendarEntriesFromItems(items) {
  const entries = []

  for (const item of items) {
    if (item.expiry_date && !item.perpetual) {
      entries.push({
        id: `expiry-${item.id}`,
        date: item.expiry_date,
        kind: 'expiry',
        title: item.typeName,
        subtitle: item.ownerName,
        detail: 'Expires',
        status: complianceStatus(item.expiry_date),
        href: ownerRequirementPath(item),
      })
    }

    const due = item.last_verified_date ? recheckDueDate(item) : null
    if (due && due !== item.expiry_date) {
      entries.push({
        id: `recheck-${item.id}`,
        date: due,
        kind: 'recheck',
        title: item.typeName,
        subtitle: item.ownerName,
        detail: 'Recheck',
        status: recheckStatus(due),
        href: ownerRequirementPath(item),
      })
    }
  }

  return entries
}

export function calendarEntriesFromEvents(events) {
  return events.map((event) => ({
    id: `event-${event.id}`,
    date: event.event_date,
    kind: 'event',
    title: event.title,
    subtitle: event.notes || 'Added to calendar',
    detail: 'Event',
    status: 'Event',
    href: null,
    eventId: event.id,
    notes: event.notes,
    event,
  }))
}

export function groupEntriesByDate(entries) {
  const byDate = new Map()
  for (const entry of entries) {
    const current = byDate.get(entry.date) ?? []
    current.push(entry)
    byDate.set(entry.date, current)
  }
  for (const dayEntries of byDate.values()) {
    dayEntries.sort((left, right) => {
      const kindOrder = { expiry: 0, recheck: 1, event: 2 }
      const kindDiff = (kindOrder[left.kind] ?? 9) - (kindOrder[right.kind] ?? 9)
      if (kindDiff !== 0) return kindDiff
      return left.title.localeCompare(right.title)
    })
  }
  return byDate
}

export function upcomingEntries(entries, { from = todayIsoDate(), days = 30 } = {}) {
  const untilDate = parseIsoDate(from)
  untilDate.setDate(untilDate.getDate() + days)
  const until = isoDateFromParts(
    untilDate.getFullYear(),
    untilDate.getMonth(),
    untilDate.getDate(),
  )

  return entries
    .filter((entry) => entry.date >= from && entry.date <= until)
    .sort((left, right) => {
      const dateDiff = left.date.localeCompare(right.date)
      if (dateDiff !== 0) return dateDiff
      return left.title.localeCompare(right.title)
    })
}
