import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// The 10 companies we track. Anything else in the source tables is noise
// (mislabeled posts, comma-joined names like "Orchid Security, Lumos",
// generic categories like "None", or off-topic mentions) and must be
// filtered out so it doesn't leak into rankings / sentiment / feed.
export const TRACKED_COMPANIES = [
  'Twine Security',
  'Lumos',
  'Orchid Security',
  'Cerby',
  'Linx Security',
  'BlinkOps',
  'Opti',
  'Fabrix Security',
  'Surf AI',
  'Redblock',
]
const TRACKED_SET = new Set(TRACKED_COMPANIES.map(c => c.toLowerCase()))
const isTracked = (name) => !!name && TRACKED_SET.has(String(name).trim().toLowerCase())

export function useSOVData() {
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

  const rawPosts = [
    ...tweets.map(t => ({ ...t, platform: 'X', ts: t.createdAt })),
    ...redditPosts.map(r => ({ ...r, platform: 'Reddit', ts: r.createdAt })),
    ...googleNews.map(g => ({ ...g, platform: 'Google News', ts: g.publishedAt })),
    ...linkedinPosts.map(l => ({ ...l, platform: 'LinkedIn', ts: l.posted_at })),
  ].filter(p => isTracked(p.companyName))

  // Two concerns to balance:
  //   1. n8n's weightedSOV is on different scales per platform (Reddit's
  //      log compression vs X's engagement × decay), so naively summing
  //      raw values double-counts whichever platform has the biggest scale.
  //   2. But platforms also have very different data volumes (LinkedIn 325
  //      posts vs X 15 vs Reddit 4) and a platform with 4 posts shouldn't
  //      count as much as one with 325. Per-platform-equal weighting was
  //      letting tiny platforms dominate composite rankings.
  //
  // Fix: normalize within each platform (handles concern 1), then weight
  // each platform's contribution by its share of total posts (handles
  // concern 2). Each post's contribution becomes:
  //   unweightedSOV = 1 / totalPostsAcrossAll          (pure post share)
  //   weightedSOV   = (post.weightedSOV / Σ_platform)
  //                   × (platformPostCount / totalPostsAcrossAll)
  // Falls back to post-share if a platform's weighted pool is zero (e.g.
  // Google News calc is broken upstream).
  const platformPostCounts = {}
  const platformWeightedTotals = {}
  for (const p of rawPosts) {
    const k = p.platform
    platformPostCounts[k] = (platformPostCounts[k] || 0) + 1
    platformWeightedTotals[k] = (platformWeightedTotals[k] || 0) + (p.weightedSOV || 0)
  }
  const totalPosts = rawPosts.length || 1
  const allPosts = rawPosts.map(p => {
    const postCount = platformPostCounts[p.platform] || 1
    const weightedTotal = platformWeightedTotals[p.platform] || 0
    const platformShare = postCount / totalPosts // platform's fraction of all posts
    const unweighted = 1 / totalPosts
    const platformFraction = weightedTotal > 0
      ? (p.weightedSOV || 0) / weightedTotal
      : 1 / postCount
    const weighted = platformFraction * platformShare
    return {
      ...p,
      // Preserve the raw n8n score for per-post display in the feed.
      rawWeightedSOV: p.weightedSOV || 0,
      unweightedSOV: unweighted,
      weightedSOV: weighted,
      sov: unweighted,
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
    allPosts, companies, loading, error, refetch: fetchAll,
    getCompanySOV, getCompanySentiment, getPlatformBreakdown,
  }
}
