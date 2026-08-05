#!/usr/bin/env node
// Live eval runner for the SOV dashboard assistant.
//
// Runs the golden questions in assistant_evals.jsonl against a REAL deployed
// /api/ask (agentic loop, live data), records which tools ran (from the progress
// frames' `tool` field) + the final answer, then has an LLM judge score each
// transcript against the item's expected_behavior / red_flags. Writes a scorecard
// to eval_results/<date>-scorecard.{json,md}.
//
// Requirements (env):
//   EVAL_BASE          https://<the deployed dashboard>   (no default — required)
//   EVAL_EMAIL/EVAL_PASSWORD  a Supabase login for a dedicated eval user
//     (create one in Supabase Studio → Authentication → Add user), OR
//   EVAL_TOKEN         a raw Supabase access token (overrides email/password)
//   ANTHROPIC_API_KEY  for the judge (claude-sonnet-4-5)
//
// Notes:
//   • Each run burns ~26 questions of the eval user's daily assistant budget —
//     use a dedicated eval user, not your own login.
//   • Run BEFORE merging assistant changes (deploy to preview or run against prod
//     pre/post-merge and diff scorecards).
// Usage: node run_assistant_evals.mjs [--only id-substring] [--limit N]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SUPABASE_URL = 'https://addwjngdezmmnxddulll.supabase.co'
const SUPABASE_ANON = '<REDACTED_JWT — read from sov-tooling/.sbkey or Supabase settings>'
const JUDGE_MODEL = 'claude-sonnet-4-5'

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const ONLY = flag('--only')
const LIMIT = Number(flag('--limit')) || Infinity

const BASE = process.env.EVAL_BASE
const JUDGE_KEY = process.env.ANTHROPIC_API_KEY
if (!BASE) { console.error('EVAL_BASE is required (the deployed dashboard origin, e.g. https://…)'); process.exit(1) }
if (!JUDGE_KEY) { console.error('ANTHROPIC_API_KEY is required (for the judge)'); process.exit(1) }

// ---- auth ------------------------------------------------------------------
async function getToken() {
  if (process.env.EVAL_TOKEN) return process.env.EVAL_TOKEN
  const email = process.env.EVAL_EMAIL, password = process.env.EVAL_PASSWORD
  if (!email || !password) { console.error('Set EVAL_TOKEN, or EVAL_EMAIL + EVAL_PASSWORD (a dedicated eval user)'); process.exit(1) }
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!r.ok) { console.error(`Supabase sign-in failed (${r.status}): ${await r.text()}`); process.exit(1) }
  return (await r.json()).access_token
}

// ---- ask -------------------------------------------------------------------
// Returns { toolsCalled, progress, answer, draft, error, ms }
async function ask(token, question) {
  const started = Date.now()
  const r = await fetch(`${BASE}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ question, context: { tab: 'overview', window: '7d', platformFilter: 'All' }, history: [], session_id: randomUUID() }),
  })
  if (!r.ok || !r.body) return { error: `HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`, ms: Date.now() - started }
  const text = await r.text()
  const frames = text.split('\x1e').filter(Boolean).map(s => { try { return JSON.parse(s) } catch { return null } }).filter(Boolean)
  return {
    toolsCalled: frames.filter(f => f.t === 'progress').map(f => f.tool || f.label),
    progress: frames.filter(f => f.t === 'progress').map(f => f.label),
    answer: frames.filter(f => f.t === 'token').map(f => f.text).join(''),
    draft: frames.find(f => f.t === 'draft')?.draft || null,
    error: frames.find(f => f.t === 'error')?.message || null,
    ms: Date.now() - started,
  }
}

// ---- reference data for the judge (live board, so number-claims are checkable)
async function boardReference(token) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/sov_daily?select=company,snapshot_date,weighted_pct&window_days=eq.7&order=snapshot_date.desc&limit=60`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
    })
    return r.ok ? await r.json() : null
  } catch { return null }
}

// ---- judge -----------------------------------------------------------------
async function judge(item, run, reference) {
  const transcript = run.draft
    ? `TOOLS CALLED: ${JSON.stringify(run.toolsCalled)}\nOUTCOME: issue DRAFT (not filed) — title: ${run.draft.title}\nbody: ${run.draft.body}\ncategory: ${run.draft.category}`
    : `TOOLS CALLED: ${JSON.stringify(run.toolsCalled)}\nFINAL ANSWER:\n${run.answer || '(empty)'}${run.error ? `\nSTREAM ERROR: ${run.error}` : ''}`
  const prompt = `You are judging one eval of a competitive-intelligence dashboard assistant.

EVAL ITEM:
question: ${item.question}
language: ${item.language}
expected tools (guideline, not strict): ${JSON.stringify(item.expected_tools)}
expected behavior (PASS criteria): ${item.expected_behavior}
red flags (FAIL indicators): ${item.red_flags}

LIVE BOARD REFERENCE (sov_daily, 7d window, newest first — use to sanity-check claimed SOV numbers/deltas):
${JSON.stringify(reference || 'unavailable').slice(0, 4000)}

ASSISTANT TRANSCRIPT:
${transcript.slice(0, 8000)}

Score it. verdict: "pass" (meets the PASS criteria), "partial" (right approach, minor gaps), or "fail" (red flags present / criteria unmet). Be strict about invented data and wrong language.`
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': JUDGE_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: JUDGE_MODEL, max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ name: 'verdict', description: 'Report the eval verdict', input_schema: { type: 'object', properties: { verdict: { type: 'string', enum: ['pass', 'partial', 'fail'] }, notes: { type: 'string', description: '1-3 sentences: what was right/wrong, citing specifics' } }, required: ['verdict', 'notes'] } }],
      tool_choice: { type: 'tool', name: 'verdict' },
    }),
  })
  if (!r.ok) return { verdict: 'error', notes: `judge HTTP ${r.status}` }
  const j = await r.json().catch(() => null)
  const tu = j && j.content && j.content.find(b => b.type === 'tool_use')
  return tu ? tu.input : { verdict: 'error', notes: 'no verdict returned' }
}

// ---- main ------------------------------------------------------------------
const items = readFileSync(join(HERE, 'assistant_evals.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l))
  .filter(i => !ONLY || i.id.includes(ONLY))
  .slice(0, LIMIT)

const token = await getToken()
const reference = await boardReference(token)
console.log(`Running ${items.length} evals against ${BASE} …\n`)

const results = []
for (const item of items) {
  process.stdout.write(`• ${item.id} … `)
  const run = await ask(token, item.question)
  const j = run.error && !run.answer && !run.draft
    ? { verdict: 'fail', notes: `request failed: ${run.error}` }
    : await judge(item, run, reference)
  results.push({ id: item.id, category: item.category, language: item.language, question: item.question, ...run, ...j })
  console.log(`${j.verdict.toUpperCase()} (${(run.ms / 1000).toFixed(1)}s, tools: ${run.toolsCalled.join(',') || 'none'})`)
  await new Promise(res => setTimeout(res, 1500)) // gentle pacing
}

// ---- scorecard --------------------------------------------------------------
const date = new Date().toISOString().slice(0, 10)
const dir = join(HERE, 'eval_results'); mkdirSync(dir, { recursive: true })
const tally = { pass: 0, partial: 0, fail: 0, error: 0 }
for (const r of results) tally[r.verdict] = (tally[r.verdict] || 0) + 1
const score = `${tally.pass}/${results.length} pass, ${tally.partial} partial, ${tally.fail} fail${tally.error ? `, ${tally.error} judge-error` : ''}`

writeFileSync(join(dir, `${date}-scorecard.json`), JSON.stringify({ date, base: BASE, score, tally, results }, null, 2))
const md = [
  `# Assistant eval scorecard — ${date}`,
  ``, `**Target:** ${BASE}  \n**Score:** ${score}`, ``,
  `| id | verdict | tools called | notes |`, `|---|---|---|---|`,
  ...results.map(r => `| ${r.id} | ${r.verdict === 'pass' ? '✅' : r.verdict === 'partial' ? '🟡' : '❌'} ${r.verdict} | ${r.toolsCalled.join(', ') || '—'} | ${String(r.notes).replace(/\|/g, '\\|').slice(0, 300)} |`),
].join('\n')
writeFileSync(join(dir, `${date}-scorecard.md`), md)

console.log(`\n${score}`)
console.log(`Scorecard: sov-tooling/eval_results/${date}-scorecard.md`)
process.exit(tally.fail > 0 ? 1 : 0)
