import {
  Choice,
  ChoiceRow,
  DateInput,
  Field,
  Input,
  Select,
  Textarea,
} from '../ui/form'
import { SignaturePad } from './SignaturePad'

function fieldOptions(field) {
  return (field.options ?? []).map((option) =>
    typeof option === 'string'
      ? { value: option, label: option }
      : { value: option.value, label: option.label ?? option.value },
  )
}

export function FormFieldControl({
  field,
  value,
  note,
  onChange,
  onNoteChange,
  readOnly = false,
  signatureUrl = '',
}) {
  const requiredMark = field.required ? (
    <span className="font-normal text-muted-foreground"> (required)</span>
  ) : null
  const label = (
    <>
      {field.label}
      {requiredMark}
    </>
  )
  const help = field.help || field.helpText || field.hint
  const options = fieldOptions(field)

  let control = null

  if (field.type === 'textarea') {
    control = (
      <Textarea
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        disabled={readOnly}
        readOnly={readOnly}
      />
    )
  } else if (field.type === 'number') {
    control = (
      <Input
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        disabled={readOnly}
        readOnly={readOnly}
      />
    )
  } else if (field.type === 'date') {
    control = (
      <DateInput
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        disabled={readOnly}
        readOnly={readOnly}
      />
    )
  } else if (field.type === 'checkbox') {
    control = (
      <Choice
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
        required={field.required}
        disabled={readOnly}
      >
        {field.label}
        {requiredMark}
      </Choice>
    )
  } else if (field.type === 'select') {
    control = (
      <Select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        disabled={readOnly}
      >
        <option value="">Select…</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    )
  } else if (field.type === 'signature') {
    control = (
      <SignaturePad
        label={field.label || 'Signature'}
        value={typeof value === 'string' ? value : ''}
        onChange={onChange}
        required={field.required}
        readOnly={readOnly}
        imageUrl={signatureUrl}
      />
    )
  } else if (field.type === 'radio') {
    control = (
      <ChoiceRow>
        {options.map((option) => (
          <Choice
            key={option.value}
            type="radio"
            name={field.id}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            required={field.required}
            disabled={readOnly}
          >
            {option.label}
          </Choice>
        ))}
      </ChoiceRow>
    )
  } else {
    control = (
      <Input
        type="text"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        disabled={readOnly}
        readOnly={readOnly}
      />
    )
  }

  return (
    <div className="space-y-2">
      {field.type === 'checkbox' ? (
        <div className="text-base font-medium text-card-foreground">{control}</div>
      ) : (
        <Field label={label} hint={help}>
          {control}
        </Field>
      )}
      {field.type === 'checkbox' && help ? (
        <p className="text-xs font-normal text-muted-foreground">{help}</p>
      ) : null}
      {field.allowsNote ? (
        <Field label="Note" className="font-normal">
          <Textarea
            value={note ?? ''}
            onChange={(event) => onNoteChange(event.target.value)}
            className="min-h-20"
            disabled={readOnly}
            readOnly={readOnly}
          />
        </Field>
      ) : null}
    </div>
  )
}
