import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useFormsAccess } from '../Forms'
import { DateInput, Field, Input, Select, Textarea } from '../ui/form'
import { PageError } from '../ui/page'
import { actionHasOwner, actionIsOverdue } from '../../lib/formAnswers'
import { actionCountLabel, createFormAction, listFormActions } from '../../lib/formActions'
import { todayIsoDate } from '../../lib/compliance'
import { paths } from '../../lib/paths'
import { listStaff } from '../../lib/staff'
import { FormActionList } from './FormActionList'

export function SiteOpenActions({ organizationId, siteId }) {
  const { allowed, loading: accessLoading } = useFormsAccess()
  const [actions, setActions] = useState([])
  const [staff, setStaff] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState({
    description: '',
    actionRequired: '',
    ownerStaffId: '',
    ownerName: '',
    dueDate: '',
  })

  useEffect(() => {
    if (accessLoading || !allowed || !organizationId || !siteId) return
    let cancelled = false

    async function load() {
      const [actionsResult, staffResult] = await Promise.all([
        listFormActions(organizationId, { siteId, status: 'open' }),
        listStaff(organizationId),
      ])
      if (cancelled) return
      if (actionsResult.error || staffResult.error) {
        setError((actionsResult.error || staffResult.error).message)
        return
      }
      setActions(actionsResult.data)
      setStaff(staffResult.data ?? [])
    }

    load()
    return () => {
      cancelled = true
    }
  }, [accessLoading, allowed, organizationId, siteId])

  if (accessLoading || !allowed) return null

  const today = todayIsoDate()
  const counts = {
    open: actions.length,
    overdue: actions.filter((action) => actionIsOverdue(action, today)).length,
    unassigned: actions.filter((action) => !actionHasOwner(action)).length,
  }

  async function addAction(event) {
    event.preventDefault()
    if (!draft.description.trim()) {
      setError('Enter a description.')
      return
    }
    setSaving(true)
    setError('')
    const { data, error: saveError } = await createFormAction(organizationId, {
      siteId,
      description: draft.description,
      actionRequired: draft.actionRequired,
      ownerStaffId: draft.ownerStaffId,
      ownerName: draft.ownerName,
      dueDate: draft.dueDate,
    })
    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    setActions((current) => [...current, data])
    setDraft({ description: '', actionRequired: '', ownerStaffId: '', ownerName: '', dueDate: '' })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open actions</CardTitle>
        <p className="text-sm text-muted-foreground">
          {actionCountLabel(counts) || 'No open actions.'}{' '}
          <Link to={`${paths.actions}?site=${siteId}`} className="underline underline-offset-2">
            All actions
          </Link>
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <PageError>{error}</PageError>
        <FormActionList
          actions={actions}
          staff={staff}
          onError={setError}
          onChanged={(row) =>
            setActions((current) =>
              row.status === 'open'
                ? current.map((item) => (item.id === row.id ? row : item))
                : current.filter((item) => item.id !== row.id),
            )
          }
        />
        <form className="space-y-3 border-t border-border pt-4" onSubmit={addAction}>
          <Field label="New action">
            <Input
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              disabled={saving}
            />
          </Field>
          <Field label="Action required">
            <Textarea
              value={draft.actionRequired}
              onChange={(event) => setDraft({ ...draft, actionRequired: event.target.value })}
              disabled={saving}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Owner">
              <Select
                value={draft.ownerStaffId}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    ownerStaffId: event.target.value,
                    ownerName: event.target.value ? '' : draft.ownerName,
                  })
                }
                disabled={saving}
              >
                <option value="">Unassigned</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Due date">
              <DateInput
                value={draft.dueDate}
                onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
                disabled={saving}
              />
            </Field>
          </div>
          <Button type="submit" variant="outline" disabled={saving}>
            Add action
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
