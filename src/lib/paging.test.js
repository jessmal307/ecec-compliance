import assert from 'node:assert/strict'
import test from 'node:test'
import { collectPages } from './query.js'

test('collectPages reads past 1000 rows and stops on a short page', async () => {
  const all = Array.from({ length: 2001 }, (_, index) => index)
  let calls = 0
  const rows = await collectPages(async (from, to) => {
    calls += 1
    return all.slice(from, to + 1)
  }, 1000)

  assert.equal(rows.length, 2001)
  assert.equal(calls, 3)
  assert.deepEqual(rows.slice(0, 3), [0, 1, 2])
  assert.equal(rows[2000], 2000)
})

test('collectPages stops after one short page', async () => {
  let calls = 0
  const rows = await collectPages(async () => {
    calls += 1
    return ['only']
  }, 1000)

  assert.deepEqual(rows, ['only'])
  assert.equal(calls, 1)
})
