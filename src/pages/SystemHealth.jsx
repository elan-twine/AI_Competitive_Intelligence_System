import { useEffect, useMemo, useState } from 'react'
import { Activity, RefreshCw, CheckCircle2, AlertTriangle, XCircle, HelpCircle, Database, Workflow, Server, ClipboardCopy, Layers, MessageCircleQuestion, Coins } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { AppHeader } from '../components/AppHeader'
import { GlassCard } from '../components/GlassCard'
import { SystemMap } from '../components/SystemMap'
import { TechStack } from '../components/TechStack'
import { AssistantChat } from '../components/AssistantChat'
import { useSystemHealth } from '../hooks/useSystemHealth'
import { useHealthHistory } from '../hooks/useHealthHistory'
import '../App.css'
import './systemHealth.css'

// Plain-English translation of what each check means when it is NOT healthy —
// so a non-technical reader understands the impact without knowing the stack.
// Keyed by check id; falls back to the check's own help text if absent.
const PLAIN = {
  'scrape-linkedin': "LinkedIn posts aren't being collected — the board will go stale for LinkedIn.",
  'scrape-x': "X/Twitter posts aren't being collected.",
  'scrape-news': "News articles aren't being collected.",
  'scrape-reddit': "Reddit posts aren't being collected (Reddit runs weekly, so a few days is normal).",
  queue: 'New LinkedIn posts are piling up faster than they can be processed — the newest ones may not appear yet.',
  attribution: "Posts are coming in but aren't being matched to competitors — likely a stuck AI step.",
  classifier: "Author labeling (employee vs. outsider) hasn't run recently.",
  snapshot: "The daily scoreboard hasn't been recalculated — trends and briefs may be frozen.",
  board: 'The competitor scoreboard looks empty or inconsistent.',
  geo: "The AI-visibility check hasn't run recently.",
  worker: "The app's backend service isn't responding — the assistant and some features may be down.",
  db: 'The database is responding slowly.',
  config: 'The scoring settings are missing or incomplete.',
}

// Attention-first: problems bubble to the top of each group.
const SORT_RANK = { crit: 0, warn: 1, unknown: 2, ok: 3, info: 4 }

// Build a paste-ready markdown snapshot of the whole console — for a ticket,
// Slack, or handing to an agent.
function buildReport(checks, overall, ranAt) {
  const line = (c) => `- [${c.status.toUpperCase()}] ${c.label}: ${c.value}${c.detail ? ` — ${c.detail}` : ''}`
  const groups = { Pipeline: [], Data: [], Serving: [] }
  for (const c of checks || []) (groups[c.group] || groups.Serving).push(c)
  const body = Object.entries(groups)
    .map(([g, items]) => `### ${g}\n${items.map(line).join('\n')}`)
    .join('\n\n')
  return `# SOV system health — ${overall.toUpperCase()}\n_${ranAt ? new Date(ranAt).toISOString() : 'unknown time'}_\n\n${body}\n`
}

// Developer console for the whole system: every stage of the pipeline as a
// live, color-coded architecture map + the underlying checks as tiles.
// Health is derived from DATABASE EVIDENCE (freshness, queue depth, pool
// integrity) plus two live probes — the browser can't reach the n8n API, and
// per project rule data beats logs anyway.

const STATUS_META = {
  ok: { label: 'Healthy', Icon: CheckCircle2 },
  warn: { label: 'Attention', Icon: AlertTriangle },
  crit: { label: 'Broken', Icon: XCircle },
  unknown: { label: 'Unknown', Icon: HelpCircle },
  info: { label: 'Info', Icon: HelpCircle },
}
const GROUP_ICON = { Pipeline: Workflow, Data: Database, Serving: Server }

// DEV-only synthetic results so the page (and the map's warn/crit visuals) can
// be previewed without an authed session. Never available in production builds.
const DEMO_CHECKS = [
  { id: 'scrape-linkedin', label: 'LinkedIn scrape', group: 'Pipeline', status: 'ok', value: '5h ago', detail: 'last run success · 181 rows', help: 'Apify scraper, daily ~05:00.' },
  { id: 'scrape-x', label: 'X data freshness', group: 'Pipeline', status: 'ok', value: '9h ago', detail: 'newest tweet by createdAt', help: '' },
  { id: 'scrape-news', label: 'Google News scrape', group: 'Pipeline', status: 'warn', value: '38h ago', detail: 'last run success', help: '' },
  { id: 'scrape-reddit', label: 'Reddit scrape', group: 'Pipeline', status: 'ok', value: '3.6d ago', detail: 'newest scrapedAt', help: '' },
  { id: 'queue', label: 'LinkedIn ingest queue', group: 'Pipeline', status: 'crit', value: '507 pending', detail: '6,364 processed · oldest pending 41h ago', help: 'Backlog ≥400 = newest posts silently wait.' },
  { id: 'attribution', label: 'Attribution flow', group: 'Pipeline', status: 'ok', value: '162 in 3d', detail: 'LinkedIn posts attributed, last 3 days', help: '' },
  { id: 'classifier', label: 'Author classifier', group: 'Pipeline', status: 'ok', value: '11h ago', detail: 'newest author_affiliation.checked_at', help: '' },
  { id: 'snapshot', label: 'Board snapshot', group: 'Data', status: 'ok', value: '2026-07-27', detail: 'newest sov_daily snapshot_date', help: '' },
  { id: 'board', label: 'Board integrity', group: 'Data', status: 'ok', value: 'pool OK', detail: '7d direct pool 6,212 units · 1 untracked name', help: '' },
  { id: 'geo', label: 'AI answers (GEO)', group: 'Data', status: 'ok', value: '2026-07-23', detail: 'newest geo_results.run_date', help: '' },
  { id: 'volumes', label: 'Table volumes', group: 'Data', status: 'info', value: '8.6k · 597 · 1.9k · 4', detail: 'linkedin · tweets · news · reddit', help: '' },
  { id: 'worker', label: 'Worker API', group: 'Serving', status: 'ok', value: '184ms', detail: 'GET /api/health round-trip', help: '' },
  { id: 'db', label: 'Database latency', group: 'Serving', status: 'ok', value: '212ms', detail: 'HEAD count on sov_daily', help: '' },
  { id: 'config', label: 'Scoring config', group: 'Serving', status: 'ok', value: 'complete', detail: 'multipliers LI 1 · X 1 · R 1.5 · News 15', help: '' },
]

// ---------------------------------------------------------------------------
// 30-day OpenAI token usage by model, via the Worker's /api/openai-usage proxy
// (the admin key lives server-side only). Degrades to a setup note when the
// OPENAI_ADMIN_KEY secret isn't configured, and to a plain error line when the
// route is unreachable (e.g. the vite dev server, which has no Worker).
// ---------------------------------------------------------------------------
const fmtM = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)

function OpenAiUsageCard() {
  const [state, setState] = useState({ loading: true })
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data?.session?.access_token
        const r = await fetch('/api/openai-usage', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        const body = await r.json().catch(() => null)
        if (!alive) return
        if (!r.ok || !body) setState({ error: body?.error || `usage endpoint ${r.status}` })
        else setState({ data: body })
      } catch (e) {
        if (alive) setState({ error: e?.message || String(e) })
      }
    })()
    return () => { alive = false }
  }, [])

  const d = state.data
  return (
    <GlassCard className="card hs-stack-card" intensity={3}>
      <div className="card-header">
        <span className="card-title"><Coins size={15} style={{ verticalAlign: '-2px' }} /> OpenAI usage · last 30 days</span>
        {d?.configured && <span className="hs-usage-total">≈ ${d.totalUsd} <i>est.</i></span>}
      </div>
      {state.loading && <p className="hs-help">Loading usage…</p>}
      {state.error && <p className="hs-help">Couldn't load usage ({state.error}).</p>}
      {d && !d.configured && (
        <p className="hs-help">
          Not configured yet: create an <strong>Admin key</strong> in the OpenAI console
          (Organization → Admin keys) and add it as the <code>OPENAI_ADMIN_KEY</code> Worker
          secret — the regular API key can't read usage. The card lights up on the next deploy.
        </p>
      )}
      {d?.configured && (
        <div className="table-wrap">
          <table className="hs-usage-table">
            <thead>
              <tr><th style={{ textAlign: 'left' }}>Model</th><th>Requests</th><th>Input</th><th>Cached</th><th>Output</th><th>Est. cost</th></tr>
            </thead>
            <tbody>
              {d.models.map(m => (
                <tr key={m.model}>
                  <td style={{ textAlign: 'left' }}>{m.model}</td>
                  <td>{fmtM(m.requests)}</td>
                  <td>{fmtM(m.input)}</td>
                  <td title="Share of input tokens served from OpenAI's prompt cache (75% cheaper)">
                    {m.input ? `${Math.round((m.cached / m.input) * 100)}%` : '—'}
                  </td>
                  <td>{fmtM(m.output)}</td>
                  <td>{m.estUsd != null ? `$${m.estUsd}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hs-help" style={{ marginTop: 8 }}>
            Cost is estimated from list prices (cached input billed at 25%). The <em>Cached</em> column
            is the prompt-cache hit rate — the News gate restructure should push gpt-4.1 upward here.
          </p>
        </div>
      )}
    </GlassCard>
  )
}

export default function SystemHealth({ onLogout, onNavigate }) {
  const [demo, setDemo] = useState(false)
  const { checks: liveChecks, ranAt, running, refresh } = useSystemHealth({ paused: demo })
  const checks = demo ? DEMO_CHECKS : liveChecks
  const [selected, setSelected] = useState(null)
  const [copyState, setCopyState] = useState('') // '' | 'ok' | 'fail'

  // Persisted run history → per-check trend + flap detection (demo runs, which
  // have no ranAt, are never recorded, so they can't pollute real history).
  const { runCount, trendFor, flapCount } = useHealthHistory(liveChecks, ranAt)

  const counts = useMemo(() => {
    const c = { ok: 0, warn: 0, crit: 0, unknown: 0, info: 0 }
    for (const ch of checks || []) c[ch.status] = (c[ch.status] || 0) + 1
    return c
  }, [checks])
  const overall = counts.crit ? 'crit' : counts.warn ? 'warn' : counts.unknown && !counts.ok ? 'unknown' : 'ok'
  const OverallIcon = STATUS_META[overall].Icon

  // Everything that isn't plainly healthy, worst-first — the plain-language
  // list a non-technical reader scans to see WHAT needs attention, no clicks.
  const attention = useMemo(
    () => (checks || [])
      .filter(c => c.status === 'crit' || c.status === 'warn' || c.status === 'unknown')
      .sort((a, b) => (SORT_RANK[a.status] ?? 9) - (SORT_RANK[b.status] ?? 9)),
    [checks]
  )

  const groups = useMemo(() => {
    const g = { Pipeline: [], Data: [], Serving: [] }
    for (const ch of checks || []) (g[ch.group] || g.Serving).push(ch)
    // Attention-first within each group: crit → warn → unknown → ok/info.
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => (SORT_RANK[a.status] ?? 9) - (SORT_RANK[b.status] ?? 9))
    }
    return g
  }, [checks])

  // One group card (title + its check rows). Shared by the two-column layout.
  const renderGroup = (group, items = []) => {
    const GIcon = GROUP_ICON[group]
    return (
      <GlassCard className="card hs-group" intensity={3}>
        <div className="card-header">
          <span className="card-title"><GIcon size={14} style={{ verticalAlign: '-2px' }} /> {group}</span>
        </div>
        {!checks && <p className="hs-help">Running checks…</p>}
        {items.map(c => {
          const { Icon } = STATUS_META[c.status] || STATUS_META.unknown
          const trend = demo ? [] : trendFor(c.id).slice(-16)
          const flaps = demo ? 0 : flapCount(c.id)
          return (
            <div key={c.id} className={`hs-check st-${c.status}`} title={c.help}>
              <Icon size={15} className="hs-check-icon" />
              <div className="hs-check-main">
                <span className="hs-check-label">
                  {c.label}
                  {flaps >= 3 && <span className="hs-flap" title={`Status changed ${flaps}× recently`}>flapping</span>}
                </span>
                <span className="hs-check-detail">{c.detail}</span>
              </div>
              {trend.length > 1 && (
                <span className="hs-trend" title={`Last ${trend.length} checks (oldest → newest)`}>
                  {trend.map((s, i) => <i key={i} className={`st-${s}`} />)}
                </span>
              )}
              <span className="hs-check-value">{c.value}</span>
            </div>
          )
        })}
      </GlassCard>
    )
  }

  const copyReport = async () => {
    const text = buildReport(checks, overall, demo ? null : ranAt)
    let ok = false
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch { /* clipboard blocked (insecure context / no gesture) */ }
    setCopyState(ok ? 'ok' : 'fail')
    setTimeout(() => setCopyState(''), 1800)
  }

  // Ship the same report into the assistant and ask the question a
  // non-technical reader would ask. The report rides in the user turn (data,
  // not authority) and the assistant can verify with its own tools.
  const [askPrompt, setAskPrompt] = useState(null)
  const askAssistant = () => {
    const report = buildReport(checks, overall, demo ? null : ranAt)
    setAskPrompt(
      "Here is the dashboard's current system health report:\n\n" + report +
      "\nWhat's wrong or broken right now? Explain what each problem means in plain language, how urgent it is, and what to check or do next. If everything is healthy, just say so briefly."
    )
  }

  const selectedChecks = selected
    ? (checks || []).filter(c => selected.checks.includes(c.id))
    : null

  return (
    <div className="app health-root">
      <AppHeader page="System health" onNavigate={onNavigate} onLogout={onLogout} />

      {/* overall banner */}
      <div className={`hs-banner st-${overall}`}>
        <OverallIcon size={22} />
        <div className="hs-banner-text">
          <strong>
            {overall === 'ok' ? 'All systems healthy' :
             overall === 'warn' ? 'Attention needed' :
             overall === 'crit' ? 'Something is broken' : 'Status unknown'}
          </strong>
          <span>
            {counts.ok} healthy · {counts.warn} attention · {counts.crit} broken
            {counts.unknown ? ` · ${counts.unknown} unknown` : ''}
            {ranAt && !demo ? ` — checked ${new Date(ranAt).toLocaleTimeString()}` : ''}
            {demo ? ' — demo data' : ''}
            {!demo && runCount > 1 ? ` · ${runCount} runs tracked` : ''}
          </span>
        </div>
        <div className="hs-banner-actions">
          {import.meta.env.DEV && (
            <button className={`hs-demo ${demo ? 'on' : ''}`} onClick={() => setDemo(d => !d)} title="Preview with synthetic statuses (dev only)">
              demo
            </button>
          )}
          <button className="refresh-btn" onClick={askAssistant} disabled={!checks} title="Send this health report to the assistant and ask what's wrong">
            <MessageCircleQuestion size={13} /> Ask assistant
          </button>
          <button className="refresh-btn" onClick={copyReport} disabled={!checks} title="Copy a paste-ready health report to the clipboard">
            <ClipboardCopy size={13} /> {copyState === 'ok' ? 'copied!' : copyState === 'fail' ? 'copy failed' : 'Copy report'}
          </button>
          <button className="refresh-btn" onClick={refresh} disabled={running || demo} title="Re-run all checks now">
            <RefreshCw size={13} className={running ? 'spin' : ''} /> {running ? 'checking…' : 'Re-check'}
          </button>
        </div>
      </div>

      {/* Needs-attention — the plain-language "what's wrong" a non-technical
          coworker reads first, without clicking into the map or the checks. */}
      {checks && (
        attention.length ? (
          <div className="hs-attention">
            <div className="hs-attention-head">
              <AlertTriangle size={16} />
              {attention.length === 1 ? '1 thing needs attention' : `${attention.length} things need attention`}
            </div>
            {attention.map(c => (
              <div key={c.id} className={`hs-att-row st-${c.status}`}>
                <span className="hs-att-badge">{c.status === 'crit' ? 'Broken' : c.status === 'warn' ? 'Watch' : 'Unknown'}</span>
                <div className="hs-att-body">
                  <span className="hs-att-what">{c.label} <span className="hs-att-where">· {c.group}</span></span>
                  <span className="hs-att-why">{PLAIN[c.id] || c.help}</span>
                </div>
                <span className="hs-att-value">{c.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="hs-allclear">
            <CheckCircle2 size={18} />
            <span>Everything is running. Nothing needs your attention right now.</span>
          </div>
        )
      )}

      {/* the map */}
      <GlassCard className="card" intensity={4}>
        <div className="card-header">
          <span className="card-title"><Activity size={15} style={{ verticalAlign: '-2px' }} /> Backend map — live</span>
          <span className="hs-legend">
            <i className="st-ok" /> healthy <i className="st-warn" /> attention <i className="st-crit" /> broken <i className="st-unknown" /> unknown <i className="st-idle" /> no direct signal
          </span>
        </div>
        <p className="hs-help">
          Every stage of the system, wired as it actually flows: scrapers → ingest → LLM processing → Supabase →
          aggregation → the app you're using. Colors come from live database evidence — click any node for its checks.
        </p>
        <div className="hs-map-wrap">
          <SystemMap checks={checks} onSelect={setSelected} selectedId={selected?.id} />
        </div>
        {selected && (
          <div className="hs-node-detail">
            <div className="hs-node-detail-head">
              <strong>{selected.label}</strong>
              <span>{selected.sub}</span>
              <button className="hs-close" onClick={() => setSelected(null)} aria-label="Close detail">×</button>
            </div>
            {selectedChecks && selectedChecks.length ? selectedChecks.map(c => (
              <div key={c.id} className={`hs-node-check st-${c.status}`}>
                <i />
                <span className="hs-node-check-label">{c.label}</span>
                <span className="hs-node-check-value">{c.value}</span>
                <span className="hs-node-check-detail">{c.detail}</span>
              </div>
            )) : (
              <p className="hs-help" style={{ margin: '6px 0 0' }}>
                No direct database evidence for this stage — its health shows up downstream (the stages it feeds).
              </p>
            )}
          </div>
        )}
      </GlassCard>

      {/* the checks, grouped. Two columns: Pipeline (tallest — 7 rows) on the
          left; Data + Serving stacked on the right so the third group can't
          overflow the container as it did in a 3-across grid. */}
      <div className="hs-groups">
        <div className="hs-col">{renderGroup('Pipeline', groups.Pipeline)}</div>
        <div className="hs-col">
          {renderGroup('Data', groups.Data)}
          {renderGroup('Serving', groups.Serving)}
        </div>
      </div>

      {/* LLM spend — 30-day OpenAI token usage by model (Worker-proxied) */}
      <OpenAiUsageCard />

      {/* Tech-stack diagram — what powers all of the above */}
      <GlassCard className="card hs-stack-card" intensity={3}>
        <div className="card-header">
          <span className="card-title"><Layers size={15} style={{ verticalAlign: '-2px' }} /> Tech stack</span>
        </div>
        <p className="hs-help">The technologies behind the system, in the order data flows through them.</p>
        <TechStack />
      </GlassCard>

      {/* Floating assistant — same one as the dashboard, so "Ask assistant"
          can hand it the health report ("what's wrong/broken?"). */}
      <AssistantChat tab="health" pendingPrompt={askPrompt} onPendingConsumed={() => setAskPrompt(null)} />
    </div>
  )
}
