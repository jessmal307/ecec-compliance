import { useState } from 'react'
import { emptyFormState } from '../../lib/forms'
import { ChecklistFormRenderer } from './ChecklistFormRenderer'
import { emptyHazardRow, RiskMatrixFormRenderer } from './RiskMatrixFormRenderer'
import { SimpleFormRenderer } from './SimpleFormRenderer'

export function FormRenderer({
  archetype,
  schema,
  state,
  onStateChange,
  readOnly = false,
  signatureUrls = {},
  staff = [],
  showActionFields = false,
}) {
  const [internal, setInternal] = useState(() => ({
    ...emptyFormState(),
    rows: [emptyHazardRow()],
  }))
  const current = state ?? internal

  function setCurrent(next) {
    if (onStateChange) onStateChange(next)
    else setInternal(next)
  }

  function handleChange(id, next) {
    setCurrent({ ...current, values: { ...current.values, [id]: next } })
  }

  function handleNoteChange(id, next) {
    setCurrent({ ...current, notes: { ...current.notes, [id]: next } })
  }

  function handleActionDetail(id, patch) {
    const details = current.actionDetails || {}
    setCurrent({
      ...current,
      actionDetails: {
        ...details,
        [id]: { ...details[id], ...patch },
      },
    })
  }

  if (archetype === 'evidence') return null

  if (archetype === 'checklist') {
    return (
      <ChecklistFormRenderer
        schema={schema}
        values={current.values}
        notes={current.notes}
        signoff={current.signoff}
        actionDetails={current.actionDetails}
        staff={staff}
        showActionFields={showActionFields}
        onChange={handleChange}
        onNoteChange={handleNoteChange}
        onActionDetailChange={handleActionDetail}
        onSignoffChange={(signoff) => setCurrent({ ...current, signoff })}
        readOnly={readOnly}
        signatureUrls={signatureUrls}
      />
    )
  }

  if (archetype === 'risk_matrix') {
    return (
      <RiskMatrixFormRenderer
        schema={schema}
        rows={current.rows ?? []}
        values={current.values}
        notes={current.notes}
        onChange={(rows) => setCurrent({ ...current, rows })}
        onFieldChange={handleChange}
        onNoteChange={handleNoteChange}
        readOnly={readOnly}
        signatureUrls={signatureUrls}
      />
    )
  }

  return (
    <SimpleFormRenderer
      schema={schema}
      values={current.values}
      notes={current.notes}
      onChange={handleChange}
      onNoteChange={handleNoteChange}
      readOnly={readOnly}
      signatureUrls={signatureUrls}
    />
  )
}
