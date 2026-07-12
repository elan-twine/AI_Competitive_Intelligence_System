import { WEEK_ANCHOR_DAY } from './metrics'
import { ymd, fmtDateRange } from './dates'
import { extractEngagement } from './engagement'

// Competitive Review data model: weekly, per-competitor view of posts the
// competitors themselves published (their company page + employees), with
// LinkedIn engagement aggregates. `buildWeekly` + `weekRangeLabel` power the
// Social Briefs page (SocialBriefs.jsx).
//
// Source: reuses the already-loaded `allPosts` (from useSOVData). LinkedIn rows
// carry the raw engagement + author fields. Authorship is only reliably known on
// LinkedIn for now, so "competitor-authored" filtering applies to LinkedIn; other
// platforms are shown as attributed activity behind a toggle.

// Week-start label 'YYYY-MM-DD' for a date/timestamp, anchored to the shared
// scrape-aligned anchor day (metrics.WEEK_ANCHOR_DAY — currently Thursday).
function weekStartLabel(d) {
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return null
  const x = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())
  const day = (x.getDay() - WEEK_ANCHOR_DAY + 7) % 7
  x.setDate(x.getDate() - day)
  return ymd(x)
}

// Human label for a week: "Jun 16 – Jun 22, 2026"
export function weekRangeLabel(label) {
  if (!label) return '—'
  const start = new Date(label + 'T00:00:00')
  if (isNaN(start.getTime())) return label
  const end = new Date(start); end.setDate(end.getDate() + 6)
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
// "all platforms" toggle. LinkedIn is handled separately (authored-only).
function platformActivity(p) {
  const e = extractEngagement(p)
  switch (p.platform) {
    case 'X': return (Number(e.likes) || 0) + (Number(e.replies) || 0) + (Number(e.reposts) || 0) + (Number(e.quotes) || 0)
    case 'Reddit': return (Number(e.upvotes) || 0) + (Number(e.comments) || 0)
    default: return 0
  }
}

// Build the weekly model.
//   weeks: ['YYYY-MM-DD', ...] sorted DESC (latest first)
//   byWeek[label].companies[name] = {
//     linkedin: { count, reactions, comments, reshares, posts:[...] },
//     other: { 'Google News': {count, engagement}, Reddit: {...}, X: {...} }
//   }
export function buildWeekly(posts) {
  const byWeek = {}
  const ensure = (wk, name) => {
    if (!byWeek[wk]) byWeek[wk] = { companies: {} }
    if (!byWeek[wk].companies[name]) byWeek[wk].companies[name] = {
      linkedin: { count: 0, reactions: 0, comments: 0, reshares: 0, posts: [] },
      other: {},
    }
    return byWeek[wk].companies[name]
  }

  for (const p of posts || []) {
    const name = p.companyName
    if (!name) continue
    const wk = weekStartLabel(p.ts)
    if (!wk) continue

    if (p.platform === 'LinkedIn') {
      // Competitor-authored = the shared authorType (stamped by useSOVData) is
      // the company page or a confirmed employee. External LinkedIn chatter is
      // excluded here (Social Briefs is about what competitors themselves post).
      if (p.authorType !== 'company' && p.authorType !== 'employee') continue
      const c = ensure(wk, name)
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
        ts: p.ts,
        ...e,
      })
    } else {
      // other platforms: attributed activity (authorship not determinable yet)
      const c = ensure(wk, name)
      const plat = p.platform
      if (!c.other[plat]) c.other[plat] = { count: 0, engagement: 0 }
      c.other[plat].count++
      c.other[plat].engagement += platformActivity(p)
    }
  }

  // sort each company's posts newest-first
  for (const wk of Object.keys(byWeek)) {
    for (const name of Object.keys(byWeek[wk].companies)) {
      byWeek[wk].companies[name].linkedin.posts.sort(
        (a, b) => (new Date(b.ts).getTime() || 0) - (new Date(a.ts).getTime() || 0)
      )
    }
  }

  const weeks = Object.keys(byWeek).sort().reverse() // latest first
  return { weeks, byWeek }
}
