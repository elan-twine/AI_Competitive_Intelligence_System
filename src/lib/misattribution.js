import { supabase } from './supabase'
import { clearCache } from './cache'

// Soft "un-attribute" a misattributed mention. Flags it (via the authenticated
// flag_misattributed RPC) so it's excluded from the company's SOV everywhere —
// the row/data itself is kept.
//
// UX: we ALSO keep a client-side set of flagged keys and remove the item from
// the live calculations OPTIMISTICALLY (instant recompute, no reload), rather
// than refetching the whole post firehose. The DB write persists it; clearCache
// makes the next hard load refetch the DB truth (where the read filter drops it).

// Best stable key per platform, tolerant of raw rows, normalized posts, POI
// items, and Social-Briefs post shapes.
export function postIdentity(post) {
  if (!post) return { platform: null, key: null }
  const raw = post.raw || post
  const platform = post.platform || raw.platform || 'LinkedIn'
  let key
  if (platform === 'X') key = raw.id ?? post.id ?? post.source_id
  else if (platform === 'Reddit') key = raw.id ?? post.id ?? post.source_id
  else if (platform === 'Google News') key = raw.url ?? post.url ?? post.source_id
  else key = raw.activity_id ?? post.activity_id ?? post.id ?? post.source_id // LinkedIn
  return { platform, key: key != null ? String(key) : null }
}

// ---- client-side optimistic flag store ----
const flagged = new Set()            // "platform|key"
const listeners = new Set()
const skey = (platform, key) => `${platform}|${key}`

export function isLocallyFlagged(platform, key) {
  return key != null && flagged.has(skey(platform, String(key)))
}
export function subscribeFlagged(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const notify = () => listeners.forEach(fn => { try { fn() } catch { /* ignore */ } })

export async function flagMisattributed(post) {
  const { platform, key } = postIdentity(post)
  if (!key) throw new Error('Could not identify this item')
  const k = skey(platform, key)
  flagged.add(k); notify() // optimistic — drops from the live board immediately
  try {
    const { error } = await supabase.rpc('flag_misattributed', {
      p_platform: platform, p_key: key, p_flag: true,
    })
    if (error) throw new Error(error.message || 'flag failed')
    // Bust cached raw data so a future hard reload refetches the DB truth
    // (where the misattributed read-filter drops it) even after this session.
    clearCache().catch(() => {})
  } catch (e) {
    flagged.delete(k); notify() // roll back the optimistic removal
    throw e
  }
}
