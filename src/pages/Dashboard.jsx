import { useState, useEffect, useMemo } from 'react'
import { RefreshCw, TrendingUp, MessageCircle, BarChart3, Globe, Moon, Sun, LogOut, Filter, ArrowUpDown, SlidersHorizontal } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useSOVData } from '../hooks/useSOVData'
import { GlassCard } from '../components/GlassCard'
import { applyFilters, rankings, companyRow, platformSplit, compare, totalWeightedSOV } from '../lib/metrics'
import '../App.css'

const PLATFORM_COLORS = {
  'X': '#1DA1F2',
  'Reddit': '#FF4500',
  'Google News': '#34D399',
  'LinkedIn': '#0A66C2',
}
const PLATFORMS = ['All', 'X', 'Reddit', 'Google News', 'LinkedIn']
const PLATFORMS_NO_ALL = ['X', 'Reddit', 'Google News', 'LinkedIn']
const TIME_RANGES = [
  { label: 'All time', value: 0 },
  { label: '30d', value: 30 },
  { label: '7d', value: 7 },
]
const SENTIMENT_KINDS = ['positive', 'neutral', 'negative']

function SentimentLabel({ score }) {
  if (score == null) return null
  const cls = score > 0 ? 'pos' : score < 0 ? 'neg' : 'neu'
  const label = score > 0 ? `+${score}` : `${score}`
  return <span className={`feed-sentiment ${cls}`}>{label}</span>
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

function toggle(set, value) {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function Dashboard({ onLogout }) {
  const { allPosts, companies, loading, error, refetch } = useSOVData()

  // Tabs
  const [tab, setTab] = useState('overview')

  // Global filters (platform + time only — sentiment is local to feed now)
  const [platform, setPlatform] = useState('All')
  const [days, setDays] = useState(0)

  // Overview
  const [sortKey, setSortKey] = useState('weightedSOV')

  // Compare
  const [compareA, setCompareA] = useState('')
  const [compareB, setCompareB] = useState('')

  // Feed local multi-select filters
  const [feedCompanies, setFeedCompanies] = useState(() => new Set())
  const [feedPlatforms, setFeedPlatforms] = useState(() => new Set())
  const [feedSentiments, setFeedSentiments] = useState(() => new Set())

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

  const ranked = useMemo(() => rankings(filtered), [filtered])
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

  const totalSOV = totalWeightedSOV(filtered)
  const sentRows = filtered.filter(p => p.sentiment != null)
  const avgSentiment = sentRows.length ? sentRows.reduce((s, p) => s + p.sentiment, 0) / sentRows.length : 0
  const pb = platformSplit(filtered)

  const maxSOV = ranked.length ? ranked[0].weightedSOV || 1 : 1
  const isTwine = (name) => /twine/i.test(name || '')

  // Feed-local filtering: apply on top of `filtered`
  const feedPosts = filtered.filter(p => {
    if (feedCompanies.size > 0 && !feedCompanies.has(p.companyName)) return false
    if (feedPlatforms.size > 0 && !feedPlatforms.has(p.platform)) return false
    if (feedSentiments.size > 0) {
      if (p.sentiment == null) return false
      const kind = p.sentiment > 0 ? 'positive' : p.sentiment < 0 ? 'negative' : 'neutral'
      if (!feedSentiments.has(kind)) return false
    }
    return true
  }).sort((a, b) => (b.weightedSOV || b.sov || 0) - (a.weightedSOV || a.sov || 0)).slice(0, 40)

  const cmp = compareA && compareB ? compare(filtered, compareA, compareB) : null

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <img src="/twine-logo.svg" alt="Twine" className="header-logo" />
          <h1>Twine <span>SOV</span></h1>
        </div>
        <div className="header-right">
          <button className="theme-btn" onClick={() => setDark(d => !d)} aria-label="Toggle theme">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className={`refresh-btn ${loading ? 'loading' : ''}`} onClick={refetch}>
            <RefreshCw size={14} />
            Refresh
          </button>
          {onLogout && (
            <button className="theme-btn" onClick={onLogout} aria-label="Log out" title="Log out">
              <LogOut size={16} />
            </button>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div className="tab-nav">
        <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        <button className={`tab ${tab === 'compare' ? 'active' : ''}`} onClick={() => setTab('compare')}>Compare</button>
      </div>

      {/* Global filter bar (platform + time only) */}
      <GlassCard className="card filter-bar" intensity={3}>
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
          {/* Stats grid */}
          <div className="stats-grid">
            {[
              { label: 'Total Posts', value: filtered.length, sub: platform === 'All' ? 'Across all platforms' : `On ${platform}` },
              { label: 'Total Weighted SOV', value: totalSOV.toFixed(1), sub: 'Sum across all companies', accent: true },
              {
                label: 'Avg Sentiment',
                value: `${avgSentiment > 0 ? '+' : ''}${avgSentiment.toFixed(2)}`,
                sub: 'Scale: -3 to +3',
                color: avgSentiment > 0 ? 'var(--positive)' : avgSentiment < 0 ? 'var(--negative)' : 'var(--neutral)',
              },
              { label: 'Companies', value: ranked.length, sub: `${Object.keys(pb).length} platforms` },
            ].map((stat, i) => (
              <GlassCard key={i} className="stat-card" intensity={10}>
                <div className="label">{stat.label}</div>
                <div className="value" style={stat.color ? { color: stat.color } : stat.accent ? { color: 'var(--accent)' } : {}}>
                  {stat.value}
                </div>
                <div className="sub">{stat.sub}</div>
              </GlassCard>
            ))}
          </div>

          {/* Rankings + sentiment */}
          <div className="main-grid">
            <GlassCard className="card" intensity={5}>
              <div className="card-header">
                <span className="card-title">Share of Voice by Company</span>
                <span className="card-badge"><TrendingUp size={11} style={{ marginRight: 4 }} />Rankings</span>
              </div>
              {ranked.length > 0 ? ranked.map(r => {
                const pct = maxSOV > 0 ? (r.weightedSOV / maxSOV) * 100 : 0
                const twine = isTwine(r.company)
                return (
                  <div className={`sentiment-row ${twine ? 'is-twine' : ''}`} key={r.company}>
                    <span className="sentiment-name">{r.company}</span>
                    <div className="sentiment-bar-group">
                      <div className="bar" style={{
                        width: `${pct}%`,
                        background: twine ? 'var(--accent)' : 'rgba(219, 254, 2, 0.45)',
                      }} />
                    </div>
                    <span className="sentiment-score" style={{ color: 'var(--text-primary)' }}>
                      {r.weightedSOV.toFixed(2)}
                    </span>
                  </div>
                )
              }) : (
                <div className="empty-state"><p>No data for the current filters</p></div>
              )}
            </GlassCard>

            <GlassCard className="card" intensity={5}>
              <div className="card-header">
                <span className="card-title">Sentiment by Company</span>
                <span className="card-badge"><MessageCircle size={11} style={{ marginRight: 4 }} />Analysis</span>
              </div>
              {ranked.length > 0 ? [...ranked].sort((a, b) => b.avgSentiment - a.avgSentiment).map(r => {
                const sent = r.avgSentiment
                const normalized = (sent + 3) / 6
                const twine = isTwine(r.company)
                return (
                  <div className={`sentiment-row ${twine ? 'is-twine' : ''}`} key={r.company}>
                    <span className="sentiment-name">{r.company}</span>
                    <div className="sentiment-bar-group">
                      <div className="bar" style={{
                        width: `${normalized * 100}%`,
                        background: sent > 0 ? 'var(--positive)' : sent < 0 ? 'var(--negative)' : 'var(--neutral)',
                      }} />
                    </div>
                    <span className={`sentiment-score ${sent > 0 ? 'positive' : sent < 0 ? 'negative' : 'neutral'}`}>
                      {fmtSent(sent)}
                    </span>
                  </div>
                )
              }) : (
                <div className="empty-state"><p>No sentiment data for current filters</p></div>
              )}
            </GlassCard>
          </div>

          {/* All-companies breakdown table */}
          <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4}>
            <div className="card-header">
              <span className="card-title">All Companies · Breakdown</span>
              <span className="card-badge"><ArrowUpDown size={11} style={{ marginRight: 4 }} />Sortable</span>
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
                      <SortHeader label="Unweighted SOV" field="unweightedSOV" sortKey={sortKey} setSortKey={setSortKey} />
                      <SortHeader label="Weighted SOV" field="weightedSOV" sortKey={sortKey} setSortKey={setSortKey} />
                      <SortHeader label="Avg Sentiment" field="avgSentiment" sortKey={sortKey} setSortKey={setSortKey} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRanked.map(r => (
                      <tr key={r.company} className={isTwine(r.company) ? 'is-twine' : ''}>
                        <td className="col-company">{r.company}</td>
                        <td>{r.postCount}</td>
                        <td>{r.unweightedSOV.toFixed(2)}</td>
                        <td><strong>{r.weightedSOV.toFixed(2)}</strong></td>
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

          {/* Platform breakdown */}
          <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4}>
            <div className="card-header">
              <span className="card-title">Platform Breakdown</span>
              <span className="card-badge"><Globe size={11} style={{ marginRight: 4 }} />Sources</span>
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
                    <div className="platform-sov">SOV {data.sov.toFixed(1)}</div>
                  </div>
                )
              })}
            </div>
          </GlassCard>

          {/* Recent mentions feed with local multi-select filters */}
          <GlassCard className="card feed-section" intensity={3}>
            <div className="card-header">
              <span className="card-title">Recent Mentions</span>
              <span className="card-badge"><SlidersHorizontal size={11} style={{ marginRight: 4 }} />Filterable</span>
            </div>

            <div className="feed-filters">
              <MultiSelectRow
                label="Company"
                options={companies}
                selected={feedCompanies}
                onToggle={(v) => setFeedCompanies(s => toggle(s, v))}
                onClear={() => setFeedCompanies(new Set())}
              />
              <MultiSelectRow
                label="Platform"
                options={PLATFORMS_NO_ALL}
                selected={feedPlatforms}
                onToggle={(v) => setFeedPlatforms(s => toggle(s, v))}
                onClear={() => setFeedPlatforms(new Set())}
              />
              <MultiSelectRow
                label="Sentiment"
                options={SENTIMENT_KINDS}
                selected={feedSentiments}
                onToggle={(v) => setFeedSentiments(s => toggle(s, v))}
                onClear={() => setFeedSentiments(new Set())}
              />
            </div>

            <div className="feed-list">
              {feedPosts.length > 0 ? feedPosts.map((post, i) => {
                const url = post.twitterUrl || post.permalink || post.url || post.post_url || '#'
                const title = post.text || post.title || post.selfText || 'Untitled'
                const company = post.companyName || '—'
                const color = PLATFORM_COLORS[post.platform] || '#888'
                const sov = post.weightedSOV || post.sov || 0
                return (
                  <a key={i} className="feed-item" href={url} target="_blank" rel="noopener noreferrer">
                    <div className="feed-platform-dot" style={{ background: color }} />
                    <div className="feed-content">
                      <div className="feed-title">{title}</div>
                      <div className="feed-meta">
                        <span>{post.platform}</span>
                        <span>{company}</span>
                        <SentimentLabel score={post.sentiment} />
                      </div>
                    </div>
                    <span className="feed-sov">{sov.toFixed(1)}</span>
                  </a>
                )
              }) : (
                <div className="empty-state"><p>No posts match these filters</p></div>
              )}
            </div>
          </GlassCard>
        </>
      )}

      {tab === 'compare' && (
        <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4}>
          <div className="card-header">
            <span className="card-title">Head-to-head</span>
            <span className="card-badge">Compare</span>
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
    </div>
  )
}

function MultiSelectRow({ label, options, selected, onToggle, onClear }) {
  return (
    <div className="feed-filter-row">
      <span className="filter-label">{label}</span>
      <div className="chip-row">
        {options.map(opt => (
          <button
            key={opt}
            className={`chip ${selected.has(opt) ? 'active' : ''}`}
            onClick={() => onToggle(opt)}
          >
            {opt}
          </button>
        ))}
        {selected.size > 0 && (
          <button className="chip clear" onClick={onClear}>Clear</button>
        )}
      </div>
    </div>
  )
}

function SortHeader({ label, field, sortKey, setSortKey, align = 'right' }) {
  const active = sortKey === field
  return (
    <th className={`sortable ${active ? 'active' : ''}`} style={{ textAlign: align }} onClick={() => setSortKey(field)}>
      {label}{active ? ' ↓' : ''}
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
        <span className="metric-label">Weighted SOV</span>
        <span className="metric-value">{row.weightedSOV.toFixed(2)}</span>
      </div>
      <div className="compare-metric">
        <span className="metric-label">Unweighted SOV</span>
        <span className="metric-value">{row.unweightedSOV.toFixed(2)}</span>
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
              <div className="platform-sov">SOV {data.sov.toFixed(1)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default Dashboard
