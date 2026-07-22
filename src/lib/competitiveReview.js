import { ymd, fmtDateRange } from './dates'
import { extractEngagement } from './engagement'

// Competitive Review data model: per-competitor view of LinkedIn posts
// attributed to each competitor, bucketed into BI-WEEKLY review periods.
// `buildPeriods` + `periodRangeLabel` power the Social Briefs page
// (SocialBriefs.jsx).
//
// Source: reuses the already-loaded `allPosts` (from useSOVData). LinkedIn rows
// carry the raw engagement + author fields, plus `authorType`
// ('company' | 'employee' | 'external') from the shared classifier — shown as a
// badge per post. Other platforms are aggregated as attributed activity.
//
// Cadence: the review meeting is bi-weekly, so periods are 14 days anchored to
// this date — the current period is Jul 22 – Aug 4, and the grid extends
// backwards on the same 14-day rhythm (Jul 8–21, Jun 24–Jul 7, …).
export const PERIOD_ANCHOR = '2026-07-22'
export const PERIOD_DAYS = 14
const DAY_MS = 86400000

// Period-start label 'YYYY-MM-DD' for a date/timestamp, snapped to the 14-day
// grid. Uses Math.round for the day diff so a DST hour can't skew the bucket.
function periodStartLabel(d) {
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return null
  const day0 = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())
  const anchor = new Date(PERIOD_ANCHOR + 'T00:00:00')
  const diffDays = Math.round((day0.getTime() - anchor.getTime()) / DAY_MS)
  const idx = Math.floor(diffDays / PERIOD_DAYS)
  const start = new Date(anchor)
  start.setDate(anchor.getDate() + idx * PERIOD_DAYS)
  return ymd(start)
}

// Human label for a period: "Jul 21 – Aug 3, 2026"
export function periodRangeLabel(label) {
  if (!label) return '—'
  const start = new Date(label + 'T00:00:00')
  if (isNaN(start.getTime())) return label
  const end = new Date(start); end.setDate(end.getDate() + PERIOD_DAYS - 1)
  return fmtDateRange(start, end, { withYear: true, collapseSameMonth: false })
}

function linkedinEngagement(p) {
  const e = extractEngagement(p)
  return {
    reactions: Number(e.reactions) || 0,
    comments: Number(e.comments) || 0,
    reshares: Number(e.reshares) || 0,
  }
}

// Per-platform attributed counts + a coarse engagement number, for the
// "all platforms" toggle. LinkedIn is handled separately (per-post rows).
function platformActivity(p) {
  const e = extractEngagement(p)
  switch (p.platform) {
    case 'X': return (Number(e.likes) || 0) + (Number(e.replies) || 0) + (Number(e.reposts) || 0) + (Number(e.quotes) || 0)
    case 'Reddit': return (Number(e.upvotes) || 0) + (Number(e.comments) || 0)
    default: return 0
  }
}

// Build the bi-weekly model.
//   periods: ['YYYY-MM-DD', ...] sorted DESC (latest first)
//   byPeriod[label].companies[name] = {
//     linkedin: { count, reactions, comments, reshares, posts:[...] },
//     other: { 'Google News': {count, engagement}, Reddit: {...}, X: {...} }
//   }
// LinkedIn includes ALL posts attributed to the competitor — the company page,
// employees, and external voices — with `authorType` carried per post so the UI
// can badge who's talking. Posts are sorted by total engagement (desc) within
// each company, ties broken newest-first.
export function buildPeriods(posts) {
  const byPeriod = {}
  const ensure = (pk, name) => {
    if (!byPeriod[pk]) byPeriod[pk] = { companies: {} }
    if (!byPeriod[pk].companies[name]) byPeriod[pk].companies[name] = {
      linkedin: { count: 0, reactions: 0, comments: 0, reshares: 0, posts: [] },
      other: {},
    }
    return byPeriod[pk].companies[name]
  }

  for (const p of posts || []) {
    const name = p.companyName
    if (!name) continue
    const pk = periodStartLabel(p.ts)
    if (!pk) continue

    if (p.platform === 'LinkedIn') {
      const c = ensure(pk, name)
      const e = linkedinEngagement(p)
      c.linkedin.count++
      c.linkedin.reactions += e.reactions
      c.linkedin.comments += e.comments
      c.linkedin.reshares += e.reshares
      c.linkedin.posts.push({
        id: p.activity_id || p.id || p.post_url,
        text: p.text || p.title || '',
        url: p.post_url || p.url || '',
        author: (p.author && (p.author.name || p.author.full_name)) || name,
        authorType: p.authorType || 'external',
        ts: p.ts,
        ...e,
      })
    } else {
      // other platforms: attributed activity (authorship not determinable yet)
      const c = ensure(pk, name)
      const plat = p.platform
      if (!c.other[plat]) c.other[plat] = { count: 0, engagement: 0 }
      c.other[plat].count++
      c.other[plat].engagement += platformActivity(p)
    }
  }

  // Sort each company's posts by total engagement desc (the meeting reads the
  // loudest posts first); ties → newest first.
  const engOf = (p) => p.reactions + p.comments + p.reshares
  for (const pk of Object.keys(byPeriod)) {
    for (const name of Object.keys(byPeriod[pk].companies)) {
      byPeriod[pk].companies[name].linkedin.posts.sort(
        (a, b) => engOf(b) - engOf(a) || (new Date(b.ts).getTime() || 0) - (new Date(a.ts).getTime() || 0)
      )
    }
  }

  const periods = Object.keys(byPeriod).sort().reverse() // latest first
  return { periods, byPeriod }
}
