// Competitive Review data model: weekly, per-competitor view of posts the
// competitors themselves published (their company page + employees), with
// LinkedIn engagement aggregates. Skeleton for the future weekly insight report
// (marketing-strategy shifts / campaigns) — that classification is TODO.
//
// Source: reuses the already-loaded `allPosts` (from useSOVData). LinkedIn rows
// carry the raw engagement + author fields. Authorship is only reliably known on
// LinkedIn for now, so "competitor-authored" filtering applies to LinkedIn; other
// platforms are shown as attributed activity behind a toggle.

// Monday (ISO week start) label 'YYYY-MM-DD' for a date/timestamp.
export function weekStartLabel(d) {
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return null
  const x = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())
  const day = (x.getDay() + 6) % 7 // 0=Mon..6=Sun
  x.setDate(x.getDate() - day)
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const dd = String(x.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// Human label for a week: "Jun 16 – Jun 22, 2026"
export function weekRangeLabel(label) {
  if (!label) return '—'
  const start = new Date(label + 'T00:00:00')
  if (isNaN(start.getTime())) return label
  const end = new Date(start); end.setDate(end.getDate() + 6)
  const opts = { month: 'short', day: 'numeric' }
  const s = start.toLocaleDateString(undefined, opts)
  const e = end.toLocaleDateString(undefined, { ...opts, year: 'numeric' })
  return `${s} – ${e}`
}

// Is this post authored BY the competitor (its company page or an employee)?
// Only meaningful for LinkedIn (we have the author object there).
export function isCompanyAuthored(post, urnByName) {
  if (post.platform !== 'LinkedIn') return false
  const a = post.author && typeof post.author === 'object' ? post.author : {}
  const cn = String(post.companyName || '')
  if (!cn) return false
  const urn = urnByName[cn]
  if (urn && String(a.profile_id || '') === String(urn)) return true       // company page
  const head = String(a.headline || '').toLowerCase()
  if (head && head.includes(cn.toLowerCase())) return true                  // employee
  return false
}

export function linkedinEngagement(p) {
  return {
    reactions: Number(p.totalReactions) || 0,
    comments: Number(p.comments) || 0,
    reshares: Number(p.reshares) || 0,
  }
}

// Per-platform attributed counts + a coarse engagement number, for the
// "all platforms" toggle. LinkedIn is handled separately (authored-only).
export function platformActivity(p) {
  switch (p.platform) {
    case 'X': return (Number(p.likeCount) || 0) + (Number(p.replyCount) || 0) + (Number(p.retweetCount) || 0) + (Number(p.quoteCount) || 0)
    case 'Reddit': return (Number(p.score) || 0) + (Number(p.numComments) || 0)
    default: return 0
  }
}

// Build the weekly model.
//   weeks: ['YYYY-MM-DD', ...] sorted DESC (latest first)
//   byWeek[label].companies[name] = {
//     linkedin: { count, reactions, comments, reshares, posts:[...] },
//     other: { 'Google News': {count, engagement}, Reddit: {...}, X: {...} }
//   }
export function buildWeekly(posts, urnByName) {
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
      if (!isCompanyAuthored(p, urnByName)) continue
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
