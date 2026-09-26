import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Select } from '../ui/form'
import { PageError } from '../ui/page'
import { FormDueByDefault } from './FormDueTimes'
import { FormSiteExclusions } from './FormSiteExclusions'
import { templateTakesDueBy } from '../../lib/formDueTimes'
import { normalizeCadenceMonths } from '../../lib/formPeriods'
import {
  archetypeLabel,
  cadenceLabel,
  isScheduledAllSitesTemplate,
  saveFormOrgSchedule,
} from '../../lib/forms'
import { scheduleEnabled } from '../../lib/formSchedule'
import { paths } from '../../lib/paths'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function monthsText(months) {
  const normalized = normalizeCadenceMonths(months)
  if (!normalized.length) return ''
  return normalized.map((month) => MONTHS[month - 1]).join(' and ')
}

export function FormLibraryCard({ organizationId, template, schedule, onSchedule }) {
  const enabled = scheduleEnabled(template, schedule)
  const usingDefault = !schedule?.cadence_months?.length
  const shownMonths = usingDefault ? template.cadence_months : schedule.cadence_months
  const [monthA, setMonthA] = useState(shownMonths?.[0] ? String(shownMonths[0]) : '')
  const [monthB, setMonthB] = useState(shownMonths?.[1] ? String(shownMonths[1]) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const anchored = template.cadence === 'half_yearly' || template.cadence === 'annually'
  const scheduled = isScheduledAllSitesTemplate(template)

  async function persist(nextEnabled, cadenceMonths) {
    setSaving(true)
    setError('')
    const { data, error: saveError } = await saveFormOrgSchedule(organizationId, template.id, {
      enabled: nextEnabled,
      cadenceMonths,
    })
    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    onSchedule(data)
  }

  async function saveMonths(event) {
    event.preventDefault()
    const first = Number(monthA)
    const second = Number(monthB)
    if (template.cadence === 'annually') {
      if (!first) {
        setError('Choose a month.')
        return
      }
      await persist(enabled, [first])
      return
    }
    if (!first || !second || first === second) {
      setError('Choose two different months.')
      return
    }
    await persist(enabled, [first, second].sort((left, right) => left - right))
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{template.name}</CardTitle>
          <Badge variant="outline">{archetypeLabel(template.archetype)}</Badge>
          {template.cadence ? <Badge variant="outline">{cadenceLabel(template.cadence)}</Badge> : null}
          {template.quality_area ? <Badge variant="outline">QA {template.quality_area}</Badge> : null}
          {template.nqs_refs?.length ? (
            <Badge variant="outline">NQS {template.nqs_refs.join(', ')}</Badge>
          ) : null}
          {monthsText(shownMonths) ? <Badge variant="outline">{monthsText(shownMonths)}</Badge> : null}
          {!enabled ? <Badge variant="outline">Off</Badge> : null}
        </div>
        {template.completed_by ? (
          <CardDescription>Completed by {template.completed_by}</CardDescription>
        ) : null}
        {template.description ? <CardDescription>{template.description}</CardDescription> : null}
        <div className="flex flex-wrap gap-2 pt-2">
          {enabled ? (
            <Button asChild>
              <Link to={paths.formComplete(template.id)}>Complete</Link>
            </Button>
          ) : null}
          {template.archetype !== 'evidence' ? (
            <Button asChild variant="outline">
              <Link to={paths.formPreview(template.id)}>Preview</Link>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => persist(!enabled, schedule?.cadence_months ?? null)}
          >
            {enabled ? 'Turn off' : 'Turn on'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <PageError>{error}</PageError>
        {anchored ? (
          <form className="space-y-3" onSubmit={saveMonths}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={template.cadence === 'annually' ? 'Month' : 'First month'}>
                <Select value={monthA} onChange={(event) => setMonthA(event.target.value)} disabled={saving}>
                  <option value="">Choose…</option>
                  {MONTHS.map((name, index) => (
                    <option key={name} value={String(index + 1)}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
              {template.cadence === 'half_yearly' ? (
                <Field label="Second month">
                  <Select value={monthB} onChange={(event) => setMonthB(event.target.value)} disabled={saving}>
                    <option value="">Choose…</option>
                    {MONTHS.map((name, index) => (
                      <option key={name} value={String(index + 1)}>
                        {name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" variant="outline" disabled={saving}>
                Save months
              </Button>
              {!usingDefault ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={() => {
                    const library = template.cadence_months ?? []
                    setMonthA(library[0] ? String(library[0]) : '')
                    setMonthB(library[1] ? String(library[1]) : '')
                    persist(enabled, null)
                  }}
                >
                  Use library months
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
        {scheduled && enabled && templateTakesDueBy(template) ? (
          <FormDueByDefault organizationId={organizationId} template={template} />
        ) : null}
        {scheduled ? (
          <FormSiteExclusions organizationId={organizationId} templateId={template.id} />
        ) : null}
      </CardContent>
    </Card>
  )
}
