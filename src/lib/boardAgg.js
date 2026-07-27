// Board computation from the sov_board_agg RPC — the server-side aggregation
// path for the ranking table + stat cards. The RPC returns per-(company,
// platform) rows { company, platform, wsum, cnt, sent_sum, sent_cnt } where
// wsum = Σ stored post_weight; this module turns them into the same board
// rankings() computes from raw posts (OVERALL_W is weighted-only, so the
// board number IS the pooled share), without shipping a single post to the
// browser. ~60 tiny rows regardless of post volume — this is the guard
// against the firehose-timeout class of failure (PR #139).
//
// Semantics matched to the client path:
//   - platform multipliers from sov_config scale each platform's wsum
//   - platform filter = drop non-selected platforms' rows (multi-select union)
//   - aliases collapse onto the canonical competitor name (the RPC groups by
//     the raw stored string; the client's isTracked() canonicalizes)
//   - untracked names (mislabels, removed competitors) are dropped
//   - DIRECT competitors only in the pool; share normalized over that pool
//   - sentiment is NOT computed here: the client's sentiment is external-only
//     (author-tier logic that lives in JS), so the caller enriches it from the
//     posts firehose when available. sent_sum/sent_cnt ride along as
//     all-posts values for consumers that want them.

// name/alias (normalized) -> canonical competitor name, for ACTIVE competitors.
export function canonicalIndex(competitors) {
  const index = new Map()
  for (const c of competitors || []) {
    if (c.active === false) continue
    const add = (v) => { const k = String(v || '').trim().toLowerCase(); if (k) index.set(k, c.name) }
    add(c.name)
    for (const a of c.aliases || []) add(a)
  }
  return index
}

export function boardFromAgg(rows, { multipliers, platforms, competitors } = {}) {
  const mult = multipliers || {}
  const idx = canonicalIndex(competitors)
  const directNames = new Set(
    (competitors || [])
      .filter(c => c.active !== false && (c.type || 'direct') !== 'indirect')
      .map(c => c.name)
  )
  const platformSet = platforms && platforms.length ? new Set(platforms) : null

  // Canonicalize + scale + accumulate.
  const acc = new Map() // canonical -> { impact, postCount, sentSum, sentCnt, byPlatform }
  for (const r of rows || []) {
    if (platformSet && !platformSet.has(r.platform)) continue
    const canonical = idx.get(String(r.company || '').trim().toLowerCase())
    if (!canonical) continue // untracked/mislabel/removed — same drop as isTracked()
    const m = mult[r.platform] != null ? mult[r.platform] : 0
    if (!m) continue
    const impact = m * (Number(r.wsum) || 0)
    let a = acc.get(canonical)
    if (!a) { a = { impact: 0, postCount: 0, sentSum: 0, sentCnt: 0, byPlatform: {} }; acc.set(canonical, a) }
    a.impact += impact
    a.postCount += Number(r.cnt) || 0
    a.sentSum += Number(r.sent_sum) || 0
    a.sentCnt += Number(r.sent_cnt) || 0
    a.byPlatform[r.platform] = (a.byPlatform[r.platform] || 0) + impact
  }

  // Share of the DIRECT pool (indirect are tracked but out of the denominator).
  let directTotal = 0
  for (const [name, a] of acc) if (directNames.has(name)) directTotal += a.impact

  const direct = [], indirect = []
  for (const [company, a] of acc) {
    const weightedPct = directTotal > 0 ? (a.impact / directTotal) * 100 : 0
    const row = {
      company,
      weightedPct,
      overall: weightedPct, // OVERALL_W is weighted-only; kept for shape parity
      postCount: a.postCount,
      impact: a.impact,
      byPlatform: a.byPlatform,
      // All-posts sentiment from the RPC — NOT the external-only figure the
      // table shows. Callers overlay posts-derived sentiment when available.
      sentSumAll: a.sentSum,
      sentCntAll: a.sentCnt,
    }
    ;(directNames.has(company) ? direct : indirect).push(row)
  }
  direct.sort((a, b) => b.weightedPct - a.weightedPct)
  indirect.sort((a, b) => b.impact - a.impact)
  return { direct, indirect, directTotal }
}
