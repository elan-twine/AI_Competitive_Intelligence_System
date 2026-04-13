import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

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
    try {
      const [tweetsRes, redditRes, newsRes, linkedinRes] = await Promise.all([
        supabase.from('tweets').select('*').order('createdAt', { ascending: false }),
        supabase.from('reddit_posts').select('*').order('createdAt', { ascending: false }),
        supabase.from('googlenews').select('*').order('publishedAt', { ascending: false }),
        supabase.from('linkedin_posts').select('*').order('posted_at', { ascending: false }),
      ])

      if (tweetsRes.error) throw tweetsRes.error
      if (redditRes.error) throw redditRes.error
      if (newsRes.error) throw newsRes.error
      if (linkedinRes.error) throw linkedinRes.error

      setTweets(tweetsRes.data || [])
      setRedditPosts(redditRes.data || [])
      setGoogleNews(newsRes.data || [])
      setLinkedinPosts(linkedinRes.data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAll()
  }, [])

  const allPosts = [
    ...tweets.map(t => ({ ...t, platform: 'X', sov: t.weightedSOV || t.unweightedSOV || 0 })),
    ...redditPosts.map(r => ({ ...r, platform: 'Reddit', sov: r.weightedSOV || r.unweightedSOV || 0 })),
    ...googleNews.map(g => ({ ...g, platform: 'Google News', sov: g.weightedSOV || g.unweightedSOV || 0 })),
    ...linkedinPosts.map(l => ({ ...l, platform: 'LinkedIn', sov: l.weightedSOV || l.unweightedSOV || 0 })),
  ]

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
