// Offline tests for /api/enrich-competitor (Stage 3). Stubs Supabase auth +
// Anthropic; no network, no secrets — safe for CI. Run: npm test
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../index.js'

const env = { ANTHROPIC_API_KEY: 'k', SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon' }
const orig = globalThis.fetch
after(() => { globalThis.fetch = orig })

function stub({ user = { id: 'u1' }, anthropic }) {
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('/auth/v1/user')) return user ? new Response(JSON.stringify(user), { status: 200 }) : new Response('x', { status: 401 })
    if (u.includes('api.anthropic.com')) return anthropic()
    throw new Error('unexpected fetch ' + u)
  }
}
const req = (body, auth = 'Bearer t') =>
  new Request('https://app.test/api/enrich-competitor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body),
  })
const modelJSON = (obj) => async () => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }] }), { status: 200 })

test('enrich: 401 without a valid session', async () => {
  stub({ user: null, anthropic: modelJSON({}) })
  assert.equal((await worker.fetch(req({ name: 'X' }), env)).status, 401)
})

test('enrich: 400 when name missing', async () => {
  stub({ anthropic: modelJSON({}) })
  assert.equal((await worker.fetch(req({}), env)).status, 400)
})

test('enrich: 503 when API key absent', async () => {
  stub({ anthropic: modelJSON({}) })
  assert.equal((await worker.fetch(req({ name: 'X' }), { ...env, ANTHROPIC_API_KEY: '' })).status, 503)
})

test('enrich: 200 returns sanitized fields', async () => {
  stub({ anthropic: modelJSON({ definition: 'A thing.', keywords: ['a', 'b'], collision_terms: ['c'], aliases: ['al'], domain: 'https://ex.com/x', x_handle: '@h', subreddits: ['r/sec', 'netsec'] }) })
  const r = await worker.fetch(req({ name: 'X' }), env)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.equal(j.definition, 'A thing.')
  assert.deepEqual(j.keywords, ['a', 'b'])
  assert.deepEqual(j.collision_terms, ['c'])
  assert.equal(j.domain, 'ex.com')                 // protocol + path stripped
  assert.equal(j.x_handle, 'h')                     // leading @ stripped
  assert.deepEqual(j.subreddits, ['sec', 'netsec']) // r/ prefix stripped
})

test('enrich: 502 on unparseable model output', async () => {
  stub({ anthropic: async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'no json here' }] }), { status: 200 }) })
  assert.equal((await worker.fetch(req({ name: 'X' }), env)).status, 502)
})
