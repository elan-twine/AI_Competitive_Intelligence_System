// Posts of Interest — the digital clone of the manual bi-weekly "Competitor
// Social Analysis" doc. Each row (from the `posts_of_interest` table) is a
// notable competitor post curated with a plain-English summary + a "why it
// matters" reason + a link. Here we group them the way the doc does: by period,
// then by competitor, with an auto-detected content TYPE (guide / webinar / ad
// / event / …) so a reader can scan what each competitor is pushing.

// ---- Content-type taxonomy --------------------------------------------------
// The canonical set (see sov-tooling/POI_GENERATOR_SPEC.md) is the 22 types the
// manual reviewers used. The weekly generator writes one of these into
// posts_of_interest.post_type, which the UI prefers. detectPostType() is only a
// FALLBACK for rows with no stored type (the legacy April backfill): a
// most-specific-first regex sweep over the summary + reason text.
const TYPE_RULES = [
  ['Earned Media', /\bthe hacker news\b|posts about (?:their|the).*(?:partner|integration)|(?:featured|covered|mentioned) (?:in|by) |press|coverage|globe ?newswire|named .*(?:by|in) (?:the )?[A-Z]/i],
  ['Webinar', /webinar|fireside|live session|virtual event|round ?table|live demo|\bama\b/i],
  ['Networking Event', /happy hour|\bdinner\b|pickleball|golf|tailgate|giveaway|mixer|reception|party/i],
  ['Event', /conference|summit|\bbooth\b|\brsac\b|identiverse|gartner|black ?hat|def ?con|sponsor|expo|meetup|road ?show|\bevent\b|showcase|attend|speaking session/i],
  ['Funding', /\braise[ds]?\b|funding|series [a-e]\b|seed round|\bround\b|investor|investment|invests?|valuation|backed by|nasdaq|nyse/i],
  ['Partnership', /partner|integrat|alliance|joins forces|collaborat|available on .*marketplace|teams? up|1-click|one-click/i],
  ['Award', /\baward|finalist|\bhonor|ranked|\bcyber ?\d+\b|hottest|top \d+|excellence|voice of the customer|\bvoc\b/i],
  ['Milestone', /\d[\d,]*\s*(?:followers|customers|users)|anniversary|\d+\s*years|celebrat|reaches?\b/i],
  ['Positioning Shift', /rebrand|renam|new (?:banner|tagline|category)|now (?:calling|labeling|referring)|changes? .*banner|coin(?:s|ed|ing)? (?:the term|a new)|introduc\w* .*(?:category|market)\b/i],
  ['Research', /security research|vulnerabilit|\bcve\b|exploit|malware|threat report|\bdbir\b|global threat|breach\b/i],
  ['Product', /launch|introduc|unveil|new feature|now available|general availability|\bga\b|releases? (?:a |the |new |its )?(?:feature|product|agent|platform|capabilit)|announc\w* .*(?:feature|product|agent|platform|capabilit)/i],
  ['Video', /\bvideo\b|animated|explainer|\bdemo\b|\breel\b|\bveo\b/i],
  ['Customer Story', /customer story|case study|testimonial|quote from .*(?:ciso|customer)|success story/i],
  ['Campaign', /campaign|advertisement|\bad(?:s|vert)?\b|ad[- ]library|spotlight|billboard|message ad|promot/i],
  ['Thought Leadership', /whitepaper|white paper|e-?book|buyer'?s guide|\bguide\b|playbook|checklist|\breport\b|study|findings|infographic|\bbrief\b|survey|\bblog\b|\bmemo\b|perspective|op-?ed|point of view|thought leadership|weighs? in|take on|hot take/i],
  ['Community', /community|alliance|\bgsia\b|cohort|user group|founders/i],
  ['Interactive', /\bpoll\b|quiz|caption this|guess|this or that|poem|meme/i],
  ['Seasonal', /happy (?:hannukah|hanukkah|holidays|new year|thanksgiving)|valentine|super ?bowl|halloween|christmas|\bpride\b|nasa/i],
  ['Hiring', /hiring|join our team|open role|now hiring|we'?re growing|paid leave|employer brand/i],
  ['Exec Commentary', /\bceo\b|\bcto\b|\bcpo\b|founder|reposts?|thought leadership on|reacts?/i],
]

// Muted, theme-safe badge colors. Covers the full canonical taxonomy plus the
// legacy "Report" label so old rows still render a color.
export const TYPE_COLORS = {
  'Thought Leadership': '#6366F1',
  'Event': '#F59E0B',
  'Webinar': '#8B5CF6',
  'Networking Event': '#FB923C',
  'Campaign': '#F97316',
  'Video': '#EF4444',
  'Award': '#EAB308',
  'Earned Media': '#38BDF8',
  'Exec Commentary': '#818CF8',
  'Product': '#EC4899',
  'Partnership': '#14B8A6',
  'Research': '#A855F7',
  'Positioning Shift': '#F43F5E',
  'Funding': '#22C55E',
  'Distribution Tactic': '#2DD4BF',
  'Hiring': '#64748B',
  'Milestone': '#EAB308',
  'Customer Story': '#10B981',
  'Seasonal': '#E879F9',
  'Community': '#0EA5E9',
  'Interactive': '#C084FC',
  'Report': '#0EA5E9', // legacy alias of Thought Leadership
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
// The weekly generator runs on a Thursday cadence, synced to the Thursday OKR
// meeting. We bucket post dates into fixed 7-day windows from a stable THURSDAY
// anchor, so each period is exactly the Thursday→Wednesday week reviewed at the
// meeting (and matches metrics.WEEK_ANCHOR_DAY + the SOV-ranking "Week of" label).
// Deterministic (no dependence on "today"); legacy rows fall into their week.
const PERIOD_ANCHOR = Date.UTC(2026, 0, 1) // 2026-01-01, a Thursday
const DAY = 86400000

function ymd(t) {
  const d = new Date(t)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// Parse a DB timestamp to epoch ms as UTC. posts_of_interest.date is stored
// zoneless ("2026-03-18 14:32:53"), which `new Date()` would read in the
// browser's LOCAL zone — while all the bucket math here is UTC (PERIOD_ANCHOR,
// ymd). That mismatch can shift a post across a 14-day boundary for non-UTC
// users. Force zoneless strings to UTC; leave already-zoned ISO strings alone.
function toUtcMs(date) {
  if (date == null) return NaN
  let s = String(date).trim()
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) {
    s = s.replace(' ', 'T') + 'Z'
  }
  return new Date(s).getTime()
}

export function periodStartFor(date, windowDays = 7) {
  const t = toUtcMs(date)
  if (isNaN(t)) return null
  const span = windowDays * DAY
  const idx = Math.floor((t - PERIOD_ANCHOR) / span)
  return ymd(PERIOD_ANCHOR + idx * span)
}

export function periodRangeLabel(startKey, windowDays = 7) {
  if (startKey === 'all') return 'All periods'
  if (!startKey) return '—'
  const start = new Date(startKey + 'T00:00:00Z')
  if (isNaN(start.getTime())) return startKey
  const end = new Date(start.getTime() + (windowDays - 1) * DAY)
  const sM = start.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })
  const eM = end.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })
  const sD = start.getUTCDate(), eD = end.getUTCDate()
  // "Week of Jul 2 – 8" (same month) or "Week of Jul 30 – Aug 5". The "Week of"
  // prefix marks the Thursday OKR week; drop it for non-weekly windows.
  const range = sM === eM ? `${sM} ${sD} – ${eD}` : `${sM} ${sD} – ${eM} ${eD}`
  return windowDays === 7 ? `Week of ${range}` : range
}

// Normalize one posts_of_interest row into a display item. Prefers the fields
// the weekly generator writes (post_type, strategic_angle, engagement snapshot,
// collapsed_count) and falls back gracefully for the legacy April rows that only
// had summary/relevance_reason/url.
function toItem(row, engagementIndex) {
  const summary = row.summary || row.relevance_reason || 'Flagged post'
  const reason = (row.summary && row.relevance_reason && row.relevance_reason !== row.summary)
    ? row.relevance_reason : ''
  const actId = row.source_id || activityIdFromUrl(row.url)
  const url = row.url || linkedinUrlForActivity(actId)
  // Stored engagement snapshot wins; fall back to a live join against the loaded
  // LinkedIn posts (older rows have no snapshot).
  const stored = (row.reactions != null || row.comments != null || row.reshares != null)
    ? { reactions: Number(row.reactions) || 0, comments: Number(row.comments) || 0, reshares: Number(row.reshares) || 0 }
    : null
  const eng = stored || (actId && engagementIndex ? engagementIndex.get(actId) : null)
  const collapsed = Math.max(1, Number(row.collapsed_count) || 1)
  return {
    id: row.id ?? row.url ?? summary,
    company: row.author || 'Unknown',
    date: row.date || row.created_at,
    summary,
    reason,
    // The strategic angle the review meeting produces — AI-suggested "what this
    // means for Twine / how we might respond". The most valuable field.
    strategicAngle: row.strategic_angle || '',
    url,
    // Generator-assigned category wins over the client-side regex fallback.
    type: row.post_type || detectPostType(summary, reason),
    engagement: eng || null,
    collapsedCount: collapsed,
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
  const { competitors = [], engagementIndex = null, windowDays = 7 } = opts
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
