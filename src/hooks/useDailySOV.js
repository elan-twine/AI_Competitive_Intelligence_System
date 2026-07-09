import { useMemo, useCallback } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useCachedFetch } from './useCachedFetch'

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
//
// Cached (localStorage), keyed per window_days.
import { SOV_HISTORY_START } from '../lib/metrics'

export function useDailySOV(windowDays = 7, metric = 'overall') {
  const fetcher = useCallback(async () => {
    try {
      const data = await fetchAllRows(() => supabase
        .from('sov_daily')
        .select('snapshot_date,company,window_days,overall,weighted_pct,sentiment_pct,posts_count')
        .eq('window_days', windowDays)
        .order('snapshot_date', { ascending: true }))
      return (data || []).filter(r => r.snapshot_date >= SOV_HISTORY_START)
    } catch (err) {
      // Table may not exist yet (pre-migration) — fail soft to an empty series.
      console.warn('[sov_daily]', err?.message || err)
      return []
    }
  }, [windowDays])

  const { data, loading } = useCachedFetch(`sov_daily_${windowDays}`, fetcher, {})
  const rows = data || []
  const ready = !loading

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
