import { useState, useEffect, useCallback } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'

// Post-level 👍/👎 feedback for Social Briefs. Source of truth: the
// `post_feedback` table (one row per competitor-authored post, keyed by
// activity_id). Reads all rows into a map; writes upsert a single row.
//
// setVerdict(post, next) where next ∈ {'up','down',null}:
//   - clicking the same thumb again clears it (null) — the UI passes null.
//   - optimistic local update, then upsert; on error we refetch to resync.
export function useSocialBriefFeedback() {
  const [byId, setById] = useState({})   // activity_id -> row
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await fetchAllRows(() => supabase.from('post_feedback').select('*'))
      const m = {}
      for (const r of rows || []) if (r && r.activity_id != null) m[String(r.activity_id)] = r
      setById(m)
    } catch (err) {
      console.warn('[post_feedback] load failed:', err)
      setById({})
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // post: { id, company, week_start, url, generatorPicked }
  const setVerdict = useCallback(async (post, next) => {
    const id = String(post.id)
    if (!id) return
    const row = {
      activity_id: id,
      platform: 'LinkedIn',
      company: post.company || null,
      week_start: post.week_start || null,
      verdict: next,                      // 'up' | 'down' | null
      generator_picked: !!post.generatorPicked,
      post_url: post.url || null,
      updated_at: new Date().toISOString(),
    }
    // optimistic
    setById(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...row } }))
    const { error: upErr } = await supabase
      .from('post_feedback')
      .upsert(row, { onConflict: 'activity_id' })
    if (upErr) {
      console.warn('[post_feedback] upsert failed, resyncing:', upErr)
      fetchAll()
    }
  }, [fetchAll])

  return { byId, loading, error, setVerdict, refetch: fetchAll }
}
