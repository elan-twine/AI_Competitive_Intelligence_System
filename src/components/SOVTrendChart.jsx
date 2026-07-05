import { useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer,
} from 'recharts'
import { useWeeklySOV } from '../hooks/useWeeklySOV'
import { useDailySOV } from '../hooks/useDailySOV'
import { weeklySOVSeries, weeklySentimentSeries, rollingDailySOVSeries, rollingDailySentimentSeries } from '../lib/metrics'
import { colorForCompany, isTwine } from '../lib/colors'

// How many trailing points to draw so the chart stays readable. The time SPAN
// is governed by the GLOBAL window (7d / 30d / YTD) — there is no separate
// per-chart range selector anymore; the chart always reflects the dashboard's
// one time control.
const MAX_DAILY_POINTS = 90    // ~3 months of daily rolling points
const MAX_WEEKLY_POINTS = 52   // ~1 year of weekly snapshots

function TrendTooltip({ active, payload, label, isDaily }) {
  if (!active || !payload?.length) return null
  const rows = [...payload]
    .filter(p => p.value != null && p.strokeOpacity !== 0)
    .sort((a, b) => (b.value || 0) - (a.value || 0))
  if (!rows.length) return null
  return (
    <div className="chart-tooltip">
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>
        {isDaily ? label : `Week of ${label}`}
      </div>
      {rows.map(p => (
        <div
          key={p.dataKey}
          className="chart-tooltip-value"
          style={{ color: 'var(--text-secondary)', display: 'flex', gap: 8, justifyContent: 'space-between' }}
        >
          <span style={{ color: p.color }}>{p.dataKey}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Number(p.value).toFixed(1)}</span>
        </div>
      ))}
    </div>
  )
}

// `competitors` — the active competitor list (drives which lines to draw).
// Data normally comes from the immutable weekly snapshots (sov_weekly) via
// useWeeklySOV (cross-platform, full history). When `live` is set — i.e. the
// user has narrowed the platform filter — we instead compute the weekly series
// live from the passed `posts` so the chart reflects the selected platform(s).
// That trades full frozen history for a filter-accurate view.
// `windowDays` — the GLOBAL time window (7 or 30 => daily rolling series from
// sov_daily; null/other => YTD weekly board from sov_weekly). When `live` is set
// (a platform filter is active) sov_daily can't be sliced by platform, so we
// fall back to a weekly series computed live from the passed posts.
export function SOVTrendChart({ competitors = [], metric = 'overall', yLabel = 'SOV %', posts = null, live = false, config = undefined, windowDays = null }) {
  // Daily whenever the window is 7d/30d — whether from the precomputed sov_daily
  // board (all-platform) or, under a platform filter, a live rolling series.
  const isDaily = (windowDays === 7 || windowDays === 30)
  const { series: frozenSeries } = useWeeklySOV(metric)
  const { series: dailySeries } = useDailySOV(windowDays === 30 ? 30 : 7, metric)
  const liveSeries = useMemo(() => {
    if (!live || !posts) return null
    if (isDaily) {
      return metric === 'sentiment_pct'
        ? rollingDailySentimentSeries(posts, { windowDays })
        : rollingDailySOVSeries(posts, config, { windowDays })
    }
    return metric === 'sentiment_pct'
      ? weeklySentimentSeries(posts, { weeks: 52 })
      : weeklySOVSeries(posts, config, { weeks: 52 })
  }, [live, posts, metric, config, isDaily, windowDays])
  const series = liveSeries || (isDaily ? dailySeries : frozenSeries)
  const [hidden, setHidden] = useState(() => new Set())   // companies toggled off via legend
  const [active, setActive] = useState(null)              // legend-hovered company (spotlight)
  const [scope, setScope] = useState('direct')             // 'all' | 'direct' — which competitor lines to draw (default: direct)

  const data = useMemo(() => {
    const n = isDaily ? MAX_DAILY_POINTS : MAX_WEEKLY_POINTS
    return series.length > n ? series.slice(series.length - n) : series
  }, [series, isDaily])

  // Lines to draw: active competitors present in the windowed data (Twine first).
  const lines = useMemo(() => {
    const present = new Set()
    for (const row of data) for (const k of Object.keys(row)) if (k !== 'week') present.add(k)
    const activeNames = (competitors || []).filter(c => c && c.active !== false).map(c => c.name)
    let names = activeNames.length ? activeNames.filter(n => present.has(n)) : [...present]
    if (scope === 'direct') {
      const directNames = new Set(
        (competitors || []).filter(c => c && c.active !== false && (c.type || 'direct') !== 'indirect').map(c => c.name)
      )
      names = names.filter(n => directNames.has(n) || isTwine(n))
    }
    return names.sort((a, b) => {
      if (isTwine(a) && !isTwine(b)) return -1
      if (isTwine(b) && !isTwine(a)) return 1
      return a.localeCompare(b)
    })
  }, [data, competitors, scope])

  // Zoom the Y-axis to the visible band so tightly-packed lines spread out
  // (only across lines that are currently shown).
  const yDomain = useMemo(() => {
    let lo = Infinity, hi = -Infinity
    for (const row of data) for (const n of lines) {
      if (hidden.has(n)) continue
      const v = row[n]
      if (v == null || isNaN(v)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    if (!isFinite(lo) || !isFinite(hi)) return [0, 'auto']
    if (lo === hi) return [Math.max(0, lo - 5), hi + 5]
    const pad = Math.max(2, (hi - lo) * 0.12)
    return [Math.max(0, Math.floor(lo - pad)), Math.ceil(hi + pad)]
  }, [data, lines, hidden])

  if (!data.length || !lines.length) {
    return (
      <div className="empty-state">
        <p>{live
          ? 'No posts on the selected platform(s) in this window — clear or widen the platform filter.'
          : isDaily
            ? 'Daily rolling history is still building — it adds one point per day. Switch to YTD for the full weekly trend.'
            : 'Not enough history yet — weekly trends appear once a few weeks of mentions accumulate.'}</p>
      </div>
    )
  }

  const toggle = (name) => setHidden(prev => {
    const s = new Set(prev)
    s.has(name) ? s.delete(name) : s.add(name)
    return s
  })

  const pill = {
    fontSize: 11, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
    background: 'transparent', fontWeight: 600, lineHeight: 1.4,
    border: '1px solid var(--border)', color: 'var(--text-secondary)',
  }
  const activePill = { borderColor: 'var(--accent)', color: 'var(--accent)' }

  return (
    <div className="trend-chart-wrap">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {live && (
            <span
              title="Computed live from the current platform filter (not the frozen weekly board). History is limited to weeks with posts."
              style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', borderRadius: 999, padding: '2px 8px' }}
            >
              ● Filtered
            </span>
          )}
          {[['direct', 'Direct'], ['all', 'All']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setScope(key)}
              style={{ ...pill, ...(scope === key ? activePill : null) }}
              title={key === 'direct' ? 'Direct competitors only' : 'All tracked companies (incl. indirect)'}
            >
              {label}
            </button>
          ))}
        </div>
        <span
          title={isDaily
            ? `Each point = that day's share of voice over the trailing ${windowDays} days. Set by the dashboard's Time window.`
            : 'Each point = that week’s frozen board score. Set the Time window to 7d/30d for the daily rolling trend.'}
          style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 8px' }}
        >
          {isDaily ? `${windowDays}-day rolling · daily` : 'Weekly board'}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.25} vertical={false} />
          <XAxis
            dataKey="week"
            tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)', opacity: 0.4 }}
            minTickGap={20}
          />
          <YAxis
            domain={yDomain}
            allowDecimals={false}
            tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            label={{
              value: yLabel,
              angle: -90,
              position: 'insideLeft',
              style: { fill: 'var(--text-secondary)', fontSize: 12 },
            }}
          />
          <Tooltip content={<TrendTooltip isDaily={isDaily} />} />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 6 }}
            onClick={(o) => toggle(o.dataKey || o.value)}
            onMouseEnter={(o) => setActive(o.dataKey || o.value)}
            onMouseLeave={() => setActive(null)}
            formatter={(value) => (
              <span style={{
                color: hidden.has(value) ? 'var(--text-tertiary, #888)' : 'var(--text-secondary)',
                opacity: hidden.has(value) ? 0.4 : 1,
                textDecoration: hidden.has(value) ? 'line-through' : 'none',
                cursor: 'pointer',
              }}>{value}</span>
            )}
          />
          {lines.map(name => {
            const twine = isTwine(name)
            const color = colorForCompany(name)   // stable per-company color, independent of filter/order
            const dim = active && active !== name
            return (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                name={name}
                stroke={color}
                strokeWidth={active === name ? (twine ? 4.5 : 3) : (twine ? 3.25 : 1.75)}
                strokeOpacity={dim ? 0.16 : 1}
                hide={hidden.has(name)}
                dot={data.length <= 16 ? { r: twine ? 3 : 2, strokeWidth: 0, fill: color } : false}
                activeDot={{ r: twine ? 6 : 4 }}
                connectNulls
                isAnimationActive={false}
              />
            )
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
