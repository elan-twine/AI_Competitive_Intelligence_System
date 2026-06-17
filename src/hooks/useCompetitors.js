import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Source-of-truth competitor list (replaces the old hardcoded TRACKED_COMPANIES).
// Reads/writes the `competitors` table; RLS allows any authenticated user.
// A row: { id, name, aliases[], linkedin_urn, linkedin_url, domain, x_handle,
//          subreddits[], is_self, active }.
export function useCompetitors() {
  const [competitors, setCompetitors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase
        .from('competitors')
        .select('*')
        .order('name', { ascending: true })
      if (error) {
        console.warn('[competitors] query error:', error.message)
        setError(error.message)
        setCompetitors([])
      } else {
        setCompetitors(data || [])
      }
    } catch (err) {
      console.warn('[competitors] threw:', err)
      setError(err.message)
      setCompetitors([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refetch() }, [refetch])

  const addCompetitor = useCallback(async (fields) => {
    const { data, error } = await supabase
      .from('competitors')
      .insert([fields])
      .select()
      .single()
    if (error) throw error
    await refetch()
    return data
  }, [refetch])

  const updateCompetitor = useCallback(async (id, fields) => {
    const { data, error } = await supabase
      .from('competitors')
      .update(fields)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    await refetch()
    return data
  }, [refetch])

  // Note: there is intentionally NO hard delete. "Removing" a competitor means
  // deactivating it (active=false) via updateCompetitor — it drops out of the
  // workflow scrape and the dashboard, but all historical rows are preserved
  // and it can be reactivated at any time.
  const setActive = useCallback(async (id, active) => {
    return updateCompetitor(id, { active })
  }, [updateCompetitor])

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
