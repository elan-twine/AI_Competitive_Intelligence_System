import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Tunable knobs for the SOV methodology (see SOV_METHODOLOGY.md). Stored as a
// single jsonb row in `sov_config` (id = 1).
//
// ⚠️ RLS: `sov_config` is currently NOT anon-readable, so the logged-in web app
// (anon key) gets an empty result and FALLS BACK to these defaults. They must
// therefore stay in sync with the live row, or the dashboard silently computes
// on stale weights. Kept in lockstep with the deployed sov_config as of
// 2026-07-06. Once the anon-SELECT grant lands (migration
// 2026-07-06_sov_config_public_read.sql) the live row wins and this is just a
// fallback. The values the frontend actually USES for SOV math are
// platformWeights + minPlatformVolume (post_weight itself is precomputed by n8n).
export const DEFAULT_SOV_CONFIG = {
  platformWeights: { LinkedIn: 0.35, 'Google News': 0.30, Reddit: 0.20, X: 0.15 },
  halfLifeDays: { LinkedIn: 14, 'Google News': 30, Reddit: 10, X: 7 },
  engagementWeights: {
    LinkedIn: { reaction: 1, comment: 3, reshare: 10, image: 1.5 },
    Reddit: { upvote: 1, comment: 3 },
    X: { like: 1, reply: 2, repost: 10, quote: 4 },
  },
  authorBaseline: { company: 1, employee: 2, external: 5 },
  authorEngMult: { company: 1, employee: 1.2, external: 2 },
  overallWeights: { weighted: 1, unweighted: 0, sentiment: 0 },
  enabledPlatforms: ['LinkedIn', 'Google News', 'Reddit', 'X'],
  sentimentClamp: { min: 0.5, max: 1.3 },
  perPostCapPct: 0.10,
  minPlatformVolume: 3,
}

export function useSOVConfig() {
  const [config, setConfig] = useState(DEFAULT_SOV_CONFIG)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('sov_config')
          .select('config')
          .eq('id', 1)
          .single()
        if (!mounted) return
        if (error || !data?.config) {
          if (error) console.warn('[sov_config] using defaults:', error.message)
          setConfig(DEFAULT_SOV_CONFIG)
        } else {
          // Shallow-merge over defaults so a partial config row still works.
          setConfig({ ...DEFAULT_SOV_CONFIG, ...data.config })
        }
      } catch (err) {
        console.warn('[sov_config] threw, using defaults:', err)
        if (mounted) setConfig(DEFAULT_SOV_CONFIG)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [])

  return { config, loading }
}
