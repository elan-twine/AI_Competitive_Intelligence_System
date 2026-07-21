import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useCachedFetch } from './useCachedFetch'

// Operational pipeline status for the admin health strip: the LinkedIn ingestion
// queue, per-platform scrape freshness, and the live scoring config — from the
// SECURITY DEFINER RPC assistant_system_status (same source the assistant's
// system_status tool uses). Short cache (2 min) so the strip is cheap on
// re-renders but still current. Fails soft to null.
const TWO_MIN = 2 * 60 * 1000

export function useSystemStatus() {
  const fetcher = useCallback(async () => {
    const { data, error } = await supabase.rpc('assistant_system_status')
    if (error) throw error
    return data || null
  }, [])
  const { data, loading } = useCachedFetch('sys-status', fetcher, { ttlMs: TWO_MIN })
  return { status: data || null, loading }
}
