import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Maps a row from the competitor_briefings table (whatever shape n8n writes)
// onto the structured shape the Briefings UI expects. Tolerant of both
// camelCase and snake_case keys, plus nested `output`/`result`/`briefing`
// envelopes if n8n stuffs the LLM payload there.
function normalizeBriefing(row) {
  if (!row) return null
  const x = row.output || row.result || row.briefing || row.data || row
  const name = x.name || x.company || x.competitor || row.company || row.name || ''
  const date = x.date || x.created_at || row.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10)
  return {
    name,
    date: typeof date === 'string' ? date.slice(0, 10) : date,
    threat: (x.threatLevel || x.threat_level || x.threat || 'medium').toLowerCase(),
    summary: x.summary || x.threatDescription || x.threat_description || '',
    category: x.category || '',
    claim: x.coreClaim || x.core_claim || x.claim || '',
    pricing: x.pricing || x.pricingSignals || '',
    api: x.api || '',
    models: x.models || x.flagshipModels || x.flagship_models || [],
    products: x.products || x.product_overview || [],
    industries: x.industries || [],
    customers: x.customers || x.customerTypes || x.customer_types || [],
    funding: x.funding || '',
    strengths: x.strengths || [],
    weaknesses: x.weaknesses || [],
    diff: x.differentiation || x.diff || [],
    overlap: x.overlapRisks || x.overlap_risks || x.overlap || [],
    battle: x.battleCardNotes || x.battle_card_notes || x.battle || [],
    gaps: x.positioningGaps || x.positioning_gaps || x.gaps || [],
    news: x.recentNews || x.recent_news || x.news || [],
    urn: row.URN || row.urn || x.urn || null,
    _id: row.id,
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
      safe(() => supabase.from('postsOfInterest').select('*').order('date', { ascending: false })),
      safe(() => supabase.from('linkedin_URNs').select('*').order('company', { ascending: true })),
    ])
    // Newest briefing wins per company (rows already ordered desc by created_at)
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
