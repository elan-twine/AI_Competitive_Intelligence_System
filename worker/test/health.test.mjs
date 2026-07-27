// /api/health — shallow liveness probe for the System Health console.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../index.js'

test('health: public JSON probe, no auth, no secrets, no-store', async () => {
  const r = await worker.fetch(new Request('https://app.test/api/health'), {})
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('Cache-Control'), 'no-store')
  const j = await r.json()
  assert.equal(j.ok, true)
  assert.equal(typeof j.ts, 'number')
  assert.deepEqual(Object.keys(j).sort(), ['ok', 'ts']) // nothing else ever leaks here
})
