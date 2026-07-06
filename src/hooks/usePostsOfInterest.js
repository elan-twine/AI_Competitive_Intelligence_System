import { useState, useEffect } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'

// Curated "posts of interest" — competitor posts (their accounts/employees)
// flagged as showing marketing-strategy shifts, launches, campaigns, etc.
// Source of truth: the `posts_of_interest` table, written by the n8n weekly run.
// Columns: { id, author (company), date (post date), created_at, summary,
//            relevance_reason, url }.
export function usePostsOfInterest() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  async function fetchAll() {
    setLoading(true)
    setError(null)
    try {
      // Paginated: posts_of_interest accumulates every notable competitor post,
      // so it will eventually cross Supabase's 1000-row response cap.
      const rows = await fetchAllRows(() => supabase
        .from('posts_of_interest')
        .select('*')
        .order('date', { ascending: false }))
      setPosts(rows || [])
    } catch (err) {
      console.warn('[posts_of_interest] threw:', err)
      setPosts([])
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  return { posts, loading, error, refetch: fetchAll }
}
