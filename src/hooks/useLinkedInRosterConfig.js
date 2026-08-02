import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Editable config for the LinkedIn employee-engagement metric (OKR KR-21):
//   headcount -> the rate denominator, roster -> the staff-name matcher.
// Single row (id=1) in public.linkedin_roster_config. Read by anyone; edited by
// any logged-in (authenticated) user — the same values the n8n weekly pipeline
// reads before it computes. NOT cached: a config editor must show live state and
// reflect a save immediately.
export function useLinkedInRosterConfig() {
  const [config, setConfig] = useState(null)   // { headcount, roster, updated_at, updated_by }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [canEdit, setCanEdit] = useState(false) // true once a Supabase session exists

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('linkedin_roster_config')
      .select('headcount,roster,updated_at,updated_by')
      .eq('id', 1)
      .maybeSingle()
    if (err) setError(err.message)
    else { setConfig(data || null); setError(null) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Track auth so the UI only offers editing to signed-in users (the RLS policy
  // also enforces this server-side — this just hides a control that would 403).
  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => { if (alive) setCanEdit(!!data.session) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setCanEdit(!!session))
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  // Persist headcount + roster. Returns { ok } / { ok:false, error }.
  const save = useCallback(async ({ headcount, roster }) => {
    setSaving(true)
    setError(null)
    const { data: userData } = await supabase.auth.getUser()
    const updated_by = userData?.user?.email || null
    const { data, error: err } = await supabase
      .from('linkedin_roster_config')
      .update({ headcount, roster, updated_at: new Date().toISOString(), updated_by })
      .eq('id', 1)
      .select('headcount,roster,updated_at,updated_by')
      .maybeSingle()
    setSaving(false)
    if (err) { setError(err.message); return { ok: false, error: err.message } }
    setConfig(data)
    return { ok: true }
  }, [])

  return { config, loading, saving, error, canEdit, save, reload: load }
}
