import { supabase } from './supabase'

// History drawer for the dashboard assistant. The session store lives in
// Supabase (assistant_sessions) behind SECURITY DEFINER RPCs keyed on
// auth.uid(), so these can be called straight from the browser with the user's
// session — a client can only ever see or delete its OWN chats. The Worker owns
// get/put during a live turn; the UI owns list/load/delete/clear.
//
// All calls fail SOFT: if the RPCs aren't deployed yet (migration not run) or
// error, they resolve to a safe empty value so the chat still works without
// history — mirroring the Worker's fail-open session handling.

// localStorage key for the active conversation id, so a reload resumes the same
// chat instead of silently starting a new one.
export const ACTIVE_SESSION_KEY = 'twinesov:asst:session'

// [{ session_id, title, updated_at, turn_count }] newest-first (max 30), or [].
export async function listSessions() {
  const { data, error } = await supabase.rpc('assistant_session_list')
  if (error || !Array.isArray(data)) return []
  return data
}

// Load one session's stored turns for rendering → [{ role, content }] (max 20).
// Only user/assistant string turns are surfaced (tool-use blocks are dropped —
// the drawer replays the readable transcript, not the tool machinery).
export async function loadSession(sessionId) {
  if (!sessionId) return { turns: [], title: '' }
  const { data, error } = await supabase.rpc('assistant_session_get', { p_session: sessionId })
  if (error || !data || typeof data !== 'object') return { turns: [], title: '' }
  const turns = (Array.isArray(data.turns) ? data.turns : [])
    .filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
    .map(t => ({ role: t.role, content: t.content }))
  return { turns, title: typeof data.title === 'string' ? data.title : '' }
}

export async function deleteSession(sessionId) {
  if (!sessionId) return
  await supabase.rpc('assistant_session_delete', { p_session: sessionId })
}

export async function clearAllSessions() {
  await supabase.rpc('assistant_session_clear_all')
}
