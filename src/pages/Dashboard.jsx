import { useState, useEffect, useMemo } from 'react'
import { Filter, Info, Download, RefreshCw } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useSOVData } from '../hooks/useSOVData'
import { useSOVConfig } from '../hooks/useSOVConfig'
import { useLastUpdated } from '../hooks/useLastUpdated'
import { usePersistedState } from '../hooks/usePersistedState'
import { AppHeader } from '../components/AppHeader'
import { GlassCard } from '../components/GlassCard'
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
import { applyFilters, rankings, platformSplit, compare } from '../lib/metrics'
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
  // Current live standing (same numbers as the ranking table) → fed to the trend
  // chart as its "Now" tip so the graph ends where the table says.
  const nowValues = useMemo(
    () => Object.fromEntries((ranked || []).map(r => [r.company, r.weightedPct])),
    [ranked]
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
  const sortedRanked = useMemo(() => {
    const arr = [...ranked]
    arr.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey]
      if (typeof va === 'string') return va.localeCompare(vb)
      return (vb || 0) - (va || 0)
    })
    return arr
  }, [ranked, sortKey])

  // Seed compare pickers once companies arrive
  useEffect(() => {
    if (companies.length && !compareA) setCompareA(companies[0])
    if (companies.length > 1 && !compareB) setCompareB(companies[1])
  }, [companies, compareA, compareB])

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading SOV data...</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="loading-screen">
        <p>Error: {error}</p>
        <button className="refresh-btn" onClick={refetch}>Retry</button>
      </div>
    )
  }

  const twineIdx = ranked.findIndex(r => isTwine(r.company))
  const twineRow = twineIdx >= 0 ? ranked[twineIdx] : null
  const twineRank = twineIdx >= 0 ? twineIdx + 1 : null

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
      {/* SOV-internal tabs */}
      <div className="tab-nav">
        <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        <button className={`tab ${tab === 'posts' ? 'active' : ''}`} onClick={() => setTab('posts')}>Posts of Interest</button>
        <button className={`tab ${tab === 'ai' ? 'active' : ''}`} onClick={() => setTab('ai')}>AI Visibility</button>
        <button className={`tab ${tab === 'compare' ? 'active' : ''}`} onClick={() => setTab('compare')}>Compare</button>
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
                sub: ranked.length ? `overall, of ${ranked.length}` : 'no data',
                color: twineRank === 1 ? 'var(--positive)' : undefined,
                hint: 'Where Twine places among direct competitors, ranked by SOV % (higher = more of the conversation).',
              },
              {
                label: 'Twine SOV %',
                value: twineRow ? `${twineRow.overall.toFixed(1)}%` : '—',
                sub: twineRow ? `${twineRow.postCount} items` : 'not in filter',
                accent: true,
                hint: 'Twine\'s engagement-weighted cross-platform share of voice — the size of the conversation about Twine vs competitors.',
              },
              {
                label: 'Twine Sentiment',
                value: twineRow && twineRow.sentimentCount
                  ? `${twineRow.avgSentiment > 0 ? '+' : ''}${twineRow.avgSentiment.toFixed(2)}`
                  : '—',
                sub: twineRow && twineRow.sentimentCount
                  ? `Scale: -3 to +3 · ${twineRow.sentimentCount} rated item${twineRow.sentimentCount === 1 ? '' : 's'}`
                  : 'no rated external items in this window',
                color: twineRow && twineRow.sentimentCount
                  ? (twineRow.avgSentiment > 0 ? 'var(--positive)' : twineRow.avgSentiment < 0 ? 'var(--negative)' : 'var(--neutral)')
                  : undefined,
                hint: 'Average tone of external items about Twine, on a -3 (very negative) to +3 (very positive) per-item scale. Twine\'s own posts don\'t count — only what others say.',
              },
              {
                label: 'Twine Items',
                value: twineRow ? twineRow.postCount : '—',
                sub: twineRow ? (twineRow.postCount === 1 ? 'item in current view' : 'items in current view') : 'not in filter',
                hint: 'Number of items attributed to Twine in the current view.',
              },
            ].map((stat, i) => (
              <GlassCard key={i} className="stat-card" intensity={10} title={stat.hint}>
                <div className="label">{stat.label}</div>
                <div className={`value ${stat.accent ? 'accent' : ''}`} style={stat.color ? { color: stat.color } : {}}>
                  {stat.value}
                </div>
                <div className="sub">{stat.sub}</div>
              </GlassCard>
            ))}
          </div>

          {/* Weekly Share-of-Voice trend — competitors over time. When a platform
              is selected, this reflects it (live series); otherwise the frozen board. */}
          <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4} interactive>
            <div className="card-header">
              <span className="card-title" title={`Timescale follows the global Time window (${windowLabel}).`}>
                Share of Voice — {windowLabel}{platformScopeLabel ? ` · ${platformScopeLabel}` : ''}
              </span>
            </div>
            <SOVTrendChart
              competitors={competitors}
              metric="overall"
              yLabel="SOV %"
              posts={chartPosts}
              live={platformFiltered}
              config={sovConfig}
              windowDays={windowDays}
              nowValues={nowValues}
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
                    { key: 'company', label: 'company' },
                    { key: 'postCount', label: 'items' },
                    { key: r => (r.weightedPct ?? 0).toFixed(2), label: 'sov_pct' },
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
                  <thead>
                    <tr>
                      <SortHeader label="Company" field="company" sortKey={sortKey} setSortKey={setSortKey} align="left" />
                      <SortHeader label="Items" field="postCount" sortKey={sortKey} setSortKey={setSortKey} />
                      <SortHeader label="SOV %" field="weightedPct" sortKey={sortKey} setSortKey={setSortKey} />
                      <SortHeader label="Avg Sentiment" field="avgSentiment" sortKey={sortKey} setSortKey={setSortKey} />
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
                        <td className="col-company">{r.company}</td>
                        <td>{r.postCount}</td>
                        <td><strong style={{ color: 'var(--accent)' }}>{r.weightedPct.toFixed(1)}%</strong></td>
                        <td
                          className={r.sentimentCount ? (r.avgSentiment > 0 ? 'positive' : r.avgSentiment < 0 ? 'negative' : 'neutral') : 'neutral'}
                          title={r.sentimentCount ? `${r.sentimentCount} rated external item${r.sentimentCount === 1 ? '' : 's'}` : 'No rated external items in this window'}
                        >
                          {r.sentimentCount ? fmtSent(r.avgSentiment) : '—'}
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
              How people are talking about each company — average tone of external mentions on the −3 to +3 scale (0 = neutral), the same scale as the stat card above.
            </p>
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
          // Only for names we actually track (case-insensitive match).
          const match = (competitors || []).find(c => c.name.toLowerCase() === String(name).toLowerCase())
          if (match) { setTab('overview'); setDrilledCompany(match.name) }
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
