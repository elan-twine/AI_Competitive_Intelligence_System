import { useState, useEffect, useMemo } from 'react'
import { BarChart3, Globe, Moon, Sun, LogOut, Filter, ArrowUpDown, SlidersHorizontal, Users, Sigma } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useSOVData } from '../hooks/useSOVData'
import { useSOVConfig } from '../hooks/useSOVConfig'
import { GlassCard } from '../components/GlassCard'
import { SOVTrendChart } from '../components/SOVTrendChart'
import { CompetitiveReview } from '../components/CompetitiveReview'
import { CompanyDrillIn } from '../components/CompanyDrillIn'
import { applyFilters, rankings, platformSplit, compare } from '../lib/metrics'
import { PLATFORM_COLORS } from '../lib/colors'
import Briefings from './Briefings'
import '../App.css'

const PLATFORMS = ['All', 'X', 'Reddit', 'Google News', 'LinkedIn']
const TIME_RANGES = [
  { label: 'All time', value: 0 },
  { label: '30d', value: 30 },
  { label: '7d', value: 7 },
]

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

  // Top-level view: SOV dashboard vs Briefings (siblings, not nested)
  const [view, setView] = useState('sov')

  // SOV-internal tabs
  const [tab, setTab] = useState('overview')

  // Global filters (platform + time only — sentiment is local to feed now)
  const [platform, setPlatform] = useState('All')
  const [days, setDays] = useState(0)

  // Overview
  const [sortKey, setSortKey] = useState('overall')
  // Per-company drill-in (window into WHY a company's SOV is what it is)
  const [drilledCompany, setDrilledCompany] = useState(null)

  // Compare
  const [compareA, setCompareA] = useState('')
  const [compareB, setCompareB] = useState('')

  const [dark, setDark] = useState(() => localStorage.getItem('twine-sov-theme') === 'dark')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('twine-sov-theme', dark ? 'dark' : 'light')
  }, [dark])

  // Filtered working set (respects global platform + time only)
  const filtered = useMemo(
    () => applyFilters(allPosts, { platform, days }),
    [allPosts, platform, days]
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
  const ranked = useMemo(() => rankings(directPosts, sovConfig), [directPosts, sovConfig])
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
  const pb = platformSplit(filtered)
  const twineIdx = ranked.findIndex(r => isTwine(r.company))
  const twineRow = twineIdx >= 0 ? ranked[twineIdx] : null
  const twineRank = twineIdx >= 0 ? twineIdx + 1 : null
  const platformCount = Object.keys(pb).length

  const cmp = compareA && compareB ? compare(filtered, compareA, compareB, sovConfig) : null

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <img src="/twine-logo.svg" alt="Twine" className="header-logo" />
          <h1>Twine <span>{view === 'sov' ? 'SOV' : 'Briefings'}</span></h1>
        </div>
        <div className="view-switch">
          <button className={`view-seg ${view === 'sov' ? 'active' : ''}`} onClick={() => setView('sov')}>SOV Dashboard</button>
          <button className={`view-seg ${view === 'briefings' ? 'active' : ''}`} onClick={() => setView('briefings')}>Briefings</button>
        </div>
        <div className="header-right">
          {onNavigate && (
            <button className="theme-btn" onClick={() => onNavigate('methodology')} aria-label="The Math — how SOV is computed" title="The Math">
              <Sigma size={16} />
            </button>
          )}
          {onNavigate && (
            <button className="theme-btn" onClick={() => onNavigate('competitors')} aria-label="Manage competitors" title="Manage competitors">
              <Users size={16} />
            </button>
          )}
          <button className="theme-btn" onClick={() => setDark(d => !d)} aria-label="Toggle theme">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {onLogout && (
            <button className="theme-btn" onClick={onLogout} aria-label="Log out" title="Log out">
              <LogOut size={16} />
            </button>
          )}
        </div>
      </header>

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
            {PLATFORMS.map(p => (
              <button
                key={p}
                className={`chip ${platform === p ? 'active' : ''}`}
                onClick={() => setPlatform(p)}
              >{p}</button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Time</span>
          <div className="chip-row">
            {TIME_RANGES.map(t => (
              <button
                key={t.value}
                className={`chip ${days === t.value ? 'active' : ''}`}
                onClick={() => setDays(t.value)}
              >{t.label}</button>
            ))}
          </div>
        </div>
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
                sub: twineRow ? `${twineRow.postCount} posts` : 'not in filter',
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
                hint: 'Average tone of external posts about Twine, on a -3 (very negative) to +3 (very positive) per-post scale.',
              },
              {
                label: 'Total Posts',
                value: filtered.length,
                sub: platform === 'All' ? `Across ${platformCount} platform${platformCount === 1 ? '' : 's'}` : `On ${platform}`,
                hint: 'Count of tracked posts (all companies) matching the current platform and time filters.',
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

          {/* Platform breakdown — only when not filtered to a single platform */}
          {platform === 'All' && (
            <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4}>
              <div className="card-header">
                <span className="card-title">Platform Breakdown</span>
              </div>
              <div className="platform-grid">
                {Object.entries(PLATFORM_COLORS).map(([plat, color]) => {
                  const data = pb[plat] || { count: 0, sov: 0 }
                  return (
                    <div className="platform-card" key={plat}>
                      <div className="platform-icon" style={{ background: `${color}15` }}>
                        <div style={{ width: 12, height: 12, borderRadius: '50%', background: color }} />
                      </div>
                      <div className="platform-name">{plat}</div>
                      <div className="platform-count">{data.count}</div>
                      <div className="platform-sov">{data.count === 1 ? 'post' : 'posts'}</div>
                    </div>
                  )
                })}
              </div>
            </GlassCard>
          )}

          {/* Weekly Share-of-Voice trend — competitors over time */}
          <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4} interactive>
            <div className="card-header">
              <span className="card-title">Share of Voice — Weekly Trend</span>
            </div>
            <SOVTrendChart competitors={competitors} metric="overall" yLabel="SOV %" />
          </GlassCard>

          {/* Sentiment — its own weekly trend (separate from SOV per D3) */}
          <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4} interactive>
            <div className="card-header">
              <span className="card-title" title="A 0–100 index (50 = neutral) rescaled from the -3..+3 per-post sentiment scale used in the stat cards.">Sentiment — Weekly Trend</span>
            </div>
            <p className="cr-sub" style={{ marginTop: -8 }}>
              0–100 index (50 = neutral) — a rescale of the -3..+3 per-post scale shown in the stat cards, so the two numbers use different ranges.
            </p>
            <SOVTrendChart competitors={competitors} metric="sentiment_pct" yLabel="Sentiment index (0–100)" />
          </GlassCard>

          {/* All-companies breakdown table */}
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
                      <SortHeader label="Posts" field="postCount" sortKey={sortKey} setSortKey={setSortKey} />
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
        <span className="metric-label">Posts</span>
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
              <div className="platform-sov">{data.count === 1 ? 'post' : 'posts'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default Dashboard
