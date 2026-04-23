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
  const weightedSOV = rows.reduce((s, p) => s + (p.weightedSOV || p.sov || 0), 0)
  const sentimentRows = rows.filter(p => p.sentiment != null)
  const avgSentiment = sentimentRows.length
    ? sentimentRows.reduce((s, p) => s + p.sentiment, 0) / sentimentRows.length
    : 0
  return { company, postCount, unweightedSOV, weightedSOV, avgSentiment, posts: rows }
}

export function rankings(posts) {
  const companies = [...new Set(posts.map(p => p.companyName).filter(Boolean))]
  return companies.map(c => companyRow(posts, c)).sort((a, b) => b.weightedSOV - a.weightedSOV)
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
  const winners = {
    sov: a.weightedSOV === b.weightedSOV ? null : a.weightedSOV > b.weightedSOV ? companyA : companyB,
    sentiment: a.avgSentiment === b.avgSentiment ? null : a.avgSentiment > b.avgSentiment ? companyA : companyB,
    volume: a.postCount === b.postCount ? null : a.postCount > b.postCount ? companyA : companyB,
  }
  return { a, b, winners }
}
