import { useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer, ReferenceLine,
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

function TrendTooltip({ active, payload, label, isDaily, isSentiment }) {
  if (!active || !payload?.length) return null
  const rows = [...payload]
    .filter(p => p.value != null && p.strokeOpacity !== 0)
    .sort((a, b) => (b.value || 0) - (a.value || 0))
  if (!rows.length) return null
  const fmt = (v) => isSentiment
    ? `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}`   // −3..+3 sentiment scale
    : Number(v).toFixed(1)                            // 0..100 SOV %
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
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(p.value)}</span>
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
  // Sentiment is stored/computed as a 0..100 index but the whole app speaks the
  // −3..+3 per-post scale (stat cards, methodology). Convert on display so the
  // chart matches: raw = (idx/100)*6 − 3. Fixed −3..+3 axis with a 0 neutral line.
  const isSentiment = metric === 'sentiment_pct'
  const toDisplay = (v) => (v == null || isNaN(v)) ? v : (isSentiment ? Math.round(((v / 100) * 6 - 3) * 100) / 100 : v)
  const { series: frozenSeries } = useWeeklySOV(metric)
  const { series: dailySeries } = useDailySOV(windowDays === 30 ? 30 : 7, metric)
  const [hidden, setHidden] = useState(() => new Set())   // companies toggled off via legend
  const [active, setActive] = useState(null)              // legend-hovered company (spotlight)
  const [scope, setScope] = useState('direct')             // 'all' | 'direct' — which competitor lines to draw (default: direct)
  // Weekly (YTD) SOV has TWO valid readings and the chart offers both:
  //   'total'  — cumulative standing: the frozen weekly board (sov_weekly),
  //              i.e. everyone's overall SOV as of that week, decayed carryover
  //              from earlier weeks included. "Where does everyone stand?"
  //   'weekly' — isolated weeks: SOV recomputed over ONLY that week's items.
  //              "Who won that specific week?"
  // Only meaningful on the weekly overall-SOV chart: the 7d/30d daily views are
  // already trailing-window isolated, and sentiment is a per-period average
  // either way. Under a platform filter the frozen board can't be sliced, so
  // the chart is pinned to 'weekly' (which the live series already computes).
  const [mode, setMode] = useState('total')
  const modeApplies = !isDaily && metric === 'overall' && !!posts
  const effMode = !modeApplies ? null : (live ? 'weekly' : mode)
  // Tracked roster for zero-filling client-computed SOV series: in an isolated
  // week/window, a tracked company with no items is legitimately at 0% — its
  // line should touch 0, not gap out (or worse, get bridged by connectNulls at
  // an interpolated height). DIRECT actives only (the `posts` prop is the
  // direct-only working set, so 0-filling indirect names would fabricate flat-0
  // lines for companies whose data simply isn't in the input). SOV only —
  // sentiment has no honest zero-fill ("no rated items" is not a score of 0).
  const fillNames = useMemo(
    () => metric === 'overall'
      ? (competitors || [])
          .filter(c => c && c.active !== false && (c.type || 'direct') !== 'indirect')
          .map(c => c.name)
      : [],
    [competitors, metric]
  )
  const liveSeries = useMemo(() => {
    if (!live || !posts) return null
    if (isDaily) {
      return metric === 'sentiment_pct'
        ? rollingDailySentimentSeries(posts, { windowDays })
        : rollingDailySOVSeries(posts, config, { windowDays, fillZeroFor: fillNames })
    }
    return metric === 'sentiment_pct'
      ? weeklySentimentSeries(posts, { weeks: 52 })
      : weeklySOVSeries(posts, config, { weeks: 52, fillZeroFor: fillNames })
  }, [live, posts, metric, config, isDaily, windowDays, fillNames])
  // Isolated week-by-week series for the un-filtered weekly view ('weekly' mode).
  const isolatedSeries = useMemo(() => {
    if (live || effMode !== 'weekly' || !posts) return null
    return weeklySOVSeries(posts, config, { weeks: 52, fillZeroFor: fillNames })
  }, [live, effMode, posts, config, fillNames])
  // sov_daily only started accumulating on 2026-07-05 (one point per day). A
  // one-or-two-dot "line" chart reads as broken, so until the table has enough
  // history to draw a real line, compute the same trailing-window series
  // client-side from the full post history (identical to the platform-filtered
  // path). Once sov_daily has ≥5 points the precomputed board takes over.
  const dailyFallback = useMemo(() => {
    if (!isDaily || live || !posts || dailySeries.length >= 5) return null
    return metric === 'sentiment_pct'
      ? rollingDailySentimentSeries(posts, { windowDays })
      : rollingDailySOVSeries(posts, config, { windowDays, fillZeroFor: fillNames })
  }, [isDaily, live, posts, dailySeries.length, metric, config, windowDays, fillNames])
  const series = liveSeries || isolatedSeries || dailyFallback || (isDaily ? dailySeries : frozenSeries)

  const data = useMemo(() => {
    const n = isDaily ? MAX_DAILY_POINTS : MAX_WEEKLY_POINTS
    const sliced = series.length > n ? series.slice(series.length - n) : series
    if (!isSentiment) return sliced
    // Convert the 0..100 sentiment index to the −3..+3 scale for display.
    return sliced.map(row => {
      const out = { week: row.week }
      for (const k of Object.keys(row)) if (k !== 'week') out[k] = toDisplay(row[k])
      return out
    })
  }, [series, isDaily, isSentiment])

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
  // (only across lines that are currently shown). Sentiment zooms too — no
  // point rendering −3..0 when everyone is positive — just clamped to the
  // scale's true bounds (−3..+3) instead of SOV's 0..100.
  const yDomain = useMemo(() => {
    const [MIN, MAX] = isSentiment ? [-3, 3] : [0, 100]
    let lo = Infinity, hi = -Infinity
    for (const row of data) for (const n of lines) {
      if (hidden.has(n)) continue
      const v = row[n]
      if (v == null || isNaN(v)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    if (!isFinite(lo) || !isFinite(hi)) return isSentiment ? [MIN, MAX] : [0, 'auto']
    if (isSentiment) {
      // finer-grained scale: pad in tenths, round to 0.5 steps for clean ticks
      if (lo === hi) return [Math.max(MIN, lo - 0.5), Math.min(MAX, hi + 0.5)]
      const pad = Math.max(0.2, (hi - lo) * 0.15)
      const floorHalf = (v) => Math.floor(v * 2) / 2
      const ceilHalf = (v) => Math.ceil(v * 2) / 2
      return [Math.max(MIN, floorHalf(lo - pad)), Math.min(MAX, ceilHalf(hi + pad))]
    }
    // SOV % is bounded to 0..100 — never pad past it.
    if (lo === hi) return [Math.max(MIN, lo - 5), Math.min(MAX, hi + 5)]
    const pad = Math.max(2, (hi - lo) * 0.12)
    return [Math.max(MIN, Math.floor(lo - pad)), Math.min(MAX, Math.ceil(hi + pad))]
  }, [data, lines, hidden, isSentiment])
  // The dashed neutral (0) guide only makes sense while 0 is inside the zoomed band.
  const neutralVisible = isSentiment && yDomain[0] <= 0 && yDomain[1] >= 0
  // Clean half-step ticks across the zoomed sentiment band (domain endpoints are
  // already snapped to 0.5). undefined for SOV → recharts picks its own.
  const sentimentTicks = useMemo(() => {
    if (!isSentiment) return undefined
    const [lo, hi] = yDomain
    if (!isFinite(lo) || !isFinite(hi)) return undefined
    const step = (hi - lo) <= 3 ? 0.5 : 1
    const out = []
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 10) / 10)
    return out
  }, [isSentiment, yDomain])

  if (!data.length || !lines.length) {
    return (
      <div className="empty-state">
        <p>{live
          ? 'No posts on the selected platform(s) in this window — clear or widen the platform filter.'
          : isDaily
            ? 'Daily history is still building — one point is added per day. Switch to YTD for the full weekly trend.'
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
    // longhand (not the `border` shorthand) so activePill's borderColor never
    // conflicts — React logs a styling error when the two mix on rerender.
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)',
    color: 'var(--text-secondary)',
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
          {modeApplies && (
            <>
              <span aria-hidden style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 2px' }} />
              <button
                onClick={() => !live && setMode('total')}
                disabled={live}
                style={{ ...pill, ...(effMode === 'total' ? activePill : null), ...(live ? { opacity: 0.4, cursor: 'not-allowed' } : null) }}
                title={live
                  ? 'Standings are cross-platform only — clear the platform filter to see them.'
                  : 'The running scoreboard: where everyone stands as of each week, counting every mention so far.'}
              >
                Standings
              </button>
              <button
                onClick={() => setMode('weekly')}
                style={{ ...pill, ...(effMode === 'weekly' ? activePill : null) }}
                title="Each week scored on its own: only that week's mentions count, nothing carries over."
              >
                Week by week
              </button>
            </>
          )}
        </div>
        {(isDaily || metric !== 'overall') && (
          <span
            title={isDaily
              ? `One point per day; each point covers the ${windowDays} days before it. Set by the dashboard's Time window.`
              : 'One point per week.'}
            style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 8px' }}
          >
            {isDaily ? `each point = previous ${windowDays} days` : 'weekly'}
          </span>
        )}
      </div>
      {metric === 'overall' && (
        <p className="cr-sub" style={{ margin: '-2px 0 10px' }}>
          {isDaily
            ? `One point per day — each point is share of voice over the ${windowDays} days before it, so the newest point answers “who owned the conversation over the last ${windowDays === 7 ? 'week' : 'month'}?”`
            : effMode === 'weekly'
              ? 'One week at a time — each point only counts that week’s mentions. A clean “who won this week?”, with nothing carried over.'
              : 'The running scoreboard — each point is a company’s overall share of voice as of that week. Every mention so far counts, with older mentions slowly fading out.'}
        </p>
      )}
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
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
            allowDecimals={isSentiment}
            ticks={sentimentTicks}
            tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            label={{
              value: yLabel,
              angle: -90,
              position: 'insideLeft',
              offset: 22,   // pull the rotated label inward so it isn't clipped off the SVG's left edge
              style: { fill: 'var(--text-secondary)', fontSize: 12 },
            }}
          />
          {neutralVisible && (
            <ReferenceLine y={0} stroke="var(--text-secondary)" strokeOpacity={0.5} strokeDasharray="4 4"
              label={{ value: 'neutral', position: 'insideBottomRight', fill: 'var(--text-secondary)', fontSize: 10 }} />
          )}
          <Tooltip content={<TrendTooltip isDaily={isDaily} isSentiment={isSentiment} />} />
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
