import { useCallback } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useCachedFetch } from './useCachedFetch'

// GEO / AEO visibility — "how often each tracked company is named when a buyer
// asks an AI assistant the identity-security questions we track, web search on".
//
// Reads two tables (anon/authenticated-readable, populated by the weekly
// AI Answers n8n run):
//   geo_prompts  { id, ext_id, topic, prompt, tags, volume, active }
//     — the versioned prompt panel (48 active rows across 9 topics).
//   geo_results  { id, prompt_id→geo_prompts.id, topic, engine ('openai'|
//     'anthropic'), run_date, week_start, web_search, answer, mentions }
//     — one row per prompt × engine × run; `mentions` is jsonb
//       [{ company: '<canonical name>', position: <1-based rank> }].
//
// Written once a week, so it's cached (localStorage) — reloads read from cache.
// Empty until the workflow's first run; a fetch error leaves both arrays empty
// and the UI renders its explanatory empty state (fails soft).
export function useGeoVisibility() {
  const fetcher = useCallback(async () => {
    // Fetch prompts + results in parallel. Results are ordered newest-first so
    // the latest week (and latest run within it) is easy to pick client-side.
    const [prompts, results] = await Promise.all([
      fetchAllRows(() => supabase
        .from('geo_prompts')
        .select('*')
        .eq('active', true)),
      fetchAllRows(() => supabase
        .from('geo_results')
        .select('*')
        .order('week_start', { ascending: false })
        .order('run_date', { ascending: false })),
    ])
    return { prompts, results }
  }, [])

  const { data, loading } = useCachedFetch('geo', fetcher, {})

  const prompts = data?.prompts || []
  const allResults = data?.results || []

  // Latest week_start across all results (robust to ordering / ties).
  const weekStart = allResults.reduce(
    (max, r) => (!max || r.week_start > max ? r.week_start : max),
    null,
  )
  const results = weekStart ? allResults.filter(r => r.week_start === weekStart) : []
  const engines = [...new Set(results.map(r => r.engine))].sort()

  // allResults (every run, newest-first) powers the visibility-over-time trend;
  // runDates is the sorted (oldest→newest) list of distinct run dates.
  const runDates = [...new Set(allResults.map(r => String(r.run_date || '').slice(0, 10)).filter(Boolean))].sort()

  return { prompts, results, allResults, runDates, weekStart, engines, loading }
}
