import { supabase } from './supabase'

// Client for the dashboard assistant. POSTs the question + the in-memory data
// context to the session-gated Worker route (which holds the OpenAI key — never
// the browser). Mirrors the briefing-proxy auth pattern: bearer the Supabase
// access token so the Worker can verify a real logged-in session.
export const ASK_PATH = '/api/ask'

// `onToken(chunk, fullSoFar)` is called as text streams in, so the UI can type
// the answer out live. The Worker streams plain-text token deltas on success and
// falls back to a JSON body for errors / the not-configured case. Returns the
// full answer text.
export async function askAssistant({ question, context, history = [], onToken }) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Please sign in again — your session expired.')

  let r
  try {
    r = await fetch(ASK_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ question, context, history }),
    })
  } catch {
    throw new Error('Could not reach the assistant. Check your connection and try again.')
  }

  const ctype = r.headers.get('content-type') || ''
  // Errors (and the "not configured yet" case) come back as JSON, not a stream.
  if (!r.ok || ctype.includes('application/json') || !r.body) {
    const j = await r.json().catch(() => null)
    if (r.status === 503) throw new Error("The assistant isn't switched on yet (missing API key). Ask an admin to set it up.")
    if (!r.ok) throw new Error((j && j.error) || `Assistant error (${r.status}).`)
    return (j && j.answer) || '' // non-stream fallback (shouldn't normally happen)
  }

  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    if (chunk) { full += chunk; if (onToken) onToken(chunk, full) }
  }
  return full
}
