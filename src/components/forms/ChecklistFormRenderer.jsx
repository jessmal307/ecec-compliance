import { Choice, ChoiceRow, DateInput, Field, Input, Select, Textarea } from '../ui/form'
import { FormFieldControl } from './FormFields'
import { SignaturePad } from './SignaturePad'
import { defaultActionDueDate } from '../../lib/formAnswers'
import { todayIsoDate } from '../../lib/compliance'

const ANSWERS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'na', label: 'N/A' },
]

function YesNoNaItem({
  item,
  value,
  note,
  detail,
  staff,
  showActionFields,
  readOnly,
  onChange,
  onNoteChange,
  onDetailChange,
}) {
  function choose(next) {
    onChange(next)
    if (next === 'no' && showActionFields && !detail?.due_date) {
      onDetailChange({ due_date: defaultActionDueDate(todayIsoDate()) })
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-base font-medium text-card-foreground">
        {item.label}
        {item.required ? (
          <span className="font-normal text-muted-foreground"> (required)</span>
        ) : null}
      </p>
      <ChoiceRow>
        {ANSWERS.map((answer) => (
          <Choice
            key={answer.value}
            type="radio"
            name={item.id}
            value={answer.value}
            checked={value === answer.value}
            onChange={() => choose(answer.value)}
            disabled={readOnly}
          >
            {answer.label}
          </Choice>
        ))}
      </ChoiceRow>
      {value === 'no' ? (
        <div className="space-y-3">
          <Field label="Action taken (required)">
            <Textarea
              value={note ?? ''}
              onChange={(event) => onNoteChange(event.target.value)}
              disabled={readOnly}
              readOnly={readOnly}
            />
          </Field>
          {showActionFields ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Owner">
                <Select
                  value={detail?.owner_staff_id || ''}
                  onChange={(event) =>
                    onDetailChange({
                      owner_staff_id: event.target.value,
                      owner_name: event.target.value ? '' : detail?.owner_name || '',
                    })
                  }
                  disabled={readOnly}
                >
                  <option value="">No one assigned</option>
                  {(staff ?? []).map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Or type a name">
                <Input
                  value={detail?.owner_staff_id ? '' : detail?.owner_name || ''}
                  onChange={(event) =>
                    onDetailChange({
                      owner_name: event.target.value,
                      owner_staff_id: '',
                    })
                  }
                  disabled={readOnly || Boolean(detail?.owner_staff_id)}
                />
              </Field>
              <Field label="Due date" hint="Defaults to 7 days after this is submitted.">
                <DateInput
                  value={detail?.due_date || ''}
                  onChange={(event) => onDetailChange({ due_date: event.target.value })}
                  disabled={readOnly}
                />
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function ChecklistFormRenderer({
  schema,
  values,
  notes,
  signoff,
  actionDetails = {},
  staff = [],
  showActionFields = false,
  onChange,
  onNoteChange,
  onActionDetailChange,
  onSignoffChange,
  readOnly = false,
  signatureUrls = {},
}) {
  const items = Array.isArray(schema?.items) ? schema.items : []
  const signoffRequired = Boolean(schema?.signoff?.required)
  const showSignature = signoffRequired && schema?.signoff?.signature !== false

  return (
    <div className="space-y-5">
      {items.length === 0 ? (
        <p className="text-base text-muted-foreground md:text-sm">
          This checklist has no items yet.
        </p>
      ) : (
        items.map((item) =>
          item.answers === 'yes_no_na' ? (
            <YesNoNaItem
              key={item.id || item.label}
              item={item}
              value={values[item.id]}
              note={notes[item.id]}
              detail={actionDetails[item.id]}
              staff={staff}
              showActionFields={showActionFields && !readOnly}
              readOnly={readOnly}
              onChange={(next) => onChange(item.id, next)}
              onNoteChange={(next) => onNoteChange(item.id, next)}
              onDetailChange={(patch) => onActionDetailChange?.(item.id, patch)}
            />
          ) : (
            <FormFieldControl
              key={item.id || item.label}
              field={{ ...item, type: 'checkbox' }}
              value={values[item.id]}
              note={notes[item.id]}
              onChange={(next) => onChange(item.id, next)}
              onNoteChange={(next) => onNoteChange(item.id, next)}
              readOnly={readOnly}
            />
          ),
        )
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
              disabled={readOnly}
              readOnly={readOnly}
            />
          </Field>
          {showSignature ? (
            <Field label="Signature (required)">
              <SignaturePad
                label="Signature"
                value={signoff.signature ?? ''}
                required
                onChange={(next) =>
                  onSignoffChange({ ...signoff, signature: next })
                }
                readOnly={readOnly}
                imageUrl={signatureUrls.signoff}
              />
            </Field>
          ) : null}
          <Field label="Date (required)">
            <DateInput
              value={signoff.date}
              onChange={(event) =>
                onSignoffChange({ ...signoff, date: event.target.value })
              }
              disabled={readOnly}
              readOnly={readOnly}
            />
          </Field>
          {schema?.signoff?.note ? (
            <Field label="Note" className="font-normal">
              <Textarea
                value={signoff.note}
                onChange={(event) =>
                  onSignoffChange({ ...signoff, note: event.target.value })
                }
                disabled={readOnly}
                readOnly={readOnly}
              />
            </Field>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
