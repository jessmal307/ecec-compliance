import { FormFieldControl } from './FormFields'

export function schemaFields(schema) {
  if (Array.isArray(schema?.fields)) return schema.fields
  if (Array.isArray(schema?.items)) return schema.items
  return []
}

export function SimpleFormRenderer({
  schema,
  values,
  notes,
  onChange,
  onNoteChange,
  readOnly = false,
  signatureUrls = {},
}) {
  const fields = schemaFields(schema)

  if (fields.length === 0) {
    return (
      <p className="text-base text-muted-foreground md:text-sm">
        This template has no fields yet.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {fields.map((field) => (
        <FormFieldControl
          key={field.id || field.label}
          field={field}
          value={values[field.id]}
          note={notes[field.id]}
          onChange={(next) => onChange(field.id, next)}
          onNoteChange={(next) => onNoteChange(field.id, next)}
          readOnly={readOnly}
          signatureUrl={signatureUrls[field.id]}
        />
      ))}
    </div>
  )
}
