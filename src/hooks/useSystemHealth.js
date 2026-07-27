import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// System-health checks for the developer console page. Philosophy (project
// rule): trust DATA over logs — the browser can't reach the n8n API, so every
// check derives from evidence in the database (freshness, queue depth, sums)
// plus two live probes (Worker API, DB latency). Each check returns:
//   { id, label, group, status: 'ok'|'warn'|'crit'|'unknown'|'info',
//     value, detail, help }
// Checks run in parallel and fail soft to 'unknown' — a broken check must
// never take down the health page itself.

const HOUR = 3600000
const ago = (iso, now) => {
  if (!iso) return null
  const h = (now - new Date(iso).getTime()) / HOUR
  return h
}
const fmtAgo = (h) => h == null ? 'never' : h < 1 ? `${Math.max(1, Math.round(h * 60))}m ago` : h < 48 ? `${Math.round(h)}h ago` : `${(h / 24).toFixed(1)}d ago`
const grade = (h, amber, red) => h == null ? 'crit' : h > red ? 'crit' : h > amber ? 'warn' : 'ok'

async function maxCol(table, col, filter = '') {
  const q = supabase.from(table).select(col).order(col, { ascending: false }).limit(1)
  const { data, error } = await q
  if (error) throw error
  void filter
  return data && data[0] ? data[0][col] : null
}

async function countHead(table, filters = (q) => q) {
  const { count, error } = await filters(supabase.from(table).select('*', { count: 'exact', head: true }))
  if (error) throw error
  return count ?? 0
}

// ---- individual checks -----------------------------------------------------

async function checkScrapes(now) {
  const { data, error } = await supabase.rpc('assistant_system_status')
  if (error) throw error
  const out = []
  const byPlat = {}
  for (const r of data?.scrape_freshness || []) byPlat[r.platform] = r

  // LinkedIn + News write scrape_runs (run-level evidence).
  for (const [plat, sched] of [['LinkedIn', 'daily ~05:00'], ['Google News', 'daily ~05:45']]) {
    const r = byPlat[plat]
    const h = ago(r?.finished_at, now)
    out.push({
      id: plat === 'LinkedIn' ? 'scrape-linkedin' : 'scrape-news',
      label: `${plat} scrape`, group: 'Pipeline',
      status: r?.status && r.status !== 'success' ? 'crit' : grade(h, 30, 54),
      value: fmtAgo(h),
      detail: r ? `last run ${r.status}${r.rows_written != null ? ` · ${r.rows_written} rows` : ''}` : 'no scrape_runs entry',
      help: `Apify scraper, ${sched} Israel time. Evidence: scrape_runs.`,
    })
  }

  // Queue: LinkedIn raw staging → Processor drain (400/day cap).
  const q = data?.linkedin_queue || {}
  const oldestH = ago(q.oldest_pending, now)
  const pending = q.pending ?? null
  out.push({
    id: 'queue', label: 'LinkedIn ingest queue', group: 'Pipeline',
    status: pending == null ? 'unknown'
      : pending >= 400 || (oldestH != null && oldestH > 48) ? 'crit'
      : pending >= 150 || (oldestH != null && oldestH > 24) ? 'warn' : 'ok',
    value: pending == null ? '—' : `${pending} pending`,
    detail: `${q.processed ?? '—'} processed · oldest pending ${oldestH == null ? 'none' : fmtAgo(oldestH)}`,
    help: 'linkedin_raw staging. Processor drains 100×4/day — a backlog ≥400 means newest posts silently wait (the 07-15 failure mode).',
  })

  // Config sanity rides along on the same RPC call.
  const cfg = data?.config || {}
  const multOk = cfg.platformMultipliers && Object.keys(cfg.platformMultipliers).length >= 4
  const hlOk = cfg.halfLifeDays && Object.keys(cfg.halfLifeDays).length >= 4
  out.push({
    id: 'config', label: 'Scoring config', group: 'Serving',
    status: multOk && hlOk ? 'ok' : 'crit',
    value: multOk && hlOk ? 'complete' : 'keys missing',
    detail: multOk ? `multipliers LI ${cfg.platformMultipliers.LinkedIn} · X ${cfg.platformMultipliers.X} · R ${cfg.platformMultipliers.Reddit} · News ${cfg.platformMultipliers['Google News']}` : 'platformMultipliers missing',
    help: 'sov_config jsonb — a partial PATCH once wiped it (2026-07-13). Checks multipliers + half-lives exist.',
  })
  return out
}

async function checkXFreshness(now) {
  const v = await maxCol('tweets', 'createdAt')
  const h = ago(v, now)
  return {
    id: 'scrape-x', label: 'X data freshness', group: 'Pipeline',
    // X volume is thin (~3/day) — a quiet day is normal, so thresholds are loose.
    status: grade(h, 72, 168),
    value: fmtAgo(h),
    detail: 'newest tweet by createdAt',
    help: 'X scraper runs daily ~05:10 but writes no scrape_runs — freshness is inferred from the newest stored tweet. Thin volume → amber only after 3 quiet days.',
  }
}

async function checkRedditFreshness(now) {
  const v = await maxCol('reddit_posts', 'scrapedAt')
  const h = ago(v, now)
  return {
    id: 'scrape-reddit', label: 'Reddit scrape', group: 'Pipeline',
    status: grade(h, 204, 360), // weekly Thursdays: amber ~8.5d, red 15d
    value: fmtAgo(h),
    detail: 'newest reddit_posts.scrapedAt',
    help: 'Reddit runs WEEKLY (Thu ~05:25) — daily thresholds would show it perma-red.',
  }
}

async function checkAttributionFlow(now) {
  const since = new Date(now - 3 * 24 * HOUR).toISOString()
  const n = await countHead('linkedin_posts', (q) =>
    q.not('companyName', 'is', null).neq('companyName', 'NONE').gte('posted_at', since))
  return {
    id: 'attribution', label: 'Attribution flow', group: 'Pipeline',
    status: n > 0 ? 'ok' : 'warn',
    value: `${n} in 3d`,
    detail: 'LinkedIn posts attributed to a tracked company, last 3 days',
    help: 'Zero attributed posts for 3 days usually means a broken LLM gate, not quiet competitors.',
  }
}

async function checkSnapshot(now) {
  const v = await maxCol('sov_daily', 'snapshot_date')
  const h = v ? (now - new Date(v + 'T06:45:00Z').getTime()) / HOUR : null
  return {
    id: 'snapshot', label: 'Board snapshot', group: 'Data',
    status: grade(h == null ? null : Math.max(h, 0), 30, 54),
    value: v || 'never',
    detail: 'newest sov_daily snapshot_date',
    help: 'Weekly Snapshot workflow (daily ~06:45) recomputes sov_daily/sov_weekly. Stale = trend charts and briefs freeze.',
  }
}

async function checkBoardIntegrity() {
  const [{ data: rows, error: e1 }, { data: comps, error: e2 }] = await Promise.all([
    supabase.rpc('sov_board_agg', { window_days: 7 }),
    supabase.from('competitors').select('name,aliases,type,active'),
  ])
  if (e1) throw e1
  if (e2) throw e2
  if (!comps || !comps.length) {
    return { id: 'board', label: 'Board integrity', group: 'Data', status: 'unknown', value: '—', detail: 'competitor roster not readable in this session', help: 'Direct competitors must sum to ~100% of the pool.' }
  }
  const idx = new Map()
  for (const c of comps) {
    if (c.active === false) continue
    const add = (v) => { const k = String(v || '').trim().toLowerCase(); if (k) idx.set(k, c.name) }
    add(c.name); for (const a of c.aliases || []) add(a)
  }
  const direct = new Set(comps.filter(c => c.active !== false && (c.type || 'direct') !== 'indirect').map(c => c.name))
  // Direct-pool share is normalized by construction; the INTEGRITY signal is
  // that the pool exists and every snapshot company resolves to the roster.
  let pool = 0
  const unknownNames = new Set()
  for (const r of rows || []) {
    const canonical = idx.get(String(r.company || '').trim().toLowerCase())
    if (!canonical) { unknownNames.add(r.company); continue }
    if (direct.has(canonical)) pool += Number(r.wsum) || 0
  }
  return {
    id: 'board', label: 'Board integrity', group: 'Data',
    status: pool > 0 ? (unknownNames.size > 3 ? 'warn' : 'ok') : 'crit',
    value: pool > 0 ? 'pool OK' : 'EMPTY POOL',
    detail: `7d direct pool ${Math.round(pool)} units · ${unknownNames.size} untracked name(s) in data`,
    help: 'Live sov_board_agg 7d: the direct pool must be non-empty; stored names should resolve to the roster (aliases collapse).',
  }
}

async function checkWorker() {
  const t0 = performance.now()
  let r
  try { r = await fetch('/api/health') } catch { return { id: 'worker', label: 'Worker API', group: 'Serving', status: 'crit', value: 'unreachable', detail: 'fetch failed', help: 'Cloudflare Worker serving /api/* (assistant, enrich, briefs).' } }
  const ms = Math.round(performance.now() - t0)
  // Body must be the probe's JSON — the SPA fallback answers any path with
  // HTML 200, which is NOT evidence the Worker route is deployed.
  const body = await r.json().catch(() => null)
  const ok = r.status === 200 && body && body.ok === true
  return {
    id: 'worker', label: 'Worker API', group: 'Serving',
    status: ok ? (ms > 1500 ? 'warn' : 'ok') : r.status === 200 ? 'warn' : 'crit',
    value: ok ? `${ms}ms` : r.status === 200 ? 'no probe' : `HTTP ${r.status}`,
    detail: 'GET /api/health round-trip',
    help: 'Cloudflare Worker serving /api/* — the assistant, competitor auto-fill, and briefs ride on it.',
  }
}

async function checkDbLatency() {
  const t0 = performance.now()
  const { error } = await supabase.from('sov_daily').select('snapshot_date', { count: 'exact', head: true }).limit(1)
  const ms = Math.round(performance.now() - t0)
  if (error) throw error
  return {
    id: 'db', label: 'Database latency', group: 'Serving',
    status: ms > 2500 ? 'crit' : ms > 800 ? 'warn' : 'ok',
    value: `${ms}ms`,
    detail: 'HEAD count on sov_daily via PostgREST',
    help: 'Supabase REST round-trip from this browser (includes your network).',
  }
}

async function checkGeo(now) {
  const v = await maxCol('geo_results', 'run_date')
  const h = v ? (now - new Date(String(v).slice(0, 10) + 'T07:30:00Z').getTime()) / HOUR : null
  return {
    id: 'geo', label: 'AI answers (GEO)', group: 'Data',
    status: grade(h == null ? null : Math.max(h, 0), 204, 360),
    value: v ? String(v).slice(0, 10) : 'never',
    detail: 'newest geo_results.run_date',
    help: '48 prompts × 2 engines, weekly Thu ~07:30 → the AI Visibility tab.',
  }
}

async function checkClassifier(now) {
  const v = await maxCol('author_affiliation', 'checked_at')
  const h = ago(v, now)
  return {
    id: 'classifier', label: 'Author classifier', group: 'Pipeline',
    status: grade(h, 48, 96),
    value: fmtAgo(h),
    detail: 'newest author_affiliation.checked_at',
    help: 'Daily ~06:25 — labels post authors employee/external (feeds the ternary weight model).',
  }
}

async function checkVolumes() {
  const tables = ['linkedin_posts', 'tweets', 'googlenews', 'reddit_posts']
  const counts = await Promise.all(tables.map(t => countHead(t).catch(() => null)))
  return {
    id: 'volumes', label: 'Table volumes', group: 'Data',
    status: 'info',
    value: counts.map(c => c == null ? '—' : c >= 1000 ? (c / 1000).toFixed(1) + 'k' : c).join(' · '),
    detail: 'linkedin · tweets · news · reddit (total rows)',
    help: 'Raw row counts. LinkedIn growth drove the #139 payload bug — worth glancing at.',
  }
}

// ---- orchestrator ----------------------------------------------------------

const RUNNERS = [
  (now) => checkScrapes(now),          // → 4 checks
  (now) => checkXFreshness(now),
  (now) => checkRedditFreshness(now),
  (now) => checkAttributionFlow(now),
  (now) => checkSnapshot(now),
  () => checkBoardIntegrity(),
  () => checkWorker(),
  () => checkDbLatency(),
  (now) => checkGeo(now),
  (now) => checkClassifier(now),
  () => checkVolumes(),
]

const FAIL_LABELS = { 0: 'Pipeline status', 1: 'X data freshness', 2: 'Reddit scrape', 3: 'Attribution flow', 4: 'Board snapshot', 5: 'Board integrity', 6: 'Worker API', 7: 'Database latency', 8: 'AI answers (GEO)', 9: 'Author classifier', 10: 'Table volumes' }

export async function runAllChecks() {
  const now = Date.now()
  const settled = await Promise.allSettled(RUNNERS.map(r => r(now)))
  const checks = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') checks.push(...[].concat(s.value))
    else checks.push({ id: 'failed-' + i, label: FAIL_LABELS[i] || 'Check', group: 'Serving', status: 'unknown', value: 'check failed', detail: String(s.reason?.message || s.reason).slice(0, 120), help: 'The check itself errored — commonly RLS (not signed in) or network.' })
  })
  return { checks, ranAt: now }
}

export function useSystemHealth({ intervalMs = 60000, paused = false } = {}) {
  const [state, setState] = useState({ checks: null, ranAt: null, running: true })
  const timer = useRef(null)

  const run = useCallback(async () => {
    setState(s => ({ ...s, running: true }))
    const { checks, ranAt } = await runAllChecks()
    setState({ checks, ranAt, running: false })
  }, [])

  useEffect(() => {
    if (paused) return undefined
    let alive = true
    const kick = async () => { if (alive) await run() }
    kick()
    timer.current = setInterval(kick, intervalMs)
    return () => { alive = false; clearInterval(timer.current) }
  }, [run, intervalMs, paused])

  return { ...state, refresh: run }
}
