import { useMemo, useState } from 'react'
import { Activity, RefreshCw, CheckCircle2, AlertTriangle, XCircle, HelpCircle, Database, Workflow, Server, ClipboardCopy } from 'lucide-react'
import { AppHeader } from '../components/AppHeader'
import { GlassCard } from '../components/GlassCard'
import { SystemMap } from '../components/SystemMap'
import { useSystemHealth } from '../hooks/useSystemHealth'
import { useHealthHistory } from '../hooks/useHealthHistory'
import '../App.css'
import './systemHealth.css'

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

  const groups = useMemo(() => {
    const g = { Pipeline: [], Data: [], Serving: [] }
    for (const ch of checks || []) (g[ch.group] || g.Serving).push(ch)
    // Attention-first within each group: crit → warn → unknown → ok/info.
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => (SORT_RANK[a.status] ?? 9) - (SORT_RANK[b.status] ?? 9))
    }
    return g
  }, [checks])

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
          <button className="refresh-btn" onClick={copyReport} disabled={!checks} title="Copy a paste-ready health report to the clipboard">
            <ClipboardCopy size={13} /> {copyState === 'ok' ? 'copied!' : copyState === 'fail' ? 'copy failed' : 'Copy report'}
          </button>
          <button className="refresh-btn" onClick={refresh} disabled={running || demo} title="Re-run all checks now">
            <RefreshCw size={13} className={running ? 'spin' : ''} /> {running ? 'checking…' : 'Re-check'}
          </button>
        </div>
      </div>

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

      {/* the checks, grouped */}
      <div className="hs-groups">
        {Object.entries(groups).map(([group, items]) => {
          const GIcon = GROUP_ICON[group]
          return (
            <GlassCard key={group} className="card hs-group" intensity={3}>
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
        })}
      </div>
    </div>
  )
}
