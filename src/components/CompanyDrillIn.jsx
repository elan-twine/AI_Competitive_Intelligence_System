import { useEffect, useMemo } from 'react'
import { X, ThumbsUp, MessageSquare, Repeat2, Eye, Quote, ArrowUp, ExternalLink } from 'lucide-react'
import { computeWeightedSOV, postWeightOf } from '../lib/metrics'
import './companyDrillIn.css'

const PLATFORM_COLOR = {
  X: 'var(--x-color)',
  Reddit: 'var(--reddit-color)',
  'Google News': 'var(--news-color)',
  LinkedIn: 'var(--linkedin-color)',
}

// --- Week bucketing (Monday-start ISO week), mirrors metrics.isoWeekStart ---
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
function weekLabel(key) {
  // key = 'YYYY-MM-DD' (the Monday). Render "Week of Jun 23".
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `Week of ${dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

// --- Cross-platform field normalization. The hook surfaces every DB column
//     via select('*'), but the names differ per platform — unify them here. ---
function normalizePost(p) {
  const plat = p.platform
  let author = ''
  let text = ''
  let title = ''
  let url = ''
  let source = ''
  let engagement = [] // [{ icon, label, value }]

  if (plat === 'LinkedIn') {
    const a = p.author && typeof p.author === 'object' ? p.author : {}
    author = a.name || ''
    // `content` is a JSON object (article metadata), never a snippet string —
    // only `text` is a usable preview. Coerce defensively so a non-string never
    // reaches snippet.slice()/.length below.
    text = typeof p.text === 'string' ? p.text : ''
    title = p.title || ''
    url = p.post_url || ''
    engagement = [
      { key: 'reactions', icon: ThumbsUp, label: 'reactions', value: num(p.totalReactions) },
      { key: 'comments', icon: MessageSquare, label: 'comments', value: num(p.comments) },
      { key: 'reshares', icon: Repeat2, label: 'reshares', value: num(p.reshares) },
    ]
  } else if (plat === 'X') {
    text = p.text || ''
    url = p.url || p.twitterUrl || ''
    engagement = [
      { key: 'likes', icon: ThumbsUp, label: 'likes', value: num(p.likeCount) },
      { key: 'replies', icon: MessageSquare, label: 'replies', value: num(p.replyCount) },
      { key: 'reposts', icon: Repeat2, label: 'reposts', value: num(p.retweetCount) },
      { key: 'quotes', icon: Quote, label: 'quotes', value: num(p.quoteCount) },
      { key: 'views', icon: Eye, label: 'views', value: num(p.viewCount) },
    ].filter(e => e.value != null)
  } else if (plat === 'Reddit') {
    text = p.selfText || ''
    title = p.title || ''
    url = p.url || p.permalink || ''
    source = p.subreddit ? `r/${p.subreddit}` : ''
    engagement = [
      { key: 'upvotes', icon: ArrowUp, label: 'upvotes', value: num(p.score) },
      { key: 'comments', icon: MessageSquare, label: 'comments', value: num(p.numComments) },
    ]
  } else if (plat === 'Google News') {
    title = p.title || ''
    url = p.url || ''
    source = p.source || ''
    engagement = [] // News has no engagement metrics
  }

  return {
    platform: plat,
    author,
    text,
    title,
    url,
    source,
    engagement,
    sentiment: p.sentiment,
    external: p.external,
    weight: postWeightOf(p),
    ts: p.ts,
    raw: p,
  }
}

function num(v) {
  if (v == null) return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function fmtSent(s) {
  if (s == null) return null
  const n = Number(s)
  return `${n > 0 ? '+' : ''}${n}`
}
function sentClass(s) {
  if (s == null) return 'neutral'
  return s > 0 ? 'positive' : s < 0 ? 'negative' : 'neutral'
}

// --- "WHY" derivation: which platform drives the weighted score, external vs
//     own split, top high-impact post. Mirrors computeWeightedSOV's inner loop
//     so the per-platform contribution is honest (respects the min-vol guard). ---
function deriveWhy(allDirectPosts, company, config) {
  const { weightedPct, effectiveWeights, platformTotals } = computeWeightedSOV(allDirectPosts, config)
  const sov = weightedPct.get(company) || 0
  const mine = allDirectPosts.filter(p => p.companyName === company)

  const byPlat = {} // platform -> Σ post_weight for this company
  for (const p of mine) {
    if (!p.platform || platformTotals[p.platform] == null) continue
    byPlat[p.platform] = (byPlat[p.platform] || 0) + postWeightOf(p)
  }
  const contrib = {} // platform -> points (0..100) toward this company's score
  for (const plat of Object.keys(byPlat)) {
    const ew = effectiveWeights[plat] || 0
    const share = byPlat[plat] / (platformTotals[plat] || 1)
    contrib[plat] = ew * share * 100
  }
  const sorted = Object.entries(contrib).sort((a, b) => b[1] - a[1])
  const top = sorted[0] || [null, 0]
  const topPlatform = top[0]
  const topPlatformPctOfScore = sov ? Math.round((top[1] / sov) * 100) : 0

  const ext = mine.filter(p => p.external !== false).length
  const own = mine.length - ext

  const topPost = [...mine].sort((a, b) => postWeightOf(b) - postWeightOf(a))[0] || null

  return { sov, topPlatform, topPlatformPctOfScore, ext, own, total: mine.length, topPost }
}

function whyString(f) {
  if (f.total === 0) return 'No posts captured for this company in the current filter.'
  if (f.sov < 2) {
    return f.own > f.ext
      ? `Low SOV: little earned external chatter — most of its weight comes from its own ${f.own} post${f.own === 1 ? '' : 's'}.`
      : `Low SOV: very little engagement-weighted conversation in this period.`
  }
  const driver = f.topPlatform
    ? `Driven mostly by ${f.topPlatform} (${f.topPlatformPctOfScore}% of its weighted score)`
    : `Spread across platforms`
  const fuel = f.ext >= f.own ? 'earned third-party posts' : 'its own posts'
  const topW = f.topPost ? `; top post carries ~${Math.round(postWeightOf(f.topPost))} weight` : ''
  return `${driver}, fueled mainly by ${fuel}${topW}.`
}

export function CompanyDrillIn({ company, posts, allDirectPosts, config, onClose }) {
  // Esc to close.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const why = useMemo(
    () => deriveWhy(allDirectPosts, company, config),
    [allDirectPosts, company, config]
  )

  // Group this company's filtered posts by week (newest first), normalized,
  // and sort within each week by impact (post_weight) desc.
  const weeks = useMemo(() => {
    const mine = posts.filter(p => p.companyName === company)
    const buckets = new Map() // weekKey -> normalized posts[]
    for (const p of mine) {
      const t = p.ts ? new Date(p.ts) : null
      const key = t && !isNaN(t.getTime()) ? weekKey(t) : 'undated'
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push(normalizePost(p))
    }
    const keys = [...buckets.keys()].sort((a, b) => {
      if (a === 'undated') return 1
      if (b === 'undated') return -1
      return b.localeCompare(a) // newest first
    })
    return keys.map(k => ({
      key: k,
      label: k === 'undated' ? 'Undated' : weekLabel(k),
      posts: buckets.get(k).sort((a, b) => b.weight - a.weight),
    }))
  }, [posts, company])

  const totalPosts = weeks.reduce((s, w) => s + w.posts.length, 0)

  return (
    <div className="cdi-backdrop" onClick={onClose}>
      <div className="cdi-panel" role="dialog" aria-modal="true" aria-label={`${company} drill-in`} onClick={e => e.stopPropagation()}>
        <button className="cdi-close" onClick={onClose} aria-label="Close"><X size={18} /></button>

        <div className="cdi-head">
          <div className="cdi-title-row">
            <h2 className="cdi-company">{company}</h2>
            <div className="cdi-sov">
              <span className="cdi-sov-val">{why.sov.toFixed(1)}%</span>
              <span className="cdi-sov-label">SOV</span>
            </div>
          </div>
          <p className="cdi-why">{whyString(why)}</p>
          <div className="cdi-why-stats">
            <span><strong>{totalPosts}</strong> post{totalPosts === 1 ? '' : 's'} in view</span>
            <span className="cdi-dot">·</span>
            <span><strong>{why.ext}</strong> earned</span>
            <span className="cdi-dot">·</span>
            <span><strong>{why.own}</strong> own</span>
          </div>
        </div>

        <div className="cdi-body">
          {totalPosts === 0 ? (
            <div className="empty-state"><p>No posts for this company in the current filter.</p></div>
          ) : weeks.map(w => (
            <div className="cdi-week" key={w.key}>
              <div className="cdi-week-head">
                <span className="cdi-week-label">{w.label}</span>
                <span className="cdi-week-count">{w.posts.length} post{w.posts.length === 1 ? '' : 's'}</span>
              </div>
              <div className="cdi-posts">
                {w.posts.map((p, i) => (
                  <PostRow post={p} key={i} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PostRow({ post }) {
  const color = PLATFORM_COLOR[post.platform] || 'var(--text-muted)'
  const snippet = post.text || post.title || ''
  const headline = post.title && post.text ? post.title : ''
  return (
    <div className="cdi-post">
      <div className="cdi-post-side">
        <span className="cdi-plat-dot" style={{ background: color }} />
        <span className="cdi-plat-name">{post.platform}</span>
      </div>
      <div className="cdi-post-main">
        <div className="cdi-post-metaline">
          {post.author && <span className="cdi-author">{post.author}</span>}
          {post.source && <span className="cdi-source">{post.source}</span>}
          {!post.author && !post.source && (
            <span className="cdi-author cdi-author-muted">
              {post.external === false ? 'Own page / employee' : 'External'}
            </span>
          )}
          <span className={`cdi-weight`} title="post_weight — contribution to the weighted score">
            ⚡ {Math.round(post.weight * 100) / 100}
          </span>
        </div>
        {headline && <div className="cdi-post-title">{headline}</div>}
        <div className="cdi-post-text">
          {snippet ? (snippet.length > 240 ? snippet.slice(0, 240) + '…' : snippet) : <em>(no preview text)</em>}
        </div>
        <div className="cdi-post-foot">
          <div className="cdi-eng">
            {post.engagement.length === 0 ? (
              <span className="cdi-eng-none">{post.source || 'no engagement metrics'}</span>
            ) : post.engagement.map(e => {
              const Icon = e.icon
              return (
                <span className="cdi-eng-item" key={e.key} title={e.label}>
                  <Icon size={12} /> {fmtNum(e.value)}
                </span>
              )
            })}
          </div>
          <div className="cdi-foot-right">
            {post.sentiment != null && (
              <span className={`cdi-sent ${sentClass(post.sentiment)}`}>{fmtSent(post.sentiment)}</span>
            )}
            {post.url && (
              <a className="cdi-link" href={post.url} target="_blank" rel="noopener noreferrer" title="Open original">
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function fmtNum(v) {
  if (v == null) return '—'
  return Number(v).toLocaleString()
}
