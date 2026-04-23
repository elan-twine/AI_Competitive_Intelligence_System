// Shared team credential. Single gate for the public Vercel deploy.
// NOTE: this lives in the JS bundle and is readable by anyone who opens
// devtools — this is a low-friction team-access gate, not real authentication.
// If you need actual per-user auth or secret-keeping, switch to Supabase Auth.

export const TEAM_EMAIL = 'hello@twinesecurity.com'
export const TEAM_PASSWORD = 'PurdueSolutions123#'

export function checkLogin(email, password) {
  return (email || '').trim().toLowerCase() === TEAM_EMAIL && password === TEAM_PASSWORD
}
