import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Tunable knobs for the SOV methodology (see SOV_METHODOLOGY.md). Stored as a
// single jsonb row in `sov_config` (id = 1).
//
// sov_config is anon-readable (grant applied 2026-07-06), so the live row wins;
// these defaults are the offline fallback and must stay in sync with it.
// Kept in lockstep as of 2026-07-07: platform weights rebalanced (News raised —
// trade press is the security-buyer credibility layer; Reddit cut — lowest-volume
// channel) and sentimentClamp collapsed to 1.0 — sentiment is DECOUPLED from the
// SOV weight and is display-only. Weight changes are versioned in the live row's
// weightsChangelog. The values the frontend actually USES for SOV math are
// platformWeights + minPlatformVolume (post_weight itself is precomputed by n8n).
export const DEFAULT_SOV_CONFIG = {
  // Mindshare-pool multipliers (2026-07-08): convert each platform's per-post
  // impact onto one common "considered-attention" scale, then pool. Trust ratios
  // grounded in B2B buyer research — peer/community (Reddit) 3× and editorial
  // press (News) ≈ tunable > vendor social (LinkedIn/X) = 1. News is the dial the
  // team sets; the rest are ~locked. SOV = share of the pooled total.
  platformMultipliers: { LinkedIn: 1, 'Google News': 30, Reddit: 3, X: 1 },
  // Legacy within-platform-share weights — retained for reference/rollback only;
  // the live math now uses platformMultipliers above.
  platformWeights: { LinkedIn: 0.40, 'Google News': 0.35, Reddit: 0.10, X: 0.15 },
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
  sentimentClamp: { min: 1.0, max: 1.0 }, // decoupled 2026-07-07 — tone never moves the ranking
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
