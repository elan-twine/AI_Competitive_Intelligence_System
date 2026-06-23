// Growth strategy analysis for Twine: where the SOV score is weak and the
// highest-leverage, concrete moves to climb the board.
//
// Design principle: this module never re-implements the SOV math. It calls the
// SAME `rankings()` used by the dashboard for both the current board AND every
// what-if simulation (append synthetic Twine mentions, re-rank). So the numbers
// shown here can never drift from the board the user is looking at.

import { rankings, computeWeightedSOV, postWeightOf } from './metrics'
import { DEFAULT_SOV_CONFIG } from '../hooks/useSOVConfig'

const TWINE_RE = /twine/i
export const PLATFORMS = ['LinkedIn', 'Google News', 'Reddit', 'X']

function median(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function quantile(arr, q) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const pos = (s.length - 1) * q
  const b = Math.floor(pos)
  const rest = pos - b
  return s[b + 1] !== undefined ? s[b] + rest * (s[b + 1] - s[b]) : s[b]
}

function twineNameIn(posts) {
  const hit = posts.find(p => TWINE_RE.test(p.companyName || ''))
  return hit ? hit.companyName : 'Twine Security'
}

// Append k synthetic Twine mentions on `platform` at the given per-post weight
// and sentiment, then re-rank with the EXACT dashboard methodology.
export function simulateAdd(posts, config, platform, k, unitPw, unitSent) {
  if (!k || k <= 0) {
    const r = rankings(posts, config)
    const twine = twineNameIn(posts)
    const idx = r.findIndex(x => x.company === twine)
    return { overall: idx >= 0 ? r[idx].overall : 0, rank: idx + 1, ranked: r }
  }
  const twine = twineNameIn(posts)
  // Real posts carry unweightedSOV = 1/N; synthetic posts must use the same unit
  // so the post-count share renormalizes correctly to (twineCount+k)/(N+k).
  const u = posts.length ? (posts[0].unweightedSOV || 1 / posts.length) : 1
  const ts = new Date().toISOString()
  const synth = []
  for (let i = 0; i < k; i++) {
    synth.push({
      companyName: twine, platform, sentiment: unitSent,
      post_weight: unitPw, postWeight: unitPw, weightedSOV: unitPw,
      unweightedSOV: u, sov: u, ts,
    })
  }
  const r = rankings(posts.concat(synth), config)
  const idx = r.findIndex(x => x.company === twine)
  return { overall: idx >= 0 ? r[idx].overall : 0, rank: idx + 1, ranked: r }
}

// Fewest mentions on `platform` (at unitPw/unitSent) to reach targetOverall.
// `overall` is monotonic increasing in k, so binary-search the count. Returns
// null if unreachable within `cap`.
export function mentionsToReach(posts, config, platform, unitPw, unitSent, targetOverall, cap = 500) {
  if (simulateAdd(posts, config, platform, cap, unitPw, unitSent).overall < targetOverall) return null
  let lo = 1, hi = cap
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (simulateAdd(posts, config, platform, mid, unitPw, unitSent).overall >= targetOverall) hi = mid
    else lo = mid + 1
  }
  const sim = simulateAdd(posts, config, platform, lo, unitPw, unitSent)
  return { mentions: lo, overall: sim.overall, rank: sim.rank }
}

export function growthAnalysis(posts, config = DEFAULT_SOV_CONFIG) {
  const twine = twineNameIn(posts)
  const ranked = rankings(posts, config)
  const minVolume = config.minPlatformVolume ?? DEFAULT_SOV_CONFIG.minPlatformVolume
  const idx = ranked.findIndex(r => r.company === twine)
  if (idx < 0) return null
  const twineRow = ranked[idx]
  const above1 = idx > 0 ? ranked[idx - 1] : null   // company one rank above
  const above2 = idx > 1 ? ranked[idx - 2] : null   // two ranks above
  const leader = ranked[0]

  // ---- component contributions (matches OVERALL_W in metrics.js) ----
  const W = config.overallWeights || { unweighted: 0.30, weighted: 0.40, sentiment: 0.30 }
  const components = [
    { key: 'weighted', label: 'Weighted SOV', pct: twineRow.weightedPct, contribution: W.weighted * twineRow.weightedPct, leaderPct: leader.weightedPct, weight: W.weighted },
    { key: 'unweighted', label: 'Volume (post share)', pct: twineRow.unweightedPct, contribution: W.unweighted * twineRow.unweightedPct, leaderPct: leader.unweightedPct, weight: W.unweighted },
    { key: 'sentiment', label: 'Sentiment', pct: twineRow.sentimentScaled, contribution: W.sentiment * twineRow.sentimentScaled, leaderPct: leader.sentimentScaled, weight: W.sentiment },
  ]
  // weakest = biggest gap to the leader, scaled by how much that dimension counts
  const weakest = [...components].sort(
    (a, b) => (b.leaderPct - b.pct) * b.weight - (a.leaderPct - a.pct) * a.weight
  )[0]

  // ---- per-platform stats ----
  const { platformTotals, effectiveWeights } = computeWeightedSOV(posts, config)
  const byPlat = {}
  for (const p of posts) {
    const plat = p.platform
    if (!plat || !p.companyName) continue
    const w = postWeightOf(p)
    if (!byPlat[plat]) byPlat[plat] = { allPw: [], twinePw: 0, twineCount: 0 }
    byPlat[plat].allPw.push(w)
    if (p.companyName === twine) { byPlat[plat].twinePw += w; byPlat[plat].twineCount++ }
  }
  const base = twineRow.overall
  const unitSent = twineRow.avgSentiment || 2
  const platforms = PLATFORMS.map(plat => {
    const d = byPlat[plat] || { allPw: [], twinePw: 0, twineCount: 0 }
    const total = platformTotals[plat] || 0
    const unit = median(d.allPw)
    const lift10 = simulateAdd(posts, config, plat, 10, unit || 0.5, unitSent).overall - base
    return {
      platform: plat,
      twineCount: d.twineCount,
      twinePwShare: total > 0 ? (d.twinePw / total) * 100 : 0,
      eligible: total >= minVolume,
      platformTotal: total,
      unitMedian: unit,
      unitP75: quantile(d.allPw, 0.75),
      unitP90: quantile(d.allPw, 0.90),
      liftPer10Typical: lift10,
    }
  })

  // ---- concrete climb targets (LinkedIn quality tiers + News) ----
  const li = byPlat['LinkedIn'] || { allPw: [] }
  const tiers = [
    { key: 'viral', label: 'high-engagement', unit: quantile(li.allPw, 0.90) },
    { key: 'strong', label: 'solid', unit: quantile(li.allPw, 0.75) },
    { key: 'typical', label: 'average', unit: median(li.allPw) },
  ]
  function targetFor(row) {
    if (!row) return null
    const t = row.overall + 1e-6
    return {
      company: row.company,
      targetOverall: row.overall,
      linkedin: tiers.map(tt => ({
        ...tt,
        ...(mentionsToReach(posts, config, 'LinkedIn', tt.unit || 0.5, unitSent, t) || { mentions: null }),
      })),
      news: mentionsToReach(posts, config, 'Google News', median((byPlat['Google News'] || { allPw: [] }).allPw) || 0.2, unitSent, t),
    }
  }

  return {
    twine: { company: twine, rank: idx + 1, ...twineRow },
    total: ranked.length,
    ranked,
    leader, above1, above2,
    components, weakest,
    platforms,
    effectiveWeights,
    targets: { toRank: idx, next: targetFor(above1), nextNext: targetFor(above2) },
    config: { minVolume, overallWeights: W },
  }
}
