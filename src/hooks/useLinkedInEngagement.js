import { useCachedFetch } from './useCachedFetch'
import { supabase } from '../lib/supabase'

// Latest weekly LinkedIn company-engagement % (OKR KR-21). Written each week by
// the n8n "LinkedIn Employee Engagement" workflow into public.linkedin_engagement
// (public-read RLS). Cached (default 6h TTL, cache-first / stale-while-revalidate)
// exactly like the other dashboard OKR metrics.
//
// Returns { ...latestRow, wowDelta } where wowDelta = this week's pct − the
// previous week's pct (percentage points), or null until a second week exists —
// so the KPI card can show a week-over-week chip + rail like its neighbors.
// `null` when the table is empty.
export function useLinkedInEngagement() {
  const { data } = useCachedFetch('linkedin_engagement', async () => {
    const { data: rows, error } = await supabase
      .from('linkedin_engagement')
      .select('pct,members,headcount,post_count,captured_at')
      .order('captured_at', { ascending: false })
      .limit(2)
    if (error) throw error
    if (!rows || !rows.length) return null
    const [cur, prev] = rows
    const wowDelta = (prev && cur.pct != null && prev.pct != null)
      ? Number(cur.pct) - Number(prev.pct)
      : null
    return { ...cur, wowDelta }
  }, {})
  return data
}
