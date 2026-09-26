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
  monthTrackingBoundary,
  periodIsOwed,
  previousAnchoredPeriodBounds,
} from '../../supabase/functions/_shared/formPeriods.js'
import { scheduleEnabled } from './formSchedule.js'

function overdue({
  cadence,
  months,
  today,
  created = '2020-01-01',
  trackingStart = created,
  closures = [],
  submissions = [],
}) {
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
    trackingStart,
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

test('a month-long period is owed only when it starts on or after tracking', () => {
  const september = { start: '2026-09-01', end: '2026-09-30' }
  assert.equal(periodIsOwed(september, '2026-09-26', true), false)
  assert.equal(periodIsOwed(september, '2026-09-01', true), true)
  assert.equal(periodIsOwed(september, '2026-10-01', true), false)
  assert.equal(periodIsOwed(september, null, true), false)
  assert.equal(periodIsOwed({ start: '2026-09-25', end: '2026-09-25' }, '2026-09-26', false), false)
  assert.equal(periodIsOwed({ start: '2026-09-26', end: '2026-09-26' }, null, false), true)
  assert.equal(monthTrackingBoundary('2026-09-26', '2020-01-01'), '2026-09-26')
  assert.equal(monthTrackingBoundary('2026-09-01', '2026-10-01'), '2026-10-01')
  assert.equal(monthTrackingBoundary(null, '2020-01-01'), null)
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

test('tracking from 26 Sep owes nothing for September; 1 Sep owes it from October', () => {
  const during = overdue({
    cadence: 'annually',
    months: [9],
    today: '2026-09-26',
    trackingStart: '2026-09-01',
  })
  assert.equal(during.length, 0)

  const firstMonth = overdue({
    cadence: 'annually',
    months: [9],
    today: '2026-10-01',
    trackingStart: '2026-09-26',
  })
  assert.equal(firstMonth.length, 0)

  const backdated = overdue({
    cadence: 'annually',
    months: [9],
    today: '2026-10-01',
    trackingStart: '2026-09-01',
  })
  assert.equal(backdated.length, 1)
  assert.equal(backdated[0].period_start, '2026-09-01')
  assert.equal(backdated[0].label, 'missed September 2026')

  const siteOpenedLater = overdue({
    cadence: 'annually',
    months: [9],
    today: '2026-10-01',
    created: '2026-10-01',
    trackingStart: '2026-09-01',
  })
  assert.equal(siteOpenedLater.length, 0)

  assert.equal(
    overdue({ cadence: 'monthly', today: '2026-09-01', trackingStart: null }).length,
    0,
  )
})

test('daily checklists are off until a schedule row turns them on', () => {
  const daily = { category: 'checklist', cadence: 'daily' }
  const audit = { category: 'audit', cadence: 'monthly' }
  assert.equal(scheduleEnabled(daily, null), false)
  assert.equal(scheduleEnabled(audit, null), true)
  assert.equal(scheduleEnabled(daily, { enabled: true }), true)
  assert.equal(scheduleEnabled({ cadence: 'daily' }, null), true)
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
