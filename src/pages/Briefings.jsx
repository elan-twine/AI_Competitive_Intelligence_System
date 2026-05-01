import { useState, useEffect, useRef } from 'react'
import { RefreshCw, RotateCw, Plus } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import {
  useBriefingsData,
  N8N_NEW_COMPETITOR_WEBHOOK,
  N8N_UPDATE_ALL_WEBHOOK,
} from '../hooks/useBriefingsData'
import './briefings.css'

const COMP_COLORS = {
  twine_security: 'var(--accent)',
  lumos: '#a78bfa',
  cerby: 'var(--neutral)',
  linx_security: 'var(--positive)',
  orchid_security: '#f472b6',
  blinkops: '#60a5fa',
  opti: '#fb923c',
  fabrix_security: '#34d399',
  nagomi_security: '#fbbf24',
  redblock: 'var(--negative)',
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
  const { briefings, posts, urns, loading, refetch } = useBriefingsData()
  const [subtab, setSubtab] = useState('overview')
  const [activeBrief, setActiveBrief] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

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
        <button className="bf-btn" onClick={refetch} title="Refetch from Supabase">
          <RefreshCw size={13} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="bf-nav">
        {[
          ['overview', 'Overview'],
          ['compare', 'Compare All'],
          ['briefs', 'Briefings'],
          ['posts', 'Posts of Interest'],
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
          <Overview
            data={briefings}
            posts={posts}
            urns={urns}
            loading={loading}
            openBrief={openBrief}
            showToast={showToast}
            refetch={refetch}
          />
        )}
        {subtab === 'compare' && <CompareAll data={briefings} loading={loading} />}
        {subtab === 'briefs' && (
          activeBrief && briefings[activeBrief]
            ? <BriefDetail c={briefings[activeBrief]} onBack={() => setActiveBrief(null)} />
            : <BriefList data={briefings} loading={loading} openBrief={openBrief} />
        )}
        {subtab === 'posts' && <PostsList posts={posts} loading={loading} />}
      </div>

      {toast && <div className={`bf-toast show ${toast.kind}`}>{toast.msg}</div>}
    </div>
  )
}

function WebhookBar({ urns, showToast, refetch }) {
  const [busy, setBusy] = useState(null) // 'new' | 'loop' | null
  const [showModal, setShowModal] = useState(false)

  async function submitNew({ company, urn }) {
    setBusy('new')
    try {
      const body = { competitor: company, company, urn, URN: urn }
      const r = await fetch(N8N_NEW_COMPETITOR_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        mode: 'cors',
      })
      if (!r.ok) throw new Error(`webhook returned ${r.status}`)
      showToast(`${company} queued — refetching…`, 'ok')
      setShowModal(false)
      setTimeout(refetch, 2500)
    } catch (e) {
      showToast('Error: ' + e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  async function fireLoop() {
    if (!confirm('Re-scrape and update ALL existing briefs? This may take a while.')) return
    setBusy('loop')
    try {
      const r = await fetch(N8N_UPDATE_ALL_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        mode: 'cors',
      })
      if (!r.ok) throw new Error(`webhook returned ${r.status}`)
      showToast('Update-all loop triggered — refetching in 5s…', 'ok')
      setTimeout(refetch, 5000)
    } catch (e) {
      showToast('Error: ' + e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="bf-action-bar">
        <button
          className="bf-action-btn primary"
          onClick={() => setShowModal(true)}
          disabled={busy !== null}
          title="Add a new competitor — writes one row to competitor_briefings"
        >
          {busy === 'new' ? <span className="bf-spin" /> : <><Plus size={14} /> New competitor</>}
        </button>
        <button
          className="bf-action-btn"
          onClick={fireLoop}
          disabled={busy !== null}
          title="Re-scrape and update every existing brief"
        >
          {busy === 'loop' ? <span className="bf-spin" /> : <><RotateCw size={14} /> Update all briefs</>}
        </button>
      </div>

      {showModal && (
        <NewCompetitorModal
          urns={urns}
          onClose={() => setShowModal(false)}
          onSubmit={submitNew}
          busy={busy === 'new'}
        />
      )}
    </>
  )
}

function NewCompetitorModal({ urns, onClose, onSubmit, busy }) {
  const [name, setName] = useState('')
  const [urn, setUrn] = useState('')

  // Auto-fill URN when typed name matches a known company in linkedin_URNs
  useEffect(() => {
    const match = urns.find(u => u.company && u.company.toLowerCase() === name.trim().toLowerCase())
    if (match && match.URN != null) setUrn(String(match.URN))
  }, [name, urns])

  const trimmedName = name.trim()
  const trimmedUrn = urn.trim()
  const valid = !!trimmedName && !!trimmedUrn

  function handleSubmit() {
    if (!valid) return
    onSubmit({ company: trimmedName, urn: trimmedUrn })
  }

  return (
    <div className="bf-ov open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bf-mod">
        <h2>New competitor</h2>
        <div className="sub">Generate a brief and write it to <code>competitor_briefings</code>.</div>
        <label>Competitor name</label>
        <input
          list="bf-urn-list"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Linx Security"
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && valid) handleSubmit() }}
        />
        <datalist id="bf-urn-list">
          {urns.map(u => <option key={u.id} value={u.company} />)}
        </datalist>
        <label>LinkedIn URN</label>
        <input
          value={urn}
          onChange={e => setUrn(e.target.value)}
          placeholder="e.g. 92514012"
          onKeyDown={e => { if (e.key === 'Enter' && valid) handleSubmit() }}
        />
        <div className="bf-mod-help">
          <div className="t">Tip</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            URN is the LinkedIn company numeric ID — find it in the company page source under <code>companyId</code> or <code>urn:li:fsd_company:</code>. Typing a name already in <code>linkedin_URNs</code> auto-fills the URN.
          </div>
        </div>
        <div className="bf-mod-ft">
          <button className="bf-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="bf-btn bf-btn-g" onClick={handleSubmit} disabled={!valid || busy}>
            {busy ? <span className="bf-spin" /> : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Overview({ data, posts, urns, loading, openBrief, showToast, refetch }) {
  const all = Object.values(data)
  const uniqProducts = new Set(all.flatMap(c => c.products || []))
  const highCount = all.filter(c => c.threat === 'high' || c.threat === 'critical').length
  const overlapTotal = all.reduce((s, c) => s + (c.overlap?.length || 0), 0)
  const maxProducts = Math.max(1, ...all.map(c => (c.products || []).length))

  return (
    <>
      <WebhookBar urns={urns} showToast={showToast} refetch={refetch} />

      <div className="bf-stats">
        <StatCard label="Competitors" value={all.length} />
        <StatCard label="High Threat" value={highCount} valueColor="var(--negative)" />
        <StatCard label="Overlap Areas" value={overlapTotal} valueColor="var(--neutral)" />
        <StatCard label="Products Tracked" value={uniqProducts.size} accent />
      </div>

      {all.length === 0 && !loading && (
        <GlassCard className="bf-card" intensity={3} interactive>
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            No briefings yet. Generate one via n8n to populate the <code>competitor_briefings</code> table.
          </div>
        </GlassCard>
      )}

      {all.length > 0 && (
        <div className="bf-g3">
          {Object.keys(data).map(k => {
            const c = data[k]
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
                  </div>
                  <ThreatPill threat={c.threat} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{c.category} · {c.date}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>{c.claim}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(c.products || []).slice(0, 3).map(p => <span key={p} className="bf-tag">{p}</span>)}
                  {(c.products || []).length > 3 && <span className="bf-tag">+{c.products.length - 3}</span>}
                </div>
              </GlassCard>
            )
          })}
        </div>
      )}

      {all.length > 0 && (
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
              const len = (c.products || []).length
              return (
                <div className="bf-bar-r" key={k}>
                  <div className="bf-bar-l">{c.name}</div>
                  <div className="bf-bar-t">
                    <div className="bf-bar-f" style={{ width: `${(len / maxProducts) * 100}%`, background: 'var(--accent)' }}>
                      {len}
                    </div>
                  </div>
                </div>
              )
            })}
          </GlassCard>
        </div>
      )}

      <GlassCard className="bf-card" intensity={3} interactive>
        <h3>Recent Posts of Interest</h3>
        {loading && <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0' }}>Loading…</div>}
        {!loading && posts.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0' }}>No posts of interest yet.</div>
        )}
        {posts.slice(0, 12).map((p, i) => (
          <div key={p.id ?? i} style={{
            display: 'flex',
            gap: 14,
            padding: '10px 0',
            borderBottom: i === Math.min(posts.length, 12) - 1 ? 'none' : '1px solid var(--divider)',
            fontSize: 12,
            alignItems: 'flex-start',
          }}>
            <span style={{ color: 'var(--text-muted)', width: 90, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {(p.date || p.created_at || '').slice(0, 10)}
            </span>
            <span style={{ fontWeight: 600, width: 130, flexShrink: 0, color: 'var(--text-primary)' }}>{p.author}</span>
            <span style={{ color: 'var(--text-secondary)', lineHeight: 1.5, flex: 1 }}>
              {p.summary}{' '}
              {p.url && <a href={p.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}>↗</a>}
            </span>
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

function CompareAll({ data, loading }) {
  const comps = Object.values(data)
  if (loading) return <GlassCard className="bf-card" intensity={3}><div style={{ padding: 16, color: 'var(--text-muted)' }}>Loading…</div></GlassCard>
  if (comps.length === 0) return <GlassCard className="bf-card" intensity={3}><div style={{ padding: 16, color: 'var(--text-muted)' }}>No briefings yet.</div></GlassCard>
  const rows = [
    ['Threat', c => <ThreatPill threat={c.threat} />],
    ['Category', c => c.category],
    ['Core Claim', c => c.claim],
    ['Pricing', c => c.pricing],
    ['Funding', c => c.funding],
    ['Models', c => (c.models || []).join(', ') || '—'],
    ['Products', c => (c.products || []).join(', ')],
    ['Industries', c => (c.industries || []).join(', ')],
    ['Strengths', c => (c.strengths || []).map((s, i) => <div key={i} style={{ padding: '2px 0' }}>✓ {s}</div>)],
    ['Weaknesses', c => (c.weaknesses || []).map((w, i) => <div key={i} style={{ padding: '2px 0' }}>✗ {w}</div>)],
    ['Differentiation', c => (c.diff || []).map((d, i) => <div key={i} style={{ padding: '2px 0' }}>→ {d}</div>)],
    ['Overlap Risks', c => (c.overlap || []).map((o, i) => <div key={i} style={{ padding: '2px 0' }}>⚠ {o}</div>)],
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

function BriefList({ data, loading, openBrief }) {
  if (loading) return <GlassCard className="bf-card" intensity={3}><div style={{ padding: 16, color: 'var(--text-muted)' }}>Loading…</div></GlassCard>
  const keys = Object.keys(data)
  if (keys.length === 0) return <GlassCard className="bf-card" intensity={3}><div style={{ padding: 16, color: 'var(--text-muted)' }}>No briefings yet — generate one to get started.</div></GlassCard>
  return (
    <div>
      {keys.map(k => {
        const c = data[k]
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
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{c.name}</div>
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

function PostsList({ posts, loading }) {
  if (loading) return <GlassCard className="bf-card" intensity={3}><div style={{ padding: 16, color: 'var(--text-muted)' }}>Loading…</div></GlassCard>
  if (posts.length === 0) return <GlassCard className="bf-card" intensity={3}><div style={{ padding: 16, color: 'var(--text-muted)' }}>No posts of interest in Supabase.</div></GlassCard>
  return (
    <GlassCard className="bf-card" intensity={3} interactive>
      <h3>Posts of Interest ({posts.length})</h3>
      {posts.map((p, i) => (
        <div key={p.id ?? i} style={{
          display: 'flex',
          gap: 14,
          padding: '14px 0',
          borderBottom: i === posts.length - 1 ? 'none' : '1px solid var(--divider)',
          fontSize: 12,
          alignItems: 'flex-start',
        }}>
          <span style={{ color: 'var(--text-muted)', width: 90, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {(p.date || p.created_at || '').slice(0, 10)}
          </span>
          <span style={{ fontWeight: 600, width: 140, flexShrink: 0, color: 'var(--text-primary)' }}>{p.author}</span>
          <div style={{ flex: 1, lineHeight: 1.5 }}>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>{p.summary}</div>
            {p.relevance_reason && (
              <div style={{ color: 'var(--text-muted)', fontSize: 11, fontStyle: 'italic' }}>Relevance: {p.relevance_reason}</div>
            )}
            {p.url && <a href={p.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 11 }}>open post ↗</a>}
          </div>
        </div>
      ))}
    </GlassCard>
  )
}

function BriefDetail({ c, onBack }) {
  return (
    <GlassCard className="bf-card" intensity={3} interactive>
      <button className="bf-bk" onClick={onBack}>← All Briefings</button>
      <div className="bf-b-hero">
        <div>
          <h1>{c.name}</h1>
          <div className="meta">{c.category} · Generated {c.date}{c.urn ? ` · URN ${c.urn}` : ''}</div>
        </div>
        <span className={`bf-tp bf-tp-${c.threat}`} style={{ fontSize: 12, padding: '6px 14px' }}>{(c.threat || '').toUpperCase()} THREAT</span>
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

      {(c.models || []).length > 0 && (
        <Section title="Flagship Models">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {c.models.map(m => <span key={m} className="bf-tag" style={{ fontSize: 12, padding: '5px 12px' }}>{m}</span>)}
          </div>
        </Section>
      )}

      {(c.products || []).length > 0 && (
        <Section title="Products">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {c.products.map(p => <span key={p} className="bf-tag" style={{ fontSize: 12, padding: '5px 12px' }}>{p}</span>)}
          </div>
        </Section>
      )}

      <Section title="Target Customers">
        <div className="bf-snap">
          <Snap label="Industries" value={(c.industries || []).join(', ')} />
          <Snap label="Customer Types" value={(c.customers || []).join(', ')} />
        </div>
      </Section>

      <Section title="Strengths & Weaknesses">
        <div className="bf-sw-2">
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Strengths</div>
            {(c.strengths || []).map((s, i) => <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--accent)' }}>✓</span>{s}</div>)}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--negative)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Weaknesses</div>
            {(c.weaknesses || []).map((w, i) => <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--negative)' }}>✗</span>{w}</div>)}
          </div>
        </div>
      </Section>

      <Section title="Differentiation & Overlap">
        <div className="bf-sw-2">
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Differentiation</div>
            {(c.diff || []).map((d, i) => <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--neutral)' }}>→</span>{d}</div>)}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Overlap Risks</div>
            {(c.overlap || []).map((o, i) => <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--neutral)' }}>⚠</span>{o}</div>)}
          </div>
        </div>
      </Section>

      {(c.battle || []).length > 0 && (
        <Section title="Battle Card">
          <div className="bf-battle">
            {c.battle.map((b, i) => <div className="bf-battle-i" key={i}><span className="s">★</span>{b}</div>)}
          </div>
        </Section>
      )}

      {(c.gaps || []).length > 0 && (
        <Section title="Positioning Gaps">
          {c.gaps.map((g, i) => <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--accent)' }}>△</span>{g}</div>)}
        </Section>
      )}

      {(c.news || []).length > 0 && (
        <Section title="Recent News">
          {c.news.map((n, i) => <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--text-muted)' }}>•</span>{n}</div>)}
        </Section>
      )}
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

