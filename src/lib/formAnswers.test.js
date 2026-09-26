import assert from 'node:assert/strict'
import test from 'node:test'
import {
  actionHasOwner,
  actionIsOverdue,
  checklistItemType,
  defaultActionDueDate,
  evidenceActionErrors,
  yesNoNaErrors,
} from './formAnswers.js'

const yesNoSchema = {
  items: [
    { id: 'gates', label: 'Gates secure', type: 'checkbox', required: true },
    { id: 'sleep', label: 'Safe sleep', answers: 'yes_no_na', required: true },
  ],
}

test('existing checkbox items stay checkboxes', () => {
  assert.equal(checklistItemType({ id: 'gates', type: 'checkbox', required: true }), 'checkbox')
  assert.equal(checklistItemType({ id: 'sleep', answers: 'yes_no_na' }), 'yes_no_na')
  assert.deepEqual(yesNoNaErrors(yesNoSchema, { sleep: 'yes' }, {}), [])
})

test('a No requires the action taken note and Yes does not', () => {
  assert.deepEqual(
    yesNoNaErrors(yesNoSchema, { gates: true, sleep: 'no' }, {}),
    ['Enter the action taken for Safe sleep.'],
  )
  assert.deepEqual(
    yesNoNaErrors(yesNoSchema, { gates: true, sleep: 'yes' }, {}),
    [],
  )
  assert.deepEqual(
    yesNoNaErrors(yesNoSchema, { gates: true, sleep: 'na' }, { sleep: '   ' }),
    [],
  )
})

test('auto-raised actions are due 7 days after the submission', () => {
  assert.equal(defaultActionDueDate('2026-09-26'), '2026-10-03')
  assert.equal(defaultActionDueDate('2026-01-31T10:00:00Z'), '2026-02-07')
})

test('unassigned and overdue are separate', () => {
  const open = { status: 'open', due_date: '2026-09-25', owner_staff_id: null, owner_name: '' }
  assert.equal(actionHasOwner(open), false)
  assert.equal(actionIsOverdue(open, '2026-09-26'), true)
  assert.equal(actionHasOwner({ owner_name: 'Alex' }), true)
  assert.equal(
    actionIsOverdue({ status: 'open', due_date: '2026-09-26' }, '2026-09-26'),
    false,
  )
  assert.equal(actionIsOverdue({ status: 'closed', due_date: '2026-09-01' }, '2026-09-26'), false)
})

test('an evidence action row needs a description once it has been started', () => {
  assert.deepEqual(evidenceActionErrors([{ description: '', action_required: 'Fix the gate' }]), [
    'Enter a description for each action.',
  ])
  assert.deepEqual(evidenceActionErrors([{ description: '', action_required: '' }]), [])
})
