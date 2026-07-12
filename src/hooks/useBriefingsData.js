import { useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useCachedFetch } from './useCachedFetch'

// Briefing flows are triggered through a SAME-ORIGIN Cloudflare Worker proxy
// (worker/index.js) that verifies the caller's Supabase session before
// forwarding to the real n8n webhooks. The n8n URLs are Worker SECRETS now —
// deliberately NOT in the client bundle — so a random visitor can't read them
// and fire (paid) briefing scrapes. See audit finding F1.
//   /api/briefing/new        → POST { "Competitor Name", "Competitor URL" } → one competitor_briefings row
//   /api/briefing/update-all → POST {} → re-scrape + update every existing brief
export const BRIEFING_NEW_PATH = '/api/briefing/new'
export const BRIEFING_UPDATE_ALL_PATH = '/api/briefing/update-all'

// POST to the gated briefing proxy with the current user's Supabase access
// token. Throws on no session / non-2xx so callers can toast a clear message.
export async function callBriefingProxy(path, body) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('You must be signed in to do that.')
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body || {}),
  })
  if (!r.ok) {
    throw new Error(r.status === 401 ? 'Session expired — sign in again.' : `Request failed (${r.status})`)
  }
  return r
}

// Some array columns are stored as JSON-stringified arrays (e.g.
// "[\"a\",\"b\"]"). Tolerate both real arrays and JSON strings.
function parseList(v) {
  if (Array.isArray(v)) return v
  if (typeof v !== 'string') return v == null ? [] : [String(v)]
  const t = v.trim()
  if (!t) return []
  if (t.startsWith('[')) { try { const p = JSON.parse(t); return Array.isArray(p) ? p : [String(p)] } catch { /* fall through */ } }
  // Comma-fallback for plain CSV strings
  return t.split(/\s*,\s*/).filter(Boolean)
}

// Map a competitor_briefings row to the structured shape the UI expects.
function normalizeBriefing(row) {
  if (!row) return null
  const name = row.competitor_name || row.name || row.company || row.competitor || ''
  const dateRaw = row.date || row.created_at || ''
  return {
    name,
    date: typeof dateRaw === 'string' ? dateRaw.slice(0, 10) : dateRaw,
    threat: String(row.threat_level || row.threat || 'medium').toLowerCase(),
    summary: row.threat_rationale || row.summary || '',
    category: row.category_classification || row.category || '',
    claim: row.core_positioning || row.core_claim || row.claim || '',
    pricing: row.pricing_signals || row.pricing || '',
    api: row.api || '',
    url: row.competitor_url || row.url || '',
    models: parseList(row.flagship_models || row.models),
    products: parseList(row.product_focus_areas || row.products),
    industries: parseList(row.target_industries || row.industries),
    customers: parseList(row.target_customers || row.customers),
    notableCustomers: parseList(row.notable_customers),
    funding: row.funding_info || row.funding || '',
    strengths: parseList(row.competitor_strengths || row.strengths),
    weaknesses: parseList(row.competitor_weaknesses || row.weaknesses),
    diff: parseList(row.points_of_differentiation || row.differentiation || row.diff),
    overlap: parseList(row.overlap_risk_areas || row.overlap),
    battle: parseList(row.battle_card_notes || row.battle),
    gaps: parseList(row.positioning_gaps_for_twine || row.positioning_gaps || row.gaps),
    marketingStrategy: parseList(row.marketing_strategy),
    news: parseList(row.recent_news || row.news),
    fullReport: row.full_report || '',
    urn: row.URN || row.urn || null,
    _id: row.id,
    _createdAt: row.created_at,
  }
}

function keyFor(name) {
  return String(name || '').toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
}

export function useBriefingsData() {
  // Briefings are generated manually (rare), so the read is cached (localStorage);
  // reloads read from cache. refetch() forces a fresh fetch — the briefing UI
  // calls it after triggering a new/updated brief so the fresh row shows.
  const fetcher = useCallback(async () => {
    const safe = async (fn) => {
      try { const r = await fn(); if (r.error) { console.warn('[briefings]', r.error.message); return [] } return r.data || [] }
      catch (e) { console.warn('[briefings] threw:', e); return [] }
    }
    const [bRows, uRows] = await Promise.all([
      safe(() => supabase.from('competitor_briefings').select('*').order('created_at', { ascending: false })),
      safe(() => supabase.from('linkedin_URNs').select('*').order('company', { ascending: true })),
    ])
    return { bRows, uRows }
  }, [])

  const { data, loading, error, refetch } = useCachedFetch('briefings', fetcher, {})

  // Newest briefing wins per company (rows are desc by created_at).
  const briefings = useMemo(() => {
    const map = {}
    for (const r of (data?.bRows || [])) {
      const b = normalizeBriefing(r)
      if (!b?.name) continue
      const k = keyFor(b.name)
      if (!map[k]) map[k] = b
    }
    return map
  }, [data])
  const urns = data?.uRows || []

  return { briefings, urns, loading, error, refetch }
}

export { keyFor }
