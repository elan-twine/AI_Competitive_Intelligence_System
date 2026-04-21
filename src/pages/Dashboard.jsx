import { useState, useEffect } from 'react'
import { RefreshCw, TrendingUp, MessageCircle, BarChart3, Globe, Moon, Sun, LogOut } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useSOVData } from '../hooks/useSOVData'
import { GlassCard } from '../components/GlassCard'
import '../App.css'

const PLATFORM_COLORS = {
  'X': '#1DA1F2',
  'Reddit': '#FF4500',
  'Google News': '#34D399',
  'LinkedIn': '#0A66C2',
}

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

function Dashboard({ onLogout }) {
  const {
    allPosts, companies, loading, error, refetch,
    getCompanySOV, getCompanySentiment, getPlatformBreakdown,
  } = useSOVData()

  const [feedFilter, setFeedFilter] = useState('All')
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('twine-sov-theme')
    return saved === 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('twine-sov-theme', dark ? 'dark' : 'light')
  }, [dark])

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

  const totalSOV = allPosts.reduce((s, p) => s + (p.sov || 0), 0)
  const avgSentiment = allPosts.filter(p => p.sentiment != null).length > 0
    ? allPosts.filter(p => p.sentiment != null).reduce((s, p) => s + p.sentiment, 0) / allPosts.filter(p => p.sentiment != null).length
    : 0
  const platformBreakdown = getPlatformBreakdown()

  const chartData = companies
    .map(c => ({ name: c, sov: getCompanySOV(c) }))
    .sort((a, b) => b.sov - a.sov)

  const filteredPosts = (feedFilter === 'All' ? allPosts : allPosts.filter(p => p.platform === feedFilter))
    .sort((a, b) => (b.sov || 0) - (a.sov || 0))
    .slice(0, 20)

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

      <div className="stats-grid">
        {[
          { label: 'Total Posts', value: allPosts.length, sub: 'Across all platforms' },
          { label: 'Total SOV', value: totalSOV.toFixed(1), sub: 'Weighted share of voice', accent: true },
          {
            label: 'Avg Sentiment',
            value: `${avgSentiment > 0 ? '+' : ''}${avgSentiment.toFixed(2)}`,
            sub: 'Scale: -3 to +3',
            color: avgSentiment > 0 ? 'var(--positive)' : avgSentiment < 0 ? 'var(--negative)' : 'var(--neutral)',
          },
          { label: 'Companies', value: companies.length, sub: `${Object.keys(platformBreakdown).length} platforms` },
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

      <div className="main-grid">
        <GlassCard className="card" intensity={5}>
          <div className="card-header">
            <span className="card-title">Share of Voice by Company</span>
            <span className="card-badge">
              <TrendingUp size={11} style={{ marginRight: 4 }} />
              Rankings
            </span>
          </div>
          {chartData.length > 0 ? (
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 80, right: 20, top: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} width={80} />
                  <Tooltip content={<CustomTooltip />} cursor={false} />
                  <Bar dataKey="sov" radius={[0, 4, 4, 0]} barSize={14}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={i === 0 ? '#DBFE02' : 'rgba(219, 254, 2, 0.3)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty-state"><p>No company data yet</p></div>
          )}
        </GlassCard>

        <GlassCard className="card" intensity={5}>
          <div className="card-header">
            <span className="card-title">Sentiment by Company</span>
            <span className="card-badge">
              <MessageCircle size={11} style={{ marginRight: 4 }} />
              Analysis
            </span>
          </div>
          {companies.length > 0 ? companies.sort((a, b) => getCompanySentiment(b) - getCompanySentiment(a)).map(company => {
            const sent = getCompanySentiment(company)
            const normalized = (sent + 3) / 6
            return (
              <div className="sentiment-row" key={company}>
                <span className="sentiment-name">{company}</span>
                <div className="sentiment-bar-group">
                  <div className="bar" style={{
                    width: `${normalized * 100}%`,
                    background: sent > 0 ? 'var(--positive)' : sent < 0 ? 'var(--negative)' : 'var(--neutral)',
                  }} />
                </div>
                <span className={`sentiment-score ${sent > 0 ? 'positive' : sent < 0 ? 'negative' : 'neutral'}`}>
                  {sent > 0 ? '+' : ''}{sent.toFixed(1)}
                </span>
              </div>
            )
          }) : (
            <div className="empty-state"><p>No sentiment data yet</p></div>
          )}
        </GlassCard>
      </div>

      <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4}>
        <div className="card-header">
          <span className="card-title">Platform Breakdown</span>
          <span className="card-badge">
            <Globe size={11} style={{ marginRight: 4 }} />
            Sources
          </span>
        </div>
        <div className="platform-grid">
          {Object.entries(PLATFORM_COLORS).map(([platform, color]) => {
            const data = platformBreakdown[platform] || { count: 0, sov: 0 }
            return (
              <div className="platform-card" key={platform}>
                <div className="platform-icon" style={{ background: `${color}15` }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: color }} />
                </div>
                <div className="platform-name">{platform}</div>
                <div className="platform-count">{data.count}</div>
                <div className="platform-sov">SOV {data.sov.toFixed(1)}</div>
              </div>
            )
          })}
        </div>
      </GlassCard>

      <GlassCard className="card feed-section" intensity={3}>
        <div className="card-header">
          <span className="card-title">Recent Mentions</span>
          <span className="card-badge">
            <BarChart3 size={11} style={{ marginRight: 4 }} />
            Feed
          </span>
        </div>
        <div className="feed-tabs">
          {['All', 'X', 'Reddit', 'Google News', 'LinkedIn'].map(tab => (
            <button
              key={tab}
              className={`feed-tab ${feedFilter === tab ? 'active' : ''}`}
              onClick={() => setFeedFilter(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="feed-list">
          {filteredPosts.length > 0 ? filteredPosts.map((post, i) => {
            const url = post.twitterUrl || post.permalink || post.url || post.post_url || '#'
            const title = post.text || post.title || post.selfText || 'Untitled'
            const company = post.companyName || '—'
            const color = PLATFORM_COLORS[post.platform] || '#888'
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
                <span className="feed-sov">{(post.sov || 0).toFixed(1)}</span>
              </a>
            )
          }) : (
            <div className="empty-state"><p>No posts found</p></div>
          )}
        </div>
      </GlassCard>
    </div>
  )
}

export default Dashboard
