import { useEffect, useMemo, useState } from 'react'

// Client-side health history — turns the point-in-time checks into a trend
// without any backend. Each distinct run (keyed by ranAt) appends a compact
// snapshot { ts, statuses: {checkId: status} } to a localStorage ring buffer.
// From that we derive, per check: a status timeline (for the trend dots) and
// a flap count (how many times it changed across the retained window).
//
// Storage is intentionally tiny (CAP snapshots × a few short strings) and
// self-healing: a corrupt/absent blob just starts fresh.
const KEY = 'twinesov:health:history'
const CAP = 40

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

export function useHealthHistory(checks, ranAt) {
  const [history, setHistory] = useState(load)

  // Record once per distinct run. ranAt is null in demo mode (and before the
  // first live run), so demo never pollutes real history.
  useEffect(() => {
    if (!ranAt || !checks || !checks.length) return
    // Loop-safe: `history` is NOT a dependency, and the functional updater
    // returns the SAME reference once this ranAt is already recorded (React
    // bails out → no re-render), so this records exactly once per run.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(prev => {
      if (prev.length && prev[prev.length - 1].ts === ranAt) return prev // already recorded
      const statuses = {}
      for (const c of checks) statuses[c.id] = c.status
      const next = [...prev, { ts: ranAt, statuses }].slice(-CAP)
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* quota/again: keep in-memory */ }
      return next
    })
  }, [ranAt, checks])

  // Per-check derived views, recomputed when history changes.
  const byCheck = useMemo(() => {
    const out = {}
    for (const snap of history) {
      for (const [id, st] of Object.entries(snap.statuses || {})) {
        (out[id] || (out[id] = [])).push(st)
      }
    }
    return out
  }, [history])

  const trendFor = (id) => byCheck[id] || []
  // A "flap" = a status transition between consecutive runs. Info/ok are
  // treated as the same healthy state so a value flicker doesn't count.
  const flapCount = (id) => {
    const norm = (s) => (s === 'info' ? 'ok' : s)
    const seq = (byCheck[id] || []).map(norm)
    let n = 0
    for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) n++
    return n
  }

  const clear = () => { try { localStorage.removeItem(KEY) } catch { /* ignore */ } setHistory([]) }

  return { history, runCount: history.length, trendFor, flapCount, clear }
}
