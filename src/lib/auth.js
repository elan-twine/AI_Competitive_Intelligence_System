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

// Google OAuth. Redirects the browser to Google, then back to redirectTo with
// a code that supabase-js exchanges for a session (detectSessionInUrl). We land
// on #dashboard; App.jsx shows a spinner while the session is being established.
export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/#dashboard` },
  })
}

export async function signOut() {
  return supabase.auth.signOut()
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data?.session || null
}

// Subscribe to auth state changes. Returns an unsubscribe function.
export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })
  return () => data?.subscription?.unsubscribe()
}
