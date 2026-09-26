import { DateInput, Field, Input, Select, Textarea } from '../ui/form'
import { Button } from '@/components/ui/button'

export function emptyAuditAction() {
  return {
    description: '',
    action_required: '',
    owner_staff_id: '',
    owner_name: '',
    due_date: '',
    added_to_qip: false,
  }
}

export function AuditActionsEditor({ actions, staff, disabled, onChange }) {
  function update(index, patch) {
    onChange(actions.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-card-foreground">Actions from this audit</h3>
        <p className="text-xs text-muted-foreground">
          Add the action-plan rows from this audit. They stay editable after you submit.
        </p>
      </div>
      {actions.map((row, index) => (
        <div key={index} className="space-y-3 rounded-lg border border-border p-3">
          <Field label="Description">
            <Input
              value={row.description}
              onChange={(event) => update(index, { description: event.target.value })}
              disabled={disabled}
            />
          </Field>
          <Field label="Action required">
            <Textarea
              value={row.action_required}
              onChange={(event) => update(index, { action_required: event.target.value })}
              disabled={disabled}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Owner">
              <Select
                value={row.owner_staff_id || ''}
                onChange={(event) =>
                  update(index, {
                    owner_staff_id: event.target.value,
                    owner_name: event.target.value ? '' : row.owner_name,
                  })
                }
                disabled={disabled}
              >
                <option value="">No one assigned</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Or type a name">
              <Input
                value={row.owner_staff_id ? '' : row.owner_name || ''}
                onChange={(event) =>
                  update(index, { owner_name: event.target.value, owner_staff_id: '' })
                }
                disabled={disabled || Boolean(row.owner_staff_id)}
              />
            </Field>
            <Field label="Due date">
              <DateInput
                value={row.due_date || ''}
                onChange={(event) => update(index, { due_date: event.target.value })}
                disabled={disabled}
              />
            </Field>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(row.added_to_qip)}
              onChange={(event) => update(index, { added_to_qip: event.target.checked })}
              disabled={disabled}
            />
            Added to QIP
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onChange(actions.filter((_, rowIndex) => rowIndex !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => onChange([...actions, emptyAuditAction()])}
      >
        Add an action
      </Button>
    </div>
  )
}
