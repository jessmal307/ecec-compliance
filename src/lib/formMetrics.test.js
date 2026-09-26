import assert from 'node:assert/strict'
import test from 'node:test'
import { auditCompliancePercent } from './formMetrics.js'

const site = {
  id: 'site',
  operating_days: [1, 2, 3, 4, 5],
  created_at: '2026-11-20',
}

const monthly = {
  id: 'audit',
  category: 'audit',
  cadence: 'monthly',
  cadence_months: null,
}

const today = '2026-12-15'
const trackingStart = '2026-10-01'

test('a centre added in November does not owe October, and December is still open', () => {
  const result = auditCompliancePercent({
    site,
    templates: [monthly],
    trackingStart,
    submissions: [],
    today,
  })
  assert.equal(result.owed, 1)
  assert.equal(result.onTime, 0)
  assert.equal(result.percent, 0)
})

test('on time means submitted on or before the period end', () => {
  const onTime = auditCompliancePercent({
    site,
    templates: [monthly],
    trackingStart,
    submissions: [
      {
        status: 'complete',
        site_id: 'site',
        template_id: 'audit',
        for_date: '2026-11-01',
        submitted_at: '2026-11-18',
      },
    ],
    today,
  })
  assert.equal(onTime.percent, 100)

  const late = auditCompliancePercent({
    site,
    templates: [monthly],
    trackingStart,
    submissions: [
      {
        status: 'complete',
        site_id: 'site',
        template_id: 'audit',
        for_date: '2026-11-10',
        submitted_at: '2026-12-01',
      },
    ],
    today,
  })
  assert.equal(late.percent, 0)
})

test('a missing tracking date owes no month-long audit', () => {
  const result = auditCompliancePercent({
    site,
    templates: [monthly],
    trackingStart: null,
    submissions: [],
    today,
  })
  assert.equal(result.owed, 0)
  assert.equal(result.percent, null)
})
