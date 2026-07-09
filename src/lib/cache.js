// Client-side cache for dashboard data. The SOV data updates once or twice a
// day (pipeline-driven), so there's no reason to refetch it on every reload.
// Small payloads (boards, competitors, nav) go in localStorage; the large
// post firehose (linkedin_posts + tweets + news, several MB combined — over the
// ~5MB localStorage cap) goes in IndexedDB. Entries carry a timestamp; callers
// decide freshness via a TTL. Everything fails soft — a cache miss/parse error
// just behaves like "no cache" and the app fetches normally.

const NS = 'twinesov:'
export const CACHE_TTL = 6 * 60 * 60 * 1000 // 6h — comfortably longer than the once/twice-daily update cadence

// ---------- localStorage (small values) ----------
function lget(key) {
  try { const r = localStorage.getItem(NS + key); return r != null ? JSON.parse(r) : null } catch { return null }
}
function lset(key, val) {
  try { localStorage.setItem(NS + key, JSON.stringify(val)) }
  catch { try { localStorage.removeItem(NS + key) } catch { /* quota / disabled — skip */ } }
}

// ---------- IndexedDB (large values) ----------
const DB_NAME = 'twinesov', STORE = 'cache'
let _dbPromise
function openDb() {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
  return _dbPromise
}
async function iget(key) {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => resolve(null)
    })
  } catch { return null }
}
async function iset(key, val) {
  try {
    const db = await openDb()
    await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
    })
  } catch { /* skip */ }
}

// ---------- unified API ----------
// Returns { ts, data } or null. Freshness (ttl) is the caller's call.
export async function getCache(key, { idb = false } = {}) {
  const v = idb ? await iget(key) : lget(key)
  return v && v.ts != null ? v : null
}
export async function setCache(key, data, { idb = false } = {}) {
  const entry = { ts: Date.now(), data }
  if (idb) await iset(key, entry); else lset(key, entry)
}

// Wipe everything (used on data-mutating actions like editing a competitor, and
// when the user forces a refresh) so the next load refetches from the network.
export async function clearCache() {
  try {
    Object.keys(localStorage).filter(k => k.startsWith(NS)).forEach(k => localStorage.removeItem(k))
  } catch { /* skip */ }
  try {
    const db = await openDb()
    await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).clear()
      req.onsuccess = () => resolve(); req.onerror = () => resolve()
    })
  } catch { /* skip */ }
}
