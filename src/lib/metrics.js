// Pure analytics helpers. Take a posts array (post = row with
// { companyName, sov, sentiment, platform, ts, unweightedSOV, weightedSOV, ... })
// and return derived data. Easy to 1:1 port to Supabase RPCs later.

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

// Composite "Overall" score weights — easy to tweak in one place.
// Sentiment is rescaled from -3..+3 into 0..100 so it lives on the same
// scale as the two percent columns.
const OVERALL_W = { unweighted: 0.35, weighted: 0.35, sentiment: 0.30 }

export function rankings(posts) {
  const companies = [...new Set(posts.map(p => p.companyName).filter(Boolean))]
  const rows = companies.map(c => companyRow(posts, c))
  const totalUnweighted = rows.reduce((s, r) => s + r.unweightedSOV, 0) || 1
  const totalWeighted = rows.reduce((s, r) => s + r.weightedSOV, 0) || 1
  return rows
    .map(r => {
      const unweightedPct = (r.unweightedSOV / totalUnweighted) * 100
      const weightedPct = (r.weightedSOV / totalWeighted) * 100
      const sentimentScaled = ((r.avgSentiment + 3) / 6) * 100
      const overall =
        OVERALL_W.unweighted * unweightedPct +
        OVERALL_W.weighted * weightedPct +
        OVERALL_W.sentiment * sentimentScaled
      return { ...r, pct: unweightedPct, unweightedPct, weightedPct, sentimentScaled, overall }
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

export function compare(posts, companyA, companyB) {
  const a = companyRow(posts, companyA)
  const b = companyRow(posts, companyB)
  const total = posts.reduce((s, p) => s + (p.unweightedSOV || 0), 0) || 1
  a.pct = (a.unweightedSOV / total) * 100
  b.pct = (b.unweightedSOV / total) * 100
  const winners = {
    sov: a.unweightedSOV === b.unweightedSOV ? null : a.unweightedSOV > b.unweightedSOV ? companyA : companyB,
    sentiment: a.avgSentiment === b.avgSentiment ? null : a.avgSentiment > b.avgSentiment ? companyA : companyB,
    volume: a.postCount === b.postCount ? null : a.postCount > b.postCount ? companyA : companyB,
  }
  return { a, b, winners }
}
