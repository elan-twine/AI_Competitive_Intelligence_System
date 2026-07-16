import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ThumbsUp, MessageSquare, Repeat2, ExternalLink, Sparkles } from 'lucide-react'
import { GlassCard } from './GlassCard'
import { usePostsOfInterest } from '../hooks/usePostsOfInterest'
import { buildPostsOfInterest, buildEngagementIndex, TYPE_COLORS } from '../lib/postsOfInterest'
import { colorForCompany } from '../lib/colors'
import { MisattributeButton } from './MisattributeButton'

// Posts of Interest — the app version of the manual bi-weekly "Competitor Social
// Analysis" review: a curated digest of notable competitor posts, grouped by
// competitor, each with what they did + why it matters + a link to open it. The
// team walks these in the meeting and decides Twine's response.

function TypeBadge({ type }) {
  const color = TYPE_COLORS[type] || TYPE_COLORS.Post
  return (
    <span
      className="poi-type"
      style={{ color, borderColor: `color-mix(in srgb, ${color} 45%, transparent)`, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      {type}
    </span>
  )
}

function fmtDate(d) {
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function PostRow({ item, onFlagged }) {
  const e = item.engagement
  const Body = (
    <>
      <div className="poi-row-head">
        <TypeBadge type={item.type} />
        <span className="poi-summary">{item.summary}</span>
        {item.collapsedCount > 1 && (
          <span className="poi-collapsed" title={`Collapses ${item.collapsedCount} similar posts into one line`}>×{item.collapsedCount}</span>
        )}
      </div>
      {item.reason && <div className="poi-reason">{item.reason}</div>}
      {item.strategicAngle && (
        <div className="poi-angle" title="AI-suggested — what this means for Twine and how we might respond">
          <Sparkles size={12} className="poi-angle-icon" />
          <span><span className="poi-angle-label">For Twine:</span> {item.strategicAngle}</span>
        </div>
      )}
      <div className="poi-row-foot">
        <span className="poi-date">{fmtDate(item.date)}</span>
        {e && (e.reactions + e.comments + e.reshares > 0) && (
          <span className="poi-eng">
            <span><ThumbsUp size={11} /> {e.reactions.toLocaleString()}</span>
            <span><MessageSquare size={11} /> {e.comments.toLocaleString()}</span>
            <span><Repeat2 size={11} /> {e.reshares.toLocaleString()}</span>
          </span>
        )}
        <MisattributeButton
          post={{ platform: item.platform, source_id: item.sourceId, url: item.url }}
          company={item.company}
          onFlagged={onFlagged}
          compact
        />
        {item.url && <span className="poi-open"><ExternalLink size={12} /> open</span>}
      </div>
    </>
  )
  if (item.url) {
    return <a className="poi-row" href={item.url} target="_blank" rel="noopener noreferrer" title="Open the original post">{Body}</a>
  }
  return <div className="poi-row">{Body}</div>
}

export function PostsOfInterest({ competitors = [], allPosts = [] }) {
  const { posts: rows, loading } = usePostsOfInterest()

  const engagementIndex = useMemo(() => buildEngagementIndex(allPosts), [allPosts])
  const model = useMemo(
    () => buildPostsOfInterest(rows, { competitors, engagementIndex }),
    [rows, competitors, engagementIndex]
  )

  // Period selector: 0..N-1 index into periods, or 'all'. Default = latest period.
  const [sel, setSel] = useState(0)
  // Items flagged misattributed this session — hidden locally (POI reads its own
  // table, so the global SOV refetch doesn't drop them here).
  const [hidden, setHidden] = useState(() => new Set())
  const isAll = sel === 'all'
  const bucket = isAll ? model.all : (model.periods[sel] || model.periods[0])
  const atNewest = !isAll && sel <= 0
  const atOldest = !isAll && sel >= model.periods.length - 1

  if (loading) {
    return (
      // `interactive` disables the mouse-tilt — without it the loading card tips/
      // scales under a mid-screen cursor on mount, then snaps flat when data
      // replaces it (the "strange animation"). Match the loaded/empty cards.
      <GlassCard className="card" intensity={3} interactive>
        <div className="empty-state"><p>Loading posts of interest…</p></div>
      </GlassCard>
    )
  }

  if (!model.hasData) {
    return (
      <GlassCard className="card" intensity={3} interactive>
        <div className="card-header"><span className="card-title"><Sparkles size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Posts of Interest</span></div>
        <div className="empty-state">
          <p>No curated competitor posts yet. The weekly run writes notable posts (with a plain-English summary and why they matter) to <code>posts_of_interest</code>.</p>
        </div>
      </GlassCard>
    )
  }

  return (
    <GlassCard className="card poi-card" intensity={3} interactive>
      <div className="card-header poi-header">
        <span className="card-title"><Sparkles size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Posts of Interest</span>
        <div className="poi-periodnav">
          <button className="poi-navbtn" disabled={isAll || atOldest}
            onClick={() => setSel(i => Math.min(model.periods.length - 1, (i === 'all' ? 0 : i) + 1))}
            aria-label="Older period"><ChevronLeft size={16} /></button>
          <span className="poi-periodlabel">
            {bucket.label}
            {!isAll && atNewest && <span className="poi-latest">latest</span>}
          </span>
          <button className="poi-navbtn" disabled={isAll || atNewest}
            onClick={() => setSel(i => Math.max(0, (i === 'all' ? 0 : i) - 1))}
            aria-label="Newer period"><ChevronRight size={16} /></button>
          <button className={`poi-alltoggle ${isAll ? 'on' : ''}`} onClick={() => setSel(isAll ? 0 : 'all')}>
            {isAll ? 'By period' : 'All time'}
          </button>
        </div>
      </div>

      <p className="cr-sub">
        The notable competitor posts worth discussing this week — what each one is, why it matters, an AI-suggested angle for Twine, and a link to open it. Grouped by competitor, newest first. Modeled on the manual competitor social review. Covers the tracked roster's LinkedIn activity we scrape — not yet earned media or untracked companies.
      </p>

      <div className="poi-metrics">
        <span><strong>{bucket.metrics.posts}</strong> {bucket.metrics.posts === 1 ? 'post' : 'posts'}</span>
        <span><strong>{bucket.metrics.companies}</strong> {bucket.metrics.companies === 1 ? 'competitor' : 'competitors'}</span>
        {bucket.metrics.engagement > 0 && <span><strong>{bucket.metrics.engagement.toLocaleString()}</strong> total engagement</span>}
      </div>

      {bucket.companies.length === 0 ? (
        <div className="empty-state"><p>No curated posts in this period.</p></div>
      ) : (
        <div className="poi-list">
          {bucket.companies.map(({ company, items }) => (
            <div className="poi-co" key={company}>
              <div className="poi-co-head">
                <span className="poi-co-dot" style={{ background: colorForCompany(company) }} />
                <span className="poi-co-name">{company}</span>
                <span className="poi-co-count">{items.length}</span>
              </div>
              <div className="poi-co-items">
                {items.filter(it => !hidden.has(it.id)).map(it => (
                  <PostRow item={it} key={it.id} onFlagged={() => setHidden(h => new Set(h).add(it.id))} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="cr-footnote">
        Curated from competitor LinkedIn activity — the same digest the team reviews each cycle to spot messaging shifts, launches, and campaigns.
      </div>
    </GlassCard>
  )
}
