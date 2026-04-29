import { useState, useMemo, useEffect, useRef } from 'react'
import { Settings, Zap } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { SEED_BRIEFINGS, OPENAI_KEY } from '../data/briefings'
import './briefings.css'

// Per-competitor accent for the OpenAI-vs-X cards (the right-hand "comp" border)
const COMP_COLORS = {
  anthropic: '#a78bfa',
  crowdstrike: 'var(--negative)',
  google: 'var(--neutral)',
  perplexity: 'var(--positive)',
}
const THREAT_PCT = { critical: 95, high: 75, medium: 50, low: 25 }
const THREAT_BAR_COLOR = {
  critical: 'var(--negative)',
  high: 'var(--negative)',
  medium: 'var(--neutral)',
  low: 'var(--accent)',
}

function ThreatPill({ threat }) {
  return <span className={`bf-tp bf-tp-${threat}`}>{(threat || '').toUpperCase()}</span>
}

export default function Briefings() {
  const [data, setData] = useState(SEED_BRIEFINGS)
  const [subtab, setSubtab] = useState('overview')
  const [activeBrief, setActiveBrief] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  const oai = data[OPENAI_KEY]
  const compKeys = useMemo(() => Object.keys(data).filter(k => k !== OPENAI_KEY), [data])

  function showToast(msg, kind = 'ok') {
    setToast({ msg, kind })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }

  function go(tab) {
    setActiveBrief(null)
    setSubtab(tab)
  }

  function openBrief(key) {
    setSubtab('briefs')
    setActiveBrief(key)
  }

  return (
    <div className="briefings-root">
      <div className="bf-toolbar">
        <N8nDot />
        <button className="bf-btn" onClick={() => setModalOpen(true)}>
          <Settings size={13} />
          Settings
        </button>
      </div>

      <div className="bf-nav">
        {[
          ['overview', 'Overview'],
          ['vs', 'OpenAI vs Competitors'],
          ['compare', 'Compare All'],
          ['briefs', 'Briefings'],
        ].map(([t, label]) => (
          <button
            key={t}
            className={`bf-tab ${subtab === t ? 'on' : ''}`}
            onClick={() => go(t)}
          >{label}</button>
        ))}
      </div>

      <div className="bf-pg">
        {subtab === 'overview' && (
          <Overview data={data} setData={setData} openBrief={openBrief} showToast={showToast} setModalOpen={setModalOpen} />
        )}
        {subtab === 'vs' && <VsView oai={oai} data={data} compKeys={compKeys} />}
        {subtab === 'compare' && <CompareAll data={data} />}
        {subtab === 'briefs' && (
          activeBrief
            ? <BriefDetail c={data[activeBrief]} onBack={() => setActiveBrief(null)} />
            : <BriefList data={data} openBrief={openBrief} />
        )}
      </div>

      {modalOpen && <SettingsModal onClose={() => setModalOpen(false)} showToast={showToast} />}
      {toast && <div className={`bf-toast show ${toast.kind}`}>{toast.msg}</div>}
    </div>
  )
}

function N8nDot() {
  const [connected, setConnected] = useState(() => !!localStorage.getItem('n8n_url'))
  useEffect(() => {
    const onStorage = () => setConnected(!!localStorage.getItem('n8n_url'))
    window.addEventListener('storage', onStorage)
    const t = setInterval(onStorage, 1000)
    return () => { window.removeEventListener('storage', onStorage); clearInterval(t) }
  }, [])
  return (
    <span className="bf-pill">
      <span className={`bf-dot ${connected ? 'on' : ''}`} />
      {connected ? 'n8n connected' : 'n8n disconnected'}
    </span>
  )
}

function Overview({ data, setData, openBrief, showToast, setModalOpen }) {
  const [genName, setGenName] = useState('')
  const [generating, setGenerating] = useState(false)

  const all = Object.values(data)
  const uniqProducts = new Set(all.flatMap(c => c.products))
  const highCount = all.filter(c => c.threat === 'high' || c.threat === 'critical').length
  const overlapTotal = all.reduce((s, c) => s + (c.overlap?.length || 0), 0)
  const maxProducts = Math.max(...all.map(c => c.products.length))

  const news = all
    .flatMap(c => (c.news || []).map(n => ({ co: c.name, d: c.date, t: n })))
    .sort((a, b) => b.d.localeCompare(a.d))

  async function gen() {
    const name = genName.trim()
    if (!name) { showToast('Enter a competitor name', 'err'); return }
    const url = localStorage.getItem('n8n_url')
    if (!url) { setModalOpen(true); showToast('Set your webhook URL first', 'err'); return }
    setGenerating(true)
    try {
      const headers = { 'Content-Type': 'application/json' }
      const auth = localStorage.getItem('n8n_auth') || ''
      if (auth) headers['Authorization'] = auth
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ competitor: name }), mode: 'cors' })
      const raw = await r.json()
      const d = Array.isArray(raw) ? raw[0] : raw
      const x = d.output || d.result || d.briefing || d.data || d
      const key = name.toLowerCase().replace(/\s+/g, '_')
      const briefing = {
        name: x.name || x.company || name,
        date: x.date || new Date().toISOString().split('T')[0],
        threat: (x.threatLevel || x.threat_level || x.threat || 'medium').toLowerCase(),
        summary: x.summary || x.threatDescription || '',
        category: x.category || '',
        claim: x.coreClaim || x.core_claim || x.claim || '',
        pricing: x.pricing || x.pricingSignals || '',
        api: x.api || '',
        models: x.models || x.flagshipModels || [],
        products: x.products || x.product_overview || [],
        industries: x.industries || [],
        customers: x.customers || x.customerTypes || [],
        funding: x.funding || '',
        strengths: x.strengths || [],
        weaknesses: x.weaknesses || [],
        diff: x.differentiation || x.diff || [],
        overlap: x.overlapRisks || x.overlap || [],
        battle: x.battleCardNotes || x.battle || [],
        gaps: x.positioningGaps || x.gaps || [],
        news: x.recentNews || x.news || [],
      }
      setData(prev => ({ ...prev, [key]: briefing }))
      openBrief(key)
      showToast(`${name} briefing added`, 'ok')
      setGenName('')
    } catch (e) {
      showToast('Error: ' + e.message, 'err')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <>
      <GlassCard className="bf-card bf-n8n-bar" intensity={3} interactive>
        <div className="lbl"><Zap size={14} /> Generate via n8n</div>
        <input
          value={genName}
          onChange={e => setGenName(e.target.value)}
          placeholder="Enter a competitor name..."
          onKeyDown={e => { if (e.key === 'Enter') gen() }}
        />
        <button className="bf-btn bf-btn-g" onClick={gen} disabled={generating}>
          {generating ? <span className="bf-spin" /> : 'Generate'}
        </button>
      </GlassCard>

      <div className="bf-stats">
        <StatCard label="Competitors" value={all.length} />
        <StatCard label="High Threat" value={highCount} valueColor="var(--negative)" />
        <StatCard label="Overlap Areas" value={overlapTotal} valueColor="var(--neutral)" />
        <StatCard label="Products Tracked" value={uniqProducts.size} accent />
      </div>

      <div className="bf-g3">
        {Object.keys(data).map(k => {
          const c = data[k]
          const isOai = k === OPENAI_KEY
          return (
            <GlassCard
              key={k}
              className="bf-card"
              intensity={4}
              interactive
              style={{ cursor: 'pointer' }}
              onClick={() => openBrief(k)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--text-primary)' }}>
                  {c.name}
                  {isOai && <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, marginLeft: 8, padding: '2px 6px', borderRadius: 4, background: 'var(--accent-dim)' }}>PRIMARY</span>}
                </div>
                <ThreatPill threat={c.threat} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{c.category} · {c.date}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>{c.claim}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {c.products.slice(0, 3).map(p => <span key={p} className="bf-tag">{p}</span>)}
                {c.products.length > 3 && <span className="bf-tag">+{c.products.length - 3}</span>}
              </div>
            </GlassCard>
          )
        })}
      </div>

      <div className="bf-g2">
        <GlassCard className="bf-card" intensity={4} interactive>
          <h3>Threat Assessment</h3>
          {Object.keys(data).map(k => {
            const c = data[k]
            return (
              <div className="bf-bar-r" key={k}>
                <div className="bf-bar-l">{c.name}</div>
                <div className="bf-bar-t">
                  <div className="bf-bar-f" style={{ width: `${THREAT_PCT[c.threat] || 25}%`, background: THREAT_BAR_COLOR[c.threat] || 'var(--accent)' }}>
                    {(c.threat || '').toUpperCase()}
                  </div>
                </div>
              </div>
            )
          })}
        </GlassCard>
        <GlassCard className="bf-card" intensity={4} interactive>
          <h3>Product Breadth</h3>
          {Object.keys(data).map(k => {
            const c = data[k]
            return (
              <div className="bf-bar-r" key={k}>
                <div className="bf-bar-l">{c.name}</div>
                <div className="bf-bar-t">
                  <div className="bf-bar-f" style={{ width: `${(c.products.length / maxProducts) * 100}%`, background: 'var(--accent)' }}>
                    {c.products.length}
                  </div>
                </div>
              </div>
            )
          })}
        </GlassCard>
      </div>

      <GlassCard className="bf-card" intensity={3} interactive>
        <h3>Recent Intelligence</h3>
        {news.map((n, i) => (
          <div key={i} style={{
            display: 'flex',
            gap: 14,
            padding: '10px 0',
            borderBottom: i === news.length - 1 ? 'none' : '1px solid var(--divider)',
            fontSize: 12,
          }}>
            <span style={{ color: 'var(--text-muted)', width: 90, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{n.d}</span>
            <span style={{ fontWeight: 600, width: 130, flexShrink: 0, color: 'var(--text-primary)' }}>{n.co}</span>
            <span style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{n.t}</span>
          </div>
        ))}
      </GlassCard>
    </>
  )
}

function StatCard({ label, value, valueColor, accent }) {
  return (
    <GlassCard className="stat-card" intensity={10}>
      <div className="label">{label}</div>
      <div
        className={`value ${accent ? 'accent' : ''}`}
        style={!accent && valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
    </GlassCard>
  )
}

function VsView({ oai, data, compKeys }) {
  return (
    <>
      <GlassCard className="bf-vs-hero" intensity={5} interactive>
        <div>
          <div className="main-co">OpenAI</div>
          <div className="sub">AI research and development · $730B valuation</div>
        </div>
        <div className="vs-badge">vs {compKeys.length} Competitors</div>
      </GlassCard>

      <div className="bf-g2">
        <GlassCard className="bf-card" intensity={4} interactive>
          <h3>OpenAI Strengths to Leverage</h3>
          {oai.strengths.map((s, i) => (
            <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--accent)' }}>✓</span>{s}</div>
          ))}
        </GlassCard>
        <GlassCard className="bf-card" intensity={4} interactive>
          <h3>OpenAI Gaps to Address</h3>
          {oai.gaps.map((g, i) => (
            <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--negative)' }}>△</span>{g}</div>
          ))}
        </GlassCard>
      </div>

      {compKeys.map(k => {
        const c = data[k]
        const color = COMP_COLORS[k] || 'var(--negative)'
        return (
          <GlassCard className="bf-vs-card" intensity={3} interactive key={k}>
            <div className="bf-vs-card-hdr">
              <h4>OpenAI <span style={{ color: 'var(--accent)', margin: '0 8px' }}>vs</span> {c.name}</h4>
              <span className={`bf-tp bf-tp-${c.threat}`}>{c.threat.toUpperCase()} THREAT</span>
            </div>
            <div className="bf-vs-card-body">
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>{c.summary}</p>

              <SectionLabel>Key Models</SectionLabel>
              <div className="bf-vs-cols" style={{ marginBottom: 18 }}>
                <div className="bf-openai-col">
                  <div className="bf-vs-col-title">OpenAI</div>
                  <TagList items={oai.models} />
                </div>
                <div className="bf-comp-col" style={{ borderLeftColor: color }}>
                  <div className="bf-vs-col-title">{c.name}</div>
                  {c.models.length ? <TagList items={c.models} /> : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>N/A</span>}
                </div>
              </div>

              <SectionLabel>Strengths Comparison</SectionLabel>
              <div className="bf-vs-cols" style={{ marginBottom: 18 }}>
                <div className="bf-openai-col">
                  <div className="bf-vs-col-title" style={{ color: 'var(--accent)' }}>OpenAI</div>
                  {oai.strengths.map((s, i) => <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--accent)' }}>✓</span>{s}</div>)}
                </div>
                <div className="bf-comp-col" style={{ borderLeftColor: color }}>
                  <div className="bf-vs-col-title" style={{ color }}>{c.name}</div>
                  {c.strengths.map((s, i) => <div className="bf-sw" key={i}><span className="m" style={{ color }}>✓</span>{s}</div>)}
                </div>
              </div>

              <SectionLabel>Weaknesses</SectionLabel>
              <div className="bf-vs-cols" style={{ marginBottom: 18 }}>
                <div className="bf-openai-col">
                  <div className="bf-vs-col-title" style={{ color: 'var(--negative)' }}>OpenAI</div>
                  {oai.weaknesses.map((w, i) => <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--negative)' }}>✗</span>{w}</div>)}
                </div>
                <div className="bf-comp-col" style={{ borderLeftColor: color }}>
                  <div className="bf-vs-col-title" style={{ color: 'var(--negative)' }}>{c.name}</div>
                  {c.weaknesses.map((w, i) => <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--negative)' }}>✗</span>{w}</div>)}
                </div>
              </div>

              <SectionLabel>Overlap Risk Areas</SectionLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
                {c.overlap.map((o, i) => (
                  <span key={i} style={{ padding: '5px 12px', background: 'rgba(37, 99, 235, 0.08)', border: '1px solid rgba(37, 99, 235, 0.3)', borderRadius: 6, fontSize: 11, fontWeight: 600, color: 'var(--neutral)' }}>⚠ {o}</span>
                ))}
              </div>

              <SectionLabel>Battle Card — How OpenAI Wins</SectionLabel>
              <div className="bf-battle">
                {c.battle.map((b, i) => <div className="bf-battle-i" key={i}><span className="s">★</span>{b}</div>)}
              </div>
            </div>
          </GlassCard>
        )
      })}

      <GlassCard className="bf-card" intensity={4} interactive style={{ marginTop: 20 }}>
        <h3>Competitor Threat Matrix</h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="bf-tbl">
            <thead><tr><th>Competitor</th><th>Threat</th><th>Strengths</th><th>Weaknesses</th><th>Overlap</th><th>Funding</th></tr></thead>
            <tbody>
              {compKeys.map(k => {
                const c = data[k]
                return (
                  <tr key={k}>
                    <td>{c.name}</td>
                    <td><ThreatPill threat={c.threat} /></td>
                    <td>{c.strengths.length}</td>
                    <td>{c.weaknesses.length}</td>
                    <td>{c.overlap.length}</td>
                    <td style={{ fontSize: 11 }}>{c.funding}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </>
  )
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>{children}</div>
}
function TagList({ items }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{items.map(m => <span key={m} className="bf-tag">{m}</span>)}</div>
}

function CompareAll({ data }) {
  const comps = Object.values(data)
  const rows = [
    ['Threat', c => <ThreatPill threat={c.threat} />],
    ['Category', c => c.category],
    ['Core Claim', c => c.claim],
    ['Pricing', c => c.pricing],
    ['Funding', c => c.funding],
    ['Models', c => c.models.join(', ') || '—'],
    ['Products', c => c.products.join(', ')],
    ['Industries', c => c.industries.join(', ')],
    ['Strengths', c => c.strengths.map((s, i) => <div key={i} style={{ padding: '2px 0' }}>✓ {s}</div>)],
    ['Weaknesses', c => c.weaknesses.map((w, i) => <div key={i} style={{ padding: '2px 0' }}>✗ {w}</div>)],
    ['Differentiation', c => c.diff.map((d, i) => <div key={i} style={{ padding: '2px 0' }}>→ {d}</div>)],
    ['Overlap Risks', c => c.overlap.map((o, i) => <div key={i} style={{ padding: '2px 0' }}>⚠ {o}</div>)],
  ]
  return (
    <GlassCard className="bf-card" intensity={4} interactive>
      <div style={{ overflowX: 'auto' }}>
        <table className="bf-tbl">
          <thead><tr><th>Dimension</th>{comps.map(c => <th key={c.name}>{c.name}</th>)}</tr></thead>
          <tbody>
            {rows.map(([label, fn]) => (
              <tr key={label}>
                <td>{label}</td>
                {comps.map((c, i) => <td key={i}>{fn(c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  )
}

function BriefList({ data, openBrief }) {
  return (
    <div>
      {Object.keys(data).map(k => {
        const c = data[k]
        const isOai = k === OPENAI_KEY
        return (
          <GlassCard
            key={k}
            className="bf-card"
            intensity={4}
            interactive
            style={{ cursor: 'pointer', marginBottom: 12 }}
            onClick={() => openBrief(k)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {c.name}
                  {isOai && <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, marginLeft: 8, padding: '2px 6px', borderRadius: 4, background: 'var(--accent-dim)' }}>PRIMARY</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>{c.category} · {c.date}</div>
              </div>
              <ThreatPill threat={c.threat} />
            </div>
          </GlassCard>
        )
      })}
    </div>
  )
}

function BriefDetail({ c, onBack }) {
  return (
    <GlassCard className="bf-card" intensity={3} interactive>
      <button className="bf-bk" onClick={onBack}>← All Briefings</button>
      <div className="bf-b-hero">
        <div>
          <h1>{c.name}</h1>
          <div className="meta">{c.category} · Generated {c.date}</div>
        </div>
        <span className={`bf-tp bf-tp-${c.threat}`} style={{ fontSize: 12, padding: '6px 14px' }}>{c.threat.toUpperCase()} THREAT</span>
      </div>

      <Section title="Executive Summary">
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{c.summary}</p>
      </Section>

      <Section title="Positioning">
        <div className="bf-snap">
          <Snap label="Category" value={c.category} />
          <Snap label="Core Claim" value={c.claim} />
          <Snap label="Pricing" value={c.pricing} />
          <Snap label="Funding" value={c.funding} />
        </div>
      </Section>

      {c.models.length > 0 && (
        <Section title="Flagship Models">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {c.models.map(m => <span key={m} className="bf-tag" style={{ fontSize: 12, padding: '5px 12px' }}>{m}</span>)}
          </div>
        </Section>
      )}

      <Section title="Products">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {c.products.map(p => <span key={p} className="bf-tag" style={{ fontSize: 12, padding: '5px 12px' }}>{p}</span>)}
        </div>
      </Section>

      <Section title="Target Customers">
        <div className="bf-snap">
          <Snap label="Industries" value={c.industries.join(', ')} />
          <Snap label="Customer Types" value={c.customers.join(', ')} />
        </div>
      </Section>

      <Section title="Strengths & Weaknesses">
        <div className="bf-sw-2">
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Strengths</div>
            {c.strengths.map((s, i) => <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--accent)' }}>✓</span>{s}</div>)}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--negative)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Weaknesses</div>
            {c.weaknesses.map((w, i) => <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--negative)' }}>✗</span>{w}</div>)}
          </div>
        </div>
      </Section>

      <Section title="Differentiation & Overlap">
        <div className="bf-sw-2">
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Differentiation</div>
            {c.diff.map((d, i) => <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--neutral)' }}>→</span>{d}</div>)}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Overlap Risks</div>
            {c.overlap.map((o, i) => <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--neutral)' }}>⚠</span>{o}</div>)}
          </div>
        </div>
      </Section>

      <Section title="Battle Card">
        <div className="bf-battle">
          {c.battle.map((b, i) => <div className="bf-battle-i" key={i}><span className="s">★</span>{b}</div>)}
        </div>
      </Section>

      <Section title="Positioning Gaps">
        {c.gaps.map((g, i) => <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--accent)' }}>△</span>{g}</div>)}
      </Section>

      <Section title="Recent News">
        {c.news.map((n, i) => <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--text-muted)' }}>•</span>{n}</div>)}
      </Section>
    </GlassCard>
  )
}

function Section({ title, children }) {
  return <div className="bf-bs"><h3>{title}</h3>{children}</div>
}
function Snap({ label, value }) {
  return (
    <div className="bf-snap-i">
      <div className="sl">{label}</div>
      <div className="sv">{value}</div>
    </div>
  )
}

function SettingsModal({ onClose, showToast }) {
  const [url, setUrl] = useState(() => localStorage.getItem('n8n_url') || '')
  const [auth, setAuth] = useState(() => localStorage.getItem('n8n_auth') || '')
  function save() {
    localStorage.setItem('n8n_url', url.trim())
    localStorage.setItem('n8n_auth', auth.trim())
    showToast('Saved', 'ok')
    onClose()
  }
  return (
    <div className="bf-ov open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bf-mod">
        <h2>n8n Connection</h2>
        <div className="sub">Link your Competitor Briefing Generator workflow</div>
        <label>Webhook URL</label>
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://your-instance.app.n8n.cloud/webhook/..." />
        <label>Auth Header (optional)</label>
        <input value={auth} onChange={e => setAuth(e.target.value)} placeholder="Bearer your-token" />
        <div className="bf-mod-help">
          <div className="t">Setup</div>
          <ol>
            <li>Open your n8n workflow</li>
            <li>Add or find the <b>Webhook</b> trigger node</li>
            <li>Copy the <b>Production URL</b></li>
            <li>Paste above, hit <b>Save</b></li>
          </ol>
        </div>
        <div className="bf-mod-ft">
          <button className="bf-btn" onClick={onClose}>Cancel</button>
          <button className="bf-btn bf-btn-g" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
