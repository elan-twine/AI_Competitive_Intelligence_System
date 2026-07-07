import { useState, useEffect } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'

// AI-answer Share of Voice ("share of model") — the weekly aggregate written by
// the `SOV — AI Answers` n8n workflow into `llm_sov` (anon-readable).
// Rows: { week_start, engine, company, mention_rate, share_of_model,
//         avg_first_pos, n_prompts, n_samples, prompt_version }.
// Empty until the workflow's first run — the UI renders an explanatory
// empty state, so this hook must fail soft (missing table → []).
export function useLLMSov() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const data = await fetchAllRows(() => supabase
          .from('llm_sov')
          .select('*')
          .order('week_start', { ascending: false }))
        if (mounted) setRows(data || [])
      } catch (err) {
        // Table may not exist yet (migration pending) — treat as no data.
        console.warn('[llm_sov] unavailable:', err?.message || err)
        if (mounted) setRows([])
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [])

  return { rows, loading }
}
