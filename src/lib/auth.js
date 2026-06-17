// Real per-user authentication via Supabase Auth. Replaces the old shared
// team-password gate. Sessions are managed by the supabase client (stored in
// localStorage by supabase-js itself) — we no longer set our own auth flags.

import { supabase } from './supabase'

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({
    email: (email || '').trim(),
    password,
  })
}

// Google OAuth. Redirects the browser to Google, then back to redirectTo, where
// supabase-js exchanges the response for a session. We redirect to the origin
// root (NOT a hash route) because supabase-js consumes the URL hash/query to
// extract the session; App.jsx then navigates to the dashboard on the SIGNED_IN
// event rather than relying on the hash surviving.
export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/` },
  })
}

export async function signOut() {
  return supabase.auth.signOut()
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data?.session || null
}

// Subscribe to auth state changes. Passes (event, session) so callers can tell
// a fresh sign-in (SIGNED_IN) from a session restore (INITIAL_SESSION).
// Returns an unsubscribe function.
export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session)
  })
  return () => data?.subscription?.unsubscribe()
}
