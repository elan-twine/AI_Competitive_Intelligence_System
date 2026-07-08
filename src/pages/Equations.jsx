import { useState, useEffect, useRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import { AppHeader } from '../components/AppHeader'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceArea, ReferenceDot,
} from 'recharts'
import { GlassCard } from '../components/GlassCard'
import '../App.css'
import './equations.css'

/* ------------------------------------------------------------------ */
/*  Canonical worked example — ONE post followed end-to-end.          */
/*  Numbers are precomputed module constants (labelled "example"),    */
/*  never recomputed live, so display math can never drift.           */
/* ------------------------------------------------------------------ */
const EXAMPLE = {
  blurb: 'one competitor’s LinkedIn repost — 40 reactions, 6 comments, 3 reposts, has an image, sentiment +1, 6 days old, posted by someone outside the company.',
  stages: [
    { id: 'engagement', value: '89.5',  unit: 'eng' },
    { id: 'reach',      value: '81.8',  unit: 'reach' },
    { id: 'sentiment',  value: '+1',    unit: 'sentiment · display only' },
    { id: 'decay',      value: '1.0',   unit: '× decay' },
    { id: 'weight',     value: '168.6', unit: 'post_weight' },
    { id: 'author',     value: 'external', unit: 'B=5 · M=2' },
    { id: 'share',      value: '168.6', unit: 'pool units (× LinkedIn ×1)' },
    { id: 'blend',      value: '29.2%', unit: 'share of the pool' },
    { id: 'sov',        value: '29.2%', unit: 'SOV%' },
  ],
}
const trace = (id) => EXAMPLE.stages.find(s => s.id === id)

/* ------------------------------------------------------------------ */
/*  Small primitives                                                  */
/* ------------------------------------------------------------------ */
function TracePill({ value, unit }) {
  return (
    <span className="trace-pill" title="Running worked-example value">
      <span className="trace-pill-tag">EX</span>
      <span className="trace-pill-val">{value}</span>
      {unit && <span className="trace-pill-unit">{unit}</span>}
    </span>
  )
}

function Stage({ number, id, title, intuition, pill, children }) {
  return (
    <GlassCard className="card meth-card" style={{ scrollMarginTop: '96px' }} {...{ id }}>
      <div className="card-header meth-card-header">
        <div className="card-title">{title}</div>
        <span className="card-badge">{number}</span>
      </div>
      <p className="meth-intuition">{intuition}</p>
      {children}
      {pill && (
        <div className="meth-trace-row">
          <span className="meth-trace-label">running example</span>
          <TracePill value={pill.value} unit={pill.unit} />
        </div>
      )}
    </GlassCard>
  )
}

function EquationRow({ label, color, children, note }) {
  return (
    <div className="eq-row">
      {label && (
        <span className="eq-row-label">
          <span className="eq-dot" style={{ background: color }} />
          {label}
        </span>
      )}
      <code className="eq-formula">{children}</code>
      {note && <span className="eq-row-note">{note}</span>}
    </div>
  )
}

function Callout({ children }) {
  return <div className="meth-callout">{children}</div>
}

function Fraction({ num, den }) {
  return (
    <span className="meth-fraction">
      <span className="meth-frac-num">{num}</span>
      <span className="meth-frac-rule" />
      <span className="meth-frac-den">{den}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Chart tooltips (themed per SOVTrendChart conventions)             */
/* ------------------------------------------------------------------ */
function ReachTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>eng = {label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="chart-tooltip-value" style={{ color: 'var(--text-secondary)', display: 'flex', gap: 10, justifyContent: 'space-between' }}>
          <span style={{ color: p.color }}>{p.name}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Number(p.value).toFixed(1)}</span>
        </div>
      ))}
    </div>
  )
}

function DecayTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const rows = [...payload].sort((a, b) => (b.value || 0) - (a.value || 0))
  return (
    <div className="chart-tooltip">
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>day {label}</div>
      {rows.map(p => (
        <div key={p.dataKey} className="chart-tooltip-value" style={{ color: 'var(--text-secondary)', display: 'flex', gap: 10, justifyContent: 'space-between' }}>
          <span style={{ color: p.color }}>{p.name}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Number(p.value).toFixed(2)}</span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Visual 1 — HERO pipeline (pure inline SVG, doubles as visual TOC) */
/* ------------------------------------------------------------------ */
const HERO_NODES = [
  { id: 'engagement', label: 'Engagement', x: 18,  y: 88 },
  { id: 'reach',      label: 'Reach',      x: 158, y: 88 },
  { id: 'decay',      label: '× Decay', x: 298, y: 88 },
  { id: 'weight',     label: 'Per-item Weight', x: 438, y: 88 },
  { id: 'share',      label: '× Multiplier', x: 578, y: 88 },
]

function Hero({ active, onJump }) {
  const nodeW = 96, nodeH = 34
  const fill = (id) => (active === id ? 'var(--accent-dim)' : 'var(--inner-bg)')
  const stroke = (id) => (active === id ? 'var(--accent)' : 'var(--divider)')
  const txt = (id) => (active === id ? 'var(--accent)' : 'var(--text-secondary)')

  return (
    <div className="hero-wrap">
      <svg viewBox="0 0 860 200" width="100%" role="img" aria-label="Share of Voice pipeline flow diagram" className="hero-svg">
        {/* main flow rail: post → … → share → SOV (sentiment is NOT on this rail — decoupled 2026-07-07) */}
        <path d="M114 105 H158 M254 105 H298 M394 105 H438 M534 105 H578 M674 105 H772" stroke="var(--accent)" strokeWidth="2" fill="none" opacity="0.55" />

        {/* author fork: three tiers split before weight, rejoin at weight */}
        <path d="M378 105 C398 58, 416 58, 428 74" stroke="var(--text-muted)" strokeWidth="1.4" fill="none" opacity="0.7" />
        <path d="M378 105 C396 40, 422 40, 433 60" stroke="var(--meth-purple, #7a4ef5)" strokeWidth="1.4" fill="none" opacity="0.7" />
        <path d="M378 105 C398 152, 416 152, 428 136" stroke="var(--accent)" strokeWidth="1.4" fill="none" opacity="0.7" />
        <text x="396" y="70" className="hero-mini" fill="var(--text-muted)">company</text>
        <text x="398" y="36" className="hero-mini" fill="var(--meth-purple, #7a4ef5)">employee</text>
        <text x="394" y="168" className="hero-mini" fill="var(--accent)">external</text>

        {/* sentiment side-channel peels off the item and dead-ends — it never re-enters the score */}
        <path d="M206 122 C220 162, 220 176, 250 178" stroke="var(--neutral)" strokeWidth="1.4" strokeDasharray="3 3" fill="none" opacity="0.8" />
        <a onClick={() => onJump('sentiment')} style={{ cursor: 'pointer' }}>
          <rect x="250" y="166" width="150" height="26" rx="13" fill="var(--inner-bg)" stroke="var(--neutral)" strokeWidth="1" opacity="0.9" />
          <text x="325" y="183" textAnchor="middle" className="hero-mini" fill="var(--neutral)">Sentiment · display only</text>
        </a>

        {/* nodes */}
        {HERO_NODES.map(n => (
          <a key={n.id} onClick={() => onJump(n.id)} style={{ cursor: 'pointer' }}>
            <rect x={n.x} y={n.y} width={nodeW} height={nodeH} rx="9" fill={fill(n.id)} stroke={stroke(n.id)} strokeWidth="1" />
            <text x={n.x + nodeW / 2} y={n.y + nodeH / 2 + 4} textAnchor="middle" className="hero-node-text" fill={txt(n.id)}>{n.label}</text>
          </a>
        ))}

        {/* final SOV disc */}
        <a onClick={() => onJump('sov')} style={{ cursor: 'pointer' }}>
          <circle cx="810" cy="105" r="34" fill="var(--accent-dim)" stroke="var(--accent)" strokeWidth="1.5" />
          <text x="810" y="102" textAnchor="middle" className="hero-disc-text" fill="var(--accent)">SOV</text>
          <text x="810" y="116" textAnchor="middle" className="hero-disc-sub" fill="var(--accent)">%</text>
        </a>

        {/* entering post chip */}
        <g>
          <rect x="6" y="40" width="62" height="22" rx="11" fill="var(--inner-bg)" stroke="var(--divider)" strokeWidth="1" />
          <text x="37" y="55" textAnchor="middle" className="hero-mini" fill="var(--text-secondary)">1 item</text>
          <path d="M37 62 V80" stroke="var(--accent)" strokeWidth="1.4" opacity="0.5" />
        </g>
      </svg>
      <div className="hero-caption">One item, left to right. The lime rail is the score; the fork up top is who posted it; sentiment peels off as a display-only readout and never re-enters the score. Click any step to jump to it.</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Visual 2 — Engagement weight bars                                 */
/* ------------------------------------------------------------------ */
function EngWeightBars() {
  const sets = [
    { name: 'LinkedIn', color: 'var(--linkedin-color)', terms: [['reactions', 1], ['comments', 3], ['reposts', 10], ['image', 1.5]] },
    { name: 'X', color: 'var(--x-color)', terms: [['likes', 1], ['replies', 2], ['quotes', 4], ['reposts', 10]] },
    { name: 'Reddit', color: 'var(--reddit-color)', terms: [['upvotes', 1], ['comments', 3]] },
  ]
  const max = 10, trackW = 220, barH = 13, gap = 8, labelW = 96
  return (
    <div className="eng-bars">
      {sets.map(set => (
        <div key={set.name} className="eng-set">
          <div className="eng-set-name"><span className="eq-dot" style={{ background: set.color }} />{set.name}</div>
          <svg viewBox={`0 0 ${labelW + trackW + 40} ${set.terms.length * (barH + gap)}`} width="100%" className="eng-svg" role="img" aria-label={`${set.name} engagement coefficients`}>
            {set.terms.map((t, i) => {
              const [term, coef] = t
              const w = (coef / max) * trackW
              const big = coef === 10
              const y = i * (barH + gap)
              return (
                <g key={term}>
                  <text x={labelW - 8} y={y + barH - 2} textAnchor="end" className="eng-term">{term}</text>
                  <rect x={labelW} y={y} width={w} height={barH} rx="3" fill={big ? 'var(--accent)' : set.color} opacity={big ? 1 : 0.45} />
                  <text x={labelW + w + 6} y={y + barH - 2} className="eng-coef">×{coef}</text>
                </g>
              )
            })}
          </svg>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Visual 3 — Reach curve                                            */
/* ------------------------------------------------------------------ */
const REACH_DATA = (() => {
  const out = []
  for (let e = 0; e <= 500; e += 20) {
    out.push({ eng: e, reach: e === 0 ? 0 : Math.pow(e, 49 / 50), linear: e })
  }
  return out
})()

function ReachCurve() {
  return (
    <div className="trend-chart-wrap">
      <div className="chart-clip">
        <ResponsiveContainer width="100%" height={170}>
          <LineChart data={REACH_DATA} margin={{ top: 8, right: 18, bottom: 4, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.25} vertical={false} />
            <XAxis dataKey="eng" type="number" domain={[0, 500]} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--border)', opacity: 0.4 }} />
            <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} tickLine={false} axisLine={false} width={42} />
            <Tooltip content={<ReachTip />} />
            <Line type="monotone" dataKey="linear" name="y = x (linear ref)" stroke="var(--text-muted)" strokeWidth={1.4} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="reach" name="reach = eng^(49/50)" stroke="var(--accent)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            <ReferenceDot x={89.5} y={81.8} r={4} fill="var(--accent)" stroke="#0B0D00" strokeWidth={1} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-note">exponent 49/50 ≈ 0.98 — almost linear; the bend just keeps a viral outlier from dwarfing everything. Dot = example (eng 89.5 → reach ≈ 81.8).</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Visual 4 — sentiment display scale (NOT a weight input)           */
/* ------------------------------------------------------------------ */
function SentimentScale() {
  // sentiment -3..+3 on the display scale; example item scored +1
  const W = 700, H = 64, padL = 8, padR = 8
  const span = W - padL - padR
  const xAt = (s) => padL + ((s + 3) / 6) * span
  const ticks = [
    { s: -3, out: 'very negative' },
    { s: 0, out: 'neutral' },
    { s: 3, out: 'very positive' },
  ]
  return (
    <div className="ramp-wrap">
      <svg viewBox={`0 0 ${W} ${H + 34}`} width="100%" role="img" aria-label="sentiment display scale">
        <defs>
          <linearGradient id="sentGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--negative)" />
            <stop offset="50%" stopColor="var(--neutral)" />
            <stop offset="100%" stopColor="var(--positive)" />
          </linearGradient>
        </defs>
        <rect x={padL} y="8" width={span} height="20" rx="10" fill="url(#sentGrad)" opacity="0.85" />
        {ticks.map(t => (
          <g key={t.s}>
            <line x1={xAt(t.s)} y1="4" x2={xAt(t.s)} y2="32" stroke="var(--text-muted)" strokeWidth="1" />
            <text x={xAt(t.s)} y="46" textAnchor="middle" className="ramp-tick">sent {t.s > 0 ? '+' : ''}{t.s}</text>
            <text x={xAt(t.s)} y="60" textAnchor="middle" className="ramp-out">{t.out}</text>
          </g>
        ))}
        {/* example marker at +1 */}
        <g>
          <polygon points={`${xAt(1)},2 ${xAt(1) - 5},-6 ${xAt(1) + 5},-6`} fill="var(--accent)" transform="translate(0,8)" />
          <circle cx={xAt(1)} cy="18" r="5" fill="#0B0D00" stroke="var(--accent)" strokeWidth="1.5" />
          <text x={xAt(1)} y="60" textAnchor="middle" className="ramp-mark">+1 · this item</text>
        </g>
      </svg>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Visual 5 — Decay curves                                           */
/* ------------------------------------------------------------------ */
const DECAY_PLATFORMS = [
  { key: 'X', half: 7, color: 'var(--x-color)' },
  { key: 'Reddit', half: 10, color: 'var(--reddit-color)' },
  { key: 'LinkedIn', half: 14, color: 'var(--linkedin-color)' },
  { key: 'News', half: 30, color: 'var(--news-color)' },
]
const DECAY_DATA = (() => {
  const out = []
  for (let d = 0; d <= 60; d += 2) {
    const row = { day: d }
    for (const p of DECAY_PLATFORMS) row[p.key] = d <= 7 ? 1 : Math.pow(2, -d / p.half)
    out.push(row)
  }
  return out
})()

function DecayCurves() {
  return (
    <div className="trend-chart-wrap">
      <div className="chart-clip">
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={DECAY_DATA} margin={{ top: 8, right: 18, bottom: 4, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.25} vertical={false} />
            <ReferenceArea x1={0} x2={7} fill="var(--accent)" fillOpacity={0.08} />
            <XAxis dataKey="day" type="number" domain={[0, 60]} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--border)', opacity: 0.4 }} ticks={[0, 7, 14, 30, 45, 60]} />
            <YAxis domain={[0, 1]} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} tickLine={false} axisLine={false} width={40} />
            <Tooltip content={<DecayTip />} />
            {DECAY_PLATFORMS.map(p => (
              <Line key={p.key} type="monotone" dataKey={p.key} name={`${p.key} (${p.half}d)`} stroke={p.color} strokeWidth={p.key === 'X' ? 2.5 : 1.8} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend-inline">
        {DECAY_PLATFORMS.map(p => (
          <span key={p.key} className="cl-item"><span className="eq-dot" style={{ background: p.color }} />{p.key} · {p.half}d</span>
        ))}
        <span className="cl-item cl-grace">shaded = 7-day grace (decay = 1.0)</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Visual 6 — Per-post weight assembly bus                           */
/* ------------------------------------------------------------------ */
function WeightBus() {
  return (
    <div className="bus-wrap">
      <div className="bus-row">
        <span className="bus-tile bus-prefix">B + reach·M</span>
        <span className="bus-op">×</span>
        <span className="bus-core">
          <span className="bus-tile">reach</span>
          <span className="bus-op">×</span>
          <span className="bus-tile">decay</span>
        </span>
        <span className="bus-eq">=</span>
        <span className="bus-tile bus-out">post_weight</span>
      </div>
      <div className="bus-core-label">shared core (reach · decay) is identical on every platform; only the front factor changes</div>
      <div className="bus-example">
        example (external author): (5 + 81.8·2) · 1.0 ≈ <strong>168.6</strong>
      </div>
      <table className="meth-table">
        <thead>
          <tr><th>LinkedIn & X author</th><th>B (baseline)</th><th>M (reach mult)</th><th>why</th></tr>
        </thead>
        <tbody>
          <tr><td>own item (company page / own tweet)</td><td>1</td><td>1.0</td><td>impressions floor</td></tr>
          <tr className="meth-table-emp"><td>employee</td><td>2</td><td>1.2</td><td>closer to earned, still an insider</td></tr>
          <tr className="meth-table-hl"><td>external / earned</td><td>5</td><td>2.0</td><td>new eyes worth most</td></tr>
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Visual 7 — Author-type fork                                       */
/* ------------------------------------------------------------------ */
function AuthorFork() {
  return (
    <div className="fork-wrap">
      <div className="fork-q">Who posted it?<br /><span className="fork-q-sub">own page matched by LinkedIn URN · employees by classifier or company-in-headline · everyone else is external</span></div>
      <div className="fork-branches">
        <div className="fork-branch">
          <span className="fork-yn fork-yes">OWN PAGE</span>
          <div className="fork-pill">
            <div className="fork-pill-title">COMPANY</div>
            <div className="fork-pill-sub">B = 1 · M = 1.0</div>
            <div className="fork-pill-note">impressions floor</div>
          </div>
        </div>
        <div className="fork-branch">
          <span className="fork-yn fork-emp">STAFF</span>
          <div className="fork-pill fork-pill-employee">
            <div className="fork-pill-title">EMPLOYEE</div>
            <div className="fork-pill-sub">B = 2 · M = 1.2</div>
            <div className="fork-pill-note">human voice, still inside</div>
          </div>
        </div>
        <div className="fork-branch">
          <span className="fork-yn fork-no">ANYONE ELSE</span>
          <div className="fork-pill fork-pill-accent">
            <div className="fork-pill-title">EXTERNAL</div>
            <div className="fork-pill-sub">B = 5 · M = 2.0</div>
            <div className="fork-pill-note">earned = new eyes</div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Visual 8 — The cross-platform mindshare pool                      */
/* ------------------------------------------------------------------ */
function SharePoolBar() {
  // one pooled ~577-unit period (all platforms, common units); example = 168.6 units → 29.2%
  const segments = [
    { name: 'this company', val: 168.6, accent: true },
    { name: 'competitor B', val: 150 },
    { name: 'competitor C', val: 128 },
    { name: 'others', val: 130.5 },
  ]
  const total = segments.reduce((s, seg) => s + seg.val, 0)
  const W = 700, H = 38
  // Pre-compute each segment's left offset (purely functional render).
  const offsets = segments.reduce((acc, seg) => [...acc, acc[acc.length - 1] + (seg.val / total) * W], [0])
  return (
    <div className="pool-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="cross-platform mindshare pool">
        {segments.map((seg, i) => {
          const w = (seg.val / total) * W
          const x = offsets[i]
          return (
            <g key={seg.name}>
              <rect x={x} y="0" width={w - 1.5} height={H} rx="5" fill={seg.accent ? 'var(--accent)' : 'var(--inner-bg)'} stroke={seg.accent ? 'var(--accent)' : 'var(--divider)'} strokeWidth="1" />
              <text x={x + (w / 2)} y={H / 2 + 4} textAnchor="middle" className="pool-seg-text" fill={seg.accent ? '#0B0D00' : 'var(--text-secondary)'}>
                {seg.accent ? '29.2%' : ''}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="pool-note">
        SOV = <Fraction num="168.6 units (this company, all platforms)" den="577.1 units (all direct competitors, all platforms)" /> = <strong>29.2%</strong>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Visual 9 — Cross-platform exchange rates (trust multipliers)      */
/* ------------------------------------------------------------------ */
const MULTIPLIERS = [
  { name: 'LinkedIn', m: 1, color: 'var(--linkedin-color)', why: 'vendor-social baseline' },
  { name: 'X', m: 1, color: 'var(--x-color)', why: 'vendor-social baseline' },
  { name: 'Reddit', m: 3, color: 'var(--reddit-color)', why: 'peer / community trust' },
  { name: 'Google News', m: 30, color: 'var(--news-color)', why: 'editorial trust × article reach' },
]
function MultiplierBars() {
  const max = 30, trackW = 480, barH = 16, gap = 12, labelW = 110
  return (
    <div className="blend-wrap">
      <div className="blend-bar-label">Cross-platform exchange rates (trust-weighted)</div>
      <svg viewBox={`0 0 ${labelW + trackW + 60} ${MULTIPLIERS.length * (barH + gap)}`} width="100%" role="img" aria-label="platform multipliers — cross-platform exchange rates">
        {MULTIPLIERS.map((p, i) => {
          const w = Math.max((p.m / max) * trackW, 14)
          const y = i * (barH + gap)
          return (
            <g key={p.name}>
              <text x={labelW - 8} y={y + barH - 3} textAnchor="end" className="eng-term">{p.name}</text>
              <rect x={labelW} y={y} width={w} height={barH} rx="4" fill={p.color} opacity="0.85" />
              <text x={labelW + w + 6} y={y + barH - 3} className="eng-coef">×{p.m}</text>
            </g>
          )
        })}
      </svg>
      <div className="blend-legend">
        {MULTIPLIERS.map(p => (
          <span key={p.name} className="cl-item"><span className="eq-dot" style={{ background: p.color }} />{p.name} ×{p.m} — {p.why}</span>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Visual 10 — SOV% keystone (weighted-share IS the number)          */
/* ------------------------------------------------------------------ */
function SovKeystone() {
  return (
    <div className="sov-key-wrap">
      <GlassCard className="stat-card sov-stat" intensity={8}>
        <div className="label">HEADLINE SOV%</div>
        <div className="value accent">29.2</div>
        <div className="sub">your share of the mindshare pool</div>
      </GlassCard>
      <div className="sov-micro">
        That’s it — SOV% <em>is</em> your share of the pooled, trust-weighted attention. <strong>Direct</strong> competitors sum to exactly 100%; <strong>indirect</strong> ones are tracked and graphed but left out of the %.
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Visual 11 — Sentiment side-channel sparkline                      */
/* ------------------------------------------------------------------ */
const SENT_DATA = [
  { w: 'W1', s: 0.4 }, { w: 'W2', s: 0.7 }, { w: 'W3', s: 0.5 },
  { w: 'W4', s: 0.9 }, { w: 'W5', s: 1.1 }, { w: 'W6', s: 0.8 }, { w: 'W7', s: 1.2 },
]
function SentimentSpark() {
  return (
    <div className="trend-chart-wrap">
      <div className="chart-clip">
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={SENT_DATA} margin={{ top: 8, right: 18, bottom: 4, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.25} vertical={false} />
            <XAxis dataKey="w" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--border)', opacity: 0.4 }} />
            <YAxis domain={[-3, 3]} ticks={[-3, 0, 3]} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} tickLine={false} axisLine={false} width={28} />
            <Tooltip content={<ReachTip />} />
            <Line type="monotone" dataKey="s" name="avg external sentiment" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 2.5, fill: 'var(--accent)', strokeWidth: 0 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-note">Illustrative weekly trend over EXTERNAL items only.</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Footer glossary                                                   */
/* ------------------------------------------------------------------ */
const GLOSSARY = [
  ['Share of Voice', 'your share of the pooled cross-platform attention, 0–100%'],
  ['direct competitor', 'counted in SOV%; the set sums to 100%'],
  ['indirect competitor', 'tracked and graphed, but left out of SOV%'],
  ['eng', 'an item’s interactions, weighted by type'],
  ['reach', 'eng^(49/50) — eyeballs, gently flattened'],
  ['sentiment', 'tone score, −3…+3, external items only; display-only — decoupled from the weight 2026-07-07'],
  ['decay', 'age weighting; 7-day grace then halving'],
  ['post_weight', 'one item’s final score (reach × freshness, scaled by author)'],
  ['author tier', 'company ×1 · employee ×2 · external ×5 (baseline B; reach mult M = 1 / 1.2 / 2) — LinkedIn and X'],
  ['platform multiplier', 'the cross-platform exchange rate: LinkedIn ×1 · X ×1 · Reddit ×3 · News ×30 (trust-weighted)'],
  ['pool units', 'post_weight × platform multiplier — one item’s contribution to the shared attention pool'],
]

/* ------------------------------------------------------------------ */
/*  Rail (sticky mini-TOC)                                            */
/* ------------------------------------------------------------------ */
const STAGE_IDS = [
  'intro', 'engagement', 'reach', 'sentiment', 'decay', 'weight',
  'author', 'share', 'blend', 'sov', 'sentiment-metric',
]

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */
export default function Equations({ onLogout, onNavigate }) {
  const [activeStage, setActiveStage] = useState('intro')
  const obsRef = useRef(null)

  useEffect(() => {
    const els = STAGE_IDS.map(id => document.getElementById(id)).filter(Boolean)
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting)
        if (visible.length) {
          // pick the topmost intersecting section
          visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
          setActiveStage(visible[0].target.id)
        }
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: 0 }
    )
    els.forEach(el => observer.observe(el))
    obsRef.current = observer
    return () => observer.disconnect()
  }, [])

  const jump = (id) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // hero highlight maps the author/blend/sov ids back to a hero node
  const heroActive = ['engagement', 'reach', 'decay', 'weight', 'share'].includes(activeStage)
    ? activeStage
    : (activeStage === 'author' ? 'weight' : (['blend', 'sov', 'sentiment-metric'].includes(activeStage) ? 'sov' : null))

  return (
    <div className="app">
      <AppHeader page="Methodology" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="meth-layout">
        {/* sticky flow rail */}
        <nav className="meth-rail" aria-label="Pipeline stages">
          {STAGE_IDS.map((id, i) => (
            <button
              key={id}
              className={`meth-rail-dot ${activeStage === id ? 'active' : ''}`}
              onClick={() => jump(id)}
              aria-label={`Jump to stage ${i}`}
              title={id}
            >
              <span className="meth-rail-tick" />
            </button>
          ))}
        </nav>

        <main className="meth-page">
          {/* 0 — INTRO */}
          <GlassCard className="card meth-card" style={{ scrollMarginTop: '96px' }} id="intro">
            <div className="meth-eyebrow">THE MATH</div>
            <h2 className="meth-title">How an item becomes Share of Voice</h2>
            <p className="meth-thesis">
              <strong className="meth-lede">Share of Voice is how much of the conversation you own versus your direct competitors.</strong>
              {' '}Think of one big room where everyone’s talking about the market: SOV% is the share of that noise that’s about you.
            </p>
            <p className="meth-thesis">
              Each week we read every public mention across LinkedIn, Google News, Reddit, and X, score it by how much
              attention it actually earned, and add up each company’s share. Below: follow one item from raw likes to a
              single percentage.
            </p>
            <p className="meth-thesis">
              A SOV “week” runs <strong>Thursday → Wednesday</strong> and is labelled by its Thursday date — scrapes
              run Thursday mornings, so every mention lands in the week that opens with the run that caught it.
            </p>
            <Callout>
              The dashboard’s SOV trend has two toggle views. <strong>Standings</strong> is the cumulative frozen weekly
              board — every mention so far, with older ones decaying. <strong>Week by week</strong> recomputes SOV over
              only that ISO week’s items, so each point is that week in isolation.
            </Callout>
            <Hero active={heroActive} onJump={jump} />
            <Callout>
              <strong>The item we’ll follow:</strong> {EXAMPLE.blurb}
            </Callout>
          </GlassCard>

          {/* 1 — ENGAGEMENT */}
          <Stage number="1" id="engagement" title="Engagement"
            intuition="Add up the interactions — but the ones that spread an item count for more."
            pill={trace('engagement')}>
            <EquationRow label="LinkedIn" color="var(--linkedin-color)">
              eng = 1·reactions + 3·comments + 10·reposts (+1.5 if image)
            </EquationRow>
            <EquationRow label="X" color="var(--x-color)">
              eng = 1·likes + 2·replies + 10·reposts + 4·quotes
            </EquationRow>
            <EquationRow label="Reddit" color="var(--reddit-color)">
              eng = 1·upvotes + 3·comments
            </EquationRow>
            <Callout>A repost counts ×10 — it puts the item in front of a whole new audience, not just a thumbs-up.</Callout>
            <EngWeightBars />
            <div className="meth-example-line">example: 40 + 3·6 + 10·3 + 1.5 = <strong>89.5</strong></div>
          </Stage>

          {/* 2 — REACH */}
          <Stage number="2" id="reach" title="Reach"
            intuition="Turn engagement into a rough audience size, so one viral item can’t dominate."
            pill={trace('reach')}>
            <EquationRow label="default" color="var(--text-muted)">reach = eng^(49/50)</EquationRow>
            <EquationRow label="News" color="var(--news-color)" note="presence is the signal">reach = 1</EquationRow>
            <Callout>
              X reports view counts, but we deliberately don’t use them (dropped 2026-07-08): a view is
              “scrolled past”, not a considered thought — and it isn’t unique. Every platform is scored on
              engagement only, because engagement is what measures considered attention.
            </Callout>
            <ReachCurve />
            <div className="meth-example-line">example: 89.5^0.98 ≈ <strong>81.8</strong></div>
          </Stage>

          {/* 3 — SENTIMENT (measured here, decoupled from the score 2026-07-07) */}
          <Stage number="3" id="sentiment" title="Sentiment (measured, not weighted)"
            intuition="Tone is scored per item and charted next to SOV% — it does not touch the weight."
            pill={trace('sentiment')}>
            <div className="meth-fence-label">DISPLAY METRIC · NOT IN SOV%</div>
            <EquationRow>sentiment = clamp(LLM tone score, −3, +3) — external items only</EquationRow>
            <Callout>
              <strong>Decoupled 2026-07-07.</strong> Sentiment used to multiply each item’s weight by 0.5–1.3
              (0.5 very negative → 0.9 neutral → 1.3 very positive). That multiplier is now switched off — the
              pipeline’s sentiment clamp is collapsed to 1.0 — so tone can never move the ranking. SOV% measures
              purely how much you’re talked about; sentiment stays on the dashboard as a paired metric showing how
              it landed, which is also the industry-standard treatment.
            </Callout>
            <SentimentScale />
            <div className="meth-example-line">example: sentiment +1 → shown on the dashboard; weight unchanged</div>
          </Stage>

          {/* 4 — TIME DECAY */}
          <Stage number="4" id="decay" title="Time decay"
            intuition="Recent buzz matters most. Full credit for a week, then it fades."
            pill={trace('decay')}>
            <EquationRow>decay = ageDays ≤ 7 ? 1 : 2^(−ageDays / halfLife)</EquationRow>
            <div className="meth-halflives">
              Half-lives: <b style={{ color: 'var(--linkedin-color)' }}>LinkedIn 14d</b> · <b style={{ color: 'var(--news-color)' }}>Google News 30d</b> · <b style={{ color: 'var(--reddit-color)' }}>Reddit 10d</b> · <b style={{ color: 'var(--x-color)' }}>X 7d</b> (X fastest / ephemeral, News slowest / evergreen)
            </div>
            <DecayCurves />
            <div className="meth-example-line">example: 6 days ≤ 7 → decay = <strong>1.0</strong></div>
          </Stage>

          {/* 5 — PER-POST WEIGHT */}
          <Stage number="5" id="weight" title="Per-item weight"
            intuition="One item’s final score: reach × freshness, scaled by who posted it."
            pill={trace('weight')}>
            <EquationRow label="LinkedIn" color="var(--linkedin-color)">
              post_weight = (B<sub>author</sub> + reach·M<sub>author</sub>) · decay
            </EquationRow>
            <EquationRow label="X" color="var(--x-color)" note="same ternary tiers as LinkedIn">
              post_weight = (B<sub>author</sub> + reach·M<sub>author</sub>) · decay
            </EquationRow>
            <EquationRow label="Reddit" color="var(--reddit-color)">post_weight = reach · decay</EquationRow>
            <EquationRow label="News" color="var(--news-color)">post_weight = tierMult · decay</EquationRow>
            <Callout>No tone term. Until 2026-07-07 every chain above also carried a <code className="eq-inline">· sentMult</code> factor (0.5–1.3); it’s now decoupled — see step 3.</Callout>
            <Callout>News <code className="eq-inline">tierMult</code> weights an article by its outlet, matched on domain: Tier-1 security press (The Hacker News, Dark Reading, BleepingComputer, SecurityWeek…) ×2.5 · mainstream/business tech ×1.5 · neutral ×1 · PR wires (Business Wire, PR Newswire — self-placed, not earned) ×0.5. The domain→tier map is versioned in the pipeline config; it replaced an earlier per-article credibility score that the daily re-age silently dropped.</Callout>
            <WeightBus />
            <div className="meth-example-line">example (external author): (5 + 81.8·2) · 1.0 ≈ <strong>168.6</strong></div>
          </Stage>

          {/* 6 — AUTHOR TYPE */}
          <Stage number="6" id="author" title="Who posted it?"
            intuition="Your own page bragging counts for less than someone else choosing to talk about you."
            pill={trace('author')}>
            <p className="meth-body">
              Three tiers. An item is <code className="eq-inline">company</code> if it comes from the company’s own
              page (LinkedIn URN match); <code className="eq-inline">employee</code> if a verified staff member posted
              it (employee classifier, or the company named in their headline) — a human voice, worth a bit more than
              the brand account but still inside; otherwise it’s <code className="eq-inline">external</code> — earned
              attention, worth the most. This switch sets the B and M factors in step 5.
            </p>
            <AuthorFork />
            <Callout><strong>X uses the same three tiers.</strong> A company’s own tweets (author handle == its tracked x_handle) score B=1 · M=1 and count least — the earned-attention principle taken to its logical end — while everyone else’s tweets are external (B=5 · M=2). The old follower-tier author boost is gone (2026-07-08): what matters is whose words they are, not how many followers they have.</Callout>
            <div className="meth-example-line">example: posted by an outsider → <strong>external (B=5, M=2)</strong></div>
          </Stage>

          {/* 7 — CONVERT TO ONE SCALE */}
          <Stage number="7" id="share" title="Convert to one scale"
            intuition="Multiply each item’s weight by its platform’s exchange rate, so every platform lands on one common considered-attention scale."
            pill={trace('share')}>
            <EquationRow>pool units = post_weight × platform multiplier</EquationRow>
            <Callout>
              Multipliers: <strong>LinkedIn ×1 · X ×1 · Reddit ×3 · Google News ×30</strong>. They’re trust ratios
              grounded in B2B buyer research — buyers put roughly 3× more stock in peer/community discussion, and
              about 2× more in editorial press, than in vendor social (6sense 2025: 73% rank word-of-mouth #1;
              Gartner: ~79% call peer reviews most trustworthy; TrustRadius: 54% consult peers vs 15% vendor
              content; Edelman–LinkedIn 2025: 73% trust thought leadership over vendor marketing). News ×30 =
              trust (≈2) × reach scale (≈15 — one tier-1 article is read by thousands of buyers, not one feed’s
              worth of scrollers); it’s the team-tunable dial, versioned in the pipeline config. So a fresh tier-1
              article = 2.5 × 30 = <strong>75 units</strong> ≈ 75 LinkedIn engagements.
            </Callout>
            <MultiplierBars />
            <div className="meth-example-line">example: 168.6 × LinkedIn ×1 = <strong>168.6 units</strong> into the pool</div>
          </Stage>

          {/* 8 — SHARE OF THE POOL */}
          <Stage number="8" id="blend" title="Share of the pool"
            intuition="Every item from every platform pools together; your SOV is your units divided by everyone’s."
            pill={trace('blend')}>
            <div className="eq-frac-block">
              SOV% = <Fraction num="Σ multiplier · post_weight — this company, all platforms" den="Σ multiplier · post_weight — all DIRECT competitors, all platforms" /> × 100
            </div>
            <Callout>
              Platform influence is <strong>emergent, not entitled</strong>: there’s no preset per-platform budget
              and no minimum-volume cutoff. A quiet platform simply contributes the few units it actually earned;
              a loud one contributes more. One big room, one pool of considered attention.
            </Callout>
            <SharePoolBar />
            <div className="meth-example-line">example: 168.6 units of a ~577-unit pool → <strong>29.2%</strong></div>
          </Stage>

          {/* 9 — HEADLINE SOV% */}
          <Stage number="9" id="sov" title="The number: SOV%"
            intuition="Your share of the pool IS your Share of Voice. No extra step."
            pill={trace('sov')}>
            <EquationRow>SOV% = your pool units ÷ the whole pool × 100</EquationRow>
            <Callout>
              <strong>Why nothing else?</strong> Posting more already lifts your score — more items means more
              units in the pool. Adding a separate “how often” term would count volume twice, so we don’t.
            </Callout>
            <SovKeystone />
          </Stage>

          {/* 10 — SENTIMENT (display metric) */}
          <Stage number="10" id="sentiment-metric" title="Sentiment (shown, not scored)"
            intuition="How the market feels about you — tracked next to SOV%, never folded into it.">
            <div className="meth-fence-label">DISPLAY METRIC · NOT IN SOV%</div>
            <p className="meth-body">
              The dashboard also shows average sentiment over <strong>external items only</strong> — a company’s own
              posts never count toward its sentiment, so this is earned perception rather than self-promo. It’s its own
              column and weekly trend, kept fully separate from the score.
            </p>
            <SentimentSpark />
          </Stage>

          {/* 12 — FOOTER GLOSSARY */}
          <GlassCard className="card meth-card" id="glossary">
            <div className="meth-eyebrow">GLOSSARY</div>
            <div className="meth-glossary">
              {GLOSSARY.map(([term, def]) => (
                <div key={term} className="meth-gloss-item">
                  <span className="chip meth-gloss-term">{term}</span>
                  <span className="meth-gloss-def">{def}</span>
                </div>
              ))}
            </div>
            <div className="growth-footnote meth-footer">
              <span>Static reference — no live data. Numbers labelled “example” are illustrative. The board only shows data from 2026-06-22 onward, when the current model was deployed; earlier data is excluded.</span>
              {onNavigate && (
                <button className="meth-back-link" onClick={() => onNavigate('dashboard')}>
                  <ArrowLeft size={14} /> Back to dashboard
                </button>
              )}
            </div>
          </GlassCard>
        </main>
      </div>
    </div>
  )
}
