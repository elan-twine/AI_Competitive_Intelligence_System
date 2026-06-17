import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useCompetitors } from './useCompetitors'

// The set of company names/aliases we track now comes from the `competitors`
// table (source of truth), not a hardcoded list. Anything else in the source
// tables is noise (mislabeled posts, comma-joined names, generic categories
// like "None", off-topic mentions) and is filtered out.
//
// `competitors` may be passed in; if omitted the hook fetches it itself via
// useCompetitors so existing call sites (useSOVData()) keep working.
function buildTrackedIndex(competitors) {
  // map: normalized name/alias -> canonical competitor name
  const index = new Map()
  for (const c of competitors || []) {
    if (c.active === false) continue
    const canonical = c.name
    const add = (val) => {
      const key = String(val || '').trim().toLowerCase()
      if (key) index.set(key, canonical)
    }
    add(c.name)
    for (const a of c.aliases || []) add(a)
  }
  return index
}

export function useSOVData(competitorsArg) {
  const own = useCompetitors()
  const competitors = competitorsArg ?? own.competitors

  const [tweets, setTweets] = useState([])
  const [redditPosts, setRedditPosts] = useState([])
  const [googleNews, setGoogleNews] = useState([])
  const [linkedinPosts, setLinkedinPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  async function fetchAll() {
    setLoading(true)
    setError(null)

    const safeQuery = async (table, orderCol) => {
      try {
        const res = await supabase.from(table).select('*').order(orderCol, { ascending: false })
        if (res.error) {
          console.warn(`[SOV] ${table} query error:`, res.error.message)
          return []
        }
        return res.data || []
      } catch (err) {
        console.warn(`[SOV] ${table} threw:`, err)
        return []
      }
    }

    const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 8000))

    try {
      const result = await Promise.race([
        Promise.all([
          safeQuery('tweets', 'createdAt'),
          safeQuery('reddit_posts', 'createdAt'),
          safeQuery('googlenews', 'publishedAt'),
          safeQuery('linkedin_posts', 'posted_at'),
        ]),
        timeout,
      ])

      if (result === 'timeout') {
        console.warn('[SOV] fetch timed out after 8s — rendering empty state')
        setTweets([]); setRedditPosts([]); setGoogleNews([]); setLinkedinPosts([])
      } else {
        const [tw, rd, gn, li] = result
        setTweets(tw)
        setRedditPosts(rd)
        setGoogleNews(gn)
        setLinkedinPosts(li)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAll()
  }, [])

  // Tracked-name index from the competitor list (name + aliases, case-insensitive,
  // trimmed). isTracked returns the canonical name (or null) so attributed posts
  // collapse aliases onto one display name.
  const trackedIndex = buildTrackedIndex(competitors)
  const canonicalOf = (name) => {
    if (!name) return null
    return trackedIndex.get(String(name).trim().toLowerCase()) || null
  }
  const isTracked = (name) => canonicalOf(name) != null

  const rawPosts = [
    ...tweets.map(t => ({ ...t, platform: 'X', ts: t.createdAt })),
    ...redditPosts.map(r => ({ ...r, platform: 'Reddit', ts: r.createdAt })),
    ...googleNews.map(g => ({ ...g, platform: 'Google News', ts: g.publishedAt })),
    ...linkedinPosts.map(l => ({ ...l, platform: 'LinkedIn', ts: l.posted_at })),
  ]
    .filter(p => isTracked(p.companyName))
    // Normalize aliases onto the canonical competitor name.
    .map(p => ({ ...p, companyName: canonicalOf(p.companyName) }))

  // Per-post weight: prefer the n8n-computed `post_weight` (new field), fall
  // back to the legacy `weightedSOV` during the data transition. This drives
  // the within-platform share in metrics.js (computeWeightedSOV).
  const postWeight = (p) => {
    const w = p.post_weight
    if (w != null && !isNaN(w)) return Number(w)
    if (p.weightedSOV != null && !isNaN(p.weightedSOV)) return Number(p.weightedSOV)
    return 1
  }

  // Per-post fields the rest of the app expects:
  //   unweightedSOV — pure post-count share (1 / total posts)
  //   weightedSOV   — the per-post weight (within-platform share is computed
  //                   downstream in metrics.computeWeightedSOV)
  //   postWeight    — explicit alias of the chosen weight for clarity
  //   rawWeightedSOV/sov — preserved for the feed's per-post display
  const totalPosts = rawPosts.length || 1
  const allPosts = rawPosts.map(p => {
    const w = postWeight(p)
    return {
      ...p,
      rawWeightedSOV: p.weightedSOV ?? p.post_weight ?? 0,
      postWeight: w,
      unweightedSOV: 1 / totalPosts,
      weightedSOV: w,
      sov: 1 / totalPosts,
    }
  })

  const companies = [...new Set(allPosts.map(p => p.companyName).filter(Boolean))]

  function getCompanySOV(company) {
    return allPosts
      .filter(p => p.companyName === company)
      .reduce((sum, p) => sum + (p.sov || 0), 0)
  }

  function getCompanySentiment(company) {
    const posts = allPosts.filter(p => p.companyName === company && p.sentiment != null)
    if (posts.length === 0) return 0
    return posts.reduce((sum, p) => sum + (p.sentiment || 0), 0) / posts.length
  }

  function getPlatformBreakdown(company) {
    const posts = allPosts.filter(p => !company || p.companyName === company)
    const platforms = {}
    for (const p of posts) {
      if (!platforms[p.platform]) platforms[p.platform] = { count: 0, sov: 0 }
      platforms[p.platform].count++
      platforms[p.platform].sov += p.sov || 0
    }
    return platforms
  }

  return {
    tweets, redditPosts, googleNews, linkedinPosts,
    allPosts, companies, competitors,
    loading: loading || own.loading,
    error: error || own.error,
    refetch: fetchAll,
    getCompanySOV, getCompanySentiment, getPlatformBreakdown,
  }
}
