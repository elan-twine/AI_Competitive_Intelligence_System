import { useState, useEffect, useRef, useCallback } from 'react'
import { getCache, setCache, CACHE_TTL } from '../lib/cache'

// Stale-aware cached fetch. On mount:
//   - fresh cache (age < ttl) → use it, DO NOT hit the network (fast reloads).
//   - stale cache → show it immediately, then refetch in the background.
//   - no cache → fetch.
// refetch() always forces a network fetch (skips the cache read) and rewrites
// the cache — used for the error-state retry and after data-mutating actions.
//
// `key` identifies the cache slot; `idb: true` routes large payloads to
// IndexedDB. The fetcher is read from a ref so an inline closure doesn't churn
// the effect.
export function useCachedFetch(key, fetcher, { ttlMs = CACHE_TTL, idb = false } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const run = useCallback(async (force) => {
    setError(null)
    let shown = false
    if (!force) {
      const cached = await getCache(key, { idb })
      if (cached) {
        setData(cached.data); setLoading(false); shown = true
        if (Date.now() - cached.ts < ttlMs) return // fresh — no network
        // stale — fall through and refresh in the background
      }
    }
    if (!shown) setLoading(true)
    try {
      const d = await fetcherRef.current()
      setData(d); setLoading(false)
      await setCache(key, d, { idb })
    } catch (e) {
      setError(e?.message || String(e)); setLoading(false)
    }
  }, [key, ttlMs, idb])

  useEffect(() => { run(false) }, [run])

  const refetch = useCallback(() => run(true), [run])
  return { data, loading, error, refetch }
}
