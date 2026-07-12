import { useCallback } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useCachedFetch } from './useCachedFetch'

// Curated "posts of interest" — competitor posts (their accounts/employees)
// flagged as showing marketing-strategy shifts, launches, campaigns, etc.
// Source of truth: the `posts_of_interest` table, written by the n8n weekly run.
// Columns: { id, author (company), date (post date), created_at, summary,
//            relevance_reason, url, taste_score, ... }.
//
// Cached (localStorage) — written once a week by the generator, so reloads read
// from cache.
export function usePostsOfInterest() {
  const fetcher = useCallback(async () => {
    // Paginated: posts_of_interest accumulates every notable competitor post,
    // so it will eventually cross Supabase's 1000-row response cap.
    return await fetchAllRows(() => supabase
      .from('posts_of_interest')
      .select('*')
      .order('date', { ascending: false }))
  }, [])

  const { data, loading, error, refetch } = useCachedFetch('posts_of_interest', fetcher, {})
  return { posts: data || [], loading, error, refetch }
}
