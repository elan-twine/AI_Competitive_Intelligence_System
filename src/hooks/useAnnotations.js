import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Team-authored event markers rendered on the SOV trend chart (see the
// sov_annotations table + its RLS: read-all, insert/delete-own for logged-in
// users). Not cached — the list is tiny and edits should show immediately.
// Fails soft: a read error leaves an empty list and the chart just shows no
// markers. Returns { annotations, add, remove, error }.
export function useAnnotations() {
  const [annotations, setAnnotations] = useState([])
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('sov_annotations')
      .select('id, event_date, label, note, created_by')
      .order('event_date', { ascending: true })
    if (error) { setError(error.message); return }
    setError(null)
    setAnnotations(Array.isArray(data) ? data : [])
  }, [])

  // Load once on mount (and if load's identity changes). Standard data-fetch
  // effect; the lint rule flags the async setState conservatively.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  // Add a marker (created_by defaults to auth.uid() server-side). Optimistic-ish:
  // re-loads on success so the id/created_by come from the row that landed.
  const add = useCallback(async ({ event_date, label, note }) => {
    const clean = { event_date, label: String(label || '').trim().slice(0, 80), note: (note ? String(note).trim().slice(0, 400) : null) }
    if (!clean.event_date || !clean.label) return { error: 'A date and a label are required.' }
    const { error } = await supabase.from('sov_annotations').insert(clean)
    if (error) return { error: error.message }
    await load()
    return {}
  }, [load])

  // Delete a marker (RLS allows only your own — a foreign one no-ops server-side).
  const remove = useCallback(async (id) => {
    setAnnotations(prev => prev.filter(a => a.id !== id)) // optimistic
    const { error } = await supabase.from('sov_annotations').delete().eq('id', id)
    if (error) { await load(); return { error: error.message } } // rollback via reload
    return {}
  }, [load])

  return { annotations, add, remove, error }
}
