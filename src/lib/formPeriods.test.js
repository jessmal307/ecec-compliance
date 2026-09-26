import assert from 'node:assert/strict'
import test from 'node:test'
import { evidenceCompletionErrors } from './evidenceCompletion.js'
import {
  findOverdueForms,
  periodBounds,
  previousPeriodBounds,
} from './formPeriods.js'
import {
  anchoredPeriodBounds,
  calendarMonthBounds,
  periodIsOwed,
  previousAnchoredPeriodBounds,
} from '../../supabase/functions/_shared/formPeriods.js'

function overdue({ cadence, months, today, created = '2020-01-01', closures = [], submissions = [] }) {
  return findOverdueForms({
    sites: [
      {
        id: 'site',
        name: 'Centre',
        operating_days: [1, 2, 3, 4, 5],
        created_at: created,
      },
    ],
    templates: [
      {
        id: 'template',
        name: 'Item',
        cadence,
        cadence_months: months,
        scope: 'all_sites',
        created_at: created,
      },
    ],
    exclusions: [],
    closures,
    submissions,
    today,
  })
}

test('annually is the anchor month and annual stays the calendar year', () => {
  assert.deepEqual(anchoredPeriodBounds([9], '2026-09-26'), {
    start: '2026-09-01',
    end: '2026-09-30',
  })
  assert.equal(anchoredPeriodBounds([9], '2026-10-01'), null)
  assert.deepEqual(previousAnchoredPeriodBounds([9], '2026-10-01'), {
    start: '2026-09-01',
    end: '2026-09-30',
  })
  assert.deepEqual(previousAnchoredPeriodBounds([9], '2026-09-26'), {
    start: '2025-09-01',
    end: '2025-09-30',
  })
  assert.deepEqual(periodBounds('annual', '2026-09-26'), {
    start: '2026-01-01',
    end: '2026-12-31',
  })
  assert.deepEqual(previousPeriodBounds('annual', '2026-09-26'), {
    start: '2025-01-01',
    end: '2025-12-31',
  })
  assert.deepEqual(periodBounds('daily', '2026-09-26'), {
    start: '2026-09-26',
    end: '2026-09-26',
  })
})

test('half-yearly uses the latest ended anchor month, including an unsorted pair', () => {
  assert.deepEqual(previousAnchoredPeriodBounds([10, 4], '2026-05-01'), {
    start: '2026-04-01',
    end: '2026-04-30',
  })
  assert.deepEqual(anchoredPeriodBounds([4, 10], '2026-10-15'), {
    start: '2026-10-01',
    end: '2026-10-31',
  })
  assert.deepEqual(previousAnchoredPeriodBounds([4, 10], '2026-10-15'), {
    start: '2026-04-01',
    end: '2026-04-30',
  })
  assert.deepEqual(previousAnchoredPeriodBounds([4, 10], '2026-11-01'), {
    start: '2026-10-01',
    end: '2026-10-31',
  })
  assert.deepEqual(previousAnchoredPeriodBounds([4, 10], '2026-01-15'), {
    start: '2025-10-01',
    end: '2025-10-31',
  })
})

test('February keeps the last valid day', () => {
  assert.equal(calendarMonthBounds(2024, 2).end, '2024-02-29')
  assert.equal(calendarMonthBounds(2026, 2).end, '2026-02-28')
})

test('a month-long period is owed if the template existed during it', () => {
  const september = { start: '2026-09-01', end: '2026-09-30' }
  assert.equal(periodIsOwed(september, '2026-09-26', true), true)
  assert.equal(periodIsOwed(september, '2026-10-01', true), false)
  assert.equal(periodIsOwed({ start: '2026-09-25', end: '2026-09-25' }, '2026-09-26', false), false)
})

test('overdue is only the most recently ended month, even if the centre was shut', () => {
  const closures = Array.from({ length: 31 }, (_, index) => ({
    site_id: 'site',
    closure_date: `2026-08-${String(index + 1).padStart(2, '0')}`,
  }))
  const rows = overdue({ cadence: 'monthly', today: '2026-09-01', closures })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].period_start, '2026-08-01')
  assert.equal(rows[0].label, 'missed August 2026')

  const cleared = overdue({
    cadence: 'monthly',
    today: '2026-09-01',
    closures,
    submissions: [
      { status: 'complete', site_id: 'site', template_id: 'template', for_date: '2026-08-15' },
    ],
  })
  assert.equal(cleared.length, 0)
})

test('an annual item created in September is overdue in October and not before', () => {
  const during = overdue({
    cadence: 'annually',
    months: [9],
    today: '2026-09-26',
    created: '2026-09-26',
  })
  assert.equal(during.length, 0)

  const nextMonth = overdue({
    cadence: 'annually',
    months: [9],
    today: '2026-10-01',
    created: '2026-09-26',
  })
  assert.equal(nextMonth.length, 1)
  assert.equal(nextMonth[0].period_start, '2026-09-01')
  assert.equal(nextMonth[0].label, 'missed September 2026')

  const createdAfter = overdue({
    cadence: 'annually',
    months: [9],
    today: '2026-10-01',
    created: '2026-10-01',
  })
  assert.equal(createdAfter.length, 0)
})

test('each_time is never overdue and daily still uses the previous open day', () => {
  assert.equal(
    overdue({ cadence: 'each_time', today: '2026-09-28', created: '2020-01-01' }).length,
    0,
  )

  const monday = overdue({ cadence: 'daily', today: '2026-09-28' })
  assert.equal(monday.length, 1)
  assert.equal(monday[0].period_start, '2026-09-25')

  const closedFriday = overdue({
    cadence: 'daily',
    today: '2026-09-28',
    closures: [{ site_id: 'site', closure_date: '2026-09-25' }],
  })
  assert.equal(closedFriday[0].period_start, '2026-09-24')
})

test('evidence completion requires a file and does not require notes', () => {
  assert.deepEqual(evidenceCompletionErrors(0), ['Attach at least one file.'])
  assert.deepEqual(evidenceCompletionErrors(1), [])
  assert.deepEqual(evidenceCompletionErrors(2), [])
})
