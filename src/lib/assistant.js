import { supabase } from './supabase'

// Client for the dashboard assistant. POSTs the question + a THIN UI-state header
// (what the user is looking at — not a data snapshot) to the session-gated Worker
// route, which runs the agentic loop (it holds the Anthropic key, never the
// browser). Mirrors the briefing-proxy auth pattern: bearer the Supabase access
// token so the Worker can verify a real logged-in session and read AS this user.
export const ASK_PATH = '/api/ask'
export const FILE_ISSUE_PATH = '/api/file-issue'

// The Worker streams a sequence of \x1e-delimited JSON frames:
//   {t:'progress', label}  — a tool step is running (live "thinking")
//   {t:'token', text}      — a chunk of the final answer (append)
//   {t:'draft', draft}     — an issue draft to review before filing (terminal)
//   {t:'error', message}   — failure
// \x1e (record separator) never appears inside JSON.stringify output, so it's a
// safe frame delimiter.
const FRAME_SEP = '\x1e'

// `onToken(chunk, fullSoFar)` streams the answer out live; `onProgress(label)`
// surfaces each tool step as it runs; `onDraft(draft)` hands over a feedback
// draft (nothing is filed until the user confirms). Returns the full answer
// text, or { draft } when a draft was sent.
export async function askAssistant({ question, context, history = [], onToken, onProgress, onDraft }) {
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
  let buffer = ''
  let full = ''
  let draftOut = null

  const dispatch = (raw) => {
    const s = raw.trim()
    if (!s) return
    let frame
    try { frame = JSON.parse(s) } catch { return } // partial/garbled — skip
    if (frame.t === 'token') {
      full += frame.text || ''
      if (onToken) onToken(frame.text || '', full)
    } else if (frame.t === 'progress') {
      if (onProgress) onProgress(frame.label || '')
    } else if (frame.t === 'draft') {
      draftOut = frame.draft || null
      if (draftOut && onDraft) onDraft(draftOut)
    } else if (frame.t === 'error') {
      throw new Error(frame.message || 'Assistant error.')
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split(FRAME_SEP)
    buffer = parts.pop() || '' // keep the trailing (possibly incomplete) frame
    for (const p of parts) dispatch(p)
  }
  if (buffer) dispatch(buffer) // flush the final frame

  if (draftOut) return { draft: draftOut }
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
