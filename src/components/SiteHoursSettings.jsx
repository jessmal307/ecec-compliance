import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SiteFormDueTimes } from './forms/FormDueTimes'
import { Choice, DateInput, Field, FormSection, Input } from './ui/form'
import { PageError, PageMuted } from './ui/page'
import { formatDate } from '../lib/format'
import { getOrganization } from '../lib/organizations'
import { can } from '../lib/plans'
import {
  createSiteClosure,
  deleteSiteClosure,
  listSiteClosures,
  EMPTY_OPERATING_DAYS_MESSAGE,
  WEEKDAY_OPTIONS,
} from '../lib/sites'

export function SiteHoursSettings({
  organizationId,
  siteId,
  operatingDays,
  onOperatingDaysChange,
  disabled = false,
}) {
  const [allowed, setAllowed] = useState(false)
  const [closures, setClosures] = useState([])
  const [closureDate, setClosureDate] = useState('')
  const [closureNote, setClosureNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    getOrganization(organizationId).then(({ data }) => {
      if (!cancelled) setAllowed(can(data, 'forms'))
    })

    return () => {
      cancelled = true
    }
  }, [organizationId])

  useEffect(() => {
    if (!allowed || !siteId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const { data, error: loadError } = await listSiteClosures(siteId)
      if (cancelled) return
      if (loadError) {
        setError(loadError.message)
        setClosures([])
        setLoading(false)
        return
      }
      setClosures(data)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [allowed, siteId])

  if (!allowed) return null

  const selected = new Set(operatingDays)

  function toggleDay(day) {
    const next = selected.has(day)
      ? operatingDays.filter((value) => value !== day)
      : [...operatingDays, day].sort((left, right) => left - right)
    onOperatingDaysChange(next)
  }

  async function handleAddClosure() {
    if (!closureDate) {
      setError('Choose a closure date.')
      return
    }

    setSaving(true)
    setError('')
    const { data, error: saveError } = await createSiteClosure({
      orgId: organizationId,
      siteId,
      closureDate,
      note: closureNote,
    })
    setSaving(false)

    if (saveError) {
      setError(saveError.message)
      return
    }

    setClosures((current) =>
      [...current, data].sort((left, right) =>
        left.closure_date.localeCompare(right.closure_date),
      ),
    )
    setClosureDate('')
    setClosureNote('')
  }

  async function handleRemove(id) {
    setRemovingId(id)
    setError('')
    const { error: deleteError } = await deleteSiteClosure(id)
    setRemovingId(null)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setClosures((current) => current.filter((row) => row.id !== id))
  }

  return (
    <>
      <FormSection
        title="Opening hours & closures"
        description="Days this centre is open, and dates it is closed. Defaults to Monday–Friday."
      >
        <fieldset className="space-y-2" disabled={disabled}>
          <legend className="sr-only">Operating days</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_OPTIONS.map((day) => (
              <Choice
                key={day.value}
                type="checkbox"
                checked={selected.has(day.value)}
                onChange={() => toggleDay(day.value)}
                className="min-h-11 rounded-lg border border-input px-3"
              >
                {day.label}
              </Choice>
            ))}
          </div>
          {operatingDays.length === 0 ? (
            <p className="text-sm text-status-expired" role="alert">
              {EMPTY_OPERATING_DAYS_MESSAGE}
            </p>
          ) : null}
        </fieldset>
      </FormSection>

      <FormSection
        title="Closures"
        description="Public holidays, vacation shutdowns, or a one-off closed day."
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date">
              <DateInput
                value={closureDate}
                onChange={(event) => setClosureDate(event.target.value)}
                disabled={disabled || saving}
              />
            </Field>
            <Field label="Note" hint="Optional">
              <Input
                value={closureNote}
                onChange={(event) => setClosureNote(event.target.value)}
                disabled={disabled || saving}
              />
            </Field>
            <div className="sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                disabled={disabled || saving}
                onClick={handleAddClosure}
              >
                {saving ? 'Adding…' : 'Add closure'}
              </Button>
            </div>
          </div>

          <PageError>{error}</PageError>

          {loading ? (
            <PageMuted>Loading closures…</PageMuted>
          ) : closures.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming closures.</p>
          ) : (
            <ul className="divide-y divide-border">
              {closures.map((closure) => (
                <li
                  key={closure.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="font-medium">{formatDate(closure.closure_date)}</p>
                    {closure.note ? (
                      <p className="text-sm text-muted-foreground">{closure.note}</p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disabled || removingId === closure.id}
                    onClick={() => handleRemove(closure.id)}
                  >
                    {removingId === closure.id ? 'Removing…' : 'Remove'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </FormSection>

      <SiteFormDueTimes
        organizationId={organizationId}
        siteId={siteId}
        disabled={disabled}
      />
    </>
  )
}
