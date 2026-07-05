// Posts of Interest — the digital clone of the manual bi-weekly "Competitor
// Social Analysis" doc. Each row (from the `posts_of_interest` table) is a
// notable competitor post curated with a plain-English summary + a "why it
// matters" reason + a link. Here we group them the way the doc does: by period,
// then by competitor, with an auto-detected content TYPE (guide / webinar / ad
// / event / …) so a reader can scan what each competitor is pushing.

// ---- Content-type detection -------------------------------------------------
// Ordered most-specific → most-generic; first hit wins. Matched against the
// summary + reason text (the LLM-written description of what the post is).
const TYPE_RULES = [
  ['Webinar', /webinar|fireside|live session|virtual event|ama\b/i],
  ['Report', /whitepaper|white paper|e-?book|buyer'?s guide|\bguide\b|playbook|checklist|\breport\b|research|study|findings|infographic|\bbrief\b|survey/i],
  ['Event', /conference|summit|\bbooth\b|\brsac\b|identiverse|gartner|black ?hat|def ?con|sponsor|expo|meetup|road ?show|\bevent\b|dinner|tailgate|showcase|attend/i],
  ['Partnership', /partner|integrat|alliance|joins forces|collaborat|available on .*marketplace|teams? up/i],
  ['Funding', /\braise[ds]?\b|funding|series [a-e]\b|\$\s?\d|investment|invests?|\bround\b|valuation|backed by/i],
  ['Product', /launch|introduc|unveil|new feature|now available|general availability|\bga\b|releases? (?:a |the |new |its )|announc\w* .*(feature|product|agent|platform|capabilit)/i],
  ['Video', /\bvideo\b|animated|explainer|\bdemo\b|watch\b|reel\b/i],
  ['Award', /\baward|recognized|named (?:a |to |one )|finalist|honor|ranked|\bmilestone|followers\b|celebrat|anniversary/i],
  ['Campaign', /campaign|advertisement|\bad(?:s|vert)?\b|spotlight|billboard|promot|guerilla|guerrilla/i],
  ['Thought Leadership', /thought leadership|\bblog\b|\bmemo\b|perspective|op-?ed|point of view|weighs? in|reacts?|take on|hot take/i],
  ['Hiring', /hiring|join our team|open role|now hiring|we'?re growing/i],
]

// Muted, theme-safe badge colors per type.
export const TYPE_COLORS = {
  'Webinar': '#8B5CF6',
  'Report': '#0EA5E9',
  'Event': '#F59E0B',
  'Partnership': '#14B8A6',
  'Funding': '#22C55E',
  'Product': '#EC4899',
  'Video': '#EF4444',
  'Award': '#EAB308',
  'Campaign': '#F97316',
  'Thought Leadership': '#6366F1',
  'Hiring': '#64748B',
  'Post': '#94A3B8',
}

export function detectPostType(...texts) {
  const s = texts.filter(Boolean).join(' ')
  for (const [label, re] of TYPE_RULES) if (re.test(s)) return label
  return 'Post'
}

// ---- LinkedIn activity id <-> url -------------------------------------------
// posts_of_interest.url is a share URL like
//   .../posts/<slug>-activity-7440027450610298881-96e?...
// linkedin_posts stores the bare numeric activity_id. Extract to join engagement.
export function activityIdFromUrl(url) {
  const m = String(url || '').match(/activity[-:](\d{6,})/i)
  return m ? m[1] : null
}

export function linkedinUrlForActivity(id) {
  return id ? `https://www.linkedin.com/feed/update/urn:li:activity:${id}/` : ''
}

// ---- Period bucketing -------------------------------------------------------
// The manual reviews run on a ~bi-weekly cadence. We bucket post dates into
// fixed 14-day windows from a stable anchor (a Monday), so periods are
// deterministic and reproducible (no dependence on "today").
const PERIOD_ANCHOR = Date.UTC(2026, 0, 5) // 2026-01-05, a Monday
const DAY = 86400000

function ymd(t) {
  const d = new Date(t)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export function periodStartFor(date, windowDays = 14) {
  const t = new Date(date).getTime()
  if (isNaN(t)) return null
  const span = windowDays * DAY
  const idx = Math.floor((t - PERIOD_ANCHOR) / span)
  return ymd(PERIOD_ANCHOR + idx * span)
}

export function periodRangeLabel(startKey, windowDays = 14) {
  if (startKey === 'all') return 'All periods'
  if (!startKey) return '—'
  const start = new Date(startKey + 'T00:00:00Z')
  if (isNaN(start.getTime())) return startKey
  const end = new Date(start.getTime() + (windowDays - 1) * DAY)
  const o = { month: 'short', day: 'numeric', timeZone: 'UTC' }
  const s = start.toLocaleDateString(undefined, o)
  const e = end.toLocaleDateString(undefined, { ...o, year: 'numeric' })
  return `${s} – ${e}`
}

// Normalize one posts_of_interest row into a display item, joined with LinkedIn
// engagement when the post is present in linkedin_posts (matched by activity id).
function toItem(row, engagementIndex) {
  const summary = row.summary || row.relevance_reason || 'Flagged post'
  const reason = (row.summary && row.relevance_reason && row.relevance_reason !== row.summary)
    ? row.relevance_reason : ''
  const actId = activityIdFromUrl(row.url)
  const url = row.url || linkedinUrlForActivity(actId)
  const eng = actId && engagementIndex ? engagementIndex.get(actId) : null
  return {
    id: row.id ?? row.url ?? summary,
    company: row.author || 'Unknown',
    date: row.date || row.created_at,
    summary,
    reason,
    url,
    type: detectPostType(summary, reason),
    engagement: eng || null,
  }
}

// Build an activity-id → engagement map from the already-loaded LinkedIn posts.
export function buildEngagementIndex(allPosts) {
  const idx = new Map()
  for (const p of allPosts || []) {
    if (p.platform !== 'LinkedIn') continue
    const id = String(p.activity_id || '')
    if (!id) continue
    idx.set(id, {
      reactions: Number(p.totalReactions) || 0,
      comments: Number(p.comments) || 0,
      reshares: Number(p.reshares) || 0,
    })
  }
  return idx
}

// Match a posts_of_interest.author to a tracked competitor's canonical name so
// coloring/ordering line up with the rest of the app (fuzzy: substring both ways).
function canonicalCompany(author, competitorNames) {
  const a = String(author || '').trim().toLowerCase()
  if (!a) return author || 'Unknown'
  for (const n of competitorNames) {
    const ln = n.toLowerCase()
    if (a === ln || a.includes(ln) || ln.includes(a)) return n
  }
  return author
}

// Main builder. Returns period buckets (newest first) + an "all" bucket, each
// with items grouped by company and light metrics.
export function buildPostsOfInterest(rows, opts = {}) {
  const { competitors = [], engagementIndex = null, windowDays = 14 } = opts
  const names = competitors.map(c => c.name)
  const items = (rows || []).map(r => {
    const it = toItem(r, engagementIndex)
    it.company = canonicalCompany(it.company, names)
    it.periodStart = periodStartFor(it.date, windowDays)
    return it
  }).filter(it => it.periodStart)

  const groupByCompany = (list) => {
    const m = new Map()
    for (const it of list) {
      if (!m.has(it.company)) m.set(it.company, [])
      m.get(it.company).push(it)
    }
    // newest post first within each company
    for (const arr of m.values()) arr.sort((a, b) => new Date(b.date) - new Date(a.date))
    // companies ordered by post count desc, then name
    return [...m.entries()]
      .map(([company, list]) => ({ company, items: list }))
      .sort((a, b) => b.items.length - a.items.length || a.company.localeCompare(b.company))
  }

  const metricsFor = (list) => ({
    posts: list.length,
    companies: new Set(list.map(i => i.company)).size,
    engagement: list.reduce((s, i) => s + (i.engagement ? i.engagement.reactions + i.engagement.comments + i.engagement.reshares : 0), 0),
  })

  const byPeriod = new Map()
  for (const it of items) {
    if (!byPeriod.has(it.periodStart)) byPeriod.set(it.periodStart, [])
    byPeriod.get(it.periodStart).push(it)
  }
  const periods = [...byPeriod.keys()].sort().reverse().map(key => ({
    key,
    label: periodRangeLabel(key, windowDays),
    companies: groupByCompany(byPeriod.get(key)),
    metrics: metricsFor(byPeriod.get(key)),
  }))

  const allBucket = {
    key: 'all',
    label: periodRangeLabel('all'),
    companies: groupByCompany(items),
    metrics: metricsFor(items),
  }

  return { periods, all: allBucket, hasData: items.length > 0, total: items.length }
}
