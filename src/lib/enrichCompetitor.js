import { supabase } from './supabase'

// Ask the Worker to auto-generate a competitor's tracking details (definition,
// keywords, namesake collisions, aliases, domain, x_handle, subreddits) from
// just a name (+ optional URL/domain) via Claude. Session-gated, mirrors the
// assistant auth pattern. Returns the enrichment object; throws on failure.
export async function enrichCompetitor({ name, url, domain }) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Please sign in again — your session expired.')
  let r
  try {
    r = await fetch('/api/enrich-competitor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ name, url, domain }),
    })
  } catch {
    throw new Error('Could not reach the enrichment service. Check your connection.')
  }
  const j = await r.json().catch(() => null)
  if (r.status === 503) throw new Error("Auto-fill isn't switched on yet (missing API key).")
  if (!r.ok) throw new Error((j && j.error) || `Auto-fill failed (${r.status}).`)
  return j || {}
}
