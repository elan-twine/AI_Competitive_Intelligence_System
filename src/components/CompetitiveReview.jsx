import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ThumbsUp, MessageSquare, Repeat2, FileText, Sparkles, ChevronDown, Layers } from 'lucide-react'
import { GlassCard } from './GlassCard'
import { buildWeekly, weekRangeLabel, weekStartLabel } from '../lib/competitiveReview'
import { usePostsOfInterest } from '../hooks/usePostsOfInterest'

const PLATFORM_DOT = { X: '#1DA1F2', Reddit: '#FF4500', 'Google News': '#34D399' }

// Match a posts_of_interest.author (a company name string) to a tracked company.
function sameCompany(author, name) {
  const a = String(author || '').trim().toLowerCase()
  const n = String(name || '').trim().toLowerCase()
  if (!a || !n) return false
  return a === n || a.includes(n) || n.includes(a)
}

export function CompetitiveReview({ posts, competitors }) {
  const urnByName = useMemo(
    () => Object.fromEntries((competitors || []).map(c => [c.name, c.linkedin_urn])),
    [competitors]
  )
  const model = useMemo(() => buildWeekly(posts, urnByName), [posts, urnByName])
  const { posts: poiPosts } = usePostsOfInterest()

  // Flagged "posts of interest" grouped by week (Monday-start), newest first.
  const poiByWeek = useMemo(() => {
    const m = {}
    for (const p of poiPosts || []) {
      const wk = weekStartLabel(p.date || p.created_at)
      if (!wk) continue
      if (!m[wk]) m[wk] = []
      m[wk].push(p)
    }
    return m
  }, [poiPosts])

  // Weeks come from either competitor activity OR flagged posts.
  const weeks = useMemo(
    () => [...new Set([...(model.weeks || []), ...Object.keys(poiByWeek)])].sort().reverse(),
    [model.weeks, poiByWeek]
  )

  const [weekIdx, setWeekIdx] = useState(0)        // 0 = latest week
  const [showAll, setShowAll] = useState(false)    // other platforms toggle
  const [openCompany, setOpenCompany] = useState(null)

  const week = weeks[weekIdx]
  const data = week ? model.byWeek[week] : null

  const flaggedThisWeek = (week && poiByWeek[week]) || []
  const flaggedByCompany = useMemo(() => {
    const names = (competitors || []).map(c => c.name)
    const m = {}
    for (const p of flaggedThisWeek) {
      const name = names.find(n => sameCompany(p.author, n)) || p.author || 'Unknown'
      if (!m[name]) m[name] = []
      m[name].push(p)
    }
    return m
  }, [flaggedThisWeek, competitors])

  const companyRows = useMemo(() => {
    if (!data) return []
    return Object.entries(data.companies)
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.linkedin.count - a.linkedin.count || a.name.localeCompare(b.name))
  }, [data])

  const totals = useMemo(() => {
    return companyRows.reduce((t, c) => ({
      posts: t.posts + c.linkedin.count,
      reactions: t.reactions + c.linkedin.reactions,
      comments: t.comments + c.linkedin.comments,
      reshares: t.reshares + c.linkedin.reshares,
    }), { posts: 0, reactions: 0, comments: 0, reshares: 0 })
  }, [companyRows])

  return (
    <GlassCard className="card cr-card" intensity={3} interactive>
      <div className="card-header cr-header">
        <span className="card-title">Competitive Review</span>
        <div className="cr-weeknav">
          <button className="cr-navbtn" disabled={weekIdx >= weeks.length - 1}
            onClick={() => { setWeekIdx(i => Math.min(weeks.length - 1, i + 1)); setOpenCompany(null) }}
            aria-label="Previous week"><ChevronLeft size={16} /></button>
          <span className="cr-weeklabel">
            {week ? weekRangeLabel(week) : 'No data'}
            {weekIdx === 0 && week && <span className="cr-latest">latest</span>}
          </span>
          <button className="cr-navbtn" disabled={weekIdx <= 0}
            onClick={() => { setWeekIdx(i => Math.max(0, i - 1)); setOpenCompany(null) }}
            aria-label="Next week"><ChevronRight size={16} /></button>
        </div>
      </div>

      <p className="cr-sub">
        Posts published by each competitor (company pages + employees) this week, with LinkedIn engagement.
      </p>

      {/* Weekly insight report — flagged posts from posts_of_interest (skeleton) */}
      <div className="cr-report">
        <div className="cr-report-head">
          <Sparkles size={15} /> Weekly Insight Report
          {flaggedThisWeek.length > 0 && <span className="cr-report-count">{flaggedThisWeek.length}</span>}
        </div>
        <div className="cr-report-body">
          Flags competitor posts that signal <em>new marketing strategies, positioning shifts, campaigns, or launches</em>.
          <span className="cr-report-pending">Auto-classification criteria to be defined.</span>
        </div>
        {flaggedThisWeek.length === 0 ? (
          <div className="cr-flagged-empty">No posts flagged for this week.</div>
        ) : (
          <div className="cr-flagged">
            {Object.entries(flaggedByCompany).map(([name, items]) => (
              <div className="cr-flagged-co" key={name}>
                <div className="cr-flagged-co-name">{name}</div>
                <ul className="cr-flagged-list">
                  {items.map((p, i) => (
                    <li className="cr-flagged-item" key={p.id ?? i}>
                      <div className="cr-flagged-summary">
                        {p.summary || p.relevance_reason || 'Flagged post'}
                        {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className="cr-post-link"> open ↗</a>}
                      </div>
                      {p.summary && p.relevance_reason && <div className="cr-flagged-reason">{p.relevance_reason}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Week totals + platform toggle */}
      <div className="cr-toolbar">
        <div className="cr-totals">
          <span><strong>{totals.posts}</strong> posts</span>
          <span><ThumbsUp size={12} /> {totals.reactions.toLocaleString()}</span>
          <span><MessageSquare size={12} /> {totals.comments.toLocaleString()}</span>
          <span><Repeat2 size={12} /> {totals.reshares.toLocaleString()}</span>
          <span className="cr-totals-plat">LinkedIn</span>
        </div>
        <button className={`cr-toggle ${showAll ? 'on' : ''}`} onClick={() => setShowAll(s => !s)}>
          <Layers size={13} /> {showAll ? 'Hide other platforms' : 'Show other platforms'}
        </button>
      </div>

      {/* Per-company table */}
      {companyRows.length === 0 ? (
        <div className="empty-state"><p>No competitor-authored posts captured for this week yet.</p></div>
      ) : (
        <div className="cr-list">
          {companyRows.map(c => {
            const open = openCompany === c.name
            const otherPlats = Object.entries(c.other || {})
            return (
              <div className={`cr-company ${open ? 'open' : ''}`} key={c.name}>
                <button className="cr-company-head" onClick={() => setOpenCompany(open ? null : c.name)}>
                  <ChevronDown size={15} className="cr-caret" />
                  <span className="cr-company-name">{c.name}</span>
                  <span className="cr-metrics">
                    <span className="cr-metric"><FileText size={12} /> {c.linkedin.count}</span>
                    <span className="cr-metric"><ThumbsUp size={12} /> {c.linkedin.reactions.toLocaleString()}</span>
                    <span className="cr-metric"><MessageSquare size={12} /> {c.linkedin.comments.toLocaleString()}</span>
                    <span className="cr-metric"><Repeat2 size={12} /> {c.linkedin.reshares.toLocaleString()}</span>
                    {flaggedByCompany[c.name] && flaggedByCompany[c.name].length > 0 && (
                      <span className="cr-metric cr-metric-flag"><Sparkles size={11} /> {flaggedByCompany[c.name].length}</span>
                    )}
                  </span>
                </button>

                {showAll && otherPlats.length > 0 && (
                  <div className="cr-other">
                    {otherPlats.map(([plat, o]) => (
                      <span className="cr-other-chip" key={plat}>
                        <i style={{ background: PLATFORM_DOT[plat] || '#888' }} />
                        {plat}: {o.count} post{o.count === 1 ? '' : 's'} · {o.engagement.toLocaleString()} eng
                      </span>
                    ))}
                  </div>
                )}

                {open && (
                  <div className="cr-posts">
                    {c.linkedin.posts.length === 0 ? (
                      <div className="cr-post-empty">No LinkedIn posts this week.</div>
                    ) : c.linkedin.posts.map((p, i) => (
                      <div className="cr-post" key={p.id ?? i}>
                        <div className="cr-post-main">
                          <div className="cr-post-text">{p.text ? (p.text.length > 220 ? p.text.slice(0, 220) + '…' : p.text) : '(no text)'}</div>
                          <div className="cr-post-meta">
                            <span className="cr-post-author">{p.author}</span>
                            <span className="cr-post-eng"><ThumbsUp size={11} /> {p.reactions}</span>
                            <span className="cr-post-eng"><MessageSquare size={11} /> {p.comments}</span>
                            <span className="cr-post-eng"><Repeat2 size={11} /> {p.reshares}</span>
                            {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className="cr-post-link">open ↗</a>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="cr-footnote">
        Selection + AI analysis of these posts is coming. For now this lists competitor-authored LinkedIn posts
        and their engagement, by week — navigate weeks with the arrows above.
      </div>
    </GlassCard>
  )
}
