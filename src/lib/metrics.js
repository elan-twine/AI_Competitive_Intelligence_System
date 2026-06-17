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

export function applyFilters(posts, { platform = 'All', sentiment = 'All', days = 0 } = {}) {
  let out = posts
  if (platform !== 'All') out = out.filter(p => p.platform === platform)
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
  const sentimentRows = rows.filter(p => p.sentiment != null)
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
const OVERALL_W = { unweighted: 0.30, weighted: 0.40, sentiment: 0.30 }

export function rankings(posts, config = DEFAULT_SOV_CONFIG) {
  const companies = [...new Set(posts.map(p => p.companyName).filter(Boolean))]
  const rows = companies.map(c => companyRow(posts, c))
  const totalUnweighted = rows.reduce((s, r) => s + r.unweightedSOV, 0) || 1

  // Cross-platform weighted SOV (within-platform share → weighted average).
  const { weightedPct: weightedMap } = computeWeightedSOV(posts, config)

  return rows
    .map(r => {
      const unweightedPct = (r.unweightedSOV / totalUnweighted) * 100
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
