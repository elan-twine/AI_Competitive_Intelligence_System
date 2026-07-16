import { useMemo, useState } from 'react'
import { Bot, Download, Info, Search } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts'
import { GlassCard } from './GlassCard'
import { useGeoVisibility } from '../hooks/useGeoVisibility'
import { colorForCompany, isTwine } from '../lib/colors'
import { downloadCSV } from '../lib/csv'
import './aiVisibility.css'

// AI Visibility (GEO / AEO) — how often each tracked company is NAMED when a
// buyer asks an AI assistant one of the identity-security questions we track,
// with web search on. This is the "generative / answer engine optimization"
// surface: where 51% of B2B software buyers now start their research. Reads the
// versioned prompt panel in `geo_prompts` and the weekly answers in
// `geo_results` (see useGeoVisibility). All aggregation is client-side over the
// latest week, per selected engine.

const TWINE = 'Twine Security'

const ENGINE_LABELS = {
  openai: 'ChatGPT (OpenAI)',
  anthropic: 'Claude (Anthropic)',
  perplexity: 'Perplexity',
}
const engineLabel = e => ENGINE_LABELS[e] || e

const pct = (n, d) => (d ? (n / d) * 100 : 0)
const mean = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)
const fmtPos = p => (p == null ? '—' : `#${p.toFixed(1)}`)

// Latest run per prompt for a given engine (a prompt could be sampled more than
// once in a week — keep the newest by run_date). Returns Map<prompt_id, row>.
function latestByPrompt(rows) {
  const map = new Map()
  for (const r of rows) {
    const prev = map.get(r.prompt_id)
    if (!prev || (r.run_date || '') > (prev.run_date || '')) map.set(r.prompt_id, r)
  }
  return map
}

// Company visibility over a set of answered rows. Counts each company once per
// prompt (first mention wins its position), so visibility = share of prompts
// where the company appears.
function aggregate(answeredRows) {
  const comp = new Map()
  for (const row of answeredRows) {
    const seen = new Set()
    for (const m of row.mentions || []) {
      const name = m?.company
      if (!name || seen.has(name)) continue
      seen.add(name)
      if (!comp.has(name)) comp.set(name, { count: 0, positions: [] })
      const c = comp.get(name)
      c.count += 1
      if (m.position != null) c.positions.push(Number(m.position))
    }
  }
  const n = answeredRows.length
  const list = [...comp.entries()].map(([company, v]) => ({
    company,
    count: v.count,
    visibility: pct(v.count, n),
    avgPosition: mean(v.positions),
  }))
  list.sort((a, b) =>
    b.visibility - a.visibility || (a.avgPosition ?? 99) - (b.avgPosition ?? 99))
  return list
}

function LeaderTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="chart-tooltip">
      <div style={{ fontWeight: 600, marginBottom: 2, color: 'var(--text-primary)' }}>{d.company}</div>
      <div className="chart-tooltip-value" style={{ color: 'var(--text-secondary)' }}>
        Named in {d.visibility.toFixed(0)}% of prompts ({d.count})<br />
        Avg rank when named: {fmtPos(d.avgPosition)}
      </div>
    </div>
  )
}

// End-of-bar label: "42% · #2.1" so both the visibility and the avg rank read
// straight off the leaderboard without hovering.
function barLabel({ x, y, width, height, value, index, data }) {
  const d = data[index]
  if (!d) return null
  return (
    <text
      x={x + width + 8}
      y={y + height / 2}
      dominantBaseline="central"
      fontSize={11}
      fill="var(--text-secondary)"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {value.toFixed(0)}% · {fmtPos(d.avgPosition)}
    </text>
  )
}

function MiniBar({ company, visibility }) {
  return (
    <div className="geo-minirow">
      <span className={`geo-minirow-name${isTwine(company) ? ' twine' : ''}`} title={company}>{company}</span>
      <span className="geo-minibar-track">
        <span
          className="geo-minibar-fill"
          style={{
            width: `${Math.max(2, visibility)}%`,
            background: colorForCompany(company),
            opacity: isTwine(company) ? 1 : 0.8,
          }}
        />
      </span>
      <span className="geo-minirow-val">{visibility.toFixed(0)}%</span>
    </div>
  )
}

export function AIVisibility() {
  const { prompts, results, weekStart, engines, loading } = useGeoVisibility()
  const [engineSel, setEngineSel] = useState(null)

  // Default to the engine with the most answered prompts (Anthropic lags OpenAI
  // until its credential header is fixed, so OpenAI wins early on).
  const defaultEngine = useMemo(() => {
    if (!engines.length) return null
    const counts = {}
    for (const r of results) counts[r.engine] = (counts[r.engine] || 0) + 1
    return engines.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0))[0]
  }, [engines, results])
  const engine = engines.includes(engineSel) ? engineSel : defaultEngine

  // Everything for the selected engine, latest week.
  const model = useMemo(() => {
    if (!engine) return null
    const engineRows = results.filter(r => r.engine === engine)
    const byPrompt = latestByPrompt(engineRows) // prompt_id → answered row
    const answered = [...byPrompt.values()]
    const companies = aggregate(answered)
    // Twine always present in the leaderboard, even at zero.
    if (!companies.some(c => isTwine(c.company))) {
      companies.push({ company: TWINE, count: 0, visibility: 0, avgPosition: null })
    }
    const twine = companies.find(c => isTwine(c.company))

    // Topics from the active prompt panel (stable 9), each scoped to its prompts.
    const byTopic = new Map()
    for (const p of prompts) {
      if (!byTopic.has(p.topic)) byTopic.set(p.topic, [])
      byTopic.get(p.topic).push(p)
    }
    const topics = [...byTopic.entries()]
      .map(([topic, topicPrompts]) => {
        const ids = new Set(topicPrompts.map(p => p.id))
        const answeredHere = answered.filter(r => ids.has(r.prompt_id))
        const comps = aggregate(answeredHere)
        const tw = comps.find(c => isTwine(c.company))
        const promptRows = topicPrompts.map(p => {
          const row = byPrompt.get(p.id)
          const mentions = (row?.mentions || []).slice().sort(
            (a, b) => (a.position ?? 99) - (b.position ?? 99))
          const tm = mentions.find(m => isTwine(m.company))
          return {
            id: p.id,
            prompt: p.prompt,
            answered: !!row,
            twinePos: tm ? tm.position : null,
            mentions,
          }
        })
        return {
          topic,
          promptCount: topicPrompts.length,
          answeredCount: answeredHere.length,
          twine: tw || { company: TWINE, count: 0, visibility: 0, avgPosition: null },
          companies: comps.filter(c => !isTwine(c.company)).slice(0, 4),
          prompts: promptRows,
        }
      })
      .sort((a, b) => a.topic.localeCompare(b.topic))

    return {
      engine,
      answeredCount: answered.length,
      totalPrompts: prompts.length,
      companies,
      twine,
      topics,
    }
  }, [engine, results, prompts])

  // CSV: one row per mention across ALL engines this week (latest run per
  // prompt×engine). Columns: week_start, engine, topic, prompt, company, position.
  const csvRows = useMemo(() => {
    const promptText = new Map(prompts.map(p => [p.id, p.prompt]))
    // Dedupe to latest run per (engine, prompt_id).
    const latest = new Map()
    for (const r of results) {
      const key = `${r.engine}::${r.prompt_id}`
      const prev = latest.get(key)
      if (!prev || (r.run_date || '') > (prev.run_date || '')) latest.set(key, r)
    }
    const out = []
    for (const r of latest.values()) {
      for (const m of r.mentions || []) {
        out.push({
          week_start: r.week_start,
          engine: r.engine,
          topic: r.topic,
          prompt: promptText.get(r.prompt_id) || '',
          company: m.company,
          position: m.position ?? '',
        })
      }
    }
    return out
  }, [results, prompts])

  const [exporting, setExporting] = useState(false)
  const exportCSV = () => {
    setExporting(true)
    downloadCSV(`ai-visibility-geo-${weekStart || 'all'}`, csvRows, [
      { key: 'week_start', label: 'week_start' },
      { key: 'engine', label: 'engine' },
      { key: 'topic', label: 'topic' },
      { key: 'prompt', label: 'prompt' },
      { key: 'company', label: 'company' },
      { key: 'position', label: 'position' },
    ])
    setTimeout(() => setExporting(false), 400)
  }

  if (loading) {
    return (
      <GlassCard className="card" intensity={3}>
        <div className="empty-state"><p>Loading AI visibility…</p></div>
      </GlassCard>
    )
  }

  if (!model || !model.answeredCount) {
    return (
      <GlassCard className="card" intensity={3} interactive>
        <div className="card-header">
          <span className="card-title"><Bot size={15} style={{ verticalAlign: -2, marginRight: 6 }} />AI Visibility (GEO)</span>
        </div>
        <div className="empty-state">
          <p>No AI-visibility data yet — the weekly AI Answers run populates it.</p>
          <p style={{ marginTop: 8 }}>
            Each week we ask AI assistants (with web search on) the real identity-security
            questions buyers ask — "best identity security platforms", "how do I automate
            access reviews", "Twine vs Cerby" — and record which companies get named, and
            where they rank in the answer. 51% of B2B software buyers now start research in
            an AI chat, so this is whether they'd hear about us.
          </p>
        </div>
      </GlassCard>
    )
  }

  const twineVis = model.twine?.visibility ?? 0

  return (
    <GlassCard className="card" intensity={3} interactive>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="card-title"><Bot size={15} style={{ verticalAlign: -2, marginRight: 6 }} />AI Visibility (GEO)</span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>week of {weekStart}</span>
        {engines.length > 1 && (
          <div className="geo-engine-select">
            {engines.map(e => (
              <button
                key={e}
                className={`geo-engine-btn${e === engine ? ' active' : ''}`}
                onClick={() => setEngineSel(e)}
              >
                {engineLabel(e)}
              </button>
            ))}
          </div>
        )}
        <button className="csv-btn" style={{ marginLeft: 'auto' }} onClick={exportCSV} disabled={exporting} title="Download this week's mentions as CSV (one row per mention)">
          <Download size={13} /> CSV
        </button>
      </div>

      <p className="cr-sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Search size={13} style={{ flex: '0 0 auto' }} />
        How often each company is named when buyers ask AI these IAM questions, web search on.
        <strong style={{ color: 'var(--text-primary)' }}>{engineLabel(engine)}</strong> ·
        {model.answeredCount} of {model.totalPrompts} prompts answered.
        {engines.length === 1 && ' (Anthropic data appears once its credential header is fixed.)'}
      </p>

      {/* 1 — Twine summary hero */}
      <div className="geo-summary">
        <div className="geo-summary-metric">
          <span className="geo-summary-value">{twineVis.toFixed(0)}%</span>
          <span className="geo-summary-label">Twine visibility</span>
        </div>
        <div className="geo-summary-metric">
          <span className="geo-summary-value muted">{fmtPos(model.twine?.avgPosition)}</span>
          <span className="geo-summary-label">Avg rank when named</span>
        </div>
        <span className="geo-summary-note">
          Twine Security named in <strong>{model.twine?.count || 0}</strong> of <strong>{model.answeredCount}</strong> answered prompts
        </span>
      </div>

      {/* 4 — Leaderboard */}
      <div className="geo-section-title">Leaderboard — visibility across all questions</div>
      <ResponsiveContainer width="100%" height={Math.max(150, model.companies.length * 30)}>
        <BarChart data={model.companies} layout="vertical" margin={{ left: 8, right: 96, top: 4, bottom: 4 }}>
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} unit="%" />
          <YAxis type="category" dataKey="company" width={120} tick={{ fontSize: 11.5, fill: 'var(--text-primary)' }} />
          <Tooltip content={<LeaderTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
          <Bar dataKey="visibility" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
            {model.companies.map(c => (
              <Cell key={c.company} fill={colorForCompany(c.company)} opacity={isTwine(c.company) ? 1 : 0.72} />
            ))}
            <LabelList dataKey="visibility" content={props => barLabel({ ...props, data: model.companies })} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* 5 — By topic */}
      <div className="geo-section-title">By topic — Twine's visibility &amp; who else is named</div>
      <div className="geo-topic-grid">
        {model.topics.map(t => (
          <div className="geo-topic-card" key={t.topic}>
            <div className="geo-topic-head">
              <span className="geo-topic-name">{t.topic}</span>
              <span className="geo-topic-meta">{t.answeredCount}/{t.promptCount} answered</span>
            </div>
            <div className="geo-topic-twine">
              Twine: <strong>{t.twine.visibility.toFixed(0)}%</strong> · {fmtPos(t.twine.avgPosition)}
            </div>
            {t.twine.count > 0 && <MiniBar company={TWINE} visibility={t.twine.visibility} />}
            {t.companies.length === 0 && t.twine.count === 0 && (
              <div className="geo-minirow-val" style={{ flex: 'none' }}>No companies named</div>
            )}
            {t.companies.map(c => (
              <MiniBar key={c.company} company={c.company} visibility={c.visibility} />
            ))}
          </div>
        ))}
      </div>

      {/* 6 — Prompt-level win / miss */}
      <div className="geo-section-title">Every prompt — where Twine wins &amp; where it's missing</div>
      <div className="geo-prompts">
        {model.topics.map(t => (
          <div key={t.topic}>
            <div className="geo-prompt-topic-name">
              {t.topic}
              <span className="geo-topic-meta">{t.answeredCount}/{t.promptCount} answered</span>
            </div>
            {t.prompts.map(p => {
              const hit = p.answered && p.twinePos != null
              return (
                <div key={p.id} className={`geo-prompt-row${p.answered && !hit ? ' miss' : ''}`}>
                  <span className={`geo-prompt-status ${hit ? 'hit' : 'miss'}`}>
                    {!p.answered ? '·' : hit ? '✓' : '—'}
                  </span>
                  <div className="geo-prompt-body">
                    <div className="geo-prompt-q">{p.prompt}</div>
                    {!p.answered ? (
                      <div className="geo-prompt-twine-pos miss" style={{ color: 'var(--text-secondary)' }}>Not yet answered</div>
                    ) : hit ? (
                      <div className="geo-prompt-twine-pos">Twine named at #{p.twinePos}</div>
                    ) : (
                      <div className="geo-prompt-twine-pos miss">Twine not named</div>
                    )}
                    {p.mentions.length > 0 && (
                      <div className="geo-prompt-others">
                        {p.mentions.map((m, i) => (
                          <span key={`${m.company}-${i}`} className={`geo-chip${isTwine(m.company) ? ' twine' : ''}`}>
                            {m.company}
                            {m.position != null && <span className="geo-chip-pos">#{m.position}</span>}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="cr-footnote" style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <Info size={13} style={{ flex: '0 0 auto', marginTop: 2 }} />
        <span>
          Visibility = share of answered prompts where a company is named; avg rank = mean
          1-based position across those answers. Web search is on, so answers reflect the live
          web, not just training knowledge. Measured against the versioned prompt panel in{' '}
          <code>geo_prompts</code> ({model.totalPrompts} active questions across {model.topics.length} topics).
        </span>
      </div>
    </GlassCard>
  )
}
