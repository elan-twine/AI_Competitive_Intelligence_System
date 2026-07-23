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
  const [userId, setUserId] = useState(null) // to gate delete to owned markers

  useEffect(() => {
    let alive = true
    supabase.auth.getUser().then(({ data }) => { if (alive) setUserId(data?.user?.id || null) })
    return () => { alive = false }
  }, [])

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('sov_annotations')
      .select('id, event_date, end_date, label, note, created_by')
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
  const add = useCallback(async ({ event_date, end_date, label, note }) => {
    const clean = {
      event_date,
      // NULL end_date = single-date event; else a range. Blank/invalid → single.
      end_date: (end_date && String(end_date).trim()) ? String(end_date).trim() : null,
      label: String(label || '').trim().slice(0, 80),
      note: (note ? String(note).trim().slice(0, 400) : null),
    }
    if (!clean.event_date || !clean.label) return { error: 'A date and a label are required.' }
    if (clean.end_date && clean.end_date < clean.event_date) return { error: 'The end date must be on or after the start date.' }
    const { error } = await supabase.from('sov_annotations').insert(clean)
    if (error) return { error: error.message }
    await load()
    return {}
  }, [load])

  // Delete a marker. RLS allows only your own, and a blocked delete returns 2xx
  // with ZERO rows (no error) — so we .select() the deleted rows and, if none
  // came back, reload to restore the chip and report it, instead of a silent
  // false success. (The UI also hides the delete button on markers you don't own.)
  const remove = useCallback(async (id) => {
    setAnnotations(prev => prev.filter(a => a.id !== id)) // optimistic
    const { data, error } = await supabase.from('sov_annotations').delete().eq('id', id).select('id')
    if (error || !Array.isArray(data) || data.length === 0) {
      await load() // restore
      return { error: error?.message || "That marker isn't yours to remove." }
    }
    return {}
  }, [load])

  return { annotations, userId, add, remove, error }
}
