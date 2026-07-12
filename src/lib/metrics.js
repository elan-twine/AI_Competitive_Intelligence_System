// Pure analytics helpers. Take a posts array (post = row with
// { companyName, sov, sentiment, platform, ts, unweightedSOV, weightedSOV,
//   postWeight, ... }) and return derived data.
//
// SOV methodology (mindshare-pool model, 2026-07-08):
//   1. Per-post impact: n8n stores `post_weight` per row (preferred; legacy
//      `weightedSOV` fallback). It measures ENGAGEMENT depth (considered
//      attention), not raw reach.
//   2. Cross-platform common currency: multiply each post's impact by its
//      platform multiplier (config.platformMultipliers) to convert every
//      platform's impact onto ONE comparable "considered-attention" scale.
//      Multipliers are trust/consideration ratios grounded in B2B buyer
//      research (peer/community > editorial press > vendor social).
//   3. Pool + share: sum all scaled impact into a single pool; a brand's SOV is
//      its share of that pool. Platform influence is EMERGENT (a thin platform
//      contributes little) — no preset per-platform budget, no min-volume guard.
//   4. Sentiment is its own dimension; a negative-mention spike never inflates SOV.

import { DEFAULT_SOV_CONFIG } from '../hooks/useSOVConfig'
import { ymd } from './dates'

// Per-post weight used for within-platform share. Prefer the n8n-computed
// `post_weight`; fall back to the legacy normalized `weightedSOV` during the
// data transition; finally fall back to 1 (pure presence) so a post always
// counts for something.
export function postWeightOf(p) {
  const w = p.postWeight ?? p.post_weight
  if (w != null && !isNaN(w)) return Number(w)
  if (p.weightedSOV != null && !isNaN(p.weightedSOV)) return Number(p.weightedSOV)
  return 1
}

export function applyFilters(posts, { platform = 'All', platforms, sentiment = 'All', days = 0 } = {}) {
  let out = posts
  // Platform filter supports either a single string (legacy, 'All' = no filter)
  // or an array/Set of selected platforms (multi-select). A non-empty set keeps
  // posts whose platform is in the set (union); empty/absent = no filter.
  const platformSet = platforms != null
    ? (platforms instanceof Set ? platforms : new Set(platforms))
    : (platform && platform !== 'All' ? new Set([platform]) : null)
  if (platformSet && platformSet.size) out = out.filter(p => platformSet.has(p.platform))
  if (sentiment !== 'All') {
    out = out.filter(p => {
      const s = p.sentiment
      if (s == null) return false
      if (sentiment === 'positive') return s > 0
      if (sentiment === 'negative') return s < 0
      if (sentiment === 'neutral') return s === 0
      return true
    })
  }
  if (days > 0) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    out = out.filter(p => {
      const t = p.ts ? new Date(p.ts).getTime() : NaN
      return !isNaN(t) && t >= cutoff
    })
  }
  return out
}

function companyRow(posts, company) {
  const rows = posts.filter(p => p.companyName === company)
  const postCount = rows.length
  const unweightedSOV = rows.reduce((s, p) => s + (p.unweightedSOV || 0), 0)
  const weightedSOV = rows.reduce((s, p) => s + (p.weightedSOV || 0), 0)
  // Sentiment = EXTERNAL posts only (earned perception; a company's own posts are
  // self-promo and ~always positive). Posts without an `external` flag (legacy)
  // are treated as external so nothing silently drops.
  const sentimentRows = rows.filter(p => p.sentiment != null && p.external !== false)
  const avgSentiment = sentimentRows.length
    ? sentimentRows.reduce((s, p) => s + p.sentiment, 0) / sentimentRows.length
    : 0
  // sentimentCount lets the UI distinguish "genuinely neutral (avg 0)" from
  // "no rated external items in this window" (shown as — instead of 0.00).
  return { company, postCount, unweightedSOV, weightedSOV, avgSentiment, sentimentCount: sentimentRows.length, posts: rows }
}

// ---------------------------------------------------------------------------
// Methodology core: per-platform brand share → cross-platform weighted SOV.
// Returns a Map(company -> weightedPct 0..100) plus the effective platform
// weights actually used (after min-volume guard + renormalization).
// ---------------------------------------------------------------------------
export function computeWeightedSOV(posts, config = DEFAULT_SOV_CONFIG) {
  const mult = config.platformMultipliers || DEFAULT_SOV_CONFIG.platformMultipliers

  // Scale each post's impact by its platform multiplier into a common
  // "considered-attention" unit, then pool ALL platforms together.
  const platformTotals = {}          // platform -> Σ (mult · post_weight)
  const platformCompany = {}         // platform -> { company -> Σ (mult · post_weight) }
  const byCompany = {}               // company  -> Σ across all platforms
  let grand = 0
  for (const p of posts) {
    const plat = p.platform
    if (!plat || !p.companyName) continue
    const m = mult[plat] != null ? mult[plat] : 0
    if (!m) continue
    const v = m * postWeightOf(p)
    platformTotals[plat] = (platformTotals[plat] || 0) + v
    if (!platformCompany[plat]) platformCompany[plat] = {}
    platformCompany[plat][p.companyName] = (platformCompany[plat][p.companyName] || 0) + v
    byCompany[p.companyName] = (byCompany[p.companyName] || 0) + v
    grand += v
  }

  // SOV = a brand's share of the single cross-platform pool.
  const pct = new Map()
  for (const [company, v] of Object.entries(byCompany)) {
    pct.set(company, grand > 0 ? (v / grand) * 100 : 0)
  }

  // Emergent platform influence = each platform's share of the whole pool.
  const effectiveWeights = {}
  for (const plat of Object.keys(platformTotals)) {
    effectiveWeights[plat] = grand > 0 ? platformTotals[plat] / grand : 0
  }

  return { weightedPct: pct, effectiveWeights, platformTotals, grandTotal: grand, mult }
}

// ---------------------------------------------------------------------------
// Weekly SOV trend. Buckets posts into anchor-aligned weeks by `post.ts`, then
// computes per-competitor cross-platform weighted SOV for EACH week using the
// SAME methodology as computeWeightedSOV (within-platform share → weighted
// average across platforms, with the min-volume guard). Output is shaped for
// recharts: one row per week, one numeric key per company (SOV 0..100).
// ---------------------------------------------------------------------------

// "Start fresh" epoch: the SOV model changed on 2026-06-22. Weeks before that
// were computed under a superseded formula AND on thin scrape coverage, so NO
// weekly view (frozen board, live platform-filtered, or isolated week-by-week)
// displays them. Single source of truth — useWeeklySOV/useDailySOV and the
// client-side weekly series all honor this same date.
export const SOV_HISTORY_START = '2026-06-22'

// Week anchor day for ALL client-side weekly bucketing (0=Sun..6=Sat).
// Scrapes run Thursday mornings and the n8n snapshot stamps sov_weekly's
// week_start as the most-recent Thursday, so weeks are Thursday-anchored (4)
// to match. If the scrape day ever moves, change this ONE constant (and the
// snapshot's isoThursday in n8n) — every weekly grouping in the app follows.
export const WEEK_ANCHOR_DAY = 4

// Anchor day of the week containing `date`, normalized to local midnight.
// We label each bucket by this anchor date as 'YYYY-MM-DD' (the week-start date).
export function isoWeekStart(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  // getDay(): 0=Sun..6=Sat. Shift back to the most recent anchor day.
  const day = (d.getDay() - WEEK_ANCHOR_DAY + 7) % 7
  d.setDate(d.getDate() - day)
  return d
}

export function weeklySOVSeries(posts, config = DEFAULT_SOV_CONFIG, opts = {}) {
  const { weeks = 12, since = SOV_HISTORY_START, fillZeroFor = [] } = opts

  // Bucket posts by ISO-week-start label. Posts without a valid ts are skipped
  // (they can't be placed on the timeline).
  const buckets = new Map() // weekLabel -> posts[]
  for (const p of posts) {
    const t = p.ts ? new Date(p.ts) : null
    if (!t || isNaN(t.getTime())) continue
    const label = ymd(isoWeekStart(t))
    if (!buckets.has(label)) buckets.set(label, [])
    buckets.get(label).push(p)
  }

  // Ascending by week, clean-history only, then keep only the most recent N.
  let labels = [...buckets.keys()].filter(l => !since || l >= since).sort() // 'YYYY-MM-DD' sorts lexicographically
  if (weeks > 0 && labels.length > weeks) labels = labels.slice(labels.length - weeks)

  // Per-week, run the shared methodology and flatten into recharts rows.
  return labels.map(week => {
    const { weightedPct } = computeWeightedSOV(buckets.get(week), config)
    const row = { week }
    for (const [company, pct] of weightedPct) {
      row[company] = Math.round(pct * 10) / 10 // 0..100, one decimal
    }
    // In an ISOLATED week, a tracked company with no items legitimately has 0%
    // share of voice — plot it at 0 rather than leaving a hole in its line
    // (a hole reads as missing data, and connectNulls would bridge it at a
    // misleading interpolated height). Callers pass the tracked-roster names.
    for (const name of fillZeroFor) if (!(name in row)) row[name] = 0
    return row
  })
}

// Live weekly sentiment series (0–100 index, 50 = neutral), computed from the
// given posts so it can respect the platform/time filters. Mirrors the frozen
// sov_weekly.sentiment_pct semantics: EXTERNAL posts only (earned perception,
// not the company's own posts), averaged per company per ISO week and rescaled
// from the -3..+3 per-post scale. Shape matches weeklySOVSeries: { week, [company]: value }.
export function weeklySentimentSeries(posts, opts = {}) {
  const { weeks = 26, since = SOV_HISTORY_START } = opts
  const buckets = new Map() // weekLabel -> posts[]
  for (const p of posts) {
    if (p.sentiment == null) continue
    if (p.external === false) continue // external-only, matches the board's sentiment metric
    const t = p.ts ? new Date(p.ts) : null
    if (!t || isNaN(t.getTime())) continue
    const label = ymd(isoWeekStart(t))
    if (!buckets.has(label)) buckets.set(label, [])
    buckets.get(label).push(p)
  }
  let labels = [...buckets.keys()].filter(l => !since || l >= since).sort()
  if (weeks > 0 && labels.length > weeks) labels = labels.slice(labels.length - weeks)
  return labels.map(week => {
    const row = { week }
    const byCo = new Map()
    for (const p of buckets.get(week)) {
      const c = p.companyName
      if (!c) continue
      if (!byCo.has(c)) byCo.set(c, [])
      byCo.get(c).push(Number(p.sentiment))
    }
    for (const [c, arr] of byCo) {
      const avg = arr.reduce((s, v) => s + v, 0) / arr.length
      row[c] = Math.round(((avg + 3) / 6) * 1000) / 10 // 0..100, one decimal
    }
    return row
  })
}

// Rolling DAILY SOV series (live, filter-aware): one point per day, each = the
// SOV computed over the trailing `windowDays` (7 or 30) ending that day. This is
// the filter-aware counterpart to the precomputed sov_daily table — used when a
// platform filter is active (sov_daily can't be sliced by platform) so the 7d/30d
// charts stay DAILY instead of falling back to weekly. Windows OVERLAP by design.
// Anchored to the freshest post so it still renders on stale/dev data. Shape
// matches weeklySOVSeries: { week: 'YYYY-MM-DD', [company]: value } — the x key
// stays 'week' because SOVTrendChart + useDailySOV both key the x-axis on it.
export function rollingDailySOVSeries(posts, config = DEFAULT_SOV_CONFIG, opts = {}) {
  const { windowDays = 7, points = 45, since = SOV_HISTORY_START, fillZeroFor = [] } = opts
  const valid = posts.filter(p => p.ts && !isNaN(new Date(p.ts).getTime()))
  if (!valid.length) return []
  const DAY = 86400000
  let maxT = -Infinity
  for (const p of valid) { const t = new Date(p.ts).getTime(); if (t > maxT) maxT = t }
  const end = new Date(maxT); end.setHours(0, 0, 0, 0) // local midnight of the freshest day
  const rows = []
  for (let i = points - 1; i >= 0; i--) {
    const day = new Date(end.getTime() - i * DAY)
    if (since && ymd(day) < since) continue // clean-history epoch — no pre-model junk days
    const upper = day.getTime() + DAY
    const lower = upper - windowDays * DAY
    const win = valid.filter(p => { const t = new Date(p.ts).getTime(); return t > lower && t <= upper })
    const { weightedPct } = computeWeightedSOV(win, config)
    const row = { week: ymd(day) }
    for (const [company, pct] of weightedPct) row[company] = Math.round(pct * 10) / 10
    // No items in the trailing window = genuinely 0% SOV that day (see
    // weeklySOVSeries) — keep quiet companies' lines at 0 instead of gapping.
    for (const name of fillZeroFor) if (!(name in row)) row[name] = 0
    rows.push(row)
  }
  return rows
}

// Rolling DAILY sentiment (0–100 index, 50 = neutral), external-only, trailing
// windowDays. Mirrors weeklySentimentSeries semantics per rolling day.
export function rollingDailySentimentSeries(posts, opts = {}) {
  const { windowDays = 7, points = 45, since = SOV_HISTORY_START } = opts
  const valid = posts.filter(p => p.sentiment != null && p.external !== false && p.ts && !isNaN(new Date(p.ts).getTime()))
  if (!valid.length) return []
  const DAY = 86400000
  let maxT = -Infinity
  for (const p of valid) { const t = new Date(p.ts).getTime(); if (t > maxT) maxT = t }
  const end = new Date(maxT); end.setHours(0, 0, 0, 0)
  const rows = []
  for (let i = points - 1; i >= 0; i--) {
    const day = new Date(end.getTime() - i * DAY)
    if (since && ymd(day) < since) continue // clean-history epoch — no pre-model junk days
    const upper = day.getTime() + DAY
    const lower = upper - windowDays * DAY
    const row = { week: ymd(day) }
    const byCo = new Map()
    for (const p of valid) {
      const t = new Date(p.ts).getTime()
      if (t <= lower || t > upper) continue
      const c = p.companyName
      if (!c) continue
      if (!byCo.has(c)) byCo.set(c, [])
      byCo.get(c).push(Number(p.sentiment))
    }
    for (const [c, arr] of byCo) {
      const avg = arr.reduce((s, v) => s + v, 0) / arr.length
      row[c] = Math.round(((avg + 3) / 6) * 1000) / 10
    }
    rows.push(row)
  }
  return rows
}

// Sentiment as its own dimension: net sentiment % and positive-vs-negative
// SOV split. Net = (pos - neg) / total mentions, expressed as %.
function sentimentDimension(posts, company) {
  const rows = (company ? posts.filter(p => p.companyName === company) : posts)
    .filter(p => p.sentiment != null)
  let positive = 0, neutral = 0, negative = 0
  for (const p of rows) {
    if (p.sentiment > 0) positive++
    else if (p.sentiment < 0) negative++
    else neutral++
  }
  const total = rows.length || 0
  const netSentimentPct = total ? ((positive - negative) / total) * 100 : 0
  const positiveSharePct = total ? (positive / total) * 100 : 0
  const negativeSharePct = total ? (negative / total) * 100 : 0
  return { positive, neutral, negative, total, netSentimentPct, positiveSharePct, negativeSharePct }
}

// Composite "Overall" score weights — easy to tweak in one place.
//   unweighted = raw post-count share (pure frequency)
//   weighted   = methodology-driven cross-platform SOV (size of conversation)
//   sentiment  = average tone, rescaled -3..+3 → 0..100 (its own dimension,
//                bounded so a negative spike never inflates SOV)
// OKR-aligned comparative SOV% = the engagement-weighted cross-platform share
// ("seen" / size of conversation). The decayed mention-count term was REMOVED
// (2026-06-30): post quantity is already rewarded inside weighted (more posts →
// larger post_weight sum → larger within-platform share), so a separate count
// term double-counted volume and over-credited zero-engagement / noisy mentions.
// count-share + sentiment remain as their own display dimensions, NOT in the headline.
const OVERALL_W = { unweighted: 0, weighted: 1.0, sentiment: 0 }

// Decayed mention count: each post contributes decay(age) instead of 1, so
// "talked about" means recently (7-day grace, then 2^(-age/halfLife) per platform).
function countWeightOf(p, config) {
  const hl = (config.halfLifeDays && config.halfLifeDays[p.platform]) || 14
  const t = p.ts ? new Date(p.ts).getTime() : NaN
  if (isNaN(t)) return 1
  const age = Math.max(0, (Date.now() - t) / 86400000)
  return age <= 7 ? 1 : Math.pow(2, -age / hl)
}

export function rankings(posts, config = DEFAULT_SOV_CONFIG) {
  const companies = [...new Set(posts.map(p => p.companyName).filter(Boolean))]
  const rows = companies.map(c => companyRow(posts, c))

  // Decayed count-share per company ("talked about", recency-weighted).
  const countW = {}
  for (const p of posts) {
    if (!p.companyName) continue
    countW[p.companyName] = (countW[p.companyName] || 0) + countWeightOf(p, config)
  }
  const totalCount = Object.values(countW).reduce((s, v) => s + v, 0) || 1

  // Cross-platform weighted SOV (within-platform share → weighted average).
  const { weightedPct: weightedMap } = computeWeightedSOV(posts, config)

  return rows
    .map(r => {
      const unweightedPct = ((countW[r.company] || 0) / totalCount) * 100
      const weightedPct = weightedMap.get(r.company) || 0
      const sentimentScaled = ((r.avgSentiment + 3) / 6) * 100
      const sentiment = sentimentDimension(posts, r.company)
      const overall =
        OVERALL_W.unweighted * unweightedPct +
        OVERALL_W.weighted * weightedPct +
        OVERALL_W.sentiment * sentimentScaled
      return {
        ...r,
        pct: unweightedPct,
        unweightedPct,
        weightedPct,
        sentimentScaled,
        netSentimentPct: sentiment.netSentimentPct,
        positiveSharePct: sentiment.positiveSharePct,
        negativeSharePct: sentiment.negativeSharePct,
        overall,
      }
    })
    .sort((a, b) => b.overall - a.overall)
}

// Per-company post COUNT by platform (used by the Compare tab's platform grid).
// Only `count` is consumed; the old `sov` accumulator summed the legacy per-post
// `sov` field (= 1/totalPosts, a flat count-share) and was never displayed, so
// it's dropped to avoid implying a weighted value.
export function platformSplit(posts, company) {
  const rows = company ? posts.filter(p => p.companyName === company) : posts
  const platforms = {}
  for (const p of rows) {
    if (!platforms[p.platform]) platforms[p.platform] = { count: 0 }
    platforms[p.platform].count++
  }
  return platforms
}

export function compare(posts, companyA, companyB, config = DEFAULT_SOV_CONFIG) {
  const a = companyRow(posts, companyA)
  const b = companyRow(posts, companyB)
  // Use the methodology-driven weighted SOV for the head-to-head % too.
  const { weightedPct } = computeWeightedSOV(posts, config)
  a.pct = weightedPct.get(companyA) || 0
  b.pct = weightedPct.get(companyB) || 0
  const winners = {
    sov: a.pct === b.pct ? null : a.pct > b.pct ? companyA : companyB,
    sentiment: a.avgSentiment === b.avgSentiment ? null : a.avgSentiment > b.avgSentiment ? companyA : companyB,
    volume: a.postCount === b.postCount ? null : a.postCount > b.postCount ? companyA : companyB,
  }
  return { a, b, winners }
}
