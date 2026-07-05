import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Real "data freshness" for the header. Primary source: `scrape_runs` (the
// pipeline stamps a row when each scraper finishes). scrape_runs is service-role
// only by default — if a public-read policy hasn't been applied yet the anon
// query returns nothing, so we FALL BACK to the latest `sov_daily` snapshot_date
// (public-read), i.e. "when the board was last computed". Always fails soft.
//
// Returns { platforms: [{ platform, at }], latest: Date|null, source }.
function timeAgo(date) {
  if (!date) return null
  const ms = Date.now() - date.getTime()
  if (ms < 0) return 'just now'
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  return `${d}d ago`
}

export function useLastUpdated() {
  const [state, setState] = useState({ platforms: [], latest: null, source: null, ready: false })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // 1) Try scrape_runs (precise, per-platform).
      const sr = await supabase
        .from('scrape_runs')
        .select('platform,finished_at,status')
        .eq('status', 'success')
        .order('finished_at', { ascending: false })
        .limit(50)
      if (!cancelled && !sr.error && (sr.data || []).length) {
        const byPlatform = {}
        for (const r of sr.data) {
          const t = r.finished_at ? new Date(r.finished_at) : null
          if (!t || isNaN(t)) continue
          if (!byPlatform[r.platform] || t > byPlatform[r.platform]) byPlatform[r.platform] = t
        }
        const platforms = Object.entries(byPlatform)
          .map(([platform, at]) => ({ platform, at, ago: timeAgo(at) }))
          .sort((a, b) => b.at - a.at)
        const latest = platforms.length ? platforms[0].at : null
        setState({ platforms, latest, source: 'scrape_runs', ready: true })
        return
      }
      // 2) Fallback: latest computed board date from sov_daily (public-read).
      const sd = await supabase
        .from('sov_daily')
        .select('snapshot_date')
        .order('snapshot_date', { ascending: false })
        .limit(1)
      if (cancelled) return
      let latest = null
      if (!sd.error && (sd.data || []).length) {
        const d = new Date(sd.data[0].snapshot_date)
        if (!isNaN(d)) latest = d
      }
      setState({
        platforms: latest ? [{ platform: 'Board', at: latest, ago: timeAgo(latest) }] : [],
        latest,
        source: latest ? 'sov_daily' : null,
        ready: true,
      })
    })()
    return () => { cancelled = true }
  }, [])

  return state
}
