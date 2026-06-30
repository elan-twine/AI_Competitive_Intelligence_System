import { useEffect, useMemo, useState } from 'react'
import { X, ThumbsUp, MessageSquare, Repeat2, Eye, Quote, ArrowUp, ExternalLink, ChevronRight, Flame, Star } from 'lucide-react'
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

// --- "Why it did well": one short phrase per standout post, derived purely
//     from that post's own data. Pick the single dominant driver. The engagement
//     array is platform-normalized in normalizePost, so we read it by `key`. ---
function engVal(np, key) {
  const e = np.engagement.find(e => e.key === key)
  return e && e.value != null ? e.value : 0
}

function whyDidWell(np) {
  const reshares = engVal(np, 'reshares') // LinkedIn
  const reposts = engVal(np, 'reposts')   // X
  const quotes = engVal(np, 'quotes')     // X
  const comments = engVal(np, 'comments') + engVal(np, 'replies') // LinkedIn / X / Reddit
  const views = engVal(np, 'views')       // X
  const reactions = engVal(np, 'reactions') + engVal(np, 'likes') + engVal(np, 'upvotes')

  // Amplification (others spreading it) is the strongest organic-reach signal.
  if (reposts >= 5) return { phrase: `viral on X (${fmtNum(reposts)} reposts)`, kind: 'reach' }
  if (reshares >= 3) return { phrase: `amplified by ${fmtNum(reshares)} reshares`, kind: 'reach' }
  if (quotes >= 3) return { phrase: `${fmtNum(quotes)} quote-posts spread it`, kind: 'reach' }
  // Earned, external reach is worth flagging even at modest engagement.
  if (np.external !== false && views >= 5000) return { phrase: `high earned reach (${fmtNum(views)} views)`, kind: 'reach' }
  if (comments >= 8) return { phrase: `sparked discussion (${fmtNum(comments)} comments)`, kind: 'engage' }
  if (reactions >= 50) return { phrase: `lots of engagement (${fmtNum(reactions)} reactions)`, kind: 'engage' }
  if (views >= 5000) return { phrase: `wide reach (${fmtNum(views)} views)`, kind: 'reach' }
  // Tone / source fallbacks when raw engagement is unremarkable.
  if (np.sentiment != null && np.sentiment >= 2) return { phrase: 'strong positive sentiment', kind: 'tone' }
  if (np.external === false) return { phrase: 'company announcement that landed', kind: 'own' }
  if (reactions > 0 || comments > 0) return { phrase: `steady engagement (${fmtNum(reactions + comments)})`, kind: 'engage' }
  return { phrase: 'high weighted contribution', kind: 'weight' }
}

// --- Standouts: the company's few highest-impact posts + statistical outliers.
//     Outlier = post_weight clearly above this company's own typical level
//     (mean + 1·stddev, with a sane floor). We always surface the top posts by
//     weight; outliers among them get a flag. Returns up to `max` items. ---
function deriveStandouts(weeks, max = 5) {
  const all = []
  for (const w of weeks) for (const p of w.posts) all.push({ ...p, weekLabel: w.label })
  if (all.length < 4) {
    // Too few posts for a meaningful "typical" — show top posts only, no outlier claims.
    return {
      items: [...all].sort((a, b) => b.weight - a.weight).slice(0, Math.min(3, all.length))
        .map(p => ({ ...p, isOutlier: false })),
      hasOutliers: false,
    }
  }
  const weights = all.map(p => p.weight)
  const n = weights.length
  const mean = weights.reduce((s, v) => s + v, 0) / n
  const variance = weights.reduce((s, v) => s + (v - mean) ** 2, 0) / n
  const std = Math.sqrt(variance)
  const threshold = mean + std // ~1σ above this company's own typical post

  const ranked = [...all].sort((a, b) => b.weight - a.weight)
  const items = ranked.slice(0, max).map(p => ({
    ...p,
    isOutlier: p.weight > threshold && p.weight > mean,
  }))
  return { items, hasOutliers: items.some(i => i.isOutlier) }
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

  // Top posts & outliers (highest-impact + statistical standouts vs this
  // company's own typical post). Computed off the same normalized weeks.
  const standouts = useMemo(() => deriveStandouts(weeks), [weeks])

  // Collapsible week sections: only the most recent (first) week is open on mount;
  // every other week starts collapsed. Toggling is per-week via the header.
  const [expandedWeeks, setExpandedWeeks] = useState(() => new Set())
  useEffect(() => {
    // Re-seed when the company (and thus its weeks) changes: open just the latest.
    setExpandedWeeks(weeks.length ? new Set([weeks[0].key]) : new Set())
  }, [weeks])
  const toggleWeek = (key) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

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
          ) : (
            <>
              {standouts.items.length > 0 && (
                <div className="cdi-standouts">
                  <div className="cdi-standouts-head">
                    <span className="cdi-standouts-title">
                      {standouts.hasOutliers ? 'Top posts & outliers' : 'Top posts'}
                    </span>
                    <span className="cdi-standouts-sub">the standouts driving its score</span>
                  </div>
                  <div className="cdi-standouts-list">
                    {standouts.items.map((p, i) => (
                      <StandoutChip post={p} key={i} />
                    ))}
                  </div>
                </div>
              )}

              {weeks.map(w => {
                const open = expandedWeeks.has(w.key)
                return (
                  <div className={`cdi-week${open ? ' open' : ''}`} key={w.key}>
                    <button
                      type="button"
                      className="cdi-week-head"
                      onClick={() => toggleWeek(w.key)}
                      aria-expanded={open}
                    >
                      <ChevronRight size={14} className="cdi-week-caret" />
                      <span className="cdi-week-label">{w.label}</span>
                      <span className="cdi-week-count">{w.posts.length} post{w.posts.length === 1 ? '' : 's'}</span>
                    </button>
                    {open && (
                      <div className="cdi-posts">
                        {w.posts.map((p, i) => (
                          <PostRow post={p} key={i} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StandoutChip({ post }) {
  const color = PLATFORM_COLOR[post.platform] || 'var(--text-muted)'
  const preview = (post.title || post.text || '(no preview text)').trim()
  const short = preview.length > 90 ? preview.slice(0, 90) + '…' : preview
  const { phrase } = whyDidWell(post)
  const Body = (
    <>
      <div className="cdi-chip-top">
        <span className="cdi-plat-dot" style={{ background: color }} />
        <span className="cdi-chip-plat">{post.platform}</span>
        {post.isOutlier && (
          <span className="cdi-chip-outlier" title="Statistical outlier — well above this company's typical post">
            <Flame size={11} /> outlier
          </span>
        )}
        <span className="cdi-chip-weight" title="This post's contribution to the SOV score">
          ⚡ {Math.round(post.weight * 100) / 100}
        </span>
      </div>
      <div className="cdi-chip-text">{short}</div>
      <div className="cdi-chip-why"><Star size={11} /> {phrase}</div>
    </>
  )
  if (post.url) {
    return (
      <a className="cdi-chip" href={post.url} target="_blank" rel="noopener noreferrer" title="Open original">
        {Body}
      </a>
    )
  }
  return <div className="cdi-chip">{Body}</div>
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
          <span
            className="cdi-weight"
            title="This post's contribution to the SOV score — engagement, reach, sentiment, recency, and who posted it."
          >
            <span className="cdi-weight-val">⚡ {Math.round(post.weight * 100) / 100}</span>
            <span className="cdi-weight-label">SOV score</span>
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
