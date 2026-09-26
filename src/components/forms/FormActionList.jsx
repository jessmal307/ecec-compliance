import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DateInput, Field, Input, Select, Textarea } from '../ui/form'
import { actionHasOwner, actionIsOverdue } from '../../lib/formAnswers'
import { actionOwnerLabel, closeFormAction, updateFormAction } from '../../lib/formActions'
import { todayIsoDate } from '../../lib/compliance'
import { formatDate } from '../../lib/format'
import { paths } from '../../lib/paths'

function namedAction(action, staff, sites) {
  const owner = staff.find((member) => member.id === action.owner_staff_id)
  const site = sites.find((row) => row.id === action.site_id)
  return {
    ...action,
    owner_staff_name: owner?.name || action.owner_staff_name || '',
    site_name: site?.name || action.site_name || '',
  }
}

export function FormActionList({
  actions,
  staff,
  sites = [],
  showSite = false,
  onChanged,
  onError,
}) {
  const today = todayIsoDate()
  const [closingId, setClosingId] = useState('')
  const [note, setNote] = useState('')
  const [savingId, setSavingId] = useState('')

  async function save(id, fields) {
    setSavingId(id)
    const { data, error } = await updateFormAction(id, fields)
    setSavingId('')
    if (error) {
      onError?.(error.message)
      return
    }
    onChanged?.(data)
  }

  async function close(id) {
    if (!note.trim()) {
      onError?.('Enter a note to close this action.')
      return
    }
    setSavingId(id)
    const { data, error } = await closeFormAction(id, note)
    setSavingId('')
    if (error) {
      onError?.(error.message)
      return
    }
    setClosingId('')
    setNote('')
    onChanged?.(data)
  }

  if (!actions.length) {
    return <p className="text-sm text-muted-foreground">No actions.</p>
  }

  return (
    <ul className="flex flex-col gap-3">
      {actions.map((raw) => {
        const action = namedAction(raw, staff, sites)
        const overdue = actionIsOverdue(action, today)
        const unassigned = !actionHasOwner(action)
        return (
          <li key={action.id} className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-card-foreground">{action.description}</p>
              {action.status === 'closed' ? <Badge variant="outline">Closed</Badge> : null}
              {overdue ? <Badge variant="outline">Overdue</Badge> : null}
              {unassigned && action.status === 'open' ? <Badge variant="outline">Unassigned</Badge> : null}
              {action.added_to_qip ? <Badge variant="outline">QIP</Badge> : null}
              {action.quality_area ? <Badge variant="outline">QA {action.quality_area}</Badge> : null}
            </div>
            {showSite && action.site_name ? (
              <p className="text-sm text-muted-foreground">
                <Link to={paths.siteProfile(action.site_id)} className="underline underline-offset-2">
                  {action.site_name}
                </Link>
              </p>
            ) : null}
            {action.action_required ? (
              <p className="text-sm whitespace-pre-wrap">{action.action_required}</p>
            ) : null}
            {action.status === 'closed' && action.closed_note ? (
              <p className="text-sm text-muted-foreground">Closed: {action.closed_note}</p>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Owner">
                <Select
                  value={action.owner_staff_id || ''}
                  disabled={savingId === action.id}
                  onChange={(event) =>
                    save(action.id, {
                      ownerStaffId: event.target.value,
                      ownerName: event.target.value ? '' : action.owner_name,
                    })
                  }
                >
                  <option value="">Unassigned</option>
                  {staff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Or type a name">
                <Input
                  key={`${action.id}:${action.owner_name}`}
                  defaultValue={action.owner_staff_id ? '' : action.owner_name || ''}
                  disabled={savingId === action.id || Boolean(action.owner_staff_id)}
                  onBlur={(event) => {
                    const next = event.target.value.trim()
                    if (next === String(action.owner_name || '').trim()) return
                    save(action.id, { ownerName: next, ownerStaffId: '' })
                  }}
                />
              </Field>
              <Field label="Due date">
                <DateInput
                  value={action.due_date || ''}
                  disabled={savingId === action.id}
                  onChange={(event) => save(action.id, { dueDate: event.target.value })}
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              {actionOwnerLabel(action)}
              {action.due_date ? ` · due ${formatDate(action.due_date)}` : ''}
            </p>
            {action.status === 'open' ? (
              closingId === action.id ? (
                <div className="space-y-2">
                  <Field label="Note to close">
                    <Textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      disabled={savingId === action.id}
                    />
                  </Field>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={savingId === action.id}
                      onClick={() => close(action.id)}
                    >
                      Close action
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setClosingId('')
                        setNote('')
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setClosingId(action.id)
                    setNote('')
                  }}
                >
                  Close
                </Button>
              )
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
