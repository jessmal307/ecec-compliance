// Checklist Yes / No / N/A. Shared by the app, the floor page, and site-forms.
// Items without answers: "yes_no_na" stay boolean checkboxes.
import { addDaysIso } from './sydneyTime.js'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function checklistItemType(item) {
  return item?.answers === 'yes_no_na' ? 'yes_no_na' : 'checkbox'
}

export function yesNoNaAnswered(value) {
  return value === 'yes' || value === 'no' || value === 'na'
}

function noteText(notes, id) {
  const value = notes?.[id]
  return typeof value === 'string' ? value.trim() : ''
}

export function yesNoNaErrors(schema, values, notes) {
  const errors = []
  const items = Array.isArray(schema?.items) ? schema.items : []
  for (const item of items) {
    if (item?.answers !== 'yes_no_na') continue
    const label = item.label || 'this item'
    const value = values?.[item.id]
    if (item.required && !yesNoNaAnswered(value)) {
      errors.push(`Choose Yes, No, or N/A for ${label}.`)
      continue
    }
    if (value === 'no' && !noteText(notes, item.id)) {
      errors.push(`Enter the action taken for ${label}.`)
    }
  }
  return errors
}

export function defaultActionDueDate(submissionDate) {
  const day = String(submissionDate ?? '').slice(0, 10)
  if (!ISO_DATE.test(day)) return null
  return addDaysIso(day, 7)
}

export function actionHasOwner(action) {
  return Boolean(action?.owner_staff_id) || String(action?.owner_name ?? '').trim() !== ''
}

export function actionIsOverdue(action, today) {
  const due = String(action?.due_date ?? '').slice(0, 10)
  return action?.status === 'open' && ISO_DATE.test(due) && ISO_DATE.test(today) && due < today
}

export function evidenceActionErrors(actions) {
  const errors = []
  for (const row of actions ?? []) {
    const description = String(row?.description ?? '').trim()
    const required = String(row?.action_required ?? '').trim()
    const touched =
      description ||
      required ||
      row?.owner_staff_id ||
      String(row?.owner_name ?? '').trim() ||
      row?.due_date ||
      row?.added_to_qip
    if (!touched) continue
    if (!description) errors.push('Enter a description for each action.')
  }
  return [...new Set(errors)]
}
