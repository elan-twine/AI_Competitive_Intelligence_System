import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Tunable knobs for the SOV methodology (see SOV_METHODOLOGY.md). Stored as a
// single jsonb row in `sov_config` (id = 1). These defaults mirror the values
// seeded in migration 0001 and are used when the row is missing/unreachable.
export const DEFAULT_SOV_CONFIG = {
  platformWeights: { LinkedIn: 0.35, 'Google News': 0.30, Reddit: 0.20, X: 0.15 },
  halfLifeDays: { LinkedIn: 14, 'Google News': 30, Reddit: 10, X: 7 },
  engagementWeights: {
    LinkedIn: { reaction: 1, comment: 3, reshare: 5, image: 1.5 },
    Reddit: { upvote: 1, comment: 3 },
    X: { like: 1, reply: 2, repost: 3, quote: 4 },
  },
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
