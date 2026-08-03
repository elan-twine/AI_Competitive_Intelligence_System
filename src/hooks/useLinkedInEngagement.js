import { useCachedFetch } from './useCachedFetch'
import { supabase } from '../lib/supabase'
import { isoWeekStart } from '../lib/metrics'

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Weekly LinkedIn company-engagement % (OKR KR-21), keyed to the SOV default
// week: Thursday 00:00 → Wednesday 23:59 (all SOV metrics use this week unless
// explicitly specified otherwise). The n8n pipeline runs Thursdays 12:00,
// measures the just-COMPLETED week, and stamps `week_start` — including a 0%
// row for weeks with no company posts. Rows without week_start are ignored.
//
// If a week is re-measured later, the LATEST capture wins (Elan, 2026-08-03):
// engagement keeps accruing after a post, so a newer snapshot of the same
// week supersedes the older one — hence the secondary captured_at ordering
// (find() takes the first, i.e. newest, row per week).
//
// Cached (default 6h TTL, cache-first / stale-while-revalidate) like the other
// dashboard OKR metrics. Returns:
//   current — the CURRENT Thu-week's row (normally absent until Thursday noon)
//   prev    — the most recent completed week's row before the current week
//   wow     — current.pct − prev.pct (points), when both exist
export function useLinkedInEngagement() {
  const { data } = useCachedFetch('linkedin_engagement_v3', async () => {
    const { data: rows, error } = await supabase
      .from('linkedin_engagement')
      .select('pct,members,headcount,post_count,captured_at,week_start')
      .not('week_start', 'is', null)
      .order('week_start', { ascending: false })
      .order('captured_at', { ascending: false })
      .limit(8)
    if (error) throw error
    return rows || []
  }, {})
  const rows = data || []
  const curKey = ymd(isoWeekStart(new Date()))
  const current = rows.find(r => r.week_start === curKey) || null
  // N/A weeks (pct null — no company posts) don't count: comparisons skip to
  // the most recent week that has a REAL measurement (Elan, 2026-08-03).
  const prev = rows.find(r => r.week_start < curKey && r.pct != null) || null
  const wow = current && prev && current.pct != null
    ? Number(current.pct) - Number(prev.pct)
    : null
  return { current, prev, wow }
}
