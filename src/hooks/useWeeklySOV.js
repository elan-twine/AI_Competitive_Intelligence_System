import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// Reads the immutable weekly SOV snapshots written by the workflow each run
// (table `sov_weekly`) and shapes them for recharts. Each point is that week's
// frozen board score; companies absent in a week are FORWARD-FILLED from their
// last known value (a company's line starts at its first real snapshot).
//
// metric: which stored column to plot — 'overall' (default, the composite board
// score) | 'weighted_pct' | 'unweighted_pct' | 'sentiment_pct'.
export function useWeeklySOV(metric = 'overall') {
  const [rows, setRows] = useState([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('sov_weekly')
      .select('week_start,company,overall,weighted_pct,unweighted_pct,sentiment_pct')
      .order('week_start', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        // Table may not exist yet (pre-migration) — fail soft to an empty series.
        if (error) { setRows([]); setReady(true); return }
        setRows(data || [])
        setReady(true)
      })
    return () => { cancelled = true }
  }, [])

  return useMemo(() => {
    const weeks = [...new Set(rows.map(r => r.week_start))].sort()
    const companies = [...new Set(rows.map(r => r.company))]
    const byWeek = {}
    for (const r of rows) {
      (byWeek[r.week_start] || (byWeek[r.week_start] = {}))[r.company] = r[metric]
    }
    // Forward-fill: carry each company's last value across weeks where it has no
    // snapshot; a company stays absent until its first non-null value (line starts there).
    const last = {}
    const series = weeks.map(w => {
      const row = { week: w }
      for (const c of companies) {
        const v = byWeek[w]?.[c]
        if (v != null) { last[c] = v; row[c] = v }
        else if (last[c] != null) { row[c] = last[c] }
      }
      return row
    })
    return { series, companies, ready }
  }, [rows, metric, ready])
}
