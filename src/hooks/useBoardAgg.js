import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { boardFromAgg } from '../lib/boardAgg'

// RPC-backed board: fetches sov_board_agg (per-company/platform weight sums —
// ~60 tiny rows computed in Postgres) and derives the ranked board. This is
// deliberately INDEPENDENT of the raw-post firehose: the ranking and stat
// cards render fast from this even if the post fetch is slow or fails, and
// its payload does not grow with post volume.
//
// windowDays: 7 / 30 / N (YTD = days since Jan 1) / null|0 = all-time.
// platforms: multi-select array; empty/absent = all platforms.
// competitors + multipliers come from the caller (already-fetched hooks) so
// this stays a single round-trip.
export function useBoardAgg(windowDays, { platforms, competitors, multipliers } = {}) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0) // bump to refetch

  const wd = windowDays == null || windowDays <= 0 ? null : Math.round(windowDays)

  // Stale-while-revalidate: on a window change the previous rows stay rendered
  // while the new window fetches (~300ms), then swap — no flicker. All state
  // updates happen in async continuations (react-hooks/set-state-in-effect).
  useEffect(() => {
    let alive = true
    supabase.rpc('sov_board_agg', { window_days: wd })
      .then(({ data, error: err }) => {
        if (!alive) return
        if (err) { setError(err.message || 'board query failed') }
        else { setRows(Array.isArray(data) ? data : []); setError(null) }
        setLoading(false)
      })
      .catch((e) => { if (alive) { setError(e?.message || String(e)); setLoading(false) } })
    return () => { alive = false }
  }, [wd, tick])

  // Pure re-derivation on filter/config changes — no refetch needed: the RPC
  // rows are per-platform, so platform filtering happens client-side.
  const board = useMemo(() => {
    if (!rows || !competitors || !multipliers) return null
    return boardFromAgg(rows, { multipliers, platforms, competitors })
  }, [rows, platforms, competitors, multipliers])

  return {
    board,                         // { direct, indirect, directTotal } | null
    rows,                          // raw RPC rows (health page uses these too)
    loading,
    error,
    refetch: () => setTick(t => t + 1),
  }
}
