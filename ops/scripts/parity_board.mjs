// Parity check: RPC-backed board (boardFromAgg over sov_board_agg) vs the
// client-computed board (pooled model over raw attributed posts, misattributed
// excluded, aliases canonicalized) — company by company, per window.
//
// Three-way comparison:
//   A. CLIENT  — simulate the dashboard's current math from raw posts
//   B. LIB/FIX — the real src/lib/boardAgg.js over SYNTHETIC rows built from
//                the same posts (what the RPC returns AFTER the misattributed
//                migration) → must match A to ~float precision
//   C. LIB/RPC — the real lib over the LIVE RPC → drift vs A should be
//                explained entirely by still-counted misattributed posts
//                (disappears once 2026-07-27_board_agg_exclude_misattributed
//                is run)
//
// Read-only. Run from the repo root:  node sov-tooling/parity_board.mjs
import { readFileSync } from 'node:fs'
import { boardFromAgg } from '../app/src/lib/boardAgg.js'

const SB = readFileSync(new URL('./.sbkey', import.meta.url), 'utf8').trim()
const BASE = 'https://addwjngdezmmnxddulll.supabase.co/rest/v1'
const H = { apikey: SB, Authorization: 'Bearer ' + SB }
const get = async (p) => { const r = await fetch(BASE + p, { headers: H }); if (!r.ok) throw new Error(p + ' -> ' + r.status); return r.json() }
const rpc = async (name, body) => { const r = await fetch(`${BASE}/rpc/${name}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(name + ' -> ' + r.status); return r.json() }

const PLAT = [
  { table: 'linkedin_posts', platform: 'LinkedIn', date: 'posted_at' },
  { table: 'tweets', platform: 'X', date: 'createdAt' },
  { table: 'googlenews', platform: 'Google News', date: 'publishedAt' },
  { table: 'reddit_posts', platform: 'Reddit', date: 'createdAt' },
]

const competitors = await get('/competitors?select=name,aliases,type,active')
const cfg = (await get('/sov_config?select=config&limit=1'))[0].config
const mult = cfg.platformMultipliers
const idx = new Map()
for (const c of competitors) {
  if (c.active === false) continue
  const add = (v) => { const k = String(v || '').trim().toLowerCase(); if (k) idx.set(k, c.name) }
  add(c.name); for (const a of c.aliases || []) add(a)
}
const direct = new Set(competitors.filter(c => c.active !== false && (c.type || 'direct') !== 'indirect').map(c => c.name))

// All attributed posts (mirrors the dashboard's post-#139 fetch), both with and
// without the misattributed filter so we can build B and explain C.
const posts = []
for (const { table, platform, date } of PLAT) {
  const rows = await get(`/${table}?select=companyName,post_weight,misattributed,${date}&companyName=not.is.null&companyName=neq.NONE&limit=10000`)
  for (const r of rows) posts.push({ platform, companyName: r.companyName, post_weight: r.post_weight, misattributed: r.misattributed === true, ts: r[date] })
}
console.log(`posts fetched: ${posts.length} (${posts.filter(p => p.misattributed).length} flagged misattributed)`)

function clientBoard(days) {
  const cutoff = days ? Date.now() - days * 86400000 : null
  const byCompany = {}; let grand = 0
  for (const p of posts) {
    if (p.misattributed) continue
    if (p.post_weight == null) continue
    const t = p.ts ? new Date(p.ts).getTime() : NaN
    if (cutoff && (isNaN(t) || t < cutoff)) continue
    if (!cutoff && isNaN(t)) continue
    const canonical = idx.get(String(p.companyName).trim().toLowerCase())
    if (!canonical || !direct.has(canonical)) continue // dashboard pools DIRECT only
    const m = mult[p.platform] || 0
    if (!m) continue
    const v = m * Number(p.post_weight)
    byCompany[canonical] = (byCompany[canonical] || 0) + v
    grand += v
  }
  const out = {}
  for (const [c, v] of Object.entries(byCompany)) out[c] = grand > 0 ? (v / grand) * 100 : 0
  return out
}

function syntheticRows(days) {
  const cutoff = days ? Date.now() - days * 86400000 : null
  const m = new Map() // company|platform -> {wsum, cnt}
  for (const p of posts) {
    if (p.misattributed || p.post_weight == null) continue
    const t = p.ts ? new Date(p.ts).getTime() : NaN
    if (isNaN(t) || (cutoff && t < cutoff)) continue
    const k = p.companyName + '|' + p.platform
    const a = m.get(k) || { company: p.companyName, platform: p.platform, wsum: 0, cnt: 0, sent_sum: 0, sent_cnt: 0 }
    a.wsum += Number(p.post_weight); a.cnt++
    m.set(k, a)
  }
  return [...m.values()]
}

const YTD = Math.max(1, Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000))
let worstB = 0, worstC = 0
for (const days of [7, 30, YTD]) {
  const A = clientBoard(days)
  const B = boardFromAgg(syntheticRows(days), { multipliers: mult, competitors })
  const C = boardFromAgg(await rpc('sov_board_agg', { window_days: days }), { multipliers: mult, competitors })
  const bMap = Object.fromEntries(B.direct.map(r => [r.company, r.weightedPct]))
  const cMap = Object.fromEntries(C.direct.map(r => [r.company, r.weightedPct]))
  console.log(`\n=== window ${days === YTD ? `YTD(${days})` : days + 'd'} ===  ${'company'.padEnd(28)}${'A client'.padStart(10)}${'B lib/fix'.padStart(11)}${'C lib/rpc'.padStart(11)}${'A-B'.padStart(9)}${'A-C'.padStart(9)}`)
  const names = [...new Set([...Object.keys(A), ...Object.keys(bMap), ...Object.keys(cMap)])].sort((x, y) => (A[y] || 0) - (A[x] || 0))
  for (const n of names) {
    const a = A[n] || 0, b = bMap[n] || 0, c = cMap[n] || 0
    worstB = Math.max(worstB, Math.abs(a - b)); worstC = Math.max(worstC, Math.abs(a - c))
    console.log(`  ${n.padEnd(28)}${a.toFixed(3).padStart(10)}${b.toFixed(3).padStart(11)}${c.toFixed(3).padStart(11)}${(a - b).toFixed(3).padStart(9)}${(a - c).toFixed(3).padStart(9)}`)
  }
  const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0)
  console.log(`  ${'SUM'.padEnd(28)}${sum(A).toFixed(1).padStart(10)}${sum(bMap).toFixed(1).padStart(11)}${sum(cMap).toFixed(1).padStart(11)}`)
}
console.log(`\nworst |A-B| (must be ~0): ${worstB.toFixed(4)}   worst |A-C| (misattributed drift, gone after migration): ${worstC.toFixed(4)}`)
if (worstB > 0.05) { console.error('FAIL: lib does not reproduce the client board'); process.exit(1) }
console.log('PASS: lib reproduces the client board exactly on fixed-RPC rows')
