import { useState } from 'react'
import { ChecklistFormRenderer } from './ChecklistFormRenderer'
import { emptyHazardRow, RiskMatrixFormRenderer } from './RiskMatrixFormRenderer'
import { SimpleFormRenderer } from './SimpleFormRenderer'

const EMPTY_SIGNOFF = { name: '', date: '', note: '' }

export function FormRenderer({ archetype, schema }) {
  const [values, setValues] = useState({})
  const [notes, setNotes] = useState({})
  const [signoff, setSignoff] = useState(EMPTY_SIGNOFF)
  const [rows, setRows] = useState([emptyHazardRow()])

  function handleChange(id, next) {
    setValues((current) => ({ ...current, [id]: next }))
  }

  function handleNoteChange(id, next) {
    setNotes((current) => ({ ...current, [id]: next }))
  }

  if (archetype === 'checklist') {
    return (
      <ChecklistFormRenderer
        schema={schema}
        values={values}
        notes={notes}
        signoff={signoff}
        onChange={handleChange}
        onNoteChange={handleNoteChange}
        onSignoffChange={setSignoff}
      />
    )
  }

  if (archetype === 'risk_matrix') {
    return (
      <RiskMatrixFormRenderer schema={schema} rows={rows} onChange={setRows} />
    )
  }

  return (
    <SimpleFormRenderer
      schema={schema}
      values={values}
      notes={notes}
      onChange={handleChange}
      onNoteChange={handleNoteChange}
    />
  )
}
