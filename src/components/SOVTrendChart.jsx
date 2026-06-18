import { useMemo } from 'react'
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

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  // Sort entries high → low so the strongest competitor reads first.
  const rows = [...payload]
    .filter(p => p.value != null)
    .sort((a, b) => (b.value || 0) - (a.value || 0))
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

// `posts` — the same allPosts array Dashboard already has (post-filtered is fine)
// `competitors` — the active competitor list (drives which lines to draw)
// `config` — SOV config (platform weights, min-volume guard)
// `weeks` — most-recent N weeks to show (default 12)
export function SOVTrendChart({ competitors = [], weeks = 12 }) {
  // Frozen weekly board snapshots (forward-filled) from the sov_weekly table —
  // each point is that week's current SOV score, not a re-decayed recompute.
  const { series } = useWeeklySOV('overall')
  const data = useMemo(
    () => (weeks > 0 && series.length > weeks ? series.slice(series.length - weeks) : series),
    [series, weeks]
  )

  // Lines to draw: active competitors that actually appear somewhere in the
  // series (so we don't render empty/legend-only lines). Fall back to whatever
  // companies are present in the data if no competitor list was provided.
  const lines = useMemo(() => {
    const present = new Set()
    for (const row of data) {
      for (const k of Object.keys(row)) {
        if (k !== 'week') present.add(k)
      }
    }
    const active = (competitors || [])
      .filter(c => c && c.active !== false)
      .map(c => c.name)
    const names = active.length
      ? active.filter(n => present.has(n))
      : [...present]
    // Stable order: Twine first (it's the hero line), then alphabetical.
    return names.sort((a, b) => {
      if (isTwine(a) && !isTwine(b)) return -1
      if (isTwine(b) && !isTwine(a)) return 1
      return a.localeCompare(b)
    })
  }, [data, competitors])

  if (!data.length || !lines.length) {
    return (
      <div className="empty-state">
        <p>Not enough history yet — weekly trends appear once a few weeks of mentions accumulate.</p>
      </div>
    )
  }

  let colorIdx = 0
  return (
    <div className="trend-chart-wrap">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.25} vertical={false} />
          <XAxis
            dataKey="week"
            tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)', opacity: 0.4 }}
          />
          <YAxis
            domain={[0, 'auto']}
            tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            label={{
              value: 'SOV score',
              angle: -90,
              position: 'insideLeft',
              style: { fill: 'var(--text-secondary)', fontSize: 12 },
            }}
          />
          <Tooltip content={<TrendTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }} />
          {lines.map(name => {
            const twine = isTwine(name)
            const color = twine ? 'var(--accent)' : LINE_COLORS[colorIdx++ % LINE_COLORS.length]
            return (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                name={name}
                stroke={color}
                strokeWidth={twine ? 3.5 : 1.75}
                dot={{ r: twine ? 3 : 2, strokeWidth: 0, fill: color }}
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
