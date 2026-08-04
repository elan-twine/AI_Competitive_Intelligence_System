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
// Engagement is a LAGGING weekly measurement, not a live gauge: it only exists
// after the Thursday scrape. So the card reads the LAST MEASURED week and says
// which week that was — otherwise it would sit blank for 6 of every 7 days
// (Elan, 2026-08-03). Only a week that was measured AND had company posts
// counts as a measurement; N/A weeks (pct null, no posts) are skipped.
//
// Cached (default 6h TTL, cache-first / stale-while-revalidate) like the other
// dashboard OKR metrics. Returns:
//   latest    — most recent week with a REAL measurement (pct != null)
//   prior     — the measured week before that (for week-over-week)
//   wow       — latest.pct − prior.pct (points), when both exist
//   isCurrent — whether `latest` IS the current Thu-week (measured already)
//   naWeeks   — count of skipped no-post weeks since `latest` (context: "no
//               posts since"), so the card can flag a stale-but-valid number
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
  // Rows are newest-week-first, newest-capture-first — so the first row for a
  // given week is that week's authoritative (latest) measurement.
  const measured = []
  const seen = new Set()
  for (const r of rows) {
    if (seen.has(r.week_start)) continue   // an older re-capture of a week already taken
    seen.add(r.week_start)
    if (r.pct != null) measured.push(r)
  }
  const latest = measured[0] || null
  const prior = measured[1] || null
  const wow = latest && prior ? Number(latest.pct) - Number(prior.pct) : null
  const naWeeks = latest
    ? [...seen].filter(w => w > latest.week_start).length
    : 0
  return {
    latest,
    prior,
    wow,
    isCurrent: !!latest && latest.week_start === curKey,
    naWeeks,
  }
}
