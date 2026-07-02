import { useMemo } from 'react'
import { Flame, Star, ExternalLink } from 'lucide-react'
import { GlassCard } from './GlassCard'
import { normalizePost, whyDidWell } from './CompanyDrillIn'
import { colorForCompany } from '../lib/colors'
import { PLATFORM_COLOR_VAR } from '../lib/colors'
import './topPosts.css'

/* ISO-week bucketing (Monday-start), mirrors metrics.isoWeekStart. */
function isoWeekStart(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return d
}
function weekKey(date) {
  const w = isoWeekStart(date)
  return `${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, '0')}-${String(w.getDate()).padStart(2, '0')}`
}
function weekLabelOf(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/* The wild-outliers reel: the most recent ISO week's highest-impact posts,
   flagged when they're well above that week's typical post (mean + 1σ). */
function deriveWeekTop(posts, max = 6) {
  const dated = posts.filter(p => p.ts && !isNaN(new Date(p.ts).getTime()))
  if (!dated.length) return { items: [], label: null, hasOutliers: false }

  let latest = null
  for (const p of dated) {
    const k = weekKey(new Date(p.ts))
    if (!latest || k > latest) latest = k
  }
  const wk = dated.filter(p => weekKey(new Date(p.ts)) === latest)
  const norm = wk.map(p => ({ ...normalizePost(p), company: p.companyName }))

  const weights = norm.map(p => p.weight)
  const n = weights.length
  const mean = n ? weights.reduce((s, v) => s + v, 0) / n : 0
  const std = n ? Math.sqrt(weights.reduce((s, v) => s + (v - mean) ** 2, 0) / n) : 0
  const threshold = mean + std

  const ranked = [...norm]
    .sort((a, b) => b.weight - a.weight)
    .map(p => ({ ...p, isOutlier: n >= 4 && p.weight > threshold && p.weight > mean }))

  return { items: ranked.slice(0, max), label: weekLabelOf(latest), hasOutliers: ranked.slice(0, max).some(p => p.isOutlier) }
}

function TopPostRow({ post }) {
  const platColor = PLATFORM_COLOR_VAR[post.platform] || 'var(--text-muted)'
  const coColor = colorForCompany(post.company)
  const { phrase } = whyDidWell(post)
  const snippet = (post.text || post.title || '').trim()
  const short = snippet.length > 150 ? snippet.slice(0, 150) + '…' : snippet
  const Body = (
    <>
      <div className="twp-row-top">
        <span className="twp-co"><span className="twp-co-dot" style={{ background: coColor }} />{post.company}</span>
        <span className="twp-plat"><span className="twp-plat-dot" style={{ background: platColor }} />{post.platform}</span>
        {post.isOutlier && (
          <span className="twp-outlier" title="Well above this week's typical post"><Flame size={11} /> outlier</span>
        )}
        <span className="twp-weight" title="This post's weighted impact on Share of Voice">⚡ {Math.round(post.weight * 100) / 100}</span>
        {post.url && <ExternalLink size={13} className="twp-ext" />}
      </div>
      <div className="twp-text">{short || <em>(no preview text)</em>}</div>
      <div className="twp-why"><Star size={11} /> {phrase}</div>
    </>
  )
  if (post.url) {
    return <a className="twp-row" href={post.url} target="_blank" rel="noopener noreferrer" title="Open original post">{Body}</a>
  }
  return <div className="twp-row">{Body}</div>
}

// `posts` — the current filtered, direct-competitor working set. The section
// self-scopes to the most recent ISO week present, so it always shows "this week".
export function TopPostsWeek({ posts = [] }) {
  const { items, label, hasOutliers } = useMemo(() => deriveWeekTop(posts), [posts])
  if (!items.length) return null
  return (
    <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4} interactive>
      <div className="card-header">
        <span className="card-title">Top posts this week{label ? ` · week of ${label}` : ''}</span>
      </div>
      <p className="cr-sub" style={{ marginTop: -8 }}>
        The highest-impact posts driving the board right now{hasOutliers ? ' — flagged “outliers” are well above the week’s typical post.' : ', ranked by weighted contribution.'}
      </p>
      <div className="twp-list">
        {items.map((p, i) => <TopPostRow post={p} key={i} />)}
      </div>
    </GlassCard>
  )
}
