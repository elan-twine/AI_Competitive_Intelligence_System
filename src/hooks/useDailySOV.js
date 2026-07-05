import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// Reads the rolling daily SOV board (`sov_daily`) written each run by the
// pipeline — one row per (snapshot_date, company, window_days). window_days is
// 7 or 30: the trailing window over which that day's SOV was computed. This is
// the DAILY counterpart to useWeeklySOV: each point is a day, and the value is
// that day's trailing-N-day SOV. Shaped for recharts (same {week, Company:%}
// row shape as useWeeklySOV so SOVTrendChart can consume either interchangeably;
// here `week` holds the snapshot_date).
//
// metric: 'overall' (default) | 'weighted_pct' | 'sentiment_pct'
//   (sov_daily has no unweighted_pct column — those three only.)
const SOV_HISTORY_START = '2026-06-22'

export function useDailySOV(windowDays = 7, metric = 'overall') {
  const [rows, setRows] = useState([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    setReady(false)
    supabase
      .from('sov_daily')
      .select('snapshot_date,company,window_days,overall,weighted_pct,sentiment_pct,posts_count')
      .eq('window_days', windowDays)
      .order('snapshot_date', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        // Table may not exist yet (pre-migration) — fail soft to an empty series.
        if (error) { setRows([]); setReady(true); return }
        setRows((data || []).filter(r => r.snapshot_date >= SOV_HISTORY_START))
        setReady(true)
      })
    return () => { cancelled = true }
  }, [windowDays])

  return useMemo(() => {
    const dates = [...new Set(rows.map(r => r.snapshot_date))].sort()
    const companies = [...new Set(rows.map(r => r.company))]
    const byDate = {}
    for (const r of rows) {
      (byDate[r.snapshot_date] || (byDate[r.snapshot_date] = {}))[r.company] = r[metric]
    }
    // Forward-fill (mirrors useWeeklySOV) so a brief gap doesn't drop a line.
    const last = {}
    const series = dates.map(d => {
      const row = { week: d }   // 'week' key kept so SOVTrendChart's dataKey works for both
      for (const c of companies) {
        const v = byDate[d]?.[c]
        if (v != null) { last[c] = v; row[c] = v }
        else if (last[c] != null) { row[c] = last[c] }
      }
      return row
    })
    return { series, companies, ready }
  }, [rows, metric, ready])
}
