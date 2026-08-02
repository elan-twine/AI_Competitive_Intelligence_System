import { useCachedFetch } from './useCachedFetch'
import { supabase } from '../lib/supabase'

// Latest weekly LinkedIn company-engagement % (OKR KR-21). Written each week by
// the n8n "LinkedIn Employee Engagement" workflow into public.linkedin_engagement
// (public-read RLS). Cached (default 6h TTL, cache-first / stale-while-revalidate)
// exactly like the other dashboard OKR metrics. Returns the latest row or null.
export function useLinkedInEngagement() {
  const { data } = useCachedFetch('linkedin_engagement', async () => {
    const { data: rows, error } = await supabase
      .from('linkedin_engagement')
      .select('pct,members,headcount,post_count,captured_at')
      .order('captured_at', { ascending: false })
      .limit(1)
    if (error) throw error
    return rows && rows.length ? rows[0] : null
  }, {})
  return data
}
