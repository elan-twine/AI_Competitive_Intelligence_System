// Pure analytics helpers. Take a posts array (post = row with
// { companyName, sov, sentiment, platform, ts, unweightedSOV, weightedSOV,
//   postWeight, ... }) and return derived data.
//
// SOV methodology (see SOV_METHODOLOGY.md):
//   1. Per-post weight: n8n stores `post_weight` per row (preferred). Older
//      rows lack it, so we fall back to the legacy `weightedSOV` field.
//   2. Within-platform share FIRST: each brand's share of total weight on a
//      platform (0..1, scale-free — never sum raw engagement across platforms).
//   3. Weighted-average across platforms using config platform weights.
//   4. Min-volume guard: drop a platform whose total weighted score is below
//      `minPlatformVolume` for the period, then renormalize platform weights.
//   5. Sentiment is its own dimension (net + positive/negative split); a
//      negative-mention spike never inflates SOV.

import { DEFAULT_SOV_CONFIG } from '../hooks/useSOVConfig'

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

export function companyRow(posts, company) {
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
  return { company, postCount, unweightedSOV, weightedSOV, avgSentiment, posts: rows }
}

export function totalWeightedSOV(posts) {
  return posts.reduce((s, p) => s + (p.weightedSOV || 0), 0)
}

// ---------------------------------------------------------------------------
// Methodology core: per-platform brand share → cross-platform weighted SOV.
// Returns a Map(company -> weightedPct 0..100) plus the effective platform
// weights actually used (after min-volume guard + renormalization).
// ---------------------------------------------------------------------------
export function computeWeightedSOV(posts, config = DEFAULT_SOV_CONFIG) {
  const platformWeights = config.platformWeights || DEFAULT_SOV_CONFIG.platformWeights
  const minVolume = config.minPlatformVolume ?? DEFAULT_SOV_CONFIG.minPlatformVolume

  // Σ post_weight per platform, and per (platform, company).
  const platformTotals = {}          // platform -> total weight
  const platformCompany = {}         // platform -> { company -> weight }
  for (const p of posts) {
    const plat = p.platform
    if (!plat || !p.companyName) continue
    const w = postWeightOf(p)
    platformTotals[plat] = (platformTotals[plat] || 0) + w
    if (!platformCompany[plat]) platformCompany[plat] = {}
    platformCompany[plat][p.companyName] = (platformCompany[plat][p.companyName] || 0) + w
  }

  // Min-volume guard: drop low-signal platforms for this period.
  const livePlatforms = Object.keys(platformTotals).filter(
    plat => platformTotals[plat] >= minVolume
  )
  // If the guard removed everything (very small dataset), fall back to all.
  const usePlatforms = livePlatforms.length ? livePlatforms : Object.keys(platformTotals)

  // Renormalize platform weights over the surviving platforms.
  const weightSum = usePlatforms.reduce((s, plat) => s + (platformWeights[plat] || 0), 0) || 1
  const effectiveWeights = {}
  for (const plat of usePlatforms) {
    effectiveWeights[plat] = (platformWeights[plat] || 0) / weightSum
  }

  // SOV_total(brand) = Σ_platform [ platform_weight × within-platform share ].
  const out = new Map()
  for (const plat of usePlatforms) {
    const total = platformTotals[plat] || 0
    if (total <= 0) continue
    const pw = effectiveWeights[plat]
    for (const [company, w] of Object.entries(platformCompany[plat] || {})) {
      const share = w / total
      out.set(company, (out.get(company) || 0) + pw * share)
    }
  }

  // Scale 0..1 → 0..100 for display.
  const pct = new Map()
  for (const [company, v] of out) pct.set(company, v * 100)
  return { weightedPct: pct, effectiveWeights, platformTotals }
}

// ---------------------------------------------------------------------------
// Weekly SOV trend. Buckets posts into anchor-aligned weeks by `post.ts`, then
// computes per-competitor cross-platform weighted SOV for EACH week using the
// SAME methodology as computeWeightedSOV (within-platform share → weighted
// average across platforms, with the min-volume guard). Output is shaped for
// recharts: one row per week, one numeric key per company (SOV 0..100).
// ---------------------------------------------------------------------------

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

function ymd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export function weeklySOVSeries(posts, config = DEFAULT_SOV_CONFIG, opts = {}) {
  const { weeks = 12 } = opts

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

  // Ascending by week, then keep only the most recent N.
  let labels = [...buckets.keys()].sort() // 'YYYY-MM-DD' sorts lexicographically
  if (weeks > 0 && labels.length > weeks) labels = labels.slice(labels.length - weeks)

  // Per-week, run the shared methodology and flatten into recharts rows.
  return labels.map(week => {
    const { weightedPct } = computeWeightedSOV(buckets.get(week), config)
    const row = { week }
    for (const [company, pct] of weightedPct) {
      row[company] = Math.round(pct * 10) / 10 // 0..100, one decimal
    }
    return row
  })
}

// Live weekly sentiment series (0–100 index, 50 = neutral), computed from the
// given posts so it can respect the platform/time filters. Mirrors the frozen
// sov_weekly.sentiment_pct semantics: EXTERNAL posts only (earned perception,
// not the company's own posts), averaged per company per ISO week and rescaled
// from the -3..+3 per-post scale. Shape matches weeklySOVSeries: { week, [company]: value }.
export function weeklySentimentSeries(posts, opts = {}) {
  const { weeks = 26 } = opts
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
  let labels = [...buckets.keys()].sort()
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

// Sentiment as its own dimension: net sentiment % and positive-vs-negative
// SOV split. Net = (pos - neg) / total mentions, expressed as %.
export function sentimentDimension(posts, company) {
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

export function platformSplit(posts, company) {
  const rows = company ? posts.filter(p => p.companyName === company) : posts
  const platforms = {}
  for (const p of rows) {
    if (!platforms[p.platform]) platforms[p.platform] = { count: 0, sov: 0 }
    platforms[p.platform].count++
    platforms[p.platform].sov += p.sov || 0
  }
  return platforms
}

export function sentimentBuckets(posts, company) {
  const rows = (company ? posts.filter(p => p.companyName === company) : posts).filter(p => p.sentiment != null)
  let positive = 0, neutral = 0, negative = 0
  for (const p of rows) {
    if (p.sentiment > 0) positive++
    else if (p.sentiment < 0) negative++
    else neutral++
  }
  return { positive, neutral, negative, total: rows.length }
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
