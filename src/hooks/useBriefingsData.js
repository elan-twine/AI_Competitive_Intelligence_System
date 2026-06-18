import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Hardcoded n8n webhooks for the briefing flows.
// Generate-one-new = POST { "Competitor Name", "Competitor URL" } → writes one row to competitor_briefings.
// Update-all-loop  = POST {} → re-scrapes & updates every existing brief.
export const N8N_NEW_COMPETITOR_WEBHOOK = 'https://twine-security.app.n8n.cloud/webhook/e5c7839b-e076-4e2a-8de3-1db5fdfb750d'
export const N8N_UPDATE_ALL_WEBHOOK = 'https://twine-security.app.n8n.cloud/webhook/43a45fbb-cbb4-4b38-8cb2-1f46044011dc'

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
  const [briefings, setBriefings] = useState({})
  const [posts, setPosts] = useState([])
  const [urns, setUrns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    const safe = async (fn) => {
      try { const r = await fn(); if (r.error) { console.warn('[briefings]', r.error.message); return [] } return r.data || [] }
      catch (e) { console.warn('[briefings] threw:', e); return [] }
    }
    const [bRows, pRows, uRows] = await Promise.all([
      safe(() => supabase.from('competitor_briefings').select('*').order('created_at', { ascending: false })),
      safe(() => supabase.from('linkedin_scrape').select('*').order('date', { ascending: false })),
      safe(() => supabase.from('linkedin_URNs').select('*').order('company', { ascending: true })),
    ])
    // Newest briefing wins per company (rows are desc by created_at).
    const map = {}
    for (const r of bRows) {
      const b = normalizeBriefing(r)
      if (!b?.name) continue
      const k = keyFor(b.name)
      if (!map[k]) map[k] = b
    }
    setBriefings(map)
    setPosts(pRows)
    setUrns(uRows)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  return { briefings, posts, urns, loading, error, refetch: fetchAll }
}

export { keyFor }
