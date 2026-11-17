// Pure-logic test for the frontend's multi-company fan-out (src/lib/multiCompany.js).
// Lives here because `npm test` runs worker/test/*.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fanOutCompanies } from '../../src/lib/multiCompany.js'

test('single-company row passes through untouched', () => {
  const row = { activity_id: '1', companyName: 'Oak', sentiment: 2, company_names: [] }
  assert.deepEqual(fanOutCompanies(row), [row])
  const legacy = { activity_id: '2', companyName: 'Oak', sentiment: 1 } // no company_names column
  assert.deepEqual(fanOutCompanies(legacy), [legacy])
})

test('multi-company row yields one post per credited company, same weight', () => {
  const row = {
    activity_id: '7524490076052078592', companyName: 'Oak - Identity Security OS', sentiment: 2, post_weight: 168.45,
    reasoning: 'oak reason',
    company_names: [
      { name: 'Oak - Identity Security OS', sentiment: 2, reasoning: 'oak reason' },
      { name: 'Twine Security', sentiment: null, reasoning: 'manual: listed as sponsor' },
    ],
  }
  const out = fanOutCompanies(row)
  assert.deepEqual(out.map(p => p.companyName), ['Oak - Identity Security OS', 'Twine Security'])
  assert.ok(out.every(p => p.post_weight === 168.45 && p.activity_id === row.activity_id))
  assert.equal(out[1].sentiment, null)                       // secondary never inherits the primary's tone
  assert.equal(out[1].reasoning, 'manual: listed as sponsor')
  assert.deepEqual(out[1].coCredited, ['Oak - Identity Security OS', 'Twine Security'])
})

test('the list is authoritative, like the RPC; junk entries and duplicates are ignored', () => {
  const row = { activity_id: '3', companyName: 'Oak', sentiment: 1, company_names: [{ name: 'Twine Security', sentiment: 3 }, null, { name: 'NONE' }, { name: 'twine security' }] }
  const out = fanOutCompanies(row)
  assert.equal(out.length, 1)
  assert.equal(out[0].companyName, 'Twine Security')
  assert.equal(out[0].sentiment, 3)
  assert.equal(out[0].coCredited, undefined)
})

test('primary entry without its own sentiment keeps the row sentiment', () => {
  const out = fanOutCompanies({ activity_id: '4', companyName: 'Cerby', sentiment: -1, company_names: [{ name: 'Cerby' }] })
  assert.equal(out[0].sentiment, -1)
})
