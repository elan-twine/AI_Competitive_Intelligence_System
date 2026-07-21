import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, ThumbsUp, MessageSquare, Repeat2, Star } from 'lucide-react'
import { GlassCard } from './GlassCard'
import { buildPeriods, periodRangeLabel } from '../lib/competitiveReview'
import { usePostsOfInterest } from '../hooks/usePostsOfInterest'
import { useSocialBriefFeedback } from '../hooks/useSocialBriefFeedback'
import { resolvePostUrl } from '../lib/postUrl'
import { fmtPostDate } from '../lib/dates'
import { MisattributeButton } from './MisattributeButton'

// Social Briefs — the bi-weekly competitor-social review. One row per LinkedIn
// post attributed to a competitor (company page, employees, AND external
// voices — badged per post), ranked by engagement within each company. Star a
// post to mark it "interesting"; stars are saved to post_feedback (as an 'up'
// verdict) so the POI generator's learning loop keeps getting signal. Posts the
// generator auto-flagged carry its ⭐ badge, so human stars can be compared
// against the machine's picks over time.

// Extract a stable POI pick key set from posts_of_interest rows.
function pickSets(poiPosts) {
  const ids = new Set(), urls = new Set()
  for (const p of poiPosts || []) {
    if (p.source_id != null) ids.add(String(p.source_id))
    if (p.url) urls.add(String(p.url))
  }
  return { ids, urls }
}

// Compact affiliation badge: who's talking — the competitor's own page, a
// confirmed employee, or an outside voice.
const AFF_LABELS = { company: 'company', employee: 'employee', external: 'external' }
function AffBadge({ type }) {
  const t = AFF_LABELS[type] ? type : 'external'
  return <span className={`sb-aff sb-aff-${t}`} title={
    t === 'company' ? "Posted by the competitor's own company page"
      : t === 'employee' ? 'Posted by a confirmed employee of the competitor'
        : 'Posted by an outside voice (earned mention)'
  }>{AFF_LABELS[t]}</span>
}

export function SocialBriefs({ posts, competitors }) {
  // Exclude ourselves — we don't brief on Twine's own activity.
  const selfNames = useMemo(
    () => new Set((competitors || []).filter(c => c.is_self).map(c => c.name)),
    [competitors]
  )
  const model = useMemo(() => buildPeriods(posts), [posts])
  const { posts: poiPosts } = usePostsOfInterest()
  const picks = useMemo(() => pickSets(poiPosts), [poiPosts])
  const { byId, setVerdict } = useSocialBriefFeedback()

  // RAG taste_score per generator pick (written by the learning generator; null
  // until it has run with the column live). Keyed by source_id and by url.
  const tasteBySid = useMemo(() => {
    const m = {}
    for (const p of poiPosts || []) {
      if (p.taste_score == null) continue
      if (p.source_id != null) m[String(p.source_id)] = p.taste_score
      if (p.url) m[String(p.url)] = p.taste_score
    }
    return m
  }, [poiPosts])
  const tasteOf = (p) => tasteBySid[String(p.id)] ?? (p.url ? tasteBySid[String(p.url)] : undefined)

  const periods = model.periods || []
  const [periodIdx, setPeriodIdx] = useState(0)
  const [collapsed, setCollapsed] = useState({})   // company -> bool (collapsed)

  const period = periods[periodIdx]
  const data = period ? model.byPeriod[period] : null

  const isPicked = (p) => picks.ids.has(String(p.id)) || (p.url && picks.urls.has(String(p.url)))
  const isStarred = (p) => byId[String(p.id)]?.verdict === 'up'

  // Per-company rows for the period (skip companies with no LinkedIn posts).
  const companyRows = useMemo(() => {
    if (!data) return []
    return Object.entries(data.companies)
      .map(([name, d]) => ({ name, posts: d.linkedin.posts }))
      .filter(r => r.posts.length > 0 && !selfNames.has(r.name))
      .sort((a, b) => b.posts.length - a.posts.length || a.name.localeCompare(b.name))
  }, [data, selfNames])

  // Period-level comparison: your stars vs the generator's picks.
  const stats = useMemo(() => {
    let total = 0, starred = 0
    let picked = 0, pickedStarred = 0, missedStarred = 0
    for (const c of companyRows) {
      for (const p of c.posts) {
        total++
        const gp = isPicked(p)
        if (gp) picked++
        if (isStarred(p)) { starred++; gp ? pickedStarred++ : missedStarred++ }
      }
    }
    return { total, starred, picked, pickedStarred, missedStarred }
  }, [companyRows, byId, picks])

  // Toggle the "interesting" star. Written to post_feedback as verdict 'up'
  // (cleared with null) — the same signal the POI learning loop trains on.
  const toggleStar = (companyName, p) => {
    setVerdict(
      { id: p.id, company: companyName, week_start: period, url: p.url, generatorPicked: isPicked(p) },
      isStarred(p) ? null : 'up'
    )
  }

  return (
    <>
      <GlassCard className="card cr-card" intensity={3} interactive>
        <div className="card-header cr-header">
          <span className="card-title">Social Briefs</span>
          <div className="cr-weeknav">
            <button className="cr-navbtn" disabled={periodIdx >= periods.length - 1}
              onClick={() => setPeriodIdx(i => Math.min(periods.length - 1, i + 1))}
              aria-label="Previous period"><ChevronLeft size={16} /></button>
            <span className="cr-weeklabel">
              {period ? periodRangeLabel(period) : 'No data'}
              {periodIdx === 0 && period && <span className="cr-latest">current</span>}
            </span>
            <button className="cr-navbtn" disabled={periodIdx <= 0}
              onClick={() => setPeriodIdx(i => Math.max(0, i - 1))}
              aria-label="Next period"><ChevronRight size={16} /></button>
          </div>
        </div>

        <p className="cr-sub">
          Every LinkedIn post attributed to each competitor over this two-week period — company page,
          employees, and outside voices (see the badge) — loudest first. Tap the star to mark a post
          interesting; <Star size={12} className="sb-star" /> = the generator flagged it. Your stars
          train those picks over time.
        </p>

        {/* Stars vs the generator's picks, this period */}
        <div className="sb-scoreboard">
          <div className="sb-score"><span className="sb-score-v">{stats.starred}/{stats.total}</span><span className="sb-score-l">starred</span></div>
          <div className="sb-score"><span className="sb-score-v">{stats.picked}</span><span className="sb-score-l"><Star size={11} className="sb-star" /> generator picks</span></div>
          <div className="sb-score"><span className="sb-score-v sb-up">{stats.pickedStarred}/{stats.picked}</span><span className="sb-score-l">picks you starred</span></div>
          <div className="sb-score"><span className="sb-score-v sb-warn">{stats.missedStarred}</span><span className="sb-score-l">stars the generator missed</span></div>
        </div>

        {companyRows.length === 0 ? (
          <div className="empty-state"><p>No competitor posts captured for this period yet.</p></div>
        ) : (
          <div className="cr-list">
            {companyRows.map(c => {
              const open = !collapsed[c.name]
              const cStarred = c.posts.filter(p => isStarred(p)).length
              return (
                <div className={`cr-company ${open ? 'open' : ''}`} key={c.name}>
                  <button className="cr-company-head" onClick={() => setCollapsed(m => ({ ...m, [c.name]: open }))}>
                    <ChevronDown size={15} className="cr-caret" />
                    <span className="cr-company-name">{c.name}</span>
                    <span className="cr-metrics">
                      <span className="cr-metric sb-progress">{c.posts.length} posts{cStarred ? ` · ${cStarred} ⭐` : ''}</span>
                    </span>
                  </button>

                  {open && (
                    <div className="cr-posts">
                      {c.posts.map((p, i) => {
                        const gp = isPicked(p)
                        const taste = gp ? tasteOf(p) : undefined
                        const starred = isStarred(p)
                        const purl = resolvePostUrl({ platform: 'LinkedIn', activity_id: p.id, post_url: p.url }) || p.url
                        return (
                          <div className={`cr-post sb-post ${starred ? 'sb-rated-up' : ''}`} key={p.id ?? i}>
                            <div className="cr-post-main">
                              <div className="cr-post-text">
                                {gp && <Star size={13} className="sb-star sb-star-inline" aria-label="Generator pick" />}
                                {taste != null && (
                                  <span className={`sb-taste ${taste >= 0 ? 'pos' : 'neg'}`} title="RAG taste score: how strongly this pick matches your past stars">
                                    {taste >= 0 ? '+' : ''}{taste.toFixed(2)}
                                  </span>
                                )}
                                {p.text ? (p.text.length > 240 ? p.text.slice(0, 240) + '…' : p.text) : '(no text)'}
                              </div>
                              <div className="cr-post-meta">
                                <span className="cr-post-author">{p.author}</span>
                                <AffBadge type={p.authorType} />
                                {p.ts && <span className="cr-post-date" title={new Date(p.ts).toLocaleString()}>{fmtPostDate(p.ts)}</span>}
                                <span className="cr-post-eng"><ThumbsUp size={11} /> {p.reactions}</span>
                                <span className="cr-post-eng"><MessageSquare size={11} /> {p.comments}</span>
                                <span className="cr-post-eng"><Repeat2 size={11} /> {p.reshares}</span>
                                {purl && <a href={purl} target="_blank" rel="noopener noreferrer" className="cr-post-link">open ↗</a>}
                                <MisattributeButton post={{ ...p, platform: 'LinkedIn' }} company={c.name} compact />
                              </div>
                            </div>
                            <div className="sb-vote">
                              <button
                                className={`sb-vote-btn sb-star-btn ${starred ? 'on' : ''}`}
                                title={starred ? 'Unstar' : 'Mark interesting'}
                                aria-pressed={starred}
                                onClick={() => toggleStar(c.name, p)}
                              ><Star size={16} /></button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="cr-footnote">
          Competitor LinkedIn posts in two-week review periods, ranked by engagement. Your ⭐ stars are
          saved and compared against the generator's <Star size={11} className="sb-star" /> picks to
          improve what it flags.
        </div>
      </GlassCard>
    </>
  )
}
