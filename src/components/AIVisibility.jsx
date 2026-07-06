import { useMemo, useState } from 'react'
import { Bot, Download, Info } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { GlassCard } from './GlassCard'
import { useLLMSov } from '../hooks/useLLMSov'
import { colorForCompany, isTwine } from '../lib/colors'
import { downloadCSV } from '../lib/csv'

// AI Visibility — "share of model": how often each tracked company shows up in
// AI assistants' answers to real buyer questions (versioned prompt panel in
// sov_config.aiAnswers, sampled weekly by the `SOV — AI Answers` workflow across
// OpenAI / Anthropic / Perplexity). This is where 51% of B2B software buyers now
// start their research — the newest surface SOV has to cover.

const ENGINE_LABELS = {
  openai: 'ChatGPT (OpenAI)',
  anthropic: 'Claude (Anthropic)',
  perplexity: 'Perplexity',
}

function EngineTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="chart-tooltip">
      <div style={{ fontWeight: 600, marginBottom: 2, color: 'var(--text-primary)' }}>{d.company}</div>
      <div className="chart-tooltip-value" style={{ color: 'var(--text-secondary)' }}>
        Share of model: {d.share.toFixed(1)}%<br />
        Mentioned in {(d.rate * 100).toFixed(0)}% of sampled answers
      </div>
    </div>
  )
}

export function AIVisibility() {
  const { rows, loading } = useLLMSov()

  // Latest week per engine (engines can land on different weeks if one failed).
  const model = useMemo(() => {
    if (!rows.length) return { engines: [], week: null }
    const week = rows[0].week_start
    const latest = rows.filter(r => r.week_start === week)
    const byEngine = new Map()
    for (const r of latest) {
      if (!byEngine.has(r.engine)) byEngine.set(r.engine, [])
      byEngine.get(r.engine).push({
        company: r.company,
        share: Number(r.share_of_model) || 0,
        rate: Number(r.mention_rate) || 0,
        nSamples: r.n_samples,
        nPrompts: r.n_prompts,
      })
    }
    const engines = [...byEngine.entries()].map(([engine, list]) => ({
      engine,
      label: ENGINE_LABELS[engine] || engine,
      companies: list.sort((a, b) => b.share - a.share),
      nSamples: list[0]?.nSamples,
      nPrompts: list[0]?.nPrompts,
    }))
    return { engines, week }
  }, [rows])

  const [exporting, setExporting] = useState(false)
  const exportAll = () => {
    setExporting(true)
    downloadCSV(`ai-visibility-${model.week || 'all'}`, rows, [
      { key: 'week_start', label: 'week' },
      { key: 'engine', label: 'engine' },
      { key: 'company', label: 'company' },
      { key: 'share_of_model', label: 'share_of_model_pct' },
      { key: 'mention_rate', label: 'mention_rate' },
      { key: 'avg_first_pos', label: 'avg_first_position' },
      { key: 'n_prompts', label: 'prompts' },
      { key: 'n_samples', label: 'answers_sampled' },
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

  if (!model.engines.length) {
    return (
      <GlassCard className="card" intensity={3} interactive>
        <div className="card-header">
          <span className="card-title"><Bot size={15} style={{ verticalAlign: -2, marginRight: 6 }} />AI Visibility — share of model</span>
        </div>
        <div className="empty-state">
          <p>
            No AI-answer samples yet. Every week the <code>SOV — AI Answers</code> run asks
            ChatGPT, Claude and Perplexity ~28 real buyer questions ("best identity security
            platforms…", "Twine vs Cerby…", "how do I automate access reviews…"), several times
            each, and measures how often every tracked company appears in the answers.
          </p>
          <p style={{ marginTop: 8 }}>
            51% of B2B software buyers now start research in an AI chat — this tab shows whether
            they'd hear about us. First data lands after the workflow's first Thursday run.
          </p>
        </div>
      </GlassCard>
    )
  }

  return (
    <GlassCard className="card" intensity={3} interactive>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="card-title"><Bot size={15} style={{ verticalAlign: -2, marginRight: 6 }} />AI Visibility — share of model</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>week of {model.week}</span>
        <button className="csv-btn" onClick={exportAll} disabled={exporting} title="Download every week's AI-visibility rows as CSV">
          <Download size={13} /> CSV
        </button>
      </div>

      <p className="cr-sub">
        How often each company is named when AI assistants answer real buyer questions — the
        share of all tracked-company mentions across the week's sampled answers, per engine.
        Answers are stochastic, so each prompt is sampled multiple times.
      </p>

      <div className="ai-engines">
        {model.engines.map(e => (
          <div className="ai-engine" key={e.engine}>
            <div className="ai-engine-head">
              <span className="ai-engine-name">{e.label}</span>
              <span className="ai-engine-meta" title="prompts asked × answers sampled this week">
                {e.nPrompts} prompts · {e.nSamples} answers
              </span>
            </div>
            <ResponsiveContainer width="100%" height={Math.max(120, e.companies.length * 28)}>
              <BarChart data={e.companies} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                <XAxis type="number" domain={[0, 'dataMax']} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} unit="%" />
                <YAxis type="category" dataKey="company" width={110} tick={{ fontSize: 11.5, fill: 'var(--text-primary)' }} />
                <Tooltip content={<EngineTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
                <Bar dataKey="share" radius={[0, 4, 4, 0]} maxBarSize={16}>
                  {e.companies.map(c => (
                    <Cell key={c.company} fill={colorForCompany(c.company)} opacity={isTwine(c.company) ? 1 : 0.75} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      <div className="cr-footnote" style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <Info size={13} style={{ flex: '0 0 auto', marginTop: 2 }} />
        <span>
          Measured against a versioned prompt panel (v{rows[0]?.prompt_version ?? 1}) — trend
          breaks after a panel change are expected and annotated. Engines differ by design:
          Perplexity searches the live web; ChatGPT and Claude answer from training knowledge.
        </span>
      </div>
    </GlassCard>
  )
}
