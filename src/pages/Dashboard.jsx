import { useState, useEffect, useMemo } from 'react'
import { Filter, Info } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useSOVData } from '../hooks/useSOVData'
import { useSOVConfig } from '../hooks/useSOVConfig'
import { useLastUpdated } from '../hooks/useLastUpdated'
import { AppHeader } from '../components/AppHeader'
import { GlassCard } from '../components/GlassCard'
import { SOVTrendChart } from '../components/SOVTrendChart'
import { CompetitiveReview } from '../components/CompetitiveReview'
import { CompanyDrillIn } from '../components/CompanyDrillIn'
import { TopPostsWeek } from '../components/TopPostsWeek'
import { applyFilters, rankings, platformSplit, compare } from '../lib/metrics'
import { PLATFORM_COLORS } from '../lib/colors'
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
  { label: 'YTD', value: YTD_DAYS, hint: 'Share of voice over all posts year-to-date (Jan 1 → today). The trend chart shows the weekly board across the year.' },
  { label: '30d', value: 30, hint: 'Share of voice over posts from the last 30 days. The trend chart shows the 30-day rolling value, one point per day.' },
  { label: '7d', value: 7, hint: 'Share of voice over posts from the last 7 days. The trend chart shows the 7-day rolling value, one point per day.' },
]
// Map the selected window to the trend-chart resolution + a human label.
function windowMeta(days) {
  if (days === 7) return { windowDays: 7, label: '7-day rolling' }
  if (days === 30) return { windowDays: 30, label: '30-day rolling' }
  return { windowDays: null, label: 'Weekly · year-to-date' }
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
  const { config: sovConfig } = useSOVConfig()
  const lastUpdated = useLastUpdated()

  // Top-level view: SOV dashboard vs Briefings (siblings, not nested)
  const [view, setView] = useState('sov')

  // SOV-internal tabs
  const [tab, setTab] = useState('overview')

  // Global filters (platform + time only — sentiment is local to feed now).
  // Platform is MULTI-select: an array of selected platform names. Empty = no
  // platform filter (the "All" chip clears the selection). Time stays single-select.
  const [selectedPlatforms, setSelectedPlatforms] = useState([])
  const [days, setDays] = useState(YTD_DAYS)

  // Toggle a platform in/out of the selection. Clicking "All" clears everything.
  const togglePlatform = (p) => {
    if (p === 'All') { setSelectedPlatforms([]); return }
    setSelectedPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    )
  }

  // Overview
  const [sortKey, setSortKey] = useState('overall')
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

  const isTwine = (name) => /twine/i.test(name || '')
  const twineIdx = ranked.findIndex(r => isTwine(r.company))
  const twineRow = twineIdx >= 0 ? ranked[twineIdx] : null
  const twineRank = twineIdx >= 0 ? twineIdx + 1 : null

  const cmp = compareA && compareB ? compare(filtered, compareA, compareB, sovConfig) : null

  return (
    <div className="app">
      <AppHeader
        page={view === 'sov' ? 'SOV' : 'Briefings'}
        onNavigate={onNavigate}
        onLogout={onLogout}
        view={view}
        onViewChange={setView}
      />

      {view === 'briefings' && <Briefings />}

      {view === 'sov' && (
      <>
      {/* SOV-internal tabs */}
      <div className="tab-nav">
        <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        <button className={`tab ${tab === 'compare' ? 'active' : ''}`} onClick={() => setTab('compare')}>Compare</button>
      </div>

      {/* Global filter bar (platform + time only) */}
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
        {lastUpdated.ready && lastUpdated.latest && (
          <div className="filter-group" style={{ marginLeft: 'auto' }}>
            <span className="filter-label">Updated</span>
            <span
              style={{ fontSize: 12, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}
              title={lastUpdated.source === 'scrape_runs'
                ? lastUpdated.platforms.map(p => `${p.platform}: ${p.ago}`).join('  ·  ')
                : `Board last computed ${lastUpdated.latest.toISOString().slice(0, 10)}`}
            >
              {lastUpdated.source === 'scrape_runs' && lastUpdated.platforms[0]
                ? `${lastUpdated.platforms[0].platform} · ${lastUpdated.platforms[0].ago}`
                : `board · ${lastUpdated.latest.toISOString().slice(0, 10)}`}
            </span>
          </div>
        )}
      </GlassCard>

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
                value: twineRow ? `${twineRow.avgSentiment > 0 ? '+' : ''}${twineRow.avgSentiment.toFixed(2)}` : '—',
                sub: 'Scale: -3 to +3',
                color: twineRow
                  ? (twineRow.avgSentiment > 0 ? 'var(--positive)' : twineRow.avgSentiment < 0 ? 'var(--negative)' : 'var(--neutral)')
                  : undefined,
                hint: 'Average tone of external items about Twine, on a -3 (very negative) to +3 (very positive) per-item scale.',
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
            />
          </GlassCard>

          {/* All-companies breakdown table (moved above Sentiment) */}
          <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4} interactive>
            <div className="card-header">
              <span className="card-title">Direct competitors · SOV ranking</span>
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
                        <td className={r.avgSentiment > 0 ? 'positive' : r.avgSentiment < 0 ? 'negative' : 'neutral'}>
                          {fmtSent(r.avgSentiment)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>

          {/* Top items — the wild outliers driving the board (above the sentiment graph). */}
          <TopPostsWeek posts={directPosts} />

          {/* Sentiment — its own weekly trend. Reflects the platform filter (live)
              when one is selected. */}
          <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4} interactive>
            <div className="card-header">
              <span className="card-title" title="A 0–100 index (50 = neutral) rescaled from the -3..+3 per-post sentiment scale used in the stat cards.">
                Positive or Negative Sentiment — {windowLabel}{platformScopeLabel ? ` · ${platformScopeLabel}` : ''}
              </span>
            </div>
            <p className="cr-sub" style={{ marginTop: -8 }}>
              How people are talking about us — a 0–100 index (50 = neutral) over external mentions, rescaled from the -3..+3 per-post scale in the stat cards.
            </p>
            <SOVTrendChart
              competitors={competitors}
              metric="sentiment_pct"
              yLabel="Sentiment index (0–100)"
              posts={chartPosts}
              live={platformFiltered}
              config={sovConfig}
              windowDays={windowDays}
            />
          </GlassCard>

          {/* Competitive Review — weekly view of competitor-authored posts +
              engagement (replaces the old Recent Mentions feed) */}
          <CompetitiveReview posts={allPosts} competitors={competitors} />
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
          config={sovConfig}
          onClose={() => setDrilledCompany(null)}
        />
      )}
      </>
      )}
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
        <span className={`metric-value ${row.avgSentiment > 0 ? 'positive' : row.avgSentiment < 0 ? 'negative' : 'neutral'}`}>
          {fmtSent(row.avgSentiment)}
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
