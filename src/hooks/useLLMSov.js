import { useCallback } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useCachedFetch } from './useCachedFetch'

// AI-answer Share of Voice ("share of model") — the weekly aggregate written by
// the `SOV — AI Answers` n8n workflow into `llm_sov` (anon-readable).
// Rows: { week_start, engine, company, mention_rate, share_of_model,
//         avg_first_pos, n_prompts, n_samples, prompt_version }.
// Written once a week, so it's cached (localStorage) — reloads read from cache
// instead of refetching. Empty until the workflow's first run; a fetch error
// leaves rows=[] and the UI renders its explanatory empty state (fails soft).
export function useLLMSov() {
  const fetcher = useCallback(async () => {
    return await fetchAllRows(() => supabase
      .from('llm_sov')
      .select('*')
      .order('week_start', { ascending: false }))
  }, [])

  const { data, loading } = useCachedFetch('llm_sov', fetcher, {})
  return { rows: data || [], loading }
}
