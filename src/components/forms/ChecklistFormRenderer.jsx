import { DateInput, Field, Input, Textarea } from '../ui/form'
import { FormFieldControl } from './FormFields'

export function ChecklistFormRenderer({
  schema,
  values,
  notes,
  signoff,
  onChange,
  onNoteChange,
  onSignoffChange,
}) {
  const items = Array.isArray(schema?.items) ? schema.items : []
  const signoffRequired = Boolean(schema?.signoff?.required)

  return (
    <div className="space-y-5">
      {items.length === 0 ? (
        <p className="text-base text-muted-foreground md:text-sm">
          This checklist has no items yet.
        </p>
      ) : (
        items.map((item) => (
          <FormFieldControl
            key={item.id || item.label}
            field={{ ...item, type: 'checkbox' }}
            value={values[item.id]}
            note={notes[item.id]}
            onChange={(next) => onChange(item.id, next)}
            onNoteChange={(next) => onNoteChange(item.id, next)}
          />
        ))
      )}

      {signoffRequired ? (
        <div className="space-y-4 border-t border-border pt-5">
          <h3 className="text-sm font-medium text-card-foreground">Sign-off</h3>
          <Field label="Name (required)">
            <Input
              type="text"
              autoComplete="name"
              value={signoff.name}
              onChange={(event) =>
                onSignoffChange({ ...signoff, name: event.target.value })
              }
            />
          </Field>
          <Field label="Date (required)">
            <DateInput
              value={signoff.date}
              onChange={(event) =>
                onSignoffChange({ ...signoff, date: event.target.value })
              }
            />
          </Field>
          {schema?.signoff?.note ? (
            <Field label="Note" className="font-normal">
              <Textarea
                value={signoff.note}
                onChange={(event) =>
                  onSignoffChange({ ...signoff, note: event.target.value })
                }
              />
            </Field>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
