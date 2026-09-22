import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from './StatusBadge'
import { DateInput, Field, FormActions, Input, Textarea } from './ui/form'
import { PageError, PageMuted } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import {
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
} from '../lib/calendar'
import { listComplianceItems, todayIsoDate } from '../lib/compliance'
import {
  addMonths,
  calendarEntriesFromEvents,
  calendarEntriesFromItems,
  groupEntriesByDate,
  monthCells,
  monthLabel,
  upcomingEntries,
} from '../lib/complianceCalendar'
import { formatDate } from '../lib/format'
import { firstError } from '../lib/query'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const CHIP_CLASS = {
  Valid: 'bg-status-valid text-status-valid-foreground',
  'Expiring soon': 'bg-status-soon text-status-soon-foreground',
  Expired: 'bg-status-expired text-status-expired-foreground',
  'Recheck due': 'bg-status-expired text-status-expired-foreground',
  Event: 'bg-sidebar-accent text-sidebar-accent-foreground',
}

const DOT_CLASS = {
  Valid: 'bg-status-valid',
  'Expiring soon': 'bg-status-soon',
  Expired: 'bg-status-expired',
  'Recheck due': 'bg-status-expired',
  Event: 'bg-sidebar-foreground/70',
}

function chipClass(entry) {
  return CHIP_CLASS[entry.status] ?? CHIP_CLASS.Event
}

function dotClass(entry) {
  return DOT_CLASS[entry.status] ?? DOT_CLASS.Event
}

function emptyForm(date) {
  return { title: '', eventDate: date, notes: '' }
}

export function ComplianceCalendar() {
  const { organizationId } = useAuth()
  const today = todayIsoDate()
  const todayDate = new Date(`${today}T00:00:00`)
  const [year, setYear] = useState(todayDate.getFullYear())
  const [month, setMonth] = useState(todayDate.getMonth())
  const [selectedDate, setSelectedDate] = useState(today)
  const [items, setItems] = useState([])
  const [customEvents, setCustomEvents] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(() => emptyForm(today))
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const [itemsResult, eventsResult] = await Promise.all([
        listComplianceItems(organizationId),
        listCalendarEvents(organizationId),
      ])
      if (cancelled) return

      const loadError = firstError(itemsResult, eventsResult)
      if (itemsResult.data) setItems(itemsResult.data)
      if (eventsResult.data) setCustomEvents(eventsResult.data)
      if (loadError) {
        setError(
          /calendar_events/i.test(loadError.message)
            ? 'Re-run schema.sql to add your own calendar events. Expiry dates still show.'
            : loadError.message,
        )
        setLoading(false)
        return
      }

      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId])

  const entries = useMemo(
    () => [
      ...calendarEntriesFromItems(items),
      ...calendarEntriesFromEvents(customEvents),
    ],
    [customEvents, items],
  )
  const byDate = useMemo(() => groupEntriesByDate(entries), [entries])
  const cells = useMemo(() => monthCells(year, month), [month, year])
  const selectedEntries = byDate.get(selectedDate) ?? []
  const comingUp = useMemo(
    () => upcomingEntries(entries, { from: today, days: 30 }).slice(0, 12),
    [entries, today],
  )

  function goToMonth(delta) {
    const next = addMonths(year, month, delta)
    setYear(next.year)
    setMonth(next.month)
  }

  function goToToday() {
    setYear(todayDate.getFullYear())
    setMonth(todayDate.getMonth())
    setSelectedDate(today)
  }

  function openCreate(date = selectedDate) {
    setEditingId(null)
    setForm(emptyForm(date))
    setFormError('')
    setFormOpen(true)
  }

  function openEdit(entry) {
    setEditingId(entry.eventId)
    setForm({
      title: entry.title,
      eventDate: entry.date,
      notes: entry.notes ?? '',
    })
    setFormError('')
    setFormOpen(true)
  }

  async function handleSaveEvent(event) {
    event.preventDefault()
    if (!organizationId) return

    const title = form.title.trim()
    if (!title) {
      setFormError('Enter a title.')
      return
    }
    if (!form.eventDate) {
      setFormError('Enter a date.')
      return
    }

    setSaving(true)
    setFormError('')

    const result = editingId
      ? await updateCalendarEvent(editingId, {
          title,
          eventDate: form.eventDate,
          notes: form.notes,
        })
      : await createCalendarEvent({
          orgId: organizationId,
          title,
          eventDate: form.eventDate,
          notes: form.notes,
        })

    if (result.error) {
      setFormError(result.error.message)
      setSaving(false)
      return
    }

    setCustomEvents((current) => {
      if (editingId) {
        return current.map((row) => (row.id === editingId ? result.data : row))
      }
      return [...current, result.data]
    })
    setSelectedDate(form.eventDate)
    const next = parseIsoDateSafe(form.eventDate)
    if (next) {
      setYear(next.getFullYear())
      setMonth(next.getMonth())
    }
    setSaving(false)
    setFormOpen(false)
    setEditingId(null)
  }

  async function handleDeleteEvent() {
    if (!pendingDelete) return
    setDeleting(true)
    setError('')
    const { error: deleteError } = await deleteCalendarEvent(pendingDelete.eventId)
    if (deleteError) {
      setError(deleteError.message)
      setDeleting(false)
      return
    }
    setCustomEvents((current) =>
      current.filter((row) => row.id !== pendingDelete.eventId),
    )
    setPendingDelete(null)
    setDeleting(false)
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader>
          <CardTitle>Calendar</CardTitle>
          <CardDescription>
            Expiry dates, rechecks, and anything you add for the service.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Previous month"
                onClick={() => goToMonth(-1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <p className="min-w-40 px-2 text-center text-sm font-medium text-card-foreground">
                {monthLabel(year, month)}
              </p>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Next month"
                onClick={() => goToMonth(1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <Button type="button" variant="outline" onClick={goToToday}>
              Today
            </Button>
            <Button
              type="button"
              onClick={() => openCreate(selectedDate)}
              disabled={!organizationId}
            >
              <Plus data-icon="inline-start" />
              Add event
            </Button>
          </div>
          <PageError>{error}</PageError>
          {loading ? <PageMuted>Loading calendar…</PageMuted> : null}

          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="bg-muted px-1 py-2 text-center text-[10px] font-medium text-muted-foreground sm:text-xs"
              >
                {day}
              </div>
            ))}
            {cells.map((cell) => {
              const dayEntries = byDate.get(cell.date) ?? []
              const isToday = cell.date === today
              const isSelected = cell.date === selectedDate
              const dayNumber = Number(cell.date.slice(8, 10))

              return (
                <button
                  key={cell.date}
                  type="button"
                  onClick={() => setSelectedDate(cell.date)}
                  className={[
                    'flex min-h-16 flex-col gap-1 bg-card p-1 text-left transition-colors sm:min-h-24 sm:p-1.5',
                    cell.inMonth ? 'text-card-foreground' : 'text-muted-foreground/60',
                    isSelected ? 'ring-2 ring-ring ring-inset' : 'hover:bg-muted/50',
                    isToday && !isSelected ? 'bg-muted/40' : '',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'flex size-6 items-center justify-center rounded-full text-xs font-medium',
                      isToday
                        ? 'bg-foreground text-background'
                        : '',
                    ].join(' ')}
                  >
                    {dayNumber}
                  </span>
                  <div className="flex flex-wrap gap-0.5 md:hidden">
                    {dayEntries.slice(0, 3).map((entry) => (
                      <span
                        key={entry.id}
                        className={`size-1.5 rounded-full ${dotClass(entry)}`}
                      />
                    ))}
                    {dayEntries.length > 3 ? (
                      <span className="text-[10px] text-muted-foreground">
                        +{dayEntries.length - 3}
                      </span>
                    ) : null}
                  </div>
                  <div className="hidden min-w-0 flex-col gap-0.5 md:flex">
                    {dayEntries.slice(0, 3).map((entry) => (
                      <span
                        key={entry.id}
                        className={`truncate rounded px-1 py-0.5 text-[10px] leading-4 ${chipClass(entry)}`}
                      >
                        {entry.title}
                      </span>
                    ))}
                    {dayEntries.length > 3 ? (
                      <span className="text-[10px] text-muted-foreground">
                        +{dayEntries.length - 3} more
                      </span>
                    ) : null}
                  </div>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{formatDate(selectedDate)}</CardTitle>
            <CardDescription>
              {selectedDate === today ? 'Today. ' : ''}
              {selectedEntries.length === 0
                ? 'Nothing on this day yet.'
                : `${selectedEntries.length} on this day.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <PageMuted>Loading this day…</PageMuted>
            ) : selectedEntries.length === 0 ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => openCreate(selectedDate)}
                disabled={!organizationId}
              >
                <Plus data-icon="inline-start" />
                Add to this day
              </Button>
            ) : (
              <ul className="space-y-2">
                {selectedEntries.map((entry) => (
                  <li key={entry.id}>
                    <CalendarEntryRow
                      entry={entry}
                      onEdit={() => openEdit(entry)}
                      onDelete={() => setPendingDelete(entry)}
                    />
                  </li>
                ))}
              </ul>
            )}
            {selectedEntries.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => openCreate(selectedDate)}
                disabled={!organizationId}
              >
                <Plus data-icon="inline-start" />
                Add event
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Coming up</CardTitle>
            <CardDescription>Next 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <PageMuted>Loading upcoming…</PageMuted>
            ) : comingUp.length === 0 ? (
              <PageMuted>Nothing coming up in the next 30 days.</PageMuted>
            ) : (
              <ul className="space-y-2">
                {comingUp.map((entry) => (
                  <li key={`${entry.id}-${entry.date}`}>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(entry.date)}
                    </p>
                    <CalendarEntryRow entry={entry} compact />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <EventFormDialog
        open={formOpen}
        editing={Boolean(editingId)}
        form={form}
        error={formError}
        saving={saving}
        onOpenChange={setFormOpen}
        onChange={setForm}
        onSubmit={handleSaveEvent}
      />

      <ConfirmDeleteDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null)
        }}
        title={pendingDelete ? `Delete ${pendingDelete.title}?` : 'Delete event?'}
        description="This removes it from the calendar. Compliance records are not changed."
        confirming={deleting}
        onConfirm={handleDeleteEvent}
        confirmLabel="Delete"
        confirmingLabel="Deleting…"
      />
    </div>
  )
}

function parseIsoDateSafe(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate ?? '')) return null
  const date = new Date(`${isoDate}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function CalendarEntryRow({ entry, compact = false, onEdit, onDelete }) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-card-foreground">
          {entry.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {entry.detail}
          {entry.subtitle ? ` · ${entry.subtitle}` : ''}
        </p>
      </div>
      {entry.kind === 'event' ? (
        <Badge variant="secondary" className="max-w-none shrink-0">
          Event
        </Badge>
      ) : (
        <StatusBadge status={entry.status} />
      )}
    </>
  )

  if (entry.kind === 'event' && !compact) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2">
        <div className="flex items-start gap-2">{body}</div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
    )
  }

  if (entry.href) {
    return (
      <Link
        to={entry.href}
        className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 no-underline hover:bg-muted/50"
      >
        {body}
      </Link>
    )
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
      {body}
    </div>
  )
}

function EventFormDialog({
  open,
  editing,
  form,
  error,
  saving,
  onOpenChange,
  onChange,
  onSubmit,
}) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (saving) return
        onOpenChange(next)
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-[60] grid w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="flex flex-col gap-1.5 text-left">
              <DialogPrimitive.Title className="text-base font-medium text-card-foreground">
                {editing ? 'Edit event' : 'Add event'}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm text-muted-foreground">
                Saved on this calendar only. It is not a compliance record.
              </DialogPrimitive.Description>
            </div>

            <Field label="Title">
              <Input
                type="text"
                name="title"
                value={form.title}
                onChange={(event) =>
                  onChange((current) => ({ ...current, title: event.target.value }))
                }
                required
                disabled={saving}
              />
            </Field>
            <Field label="Date">
              <DateInput
                name="event_date"
                value={form.eventDate}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    eventDate: event.target.value,
                  }))
                }
                required
                disabled={saving}
              />
            </Field>
            <Field label="Notes" hint="Optional">
              <Textarea
                name="notes"
                value={form.notes}
                onChange={(event) =>
                  onChange((current) => ({ ...current, notes: event.target.value }))
                }
                disabled={saving}
              />
            </Field>

            <PageError>{error}</PageError>

            <FormActions>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </FormActions>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
