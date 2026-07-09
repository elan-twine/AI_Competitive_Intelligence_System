import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useCachedFetch } from './useCachedFetch'
import { clearCache } from '../lib/cache'

// Source-of-truth competitor list (replaces the old hardcoded TRACKED_COMPANIES).
// Reads/writes the `competitors` table; RLS allows any authenticated user.
// A row: { id, name, aliases[], linkedin_urn, linkedin_url, domain, x_handle,
//          subreddits[], is_self, active }.
//
// The read is cached (localStorage); mutations clear the whole cache — editing a
// competitor changes SOV attribution and the roster everywhere, so the heavy
// post cache must be rebuilt on the next load.
export function useCompetitors() {
  const fetcher = useCallback(async () => {
    const { data, error } = await supabase
      .from('competitors')
      .select('*')
      .order('name', { ascending: true })
    if (error) throw new Error(error.message)
    return data || []
  }, [])

  const { data, loading, error, refetch } = useCachedFetch('competitors', fetcher, {})
  const competitors = data || []

  const addCompetitor = useCallback(async (fields) => {
    const { data: row, error: err } = await supabase
      .from('competitors').insert([fields]).select().single()
    if (err) throw err
    await clearCache()
    await refetch()
    return row
  }, [refetch])

  const updateCompetitor = useCallback(async (id, fields) => {
    const { data: row, error: err } = await supabase
      .from('competitors').update(fields).eq('id', id).select().single()
    if (err) throw err
    await clearCache()
    await refetch()
    return row
  }, [refetch])

  // Note: there is intentionally NO hard delete. "Removing" a competitor means
  // deactivating it (active=false) via updateCompetitor — it drops out of the
  // workflow scrape and the dashboard, but all historical rows are preserved
  // and it can be reactivated at any time.
  const setActive = useCallback((id, active) => updateCompetitor(id, { active }), [updateCompetitor])

  const activeCompetitors = competitors.filter(c => c.active !== false)

  return {
    competitors,
    activeCompetitors,
    loading,
    error,
    addCompetitor,
    updateCompetitor,
    setActive,
    refetch,
  }
}
