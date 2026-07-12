import { useMemo } from 'react'
import { Flame, Star, ExternalLink } from 'lucide-react'
import { GlassCard } from './GlassCard'
import { normalizePost, whyDidWell } from './CompanyDrillIn'
import { colorForCompany } from '../lib/colors'
import { PLATFORM_COLOR_VAR } from '../lib/colors'
import { fmtPostDate } from '../lib/dates'
import { MisattributeButton } from './MisattributeButton'
import './topPosts.css'

/* The wild-outliers reel: the highest-impact posts from the TRAILING 7 DAYS
   (anchored to the freshest post so it renders on stale/dev data too), flagged
   when they're well above the window's typical post (mean + 1σ). Trailing window
   instead of a Thursday-anchored bucket — the bucket was near-empty right after
   the morning scrape; a rolling 7-day window is always full. */
function deriveWeekTop(posts, config, max = 6) {
  const dated = posts.filter(p => p.ts && !isNaN(new Date(p.ts).getTime()))
  if (!dated.length) return { items: [], label: null, hasOutliers: false }

  let maxT = -Infinity
  for (const p of dated) { const t = new Date(p.ts).getTime(); if (t > maxT) maxT = t }
  const cutoff = maxT - 7 * 86400000
  const wk = dated.filter(p => new Date(p.ts).getTime() > cutoff)
  const multMap = config?.platformMultipliers || {}
  const norm = wk.map(p => ({ ...normalizePost(p, multMap[p.platform] ?? 1), company: p.companyName }))

  const weights = norm.map(p => p.weight)
  const n = weights.length
  const mean = n ? weights.reduce((s, v) => s + v, 0) / n : 0
  const std = n ? Math.sqrt(weights.reduce((s, v) => s + (v - mean) ** 2, 0) / n) : 0
  const threshold = mean + std

  const ranked = [...norm]
    .sort((a, b) => b.weight - a.weight)
    .map(p => ({ ...p, isOutlier: n >= 4 && p.weight > threshold && p.weight > mean }))

  return { items: ranked.slice(0, max), label: 'last 7 days', hasOutliers: ranked.slice(0, max).some(p => p.isOutlier) }
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
          <span className="twp-outlier" title="Well above this week's typical item"><Flame size={11} /> outlier</span>
        )}
        {post.ts && <span className="twp-date" title={new Date(post.ts).toLocaleString()}>{fmtPostDate(post.ts)}</span>}
        <span className="twp-weight" title="This item's weighted impact on Share of Voice">⚡ {Math.round(post.weight * 100) / 100}</span>
        {post.url && <ExternalLink size={13} className="twp-ext" />}
      </div>
      <div className="twp-text">{short || <em>(no preview text)</em>}</div>
      <div className="twp-why"><Star size={11} /> {phrase}</div>
      <div className="twp-actions"><MisattributeButton post={post} company={post.company} compact /></div>
    </>
  )
  if (post.url) {
    return <a className="twp-row" href={post.url} target="_blank" rel="noopener noreferrer" title="Open original">{Body}</a>
  }
  return <div className="twp-row">{Body}</div>
}

// `posts` — the current filtered, direct-competitor working set. The section
// self-scopes to the trailing 7 days (anchored to the freshest post present).
export function TopPostsWeek({ posts = [], config }) {
  const { items, label, hasOutliers } = useMemo(() => deriveWeekTop(posts, config), [posts, config])
  if (!items.length) return null
  return (
    <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4} interactive>
      <div className="card-header">
        <span className="card-title">Top items · {label || 'last 7 days'}</span>
      </div>
      <p className="cr-sub" style={{ marginTop: -8 }}>
        The highest-impact items driving the board right now{hasOutliers ? ' — flagged “outliers” are well above the week’s typical item.' : ', ranked by weighted contribution.'}
      </p>
      <div className="twp-list">
        {items.map((p, i) => <TopPostRow post={p} key={i} />)}
      </div>
    </GlassCard>
  )
}
