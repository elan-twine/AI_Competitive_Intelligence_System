import { useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer,
} from 'recharts'
import { useWeeklySOV } from '../hooks/useWeeklySOV'

// Distinct line colors for competitors. Twine is handled separately (it gets
// the accent token + a thicker stroke), so this palette is for everyone else.
const LINE_COLORS = [
  '#0A66C2', // LinkedIn blue
  '#FF4500', // reddit orange
  '#34D399', // green
  '#A855F7', // purple
  '#F59E0B', // amber
  '#EC4899', // pink
  '#14B8A6', // teal
  '#6366F1', // indigo
  '#EF4444', // red
  '#8B5CF6', // violet
]

const isTwine = (name) => /twine/i.test(name || '')

// Time-range options. weeks = how many trailing weekly snapshots to show.
const RANGES = [
  { key: '1m', label: '1M', weeks: 4 },
  { key: '3m', label: '3M', weeks: 13 },
  { key: '6m', label: '6M', weeks: 26 },
  { key: '1y', label: '1Y', weeks: 52 },
  { key: 'all', label: 'All', weeks: Infinity },
]

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const rows = [...payload]
    .filter(p => p.value != null && p.strokeOpacity !== 0)
    .sort((a, b) => (b.value || 0) - (a.value || 0))
  if (!rows.length) return null
  return (
    <div className="chart-tooltip">
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>
        Week of {label}
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
// Data comes from the immutable weekly snapshots (sov_weekly) via useWeeklySOV.
export function SOVTrendChart({ competitors = [], metric = 'overall', yLabel = 'SOV %' }) {
  const { series } = useWeeklySOV(metric)
  const [rangeKey, setRangeKey] = useState('3m')
  const [hidden, setHidden] = useState(() => new Set())   // companies toggled off via legend
  const [active, setActive] = useState(null)              // legend-hovered company (spotlight)
  const [scope, setScope] = useState('all')               // 'all' | 'direct' — which competitor lines to draw

  const range = RANGES.find(r => r.key === rangeKey) || RANGES[1]
  const data = useMemo(() => {
    const n = range.weeks
    return (n !== Infinity && series.length > n) ? series.slice(series.length - n) : series
  }, [series, range.weeks])

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
        <p>Not enough history yet — weekly trends appear once a few weeks of mentions accumulate.</p>
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

  let colorIdx = 0
  return (
    <div className="trend-chart-wrap">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
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
        <div style={{ display: 'flex', gap: 6 }}>
          {RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setRangeKey(r.key)}
              style={{ ...pill, ...(r.key === rangeKey ? activePill : null) }}
            >
              {r.label}
            </button>
          ))}
        </div>
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
          <Tooltip content={<TrendTooltip />} />
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
            const color = twine ? 'var(--accent)' : LINE_COLORS[colorIdx++ % LINE_COLORS.length]
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
