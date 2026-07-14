import { supabase } from './supabase'

// Client for the dashboard assistant. POSTs the question + the in-memory data
// context to the session-gated Worker route (which holds the OpenAI key — never
// the browser). Mirrors the briefing-proxy auth pattern: bearer the Supabase
// access token so the Worker can verify a real logged-in session.
export const ASK_PATH = '/api/ask'
export const FILE_ISSUE_PATH = '/api/file-issue'

// The Worker prefixes an issue-DRAFT frame with this control char (never present
// in normal answer text) so we can tell a draft envelope from answer tokens.
const DRAFT_SENTINEL = '\x1e'

// `onToken(chunk, fullSoFar)` is called as text streams in, so the UI can type
// the answer out live. The Worker streams plain-text token deltas on success and
// falls back to a JSON body for errors / the not-configured case. If the model
// wants to file feedback, the Worker instead sends a single draft frame — we
// parse it and hand it to `onDraft(draft)` (nothing is filed until the user
// confirms). Returns the full answer text, or { draft } when a draft was sent.
export async function askAssistant({ question, context, history = [], onToken, onDraft }) {
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
  let isDraft = false
  let started = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    if (!chunk) continue
    full += chunk
    // Decide draft-vs-answer on the first byte: a leading sentinel = draft frame.
    if (!started) { started = true; isDraft = full.charCodeAt(0) === 0x1e }
    if (!isDraft && onToken) onToken(chunk, full)
  }
  if (isDraft) {
    let draft = null
    try { draft = JSON.parse(full.slice(DRAFT_SENTINEL.length)) } catch { /* malformed → treat as no draft */ }
    if (draft && onDraft) onDraft(draft)
    return { draft: draft || null }
  }
  return full
}

// File a confirmed (possibly user-edited) issue draft. Session-gated like /ask.
// Returns { message, number, url }; throws on failure.
export async function fileIssue(draft) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Please sign in again — your session expired.')
  let r
  try {
    r = await fetch(FILE_ISSUE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        title: draft?.title, body: draft?.body, category: draft?.category, verbatim: draft?.verbatim,
      }),
    })
  } catch {
    throw new Error('Could not reach GitHub to file that. Check your connection and try again.')
  }
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error((j && j.error) || `Couldn't file that (${r.status}).`)
  return j || {}
}
