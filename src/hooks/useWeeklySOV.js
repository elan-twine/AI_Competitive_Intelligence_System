import { useEffect, useMemo, useState } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'

// Reads the immutable weekly SOV snapshots written by the workflow each run
// (table `sov_weekly`) and shapes them for recharts. Each point is that week's
// frozen board score; companies absent in a week are FORWARD-FILLED from their
// last known value (a company's line starts at its first real snapshot).
//
// metric: which stored column to plot — 'overall' (default, the composite board
// score) | 'weighted_pct' | 'unweighted_pct' | 'sentiment_pct'.
//
// "Start fresh": the SOV model changed on 2026-06-22 (SOV_HISTORY_START in
// metrics.js — single source shared with the live/isolated weekly series).
// Weeks before that were computed under a superseded formula AND on thin
// scrape coverage, so they are neither displayed nor used in any computation
// (forward-fill, etc.). The old rows stay in the table (not deleted) — they're
// just filtered out here.
import { SOV_HISTORY_START } from '../lib/metrics'

export function useWeeklySOV(metric = 'overall') {
  const [rows, setRows] = useState([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Paginated: sov_weekly grows ~13 rows/week, so it will cross Supabase's
    // 1000-row response cap; an unpaginated query would silently drop old weeks.
    fetchAllRows(() => supabase
      .from('sov_weekly')
      .select('week_start,company,overall,weighted_pct,unweighted_pct,sentiment_pct')
      .order('week_start', { ascending: true }))
      .then(data => {
        if (cancelled) return
        setRows((data || []).filter(r => r.week_start >= SOV_HISTORY_START))
        setReady(true)
      })
      .catch(err => {
        if (cancelled) return
        // Table may not exist yet (pre-migration) — fail soft to an empty series.
        console.warn('[sov_weekly]', err?.message || err)
        setRows([]); setReady(true)
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
