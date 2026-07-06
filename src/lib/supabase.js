import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://addwjngdezmmnxddulll.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (!supabaseAnonKey) {
  // Clearer than the SDK's cryptic "supabaseKey is required" — this means the
  // build did not receive VITE_SUPABASE_ANON_KEY. Set it as a BUILD variable
  // (not a runtime var) and trigger a fresh build/deploy.
  console.error(
    '[supabase] Missing VITE_SUPABASE_ANON_KEY at build time. ' +
    'Set it as a build variable and redeploy.'
  )
}

// Supabase caps EVERY response at 1000 rows. Any table that grows without bound
// (sov_daily ~26/day, sov_weekly ~13/week, posts_of_interest, …) will silently
// truncate to the newest 1000 on a plain query — a data bug that gets worse over
// time. Paginate with .range() until a short page. `buildQuery` is a FACTORY
// (invoked per page) because supabase-js query builders are single-use/thenable.
export async function fetchAllRows(buildQuery, { pageSize = 1000, maxPages = 25 } = {}) {
  const all = []
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await buildQuery().range(i * pageSize, (i + 1) * pageSize - 1)
    if (error) throw error
    const rows = data || []
    all.push(...rows)
    if (rows.length < pageSize) break
  }
  return all
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // PKCE returns the session as a `?code=` query param (exchanged for a
    // session), instead of the implicit flow's `#access_token=` hash — which
    // this app's hash-based router would otherwise wipe before supabase-js
    // could read it. PKCE is also Supabase's recommended, more secure flow.
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
})
