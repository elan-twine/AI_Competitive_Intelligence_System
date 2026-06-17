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

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
