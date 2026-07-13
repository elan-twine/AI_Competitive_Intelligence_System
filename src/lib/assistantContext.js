import { postWeightOf } from './metrics'

// Builds the compact, model-friendly snapshot the dashboard assistant reasons
// over. Everything here is derived from data the dashboard ALREADY has in
// memory (allPosts + the live ranked board), so the assistant never needs its
// own DB access — it answers from exactly what the user is looking at.
//
// Two question shapes drive the shape of this payload:
//   • "why did <company> spike?" → needs the current board + recent per-company
//     movement (last 7d pooled impact vs the prior 7d) + the specific recent
//     posts that carry the most weight (so it can cite the cause).
//   • "where do I see <thing>?" → answered from the static app map in the Worker
//     system prompt; this payload just grounds it in the live numbers.

const DAY = 86400000
const round1 = (n) => Math.round(n * 10) / 10
const round2 = (n) => Math.round(n * 100) / 100

function snippetOf(p) {
  const raw = (typeof p.text === 'string' && p.text) || p.title || p.selfText || ''
  const s = String(raw).replace(/\s+/g, ' ').trim()
  return s.length > 180 ? s.slice(0, 179) + '…' : s
}

export function buildAssistantContext({ allPosts = [], ranked = [], competitors = [], config = {}, filters = {} } = {}) {
  const mult = config.platformMultipliers || { LinkedIn: 1, 'Google News': 1, Reddit: 1, X: 1 }
  const impactOf = (p) => (mult[p.platform] != null ? mult[p.platform] : 0) * postWeightOf(p)
  const now = Date.now()
  const tsOf = (p) => { const t = p.ts ? new Date(p.ts).getTime() : NaN; return isNaN(t) ? 0 : t }

  const typeByName = {}
  for (const c of competitors || []) typeByName[c.name] = (c.type || 'direct')

  // The board exactly as ranked on screen (direct competitors, by SOV).
  const board = (ranked || []).map((r, i) => ({
    rank: i + 1,
    company: r.company,
    sovPct: round1(r.weightedPct || 0),
    items: r.postCount != null ? r.postCount : (r.items != null ? r.items : null),
    sentiment: r.avgSentiment != null ? round2(r.avgSentiment) : null,
    type: typeByName[r.company] || 'direct',
  }))

  // Recent movement — last 7d pooled impact vs the prior 7d. This is what makes
  // a "spike" legible: a large positive changePct is the thing to explain.
  const windowImpact = (from, to, name) => (allPosts || []).reduce((s, p) => {
    const t = tsOf(p)
    return (p.companyName === name && t >= from && t < to) ? s + impactOf(p) : s
  }, 0)
  const names = board.map(b => b.company)
  const movement = names.map(name => {
    const last7 = windowImpact(now - 7 * DAY, now + DAY, name)
    const prev7 = windowImpact(now - 14 * DAY, now - 7 * DAY, name)
    const changePct = prev7 > 0 ? round1(((last7 - prev7) / prev7) * 100) : (last7 > 0 ? null : 0)
    return { company: name, last7Impact: round1(last7), prev7Impact: round1(prev7), changePct }
  }).filter(m => m.last7Impact > 0 || m.prev7Impact > 0)

  // Highest-impact posts of the last 14 days — the "what happened" the assistant
  // cites when explaining a move. Impact = platform multiplier × post_weight.
  const recentTopPosts = (allPosts || [])
    .filter(p => tsOf(p) >= now - 14 * DAY && p.companyName)
    .map(p => ({ p, imp: impactOf(p) }))
    .sort((a, b) => b.imp - a.imp)
    .slice(0, 22)
    .map(({ p, imp }) => ({
      company: p.companyName,
      platform: p.platform,
      date: p.ts ? String(p.ts).slice(0, 10) : null,
      impact: round1(imp),
      snippet: snippetOf(p),
      url: p.post_url || p.url || p.twitterUrl || null,
    }))

  return {
    generatedAt: new Date(now).toISOString(),
    filters: { platform: filters.platform || 'All', window: filters.window || 'current' },
    board,
    movement,
    recentTopPosts,
  }
}
