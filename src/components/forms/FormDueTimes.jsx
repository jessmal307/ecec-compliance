import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FormSection, Input } from '../ui/form'
import { PageError, PageMuted } from '../ui/page'
import { dueByFor, templateTakesDueBy } from '../../lib/formDueTimes'
import {
  clearFormDueTime,
  isFormSiteExcluded,
  listFormDueTimes,
  listFormSiteExclusions,
  listFormTemplates,
  setFormDueTime,
} from '../../lib/forms'
import { firstError } from '../../lib/query'
import { formatTimeOfDay } from '../../lib/sydneyTime'

const SOURCE_LABELS = {
  site: 'set for this site',
  org: 'your organisation’s time for all sites',
  default: 'RoadToComply default',
}

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right)
}

function withoutRow(rows, siteId, templateId) {
  return rows.filter(
    (row) =>
      !(
        sameId(row.template_id, templateId) &&
        (siteId == null ? row.site_id == null : sameId(row.site_id, siteId))
      ),
  )
}

function ownRow(rows, siteId, templateId) {
  return rows.find(
    (row) =>
      sameId(row.template_id, templateId) &&
      (siteId == null ? row.site_id == null : sameId(row.site_id, siteId)),
  )
}

function DueTimeEditor({ inputId, current, own, onSave, onClear, clearLabel, disabled }) {
  const [value, setValue] = useState(own || current || '')
  const [busy, setBusy] = useState(false)

  async function run(action) {
    setBusy(true)
    await action()
    setBusy(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        id={inputId}
        type="time"
        step={60}
        className="w-36"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={disabled || busy}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || busy || !value || value === own}
        onClick={() => run(() => onSave(value))}
      >
        Save
      </Button>
      {own ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || busy}
          onClick={() => run(onClear)}
        >
          {clearLabel}
        </Button>
      ) : null}
    </div>
  )
}

function dueSummary(dueBy, source) {
  if (!dueBy) return 'No due-by time'
  return `Due by ${formatTimeOfDay(dueBy)} · ${SOURCE_LABELS[source]}`
}

// Org-wide time for one daily form, shown on its template card.
export function FormDueByDefault({ organizationId, template }) {
  const [dueTimes, setDueTimes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!organizationId || !templateTakesDueBy(template)) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const { data, error: loadError } = await listFormDueTimes(organizationId)
      if (cancelled) return
      if (loadError) setError(loadError.message)
      setDueTimes(data ?? [])
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId, template])

  if (!templateTakesDueBy(template)) return null
  if (loading) return <PageMuted>Loading due-by time…</PageMuted>

  const orgRow = ownRow(dueTimes, null, template.id)
  const { dueBy, source } = dueByFor(template, null, orgRow ? [orgRow] : [])

  async function save(value) {
    setError('')
    const { data, error: saveError } = await setFormDueTime(
      organizationId,
      null,
      template.id,
      value,
    )
    if (saveError) {
      setError(saveError.message)
      return
    }
    setDueTimes((current) => [...withoutRow(current, null, template.id), data])
  }

  async function clear() {
    setError('')
    const { error: clearError } = await clearFormDueTime(organizationId, null, template.id)
    if (clearError) {
      setError(clearError.message)
      return
    }
    setDueTimes((current) => withoutRow(current, null, template.id))
  }

  const inputId = `due-by-${template.id}`
  return (
    <div className="space-y-2 border-b border-border pb-4">
      <label htmlFor={inputId} className="block text-sm font-medium">
        Due by (all sites)
      </label>
      <p className="text-sm text-muted-foreground">
        {dueSummary(dueBy, source)}. Shows as Overdue after this time; a site can set its own in
        its site settings.
      </p>
      <PageError>{error}</PageError>
      <DueTimeEditor
        key={`${orgRow?.due_by || ''}|${dueBy || ''}`}
        inputId={inputId}
        current={dueBy}
        own={orgRow?.due_by || ''}
        onSave={save}
        onClear={clear}
        clearLabel={template.default_due_by ? 'Use RoadToComply default' : 'Remove time'}
      />
    </div>
  )
}

// Per-site times for every daily form that applies at this site.
export function SiteFormDueTimes({ organizationId, siteId, disabled = false }) {
  const [templates, setTemplates] = useState([])
  const [dueTimes, setDueTimes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!organizationId || !siteId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const [templatesResult, exclusionsResult, dueTimesResult] = await Promise.all([
        listFormTemplates(),
        listFormSiteExclusions(organizationId),
        listFormDueTimes(organizationId),
      ])
      if (cancelled) return
      const loadError = firstError(templatesResult, exclusionsResult, dueTimesResult)
      if (loadError) {
        setError(loadError.message)
        setTemplates([])
        setDueTimes([])
        setLoading(false)
        return
      }
      const exclusions = exclusionsResult.data ?? []
      setTemplates(
        (templatesResult.data ?? []).filter(
          (template) =>
            templateTakesDueBy(template) &&
            !isFormSiteExcluded(exclusions, siteId, template.id),
        ),
      )
      setDueTimes(dueTimesResult.data ?? [])
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId, siteId])

  async function save(template, value) {
    setError('')
    const { data, error: saveError } = await setFormDueTime(
      organizationId,
      siteId,
      template.id,
      value,
    )
    if (saveError) {
      setError(saveError.message)
      return
    }
    setDueTimes((current) => [...withoutRow(current, siteId, template.id), data])
  }

  async function clear(template) {
    setError('')
    const { error: clearError } = await clearFormDueTime(organizationId, siteId, template.id)
    if (clearError) {
      setError(clearError.message)
      return
    }
    setDueTimes((current) => withoutRow(current, siteId, template.id))
  }

  return (
    <FormSection
      title="Form due-by times"
      description="Daily forms show as Overdue on the floor page and in Forms after this time (Sydney time)."
    >
      <PageError>{error}</PageError>
      {loading ? (
        <PageMuted>Loading due-by times…</PageMuted>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No daily forms apply to this site.</p>
      ) : (
        <ul className="divide-y divide-border">
          {templates.map((template) => {
            const { dueBy, source } = dueByFor(template, siteId, dueTimes)
            const siteRow = ownRow(dueTimes, siteId, template.id)
            const inputId = `site-due-by-${template.id}`
            return (
              <li key={template.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div>
                  <label htmlFor={inputId} className="font-medium">
                    {template.name}
                  </label>
                  <p className="text-sm text-muted-foreground">{dueSummary(dueBy, source)}</p>
                </div>
                <DueTimeEditor
                  key={`${siteRow?.due_by || ''}|${dueBy || ''}`}
                  inputId={inputId}
                  current={dueBy}
                  own={siteRow?.due_by || ''}
                  onSave={(value) => save(template, value)}
                  onClear={() => clear(template)}
                  clearLabel="Use organisation time"
                  disabled={disabled}
                />
              </li>
            )
          })}
        </ul>
      )}
    </FormSection>
  )
}
