import { useState, useEffect, useMemo } from 'react'
import { Filter, Info, Download, RefreshCw } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useSOVData } from '../hooks/useSOVData'
import { useSOVConfig } from '../hooks/useSOVConfig'
import { useBoardAgg } from '../hooks/useBoardAgg'
import { useWeeklySOV } from '../hooks/useWeeklySOV'
import { useLastUpdated } from '../hooks/useLastUpdated'
import { useLinkedInEngagement } from '../hooks/useLinkedInEngagement'
import { useLinkedInRosterConfig } from '../hooks/useLinkedInRosterConfig'
import { LinkedInRosterSettings } from '../components/LinkedInRosterSettings'
import { usePersistedState } from '../hooks/usePersistedState'
import { AppHeader } from '../components/AppHeader'
import { GlassCard } from '../components/GlassCard'
import { HealthStrip } from '../components/HealthStrip'
import { AnnotationBar } from '../components/AnnotationBar'
import { useAnnotations } from '../hooks/useAnnotations'
import { SOVTrendChart } from '../components/SOVTrendChart'
import { SocialBriefs } from '../components/SocialBriefs'
import { CompanyDrillIn } from '../components/CompanyDrillIn'
import { TopPostsWeek } from '../components/TopPostsWeek'
import { PostsOfInterest } from '../components/PostsOfInterest'
import { AIVisibility } from '../components/AIVisibility'
import { AssistantChat } from '../components/AssistantChat'
import { clearCache } from '../lib/cache'
import { downloadCSV } from '../lib/csv'
import { fmtDateRange } from '../lib/dates'
import { applyFilters, rankings, platformSplit, compare, isoWeekStart } from '../lib/metrics'
import { PLATFORM_COLORS, registerCompanyColors, isTwine } from '../lib/colors'
import Briefings from './Briefings'
import '../App.css'

const PLATFORMS = ['All', 'X', 'Reddit', 'Google News', 'LinkedIn']
// YTD = days elapsed since Jan 1 of the current year (computed once at load).
const YTD_DAYS = Math.max(1, Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000))
// The ONE global time window. Its meaning is universal across the whole
// dashboard: every ranking, stat, and trend is "share of voice over this
// window". The hint text is surfaced on hover so it's always clear what the
// selected timescale means.
const TIME_RANGES = [
  { label: '7d', value: 7, hint: 'Everything below — rankings, stats, charts — covers the last 7 days. Trend charts show one point per day.' },
  { label: '30d', value: 30, hint: 'Everything below — rankings, stats, charts — covers the last 30 days. Trend charts show one point per day.' },
  { label: 'YTD', value: YTD_DAYS, hint: 'Everything below covers Jan 1 → today. Trend charts show one point per week.' },
]
// Map the selected window to the trend-chart resolution + a human label.
function windowMeta(days) {
  if (days === 7) return { windowDays: 7, label: 'last 7 days' }
  if (days === 30) return { windowDays: 30, label: 'last 30 days' }
  return { windowDays: null, label: 'year-to-date' }
}

// Calendar date range covered by the current window, ending today:
// "Jul 5 – 11" (same month) or "Jul 28 – Aug 3". Prefixed "Week of " on the
// 7-day view (where the ranking IS a week); plain range on 30d/YTD.
function windowRangeLabel(days) {
  const end = new Date()
  const start = new Date(); start.setDate(start.getDate() - (days - 1))
  const range = fmtDateRange(start, end)
  return days === 7 ? `Week of ${range}` : range
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="chart-tooltip">
      <div style={{ fontWeight: 600, marginBottom: 2, color: 'var(--text-primary)' }}>{d.name}</div>
      <div className="chart-tooltip-value" style={{ color: 'var(--text-secondary)' }}>SOV: {d.sov.toFixed(2)}</div>
    </div>
  )
}

function fmtSent(s) {
  const n = Number(s || 0)
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}`
}

// Last two rows of a weekly series → per-company week-over-week delta (pts).
// The Snapshot workflow re-derives the current week's row daily, so
// "last − previous" reads as "this week's standing vs last completed week".
function wowFromSeries(series) {
  if (!series || series.length < 2) return null
  const last = series[series.length - 1], prev = series[series.length - 2]
  const out = {}
  for (const k of Object.keys(last)) {
    if (k === 'week' || k === 't') continue
    if (last[k] != null && prev[k] != null) out[k] = last[k] - prev[k]
  }
  return out
}
// ±x.x with a true minus sign; '—' when there's no prior week to compare.
// Deltas that round to zero display as an unsigned "0.0" (no "−0.0").
const fmtWow = (d) => {
  if (d == null) return '—'
  if (Math.abs(d) < 0.05) return '0.0'
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`
}
// Tone for a delta — sub-±0.05 pt noise stays neutral instead of flashing color.
const wowTone = (d) => d == null ? 'fl' : d > 0.05 ? 'up' : d < -0.05 ? 'dn' : 'fl'
// Rail tone for a KPI card's week-over-week change: green improved / red
// declined / amber roughly unchanged (per-metric epsilon); null hides the rail.
const railTone = (d, eps) => d == null ? null : d > eps ? 'up' : d < -eps ? 'dn' : 'fl'
// A company's rank within one weekly-series row (values sorted high→low).
function rankInRow(row, name) {
  const vals = Object.entries(row)
    .filter(([k, v]) => k !== 'week' && k !== 't' && v != null)
    .sort((a, b) => b[1] - a[1])
  const i = vals.findIndex(([k]) => k === name)
  return i < 0 ? null : i + 1
}

function Dashboard({ onLogout, onNavigate }) {
  const { allPosts, companies, competitors, loading, error, refetch } = useSOVData()
  const [refreshing, setRefreshing] = useState(false)
  // Force the freshest data. The dashboard caches datasets in localStorage/
  // IndexedDB for 6h, and a browser hard-refresh does NOT clear those — so a
  // just-processed post won't appear until the cache goes stale. This wipes the
  // app cache and reloads, so every hook refetches from the network.
  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try { await clearCache() } catch { /* ignore — reload refetches anyway */ }
    window.location.reload()
  }
  const { config: sovConfig } = useSOVConfig()
  const lastUpdated = useLastUpdated()
  const linkedInEng = useLinkedInEngagement()  // OKR KR-21 weekly engagement %, Thu-anchored weeks
  // Twine company-page posts in the CURRENT Thu-week (mirrors the pipeline's
  // author->>name filter) — lets the card show a PROVABLE live 0% before the
  // Thursday measurement runs: zero posts means zero staff engagement.
  const twineCompanyPostsThisWeek = useMemo(() => {
    const wkStart = isoWeekStart(new Date()).getTime()
    let n = 0
    for (const p of allPosts) {
      if (p.platform !== 'LinkedIn') continue
      if (!p.author || p.author.name !== 'Twine Security') continue
      const t = p.ts ? new Date(p.ts).getTime() : NaN
      if (!isNaN(t) && t >= wkStart) n++
    }
    return n
  }, [allPosts])
  const rosterCfg = useLinkedInRosterConfig()  // editable headcount + roster for KR-21
  const [rosterOpen, setRosterOpen] = useState(false)
  const { annotations, userId: annotationUserId, add: addAnnotation, update: updateAnnotation, remove: removeAnnotation } = useAnnotations()

  // Give every tracked company its own unique chart color (sorted-roster slot
  // assignment — see colors.js). Must run before children render their lines.
  useMemo(() => registerCompanyColors((competitors || []).map(c => c.name)), [competitors])

  // Top-level view: SOV dashboard · Social Briefs · Comp Briefs (siblings, not
  // nested). Persisted so a reload keeps you on the same page.
  const [view, setView] = usePersistedState('twinesov:nav:view', 'sov')

  // SOV-internal tabs (persisted too).
  const [tab, setTab] = usePersistedState('twinesov:nav:tab', 'overview')

  // Global filters (platform + time only — sentiment is local to feed now).
  // Platform is MULTI-select: an array of selected platform names. Empty = no
  // platform filter (the "All" chip clears the selection). Time stays single-select.
  const [selectedPlatforms, setSelectedPlatforms] = usePersistedState('twinesov:nav:platforms', [])
  const [days, setDays] = usePersistedState('twinesov:nav:days', YTD_DAYS)

  // Toggle a platform in/out of the selection. Clicking "All" clears everything.
  const togglePlatform = (p) => {
    if (p === 'All') { setSelectedPlatforms([]); return }
    setSelectedPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    )
  }

  // Overview — default sort matches the ranking's own order (SOV %), so the
  // active-sort arrow is visible on the corresponding column from first load.
  const [sortKey, setSortKey] = useState('weightedPct')
  // Per-company drill-in (window into WHY a company's SOV is what it is)
  const [drilledCompany, setDrilledCompany] = useState(null)

  // Compare
  const [compareA, setCompareA] = useState('')
  const [compareB, setCompareB] = useState('')

  // Filtered working set (respects global platform + time only)
  const filtered = useMemo(
    () => applyFilters(allPosts, { platforms: selectedPlatforms, days }),
    [allPosts, selectedPlatforms, days]
  )

  // Competitive view = DIRECT competitors only. Indirect competitors are still
  // tracked, scored, and analyzed (Competitive Review + trend graph), but they
  // never enter the SOV ranking/share. Missing `type` defaults to 'direct'.
  const directNames = useMemo(
    () => new Set((competitors || []).filter(c => (c.type || 'direct') !== 'indirect').map(c => c.name)),
    [competitors]
  )
  const directPosts = useMemo(
    () => filtered.filter(p => directNames.has(p.companyName)),
    [filtered, directNames]
  )
  // Trend charts need the FULL post history (a time series), filtered by PLATFORM
  // but NOT by the time window — the window sets what each point *means* (7-/30-day
  // rolling), not the chart's span. Passing the window-limited directPosts made a
  // platform-filtered "7d" chart collapse to ~one week of data.
  const chartPosts = useMemo(
    () => applyFilters(allPosts, { platforms: selectedPlatforms }).filter(p => directNames.has(p.companyName)),
    [allPosts, selectedPlatforms, directNames]
  )
  const ranked = useMemo(() => rankings(directPosts, sovConfig), [directPosts, sovConfig])
  // RPC-backed board (sov_board_agg): ~60 tiny rows computed in Postgres, so
  // the ranking + stat cards no longer depend on the raw-post firehose — the
  // payload is constant in post volume (the guard against the #139 timeout
  // class). Sentiment stays posts-derived (external-only semantics live in
  // JS), overlaid below; if the RPC fails we fall back to the posts board.
  const agg = useBoardAgg(days, {
    platforms: selectedPlatforms,
    competitors,
    multipliers: sovConfig?.platformMultipliers,
  })
  const postsRowByCompany = useMemo(
    () => Object.fromEntries((ranked || []).map(r => [r.company, r])),
    [ranked]
  )
  // The board the table + stat cards render: RPC numbers (verified to match
  // the client math exactly — sov-tooling/parity_board.mjs), posts-derived
  // sentiment merged in when the firehose has loaded (else shown as "—").
  const boardRanked = useMemo(() => {
    if (!agg.board) return ranked
    return agg.board.direct.map(r => {
      const p = postsRowByCompany[r.company]
      return { ...r, avgSentiment: p ? p.avgSentiment : 0, sentimentCount: p ? p.sentimentCount : 0 }
    })
  }, [agg.board, ranked, postsRowByCompany])
  // Current live standing (same numbers as the ranking table) → fed to the trend
  // chart as its "Now" tip so the graph ends where the table says.
  const nowValues = useMemo(
    () => Object.fromEntries((boardRanked || []).map(r => [r.company, r.weightedPct])),
    [boardRanked]
  )
  // Same idea for the sentiment chart: its "Now" tip = the stat card's number
  // (avg external sentiment over the selected window, already on −3..+3), so the
  // chart ends exactly where the card says instead of at the last weekly bucket.
  const sentimentNow = useMemo(
    () => Object.fromEntries((ranked || []).filter(r => r.sentimentCount).map(r => [r.company, r.avgSentiment])),
    [ranked]
  )
  // When the platform filter is narrowed, the weekly trend charts switch from the
  // frozen (cross-platform) board to a live series computed off the filtered posts,
  // so they reflect the selected platform(s). "All" = frozen board, full history.
  const platformFiltered = selectedPlatforms.length > 0
  const platformScopeLabel = platformFiltered ? selectedPlatforms.join(' + ') : null
  // The single global window drives the trend charts' resolution + labels too.
  const { windowDays, label: windowLabel } = windowMeta(days)
  // --- Week-over-week + weekly-volume enrichment (the mock's Δwk / weekly-items fields) ---
  // WoW deltas come from the frozen weekly snapshots (sov_weekly) — cross-platform
  // by nature (the frozen board can't be sliced by platform). Two metrics because
  // the KPI card displays `overall` while the ranking column displays `weightedPct`;
  // each delta must match the number it sits next to. Same cached fetch under both.
  const { series: weeklyOverallSeries } = useWeeklySOV('overall')
  const { series: weeklyWeightedSeries } = useWeeklySOV('weighted_pct')
  const wowOverall = useMemo(() => wowFromSeries(weeklyOverallSeries), [weeklyOverallSeries])
  const wowWeighted = useMemo(() => wowFromSeries(weeklyWeightedSeries), [weeklyWeightedSeries])
  const twineWow = useMemo(() => {
    if (!wowOverall) return null
    const k = Object.keys(wowOverall).find(n => isTwine(n))
    return k != null ? wowOverall[k] : null
  }, [wowOverall])
  // Twine's sentiment change vs last week (stored 0..100 index — only the sign
  // and rough magnitude matter here, they drive the rail color).
  const { series: weeklySentSeries } = useWeeklySOV('sentiment_pct')
  const twineSentWow = useMemo(() => {
    const w = wowFromSeries(weeklySentSeries)
    if (!w) return null
    const k = Object.keys(w).find(n => isTwine(n))
    return k != null ? w[k] : null
  }, [weeklySentSeries])
  // Twine's rank change vs last week (+ = climbed places, − = dropped).
  const twineRankWow = useMemo(() => {
    const s = weeklyOverallSeries
    if (!s || s.length < 2) return null
    const tw = Object.keys(s[s.length - 1]).find(n => isTwine(n))
    if (!tw) return null
    const cur = rankInRow(s[s.length - 1], tw), prev = rankInRow(s[s.length - 2], tw)
    return cur != null && prev != null ? prev - cur : null
  }, [weeklyOverallSeries])
  // Items per company in the CURRENT Thursday-anchored OKR week (the SOV
  // default week — was a rolling last-7-days). Independent of the global time
  // window; respects the platform filter like the rest of the table.
  const weekItemsByCompany = useMemo(() => {
    const wkStart = isoWeekStart(new Date()).getTime()
    const m = {}
    for (const p of applyFilters(allPosts, { platforms: selectedPlatforms })) {
      if (!p.companyName) continue
      const t = p.ts ? new Date(p.ts).getTime() : NaN
      if (!isNaN(t) && t >= wkStart) m[p.companyName] = (m[p.companyName] || 0) + 1
    }
    return m
  }, [allPosts, selectedPlatforms])
  // OKR gauge: Twine mentions across ALL platforms in the CURRENT OKR week —
  // the same Thursday-anchored calendar week the drill-in and weekly pipeline
  // use (was a rolling last-7-days, which read "2" while the drill-in's
  // current week was empty). `prev` = last COMPLETED week's total, so the
  // chip/rail show the gap to beat. Platform-unfiltered by definition.
  const twineMentions = useMemo(() => {
    const wkStart = isoWeekStart(new Date()).getTime()
    const prevStart = wkStart - 7 * 86400000
    let cur = 0, prev = 0
    for (const p of allPosts) {
      if (!isTwine(p.companyName)) continue
      const t = p.ts ? new Date(p.ts).getTime() : NaN
      if (isNaN(t)) continue
      if (t >= wkStart) cur++
      else if (t >= prevStart) prev++
    }
    const wkLabel = new Date(wkStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return { cur, prev, wkLabel }
  }, [allPosts])
  const enrichedRanked = useMemo(() => boardRanked.map(r => ({
    ...r,
    wowDelta: wowWeighted ? (wowWeighted[r.company] ?? null) : null,
    weekItems: weekItemsByCompany[r.company] || 0,
  })), [boardRanked, wowWeighted, weekItemsByCompany])
  // SOV rank per company — fixed by board order (SOV desc), so the # column
  // keeps showing each company's true rank even when the table is re-sorted.
  const rankByCompany = useMemo(
    () => Object.fromEntries(boardRanked.map((r, i) => [r.company, i + 1])),
    [boardRanked]
  )
  const sortedRanked = useMemo(() => {
    const arr = [...enrichedRanked]
    arr.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey]
      if (typeof va === 'string') return va.localeCompare(vb)
      return (vb || 0) - (va || 0)
    })
    return arr
  }, [enrichedRanked, sortKey])

  // Seed compare pickers once companies arrive
  useEffect(() => {
    if (companies.length && !compareA) setCompareA(companies[0])
    if (companies.length > 1 && !compareB) setCompareB(companies[1])
  }, [companies, compareA, compareB])

  // Hold the spinner until BOTH the posts and the RPC board have settled:
  // painting the posts-computed fallback while the RPC is still in flight
  // flashed slightly different numbers (the fallback counts multi-company
  // posts once and can't exclude misattributed ones), then "corrected" itself
  // half a second later. With the RPC rows now cached this gate only bites on
  // a truly cold first visit; if the RPC errors, agg.loading settles false and
  // the fallback renders as before.
  if (loading || (agg.loading && !agg.board)) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading SOV data...</p>
      </div>
    )
  }
  // The full-page error is now a last resort: if the raw-post fetch failed but
  // the RPC board loaded, the ranking + stat cards still render (charts and the
  // feed degrade) with an inline warning instead of a blank page.
  if (error && !agg.board) {
    return (
      <div className="loading-screen">
        <p>Error: {error}</p>
        <button className="refresh-btn" onClick={refetch}>Retry</button>
      </div>
    )
  }
  const degraded = error && agg.board
    ? 'Post details failed to load (' + error + ') — standings are live, but charts, sentiment, and the feed may be incomplete.'
    : null

  const twineIdx = boardRanked.findIndex(r => isTwine(r.company))
  const twineRow = twineIdx >= 0 ? boardRanked[twineIdx] : null
  const twineRank = twineIdx >= 0 ? twineIdx + 1 : null
  // Top SOV in the current board — scales the leaderboard share-bars.
  const boardMax = boardRanked.length ? Math.max(...boardRanked.map(r => r.weightedPct || 0), 1) : 1
  // Points Twine trails the #3 slot by (the OKR target) — null when already top-3.
  const gapToTop3 = (twineRank && twineRank > 3 && boardRanked.length >= 3 && twineRow)
    ? (boardRanked[2].weightedPct - twineRow.weightedPct) : null

  // LinkedIn Engagement card state, on the SOV default week (Thu 00:00 → Wed
  // 23:59 — every SOV metric uses this week unless explicitly specified
  // otherwise):
  //   measured — the pipeline measured the current week (Thursday noon on)
  //   na       — no company posts this week (live, or a measured null-pct row):
  //              N/A, not 0 — the week doesn't count toward averages or WoW
  //   pending  — company posts exist this week; the Thursday run hasn't measured them
  //   empty    — no engagement data at all
  const engPrev = linkedInEng.prev
  const engView = (linkedInEng.current && linkedInEng.current.pct != null)
    ? { pct: Number(linkedInEng.current.pct), wow: linkedInEng.wow, kind: 'measured' }
    : (linkedInEng.current || (!error && allPosts.length > 0 && twineCompanyPostsThisWeek === 0))
      ? { pct: null, wow: null, kind: 'na' }
      : engPrev
        ? { pct: null, wow: null, kind: 'pending' }
        : { pct: null, wow: null, kind: 'empty' }

  const cmp = compareA && compareB ? compare(filtered, compareA, compareB, sovConfig) : null

  return (
    <div className="app">
      <AppHeader
        page={view === 'sov' ? 'SOV' : view === 'social' ? 'Social Briefs' : 'Comp Briefs'}
        onNavigate={onNavigate}
        onLogout={onLogout}
        view={view}
        onViewChange={setView}
      />

      {view === 'social' && <SocialBriefs posts={allPosts} competitors={competitors} />}

      {view === 'briefings' && <Briefings />}

      {view === 'sov' && (
      <>
      {degraded && (
        <div className="auth-error" style={{ margin: '0 0 14px' }}>
          {degraded} <button className="refresh-btn" style={{ marginLeft: 8 }} onClick={refetch}>Retry</button>
        </div>
      )}
      {/* SOV-internal tabs */}
      <div className="tab-nav">
        <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        <button className={`tab ${tab === 'posts' ? 'active' : ''}`} onClick={() => setTab('posts')}>Posts of Interest</button>
        <button className={`tab ${tab === 'ai' ? 'active' : ''}`} onClick={() => setTab('ai')}>AI Visibility</button>
        <button className={`tab ${tab === 'compare' ? 'active' : ''}`} onClick={() => setTab('compare')}>Compare</button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}><HealthStrip /></div>
      </div>

      {/* Posts of Interest has its own period control, so the global platform/time
          filter bar is hidden there (it doesn't apply to the curated digest). */}
      {tab === 'posts' && (
        <PostsOfInterest competitors={competitors} allPosts={allPosts} />
      )}

      {/* AI Visibility (share of model) runs on its own weekly cadence across
          AI engines — the global platform/time filters don't apply to it. */}
      {tab === 'ai' && (
        <AIVisibility />
      )}

      {/* Global filter bar (platform + time only) */}
      {tab !== 'posts' && tab !== 'ai' && (
      <GlassCard className="card filter-bar" intensity={3} interactive>
        <div className="filter-icon"><Filter size={14} /></div>
        <div className="filter-group">
          <span className="filter-label">Platform</span>
          <div className="chip-row">
            {PLATFORMS.map(p => {
              const active = p === 'All'
                ? selectedPlatforms.length === 0
                : selectedPlatforms.includes(p)
              return (
                <button
                  key={p}
                  className={`chip ${active ? 'active' : ''}`}
                  onClick={() => togglePlatform(p)}
                >{p}</button>
              )
            })}
          </div>
        </div>
        <div className="filter-group">
          <span
            className="filter-label"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'help' }}
            title="One time window for the whole dashboard — it sets the timescale of every ranking, stat, and trend below. Hover a window to see exactly what it means."
          >
            Time window <Info size={12} style={{ opacity: 0.6 }} />
          </span>
          <div className="chip-row">
            {TIME_RANGES.map(t => (
              <button
                key={t.value}
                className={`chip ${days === t.value ? 'active' : ''}`}
                onClick={() => setDays(t.value)}
                title={t.hint}
              >{t.label}</button>
            ))}
          </div>
        </div>
        <div className="filter-group" style={{ marginLeft: 'auto', gap: 10 }}>
          {lastUpdated.ready && lastUpdated.latest && (
            <>
              <span className="filter-label">Updated</span>
              <span
                style={{ fontSize: 12, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}
                title={lastUpdated.source === 'scrape_runs'
                  ? lastUpdated.platforms.map(p => `${p.platform}: ${p.ago}`).join('  ·  ')
                  : `Board last computed ${lastUpdated.latest.toISOString().slice(0, 10)}`}
              >
                {/* Just the freshness — the platform that ran last (always Google News)
                    is redundant here; the per-platform breakdown stays in the tooltip. */}
                {lastUpdated.source === 'scrape_runs' && lastUpdated.platforms[0]
                  ? lastUpdated.platforms[0].ago
                  : lastUpdated.latest.toISOString().slice(0, 10)}
              </span>
            </>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh data — clears the local cache and reloads so newly processed posts show immediately"
            aria-label="Refresh data"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12,
              color: 'var(--text-secondary)', background: 'transparent',
              border: '1px solid var(--border)', borderRadius: 8, padding: '4px 9px',
              cursor: refreshing ? 'default' : 'pointer', opacity: refreshing ? 0.6 : 1,
            }}
          >
            <RefreshCw size={13} style={refreshing ? { animation: 'spin 0.8s linear infinite' } : undefined} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </GlassCard>
      )}

      {tab === 'overview' && (
        <>
          {/* Stats grid — Twine-focused */}
          <div className="stats-grid">
            {[
              {
                label: 'Twine Rank',
                value: twineRank ? `#${twineRank}` : '—',
                unit: twineRank && boardRanked.length ? `/ ${boardRanked.length}` : '',
                // OKR: top-3 on SOV. Chip flags on/off target; sub shows the gap.
                chip: twineRank ? (twineRank <= 3 ? { text: '✓ in top 3', tone: 'up' } : { text: '⚠ target top 3', tone: 'warn' }) : null,
                rail: railTone(twineRankWow, 0),
                // The gap is real SOV math (#3's share − Twine's share), so show
                // the underlying number subtly alongside it.
                sub: gapToTop3 != null
                  ? `${gapToTop3.toFixed(1)} pts to #3 (#3: ${boardRanked[2].weightedPct.toFixed(1)}%)`
                  : (boardRanked.length ? `of ${boardRanked.length} direct` : 'no data'),
                color: twineRank === 1 ? 'var(--positive)' : undefined,
                hint: 'Where Twine places among direct competitors, ranked by SOV % (higher = more of the conversation). OKR: reach the top 3.',
              },
              {
                label: 'Twine SOV',
                value: twineRow ? twineRow.overall.toFixed(1) : '—',
                unit: twineRow ? '%' : '',
                // WoW chip (the mock's "−0.3 pts vs last week") — delta vs the
                // previous frozen weekly snapshot, same composite metric as the value.
                chip: twineRow && twineWow != null ? { text: `${fmtWow(twineWow)} pts`, tone: wowTone(twineWow) } : null,
                rail: railTone(twineWow, 0.05),
                sub: twineRow ? (twineWow != null ? 'vs last week' : `${twineRow.postCount} items`) : 'not in filter',
                accent: true,
                hint: 'Twine\'s engagement-weighted cross-platform share of voice — the size of the conversation about Twine vs competitors. The chip is the change vs last week\'s snapshot.',
              },
              {
                // OKR KR-21 (owner: Twine/company). % of staff engaging with the
                // company's LinkedIn posts in the CURRENT Thu→Wed week — same week
                // as every other card. Weeks with no company posts are N/A (not 0)
                // and are excluded from averages and week-over-week comparisons.
                label: 'LinkedIn Engagement',
                value: engView.pct != null ? String(Math.round(engView.pct)) : (engView.kind === 'na' ? 'N/A' : '—'),
                unit: engView.pct != null ? '%' : '',
                chip: engView.wow != null ? { text: `${fmtWow(engView.wow)} pts`, tone: wowTone(engView.wow) } : null,
                rail: engView.wow != null ? railTone(engView.wow, 0.5) : null,
                sub: engView.kind === 'measured' ? `vs prior wk · wk of ${twineMentions.wkLabel}`
                  : engView.kind === 'na' ? `no company posts · wk of ${twineMentions.wkLabel}`
                    : engView.kind === 'pending' ? `measures Thu · last wk ${Math.round(engPrev.pct)}%`
                      : 'no data yet',
                hint: `Share of Twine staff (of the ${rosterCfg.config?.headcount ?? 40}-person headcount) who liked, commented on, or reposted the company's LinkedIn posts in the current Thursday-anchored week (the SOV default week). Weeks with no company posts show N/A and don't count toward averages or the week-over-week chip. Measured each Thursday at noon for the completed week; a later re-measure of the same week supersedes the earlier one.`,
                // Signed-in users can edit the headcount + roster the pipeline uses.
                action: rosterCfg.canEdit ? { label: 'Edit', onClick: () => setRosterOpen(true) } : null,
              },
              {
                // OKR: number of mentions, all platforms, past week (owner: Justin).
                // Deliberately ignores the platform/time filters — it's a fixed gauge.
                label: 'Mentions This Week',
                value: error ? '—' : String(twineMentions.cur),
                chip: !error && allPosts.length
                  ? { text: `${twineMentions.cur > twineMentions.prev ? '+' : twineMentions.cur < twineMentions.prev ? '−' : ''}${Math.abs(twineMentions.cur - twineMentions.prev)}`, tone: wowTone(twineMentions.cur - twineMentions.prev) }
                  : null,
                rail: !error && allPosts.length > 0 ? railTone(twineMentions.cur - twineMentions.prev, 0.5) : null,
                sub: `all platforms · wk of ${twineMentions.wkLabel}`,
                hint: 'Twine mentions across every platform in the CURRENT OKR week (Thursday-anchored — the same weeks as the company drill-in and the weekly pipeline). Fixed gauge: ignores the platform/time filters. The chip/rail compare against last week\'s final total — the number to beat.',
              },
            ].map((stat, i) => (
              <GlassCard key={i} className={`stat-card ${stat.rail ? `rail-${stat.rail}` : ''}`} intensity={10} title={stat.hint}>
                <div className="label">{stat.label}</div>
                <div className={`value ${stat.accent ? 'accent' : ''}`} style={stat.color ? { color: stat.color } : {}}>
                  {stat.value}{stat.unit ? <span className="unit">{stat.unit}</span> : null}
                </div>
                <div className="sub">
                  {stat.chip ? <span className={`kpi-chip ${stat.chip.tone}`}>{stat.chip.text}</span> : null}
                  {stat.sub ? <span>{stat.sub}</span> : null}
                  {stat.action ? (
                    <button className="lir-edit-trigger" onClick={stat.action.onClick}>✎ {stat.action.label}</button>
                  ) : null}
                </div>
              </GlassCard>
            ))}
          </div>

          {rosterOpen && (
            <LinkedInRosterSettings
              config={rosterCfg.config}
              saving={rosterCfg.saving}
              error={rosterCfg.error}
              onSave={rosterCfg.save}
              onClose={() => setRosterOpen(false)}
            />
          )}

          {/* Weekly Share-of-Voice trend — competitors over time. When a platform
              is selected, this reflects it (live series); otherwise the frozen board. */}
          <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4} interactive>
            <div className="card-header">
              <span className="card-title" title={`Timescale follows the global Time window (${windowLabel}).`}>
                Share of Voice — {windowLabel}{platformScopeLabel ? ` · ${platformScopeLabel}` : ''}
              </span>
            </div>
            <AnnotationBar annotations={annotations} onAdd={addAnnotation} onUpdate={updateAnnotation} onRemove={removeAnnotation} currentUserId={annotationUserId} />
            <SOVTrendChart
              competitors={competitors}
              metric="overall"
              yLabel="SOV %"
              posts={chartPosts}
              live={platformFiltered}
              config={sovConfig}
              windowDays={windowDays}
              nowValues={nowValues}
              annotations={annotations}
            />
          </GlassCard>

          {/* All-companies breakdown table (moved above Sentiment) */}
          <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4} interactive>
            <div className="card-header" style={{ display: 'flex', alignItems: 'center' }}>
              <span className="card-title">Direct competitors · SOV ranking
                <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: '0.85em' }}> · {windowRangeLabel(days)}</span>
              </span>
              <button
                className="csv-btn"
                style={{ marginLeft: 'auto' }}
                title="Download this ranking (current filters) as CSV"
                onClick={() => downloadCSV(
                  `sov-ranking-${windowLabel.replace(/\s+/g, '-')}`,
                  sortedRanked,
                  [
                    { key: r => rankByCompany[r.company] ?? '', label: 'rank' },
                    { key: 'company', label: 'company' },
                    { key: 'postCount', label: 'items' },
                    { key: r => (r.weightedPct ?? 0).toFixed(2), label: 'sov_pct' },
                    { key: r => r.wowDelta != null ? r.wowDelta.toFixed(2) : '', label: 'sov_wow_pts' },
                    { key: 'weekItems', label: 'items_this_week' },
                    { key: r => r.sentimentCount ? (r.avgSentiment ?? 0).toFixed(2) : '', label: 'avg_sentiment' },
                  ]
                )}
              >
                <Download size={13} /> CSV
              </button>
            </div>
            {sortedRanked.length === 0 ? (
              <div className="empty-state"><p>No data for the current filters</p></div>
            ) : (
              <div className="table-wrap">
                <table className="breakdown-table">
                  <colgroup>
                    <col style={{ width: 44 }} />
                    <col />
                    <col style={{ width: 72 }} />
                    <col style={{ width: '32%' }} />
                    <col style={{ width: 104 }} />
                    {/* wide enough for the label + sort arrow — 92px made the arrow
                        poke past the wrap edge and summon a phantom scrollbar */}
                    <col style={{ width: 102 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="col-rank" title="SOV rank (by share, high to low)">#</th>
                      <SortHeader label="Company" field="company" sortKey={sortKey} setSortKey={setSortKey} align="left" />
                      <SortHeader label="Items" field="postCount" sortKey={sortKey} setSortKey={setSortKey} />
                      <SortHeader label="Share of Voice" field="weightedPct" sortKey={sortKey} setSortKey={setSortKey} align="left" />
                      <SortHeader label="Δ SOV (wk)" field="wowDelta" sortKey={sortKey} setSortKey={setSortKey} />
                      <SortHeader label="Items (wk)" field="weekItems" sortKey={sortKey} setSortKey={setSortKey} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRanked.map(r => (
                      <tr
                        key={r.company}
                        className={`cdi-row ${isTwine(r.company) ? 'is-twine' : ''}`}
                        onClick={() => setDrilledCompany(r.company)}
                        title={`Why is ${r.company}'s SOV ${r.weightedPct.toFixed(1)}%? — click to drill in`}
                      >
                        <td className="col-rank">{rankByCompany[r.company]}</td>
                        <td className="col-company">{r.company}</td>
                        <td>{r.postCount}</td>
                        <td className="col-share">
                          <span className="share-cell">
                            <span className="bt-meter"><i style={{ width: `${Math.max(2, (r.weightedPct / boardMax) * 100)}%` }} /></span>
                            <span className="bt-pct">{r.weightedPct.toFixed(1)}%</span>
                          </span>
                        </td>
                        <td
                          className={r.wowDelta == null ? 'neutral' : wowTone(r.wowDelta) === 'up' ? 'positive' : wowTone(r.wowDelta) === 'dn' ? 'negative' : 'neutral'}
                          title="Change in SOV points vs the previous weekly snapshot (cross-platform)"
                        >
                          {fmtWow(r.wowDelta)}
                        </td>
                        <td className="col-wkitems" title="Items attributed in the current OKR week (Thursday-anchored, same week as the KPI cards and drill-in)">
                          {error ? '—' : r.weekItems}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>

          {/* Top items — the wild outliers driving the board (above the sentiment graph). */}
          <TopPostsWeek posts={directPosts} allTimePosts={chartPosts} config={sovConfig} />

          {/* Sentiment — its own weekly trend. Reflects the platform filter (live)
              when one is selected. */}
          <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4} interactive>
            <div className="card-header">
              <span className="card-title" title="Average tone of external mentions on the −3 (very negative) to +3 (very positive) per-post scale — the same scale as the Twine Sentiment stat card. 0 = neutral.">
                Sentiment — {windowLabel}{platformScopeLabel ? ` · ${platformScopeLabel}` : ''}
              </span>
            </div>
            <p className="cr-sub" style={{ marginTop: -8 }}>
              How people are talking about each company — average tone of external mentions on the −3 to +3 scale (0 = neutral), same scale as the Twine sentiment card here.
            </p>
            {twineRow && (
              <GlassCard
                className={`stat-card ${twineRow.sentimentCount && railTone(twineSentWow, 1) ? `rail-${railTone(twineSentWow, 1)}` : ''}`}
                intensity={10}
                style={{ maxWidth: 300, marginBottom: 16 }}
                title="Average tone of external items about Twine, on a -3 (very negative) to +3 (very positive) per-item scale. Twine's own posts don't count — only what others say."
              >
                <div className="label">Sentiment · External (Twine)</div>
                <div
                  className="value"
                  style={twineRow.sentimentCount ? { color: twineRow.avgSentiment > 0 ? 'var(--positive)' : twineRow.avgSentiment < 0 ? 'var(--negative)' : 'var(--neutral)' } : {}}
                >
                  {twineRow.sentimentCount ? `${twineRow.avgSentiment > 0 ? '+' : ''}${twineRow.avgSentiment.toFixed(1)}` : '—'}
                </div>
                <div className="sub">{twineRow.sentimentCount ? `scale −3…+3 · ${twineRow.sentimentCount} rated` : 'no rated external items'}</div>
              </GlassCard>
            )}
            <SOVTrendChart
              competitors={competitors}
              metric="sentiment_pct"
              yLabel="Sentiment (−3 to +3)"
              posts={chartPosts}
              live={platformFiltered}
              config={sovConfig}
              windowDays={windowDays}
              nowValues={sentimentNow}
            />
          </GlassCard>

          {/* The weekly competitor-authored review now lives in its own
              "Social Briefs" view (with per-post 👍/👎 feedback). */}
        </>
      )}

      {tab === 'compare' && (
        <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4} interactive>
          <div className="card-header">
            <span className="card-title">Head-to-head</span>
                      </div>
          <div className="compare-pickers">
            <CompanyPicker label="Company A" companies={companies} value={compareA} onChange={setCompareA} />
            <div className="compare-vs">vs</div>
            <CompanyPicker label="Company B" companies={companies} value={compareB} onChange={setCompareB} />
          </div>

          {cmp && compareA !== compareB ? (
            <div className="compare-cards">
              <CompareColumn company={compareA} row={cmp.a} winners={cmp.winners} posts={filtered} />
              <CompareColumn company={compareB} row={cmp.b} winners={cmp.winners} posts={filtered} />
            </div>
          ) : (
            <div className="empty-state"><p>Pick two different companies to compare</p></div>
          )}
        </GlassCard>
      )}

      {drilledCompany && (
        <CompanyDrillIn
          company={drilledCompany}
          posts={directPosts}
          allDirectPosts={directPosts}
          allTimePosts={chartPosts}
          config={sovConfig}
          onClose={() => setDrilledCompany(null)}
        />
      )}
      </>
      )}

      <AssistantChat
        platform={selectedPlatforms.length ? selectedPlatforms.join(' + ') : 'All'}
        windowLabel={days === 7 ? '7d' : days === 30 ? '30d' : 'YTD'}
        tab={tab}
        drilledCompany={drilledCompany}
        onOpenCompany={(name) => {
          // Deep link from an assistant answer → open that company's drill-in.
          // Only DIRECT competitors have a drill-in (indirect ones aren't in the
          // ranked board), and only names we actually track. Also switch back to
          // the SOV view + Overview tab so the drill-in is actually visible.
          const match = (competitors || []).find(c =>
            c.name.toLowerCase() === String(name).toLowerCase() && (c.type || 'direct') !== 'indirect')
          if (match) { setView('sov'); setTab('overview'); setDrilledCompany(match.name) }
        }}
      />
    </div>
  )
}

function SortHeader({ label, field, sortKey, setSortKey, align = 'right' }) {
  const active = sortKey === field
  return (
    <th className={`sortable ${active ? 'active' : ''}`} style={{ textAlign: align }} onClick={() => setSortKey(field)}>
      {label}
      <span className="sort-arrow" aria-hidden style={{ visibility: active ? 'visible' : 'hidden' }}> ↓</span>
    </th>
  )
}

function CompanyPicker({ label, companies, value, onChange }) {
  return (
    <label className="company-picker">
      <span className="filter-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {companies.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  )
}

function CompareColumn({ company, row, winners, posts }) {
  const win = (metric) => winners[metric] === company
  const pb = platformSplit(posts, company)
  return (
    <div className="compare-column">
      <div className="compare-company">{company}</div>
      <div className={`compare-metric ${win('volume') ? 'winner' : ''}`}>
        <span className="metric-label">Items</span>
        <span className="metric-value">{row.postCount}</span>
      </div>
      <div className={`compare-metric ${win('sov') ? 'winner' : ''}`}>
        <span className="metric-label">SOV %</span>
        <span className="metric-value">{row.pct != null ? `${row.pct.toFixed(1)}%` : row.unweightedSOV.toFixed(2)}</span>
      </div>
      <div className={`compare-metric ${win('sentiment') ? 'winner' : ''}`}>
        <span className="metric-label">Avg Sentiment</span>
        <span
          className={`metric-value ${row.sentimentCount ? (row.avgSentiment > 0 ? 'positive' : row.avgSentiment < 0 ? 'negative' : 'neutral') : 'neutral'}`}
          title={row.sentimentCount ? undefined : 'No rated external items in this window'}
        >
          {row.sentimentCount ? fmtSent(row.avgSentiment) : '—'}
        </span>
      </div>

      <div className="compare-platforms-label">Platform breakdown</div>
      <div className="compare-platform-grid">
        {Object.entries(PLATFORM_COLORS).map(([plat, color]) => {
          const data = pb[plat] || { count: 0, sov: 0 }
          return (
            <div className="compare-platform-card" key={plat}>
              <div className="platform-icon" style={{ background: `${color}15` }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
              </div>
              <div className="platform-name">{plat}</div>
              <div className="platform-count">{data.count}</div>
              <div className="platform-sov">{data.count === 1 ? 'item' : 'items'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default Dashboard
