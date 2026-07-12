import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, ThumbsUp, ThumbsDown, MessageSquare, Repeat2, Star } from 'lucide-react'
import { GlassCard } from './GlassCard'
import { buildWeekly, weekRangeLabel } from '../lib/competitiveReview'
import { usePostsOfInterest } from '../hooks/usePostsOfInterest'
import { useSocialBriefFeedback } from '../hooks/useSocialBriefFeedback'
import { resolvePostUrl } from '../lib/postUrl'
import { fmtPostDate } from '../lib/dates'
import { MisattributeButton } from './MisattributeButton'

// Social Briefs — the weekly competitor-social review, one row per
// competitor-AUTHORED LinkedIn post (company page + employees). Each post gets a
// 👍 / 👎 "interesting?" vote used live in the meeting. Posts the POI generator
// auto-flagged are starred, so the human vote can be compared against the
// machine pick over time (the learning loop). LinkedIn only for now — authorship
// is only reliable there, and that's the generator's universe.

// Extract a stable POI pick key set from posts_of_interest rows.
function pickSets(poiPosts) {
  const ids = new Set(), urls = new Set()
  for (const p of poiPosts || []) {
    if (p.source_id != null) ids.add(String(p.source_id))
    if (p.url) urls.add(String(p.url))
  }
  return { ids, urls }
}

export function SocialBriefs({ posts, competitors }) {
  const urnByName = useMemo(
    () => Object.fromEntries((competitors || []).map(c => [c.name, c.linkedin_urn])),
    [competitors]
  )
  // Exclude ourselves — we don't brief on Twine's own activity. Covers direct +
  // indirect competitors, self only removed.
  const selfNames = useMemo(
    () => new Set((competitors || []).filter(c => c.is_self).map(c => c.name)),
    [competitors]
  )
  const model = useMemo(() => buildWeekly(posts, urnByName), [posts, urnByName])
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

  // Convergence: of the generator's ⭐ picks you rated each week, the share you
  // 👍'd (precision). Rising over weeks = it's learning your taste. From all
  // post_feedback rows, so it spans every week you've reviewed.
  const trend = useMemo(() => {
    const wk = {}
    for (const k in byId) {
      const r = byId[k]
      if (!r || !r.generator_picked) continue
      if (r.verdict !== 'up' && r.verdict !== 'down') continue
      if (!r.week_start) continue
      wk[r.week_start] = wk[r.week_start] || { up: 0, tot: 0 }
      wk[r.week_start].tot++
      if (r.verdict === 'up') wk[r.week_start].up++
    }
    return Object.entries(wk)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, v]) => ({ week, pct: Math.round((100 * v.up) / v.tot), n: v.tot }))
  }, [byId])

  const weeks = model.weeks || []
  const [weekIdx, setWeekIdx] = useState(0)
  const [collapsed, setCollapsed] = useState({})   // company -> bool (collapsed)

  const week = weeks[weekIdx]
  const data = week ? model.byWeek[week] : null

  const isPicked = (p) => picks.ids.has(String(p.id)) || (p.url && picks.urls.has(String(p.url)))

  // Per-company rows for the week (authored posts only; skip companies with none).
  const companyRows = useMemo(() => {
    if (!data) return []
    return Object.entries(data.companies)
      .map(([name, d]) => ({ name, posts: d.linkedin.posts }))
      .filter(r => r.posts.length > 0 && !selfNames.has(r.name))
      .sort((a, b) => b.posts.length - a.posts.length || a.name.localeCompare(b.name))
  }, [data, selfNames])

  // Week-level learning comparison: generator picks vs human votes.
  const stats = useMemo(() => {
    let total = 0, rated = 0, up = 0, down = 0
    let picked = 0, pickedUp = 0, pickedDown = 0, missedUp = 0
    for (const c of companyRows) {
      for (const p of c.posts) {
        total++
        const gp = isPicked(p)
        if (gp) picked++
        const v = byId[String(p.id)]?.verdict
        if (v === 'up' || v === 'down') rated++
        if (v === 'up') { up++; gp ? pickedUp++ : missedUp++ }
        if (v === 'down') { down++; if (gp) pickedDown++ }
      }
    }
    // precision = of generator picks you rated, how many you agreed were interesting
    const precDenom = pickedUp + pickedDown
    const precision = precDenom ? Math.round((100 * pickedUp) / precDenom) : null
    return { total, rated, up, down, picked, pickedUp, pickedDown, missedUp, precision }
  }, [companyRows, byId, picks])

  const vote = (companyName, p, next) => {
    setVerdict(
      { id: p.id, company: companyName, week_start: week, url: p.url, generatorPicked: isPicked(p) },
      next
    )
  }

  return (
    <>
      <GlassCard className="card cr-card" intensity={3} interactive>
        <div className="card-header cr-header">
          <span className="card-title">Social Briefs</span>
          <div className="cr-weeknav">
            <button className="cr-navbtn" disabled={weekIdx >= weeks.length - 1}
              onClick={() => setWeekIdx(i => Math.min(weeks.length - 1, i + 1))}
              aria-label="Previous week"><ChevronLeft size={16} /></button>
            <span className="cr-weeklabel">
              {week ? weekRangeLabel(week) : 'No data'}
              {weekIdx === 0 && week && <span className="cr-latest">latest</span>}
            </span>
            <button className="cr-navbtn" disabled={weekIdx <= 0}
              onClick={() => setWeekIdx(i => Math.max(0, i - 1))}
              aria-label="Next week"><ChevronRight size={16} /></button>
          </div>
        </div>

        <p className="cr-sub">
          Every post each competitor published this week (company pages + employees, LinkedIn).
          Thumb each one 👍 / 👎 for “interesting.” <Star size={12} className="sb-star" /> = the generator flagged it —
          your votes train those picks over time.
        </p>

        {/* Learning comparison for the week */}
        <div className="sb-scoreboard">
          <div className="sb-score"><span className="sb-score-v">{stats.rated}/{stats.total}</span><span className="sb-score-l">rated</span></div>
          <div className="sb-score"><span className="sb-score-v">{stats.picked}</span><span className="sb-score-l"><Star size={11} className="sb-star" /> generator picks</span></div>
          <div className="sb-score"><span className="sb-score-v sb-up">{stats.pickedUp}/{stats.picked}</span><span className="sb-score-l">picks you 👍</span></div>
          <div className="sb-score"><span className="sb-score-v sb-warn">{stats.missedUp}</span><span className="sb-score-l">👍 the generator missed</span></div>
          <div className="sb-score"><span className="sb-score-v">{stats.precision == null ? '—' : stats.precision + '%'}</span><span className="sb-score-l">agreement on picks</span></div>
        </div>

        {/* Convergence: generator precision week over week — rising = it's learning your taste. */}
        {trend.length >= 2 && (
          <div className="sb-trend" title="Of the generator's ⭐ picks you rated each week, the share you 👍'd">
            <span className="sb-trend-label">Generator precision by week</span>
            <div className="sb-trend-bars">
              {trend.map(t => (
                <div className="sb-trend-col" key={t.week} title={`${weekRangeLabel(t.week)} · ${t.pct}% of ${t.n} rated picks 👍`}>
                  <div className="sb-trend-bar-track">
                    <div className="sb-trend-bar-fill" style={{ height: `${t.pct}%` }} />
                  </div>
                  <span className="sb-trend-pct">{t.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {companyRows.length === 0 ? (
          <div className="empty-state"><p>No competitor-authored posts captured for this week yet.</p></div>
        ) : (
          <div className="cr-list">
            {companyRows.map(c => {
              const open = !collapsed[c.name]
              const cRated = c.posts.filter(p => byId[String(p.id)]?.verdict).length
              return (
                <div className={`cr-company ${open ? 'open' : ''}`} key={c.name}>
                  <button className="cr-company-head" onClick={() => setCollapsed(m => ({ ...m, [c.name]: open }))}>
                    <ChevronDown size={15} className="cr-caret" />
                    <span className="cr-company-name">{c.name}</span>
                    <span className="cr-metrics">
                      <span className="cr-metric sb-progress">{cRated}/{c.posts.length} rated</span>
                    </span>
                  </button>

                  {open && (
                    <div className="cr-posts">
                      {c.posts.map((p, i) => {
                        const gp = isPicked(p)
                        const taste = gp ? tasteOf(p) : undefined
                        const v = byId[String(p.id)]?.verdict
                        const purl = resolvePostUrl({ platform: 'LinkedIn', activity_id: p.id, post_url: p.url }) || p.url
                        return (
                          <div className={`cr-post sb-post ${v ? 'sb-rated-' + v : ''}`} key={p.id ?? i}>
                            <div className="cr-post-main">
                              <div className="cr-post-text">
                                {gp && <Star size={13} className="sb-star sb-star-inline" aria-label="Generator pick" />}
                                {taste != null && (
                                  <span className={`sb-taste ${taste >= 0 ? 'pos' : 'neg'}`} title="RAG taste score: how strongly this pick matches your past 👍 (positive) vs 👎 (negative)">
                                    {taste >= 0 ? '+' : ''}{taste.toFixed(2)}
                                  </span>
                                )}
                                {p.text ? (p.text.length > 240 ? p.text.slice(0, 240) + '…' : p.text) : '(no text)'}
                              </div>
                              <div className="cr-post-meta">
                                <span className="cr-post-author">{p.author}</span>
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
                                className={`sb-vote-btn up ${v === 'up' ? 'on' : ''}`}
                                title="Interesting"
                                aria-pressed={v === 'up'}
                                onClick={() => vote(c.name, p, v === 'up' ? null : 'up')}
                              ><ThumbsUp size={16} /></button>
                              <button
                                className={`sb-vote-btn down ${v === 'down' ? 'on' : ''}`}
                                title="Not interesting"
                                aria-pressed={v === 'down'}
                                onClick={() => vote(c.name, p, v === 'down' ? null : 'down')}
                              ><ThumbsDown size={16} /></button>
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
          Competitor-authored LinkedIn posts by week. Your 👍/👎 are saved and compared against the generator’s
          <Star size={11} className="sb-star" /> picks to improve what it flags.
        </div>
      </GlassCard>
    </>
  )
}
