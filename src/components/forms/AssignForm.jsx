import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { DateInput, Field, FormActions, Input, Select } from '../ui/form'
import { PageError } from '../ui/page'
import { todayIsoDate } from '../../lib/compliance'
import {
  createAssignment,
  FORM_CADENCES,
  FORM_MEMBER_ROLES,
  FORM_TARGET_TYPES,
} from '../../lib/forms'
import { firstError } from '../../lib/query'
import { listSites } from '../../lib/sites'
import { isActiveStaff, listStaff } from '../../lib/staff'

const EMPTY_FORM = {
  target_type: 'site',
  target_id: '',
  target_role: '',
  cadence: 'once',
  next_due: '',
}

export function AssignForm({ organizationId, template, onCancel, onSaved }) {
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    next_due: todayIsoDate(),
  })
  const [sites, setSites] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const [sitesResult, staffResult] = await Promise.all([
        listSites(organizationId),
        listStaff(organizationId),
      ])
      if (cancelled) return
      const loadError = firstError(sitesResult, staffResult)
      if (loadError) {
        setError(loadError.message)
        setLoading(false)
        return
      }
      setSites(sitesResult.data ?? [])
      setStaff((staffResult.data ?? []).filter(isActiveStaff))
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId])

  const roleOptions = useMemo(() => {
    const fromStaff = staff.map((member) => member.role).filter(Boolean)
    return [...new Set([...FORM_MEMBER_ROLES, ...fromStaff])]
  }, [staff])

  const recurring = form.cadence !== 'once'
  const dateLabel = recurring ? 'Start date' : 'Due date'
  const busy = loading || saving || !organizationId || !template

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (form.target_type === 'site' && !form.target_id) {
      setError('Choose a site.')
      return
    }
    if (form.target_type === 'staff' && !form.target_id) {
      setError('Choose a staff member.')
      return
    }
    if (form.target_type === 'role' && !form.target_role.trim()) {
      setError('Enter a role.')
      return
    }
    if (form.cadence === 'once' && !form.next_due) {
      setError('Choose a due date.')
      return
    }

    setSaving(true)
    const { error: saveError } = await createAssignment(organizationId, {
      template_id: template.id,
      target_type: form.target_type,
      target_id: form.target_id,
      target_role: form.target_role,
      cadence: form.cadence,
      next_due: form.next_due || todayIsoDate(),
    })
    setSaving(false)

    if (saveError) {
      setError(saveError.message)
      return
    }

    onSaved?.()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assign {template?.name}</CardTitle>
        <CardDescription>
          Choose who this is for and how often it should be completed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Field label="Assign to">
            <Select
              value={form.target_type}
              onChange={(event) => {
                setForm((current) => ({
                  ...current,
                  target_type: event.target.value,
                  target_id: '',
                  target_role: '',
                }))
              }}
              disabled={busy}
            >
              {FORM_TARGET_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          {form.target_type === 'site' ? (
            <Field label="Site">
              <Select
                value={form.target_id}
                onChange={(event) => setField('target_id', event.target.value)}
                disabled={busy}
              >
                <option value="">Select a site…</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {form.target_type === 'staff' ? (
            <Field label="Staff">
              <Select
                value={form.target_id}
                onChange={(event) => setField('target_id', event.target.value)}
                disabled={busy}
              >
                <option value="">Select staff…</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {form.target_type === 'role' ? (
            <Field label="Role">
              <Input
                list="form-assignment-roles"
                value={form.target_role}
                onChange={(event) => setField('target_role', event.target.value)}
                placeholder="e.g. Nominated Supervisor"
                disabled={busy}
              />
              <datalist id="form-assignment-roles">
                {roleOptions.map((role) => (
                  <option key={role} value={role} />
                ))}
              </datalist>
            </Field>
          ) : null}

          <Field label="Cadence">
            <Select
              value={form.cadence}
              onChange={(event) => setField('cadence', event.target.value)}
              disabled={busy}
            >
              {FORM_CADENCES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={`${dateLabel}${form.cadence === 'once' ? ' (required)' : ''}`}
            hint={
              recurring
                ? 'Defaults to today. This becomes the next due date.'
                : null
            }
          >
            <DateInput
              value={form.next_due}
              onChange={(event) => setField('next_due', event.target.value)}
              required={form.cadence === 'once'}
              disabled={busy}
            />
          </Field>

          <PageError>{error}</PageError>
          <FormActions>
            <Button type="submit" disabled={busy}>
              {saving ? 'Assigning…' : 'Assign'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onCancel}
            >
              Cancel
            </Button>
          </FormActions>
        </form>
      </CardContent>
    </Card>
  )
}
