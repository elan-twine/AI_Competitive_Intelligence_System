import { useState, useRef, useEffect, useCallback } from 'react'
import { RotateCw, Plus } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import {
  useBriefingsData,
  callBriefingProxy,
  keyFor,
  BRIEFING_NEW_PATH,
  BRIEFING_UPDATE_ALL_PATH,
} from '../hooks/useBriefingsData'
import { useCompetitors } from '../hooks/useCompetitors'
import './briefings.css'

// Best "company website" URL for a tracked competitor, to prefill the brief form.
function siteUrlFor(c) {
  if (!c) return ''
  if (c.domain) return /^https?:\/\//.test(c.domain) ? c.domain : 'https://' + String(c.domain).replace(/^\/+/, '')
  return c.linkedin_url || ''
}

const COMP_COLORS = {
  twine_security: 'var(--accent)',
  lumos: '#a78bfa',
  cerby: 'var(--neutral)',
  linx_security: 'var(--positive)',
  orchid_security: '#f472b6',
  blinkops: '#60a5fa',
  opti: '#fb923c',
  fabrix_security: '#34d399',
  surf_ai: '#fbbf24',
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
  const { briefings, loading, refetch } = useBriefingsData()
  // Roster from the Competitors page (source of truth), to offer as options —
  // minus any competitor that ALREADY has a brief (use "Update all briefs" to
  // refresh those). briefings is keyed by keyFor(name), so match on that.
  const { activeCompetitors } = useCompetitors()
  const briefedKeys = new Set(Object.keys(briefings || {}))
  const unbriefedCompetitors = (activeCompetitors || []).filter(c => !briefedKeys.has(keyFor(c.name)))
  const [subtab, setSubtab] = useState('overview')
  const [activeBrief, setActiveBrief] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  // Briefs generate asynchronously in n8n (scrape + LLM, ~1-2 min) — the webhook
  // is fire-and-forget. Track "in-flight" briefs so we can show an animated
  // Generating… card until the finished row lands in competitor_briefings.
  //   pending: { [keyFor(name)]: { name, since, baseCreatedAt } }
  const [pending, setPending] = useState({})

  const startBrief = useCallback((name) => {
    const key = keyFor(name)
    setPending(p => ({ ...p, [key]: { name, since: Date.now(), baseCreatedAt: briefings[key]?._createdAt || null } }))
  }, [briefings])

  // While anything is in flight, poll for the finished brief to land.
  useEffect(() => {
    if (!Object.keys(pending).length) return
    const iv = setInterval(() => refetch(), 8000)
    return () => clearInterval(iv)
  }, [pending, refetch])

  // Resolve an in-flight brief when its (new) row arrives, or give up after 6 min.
  // useBriefingsData returns a fresh `briefings` object each fetch, so this re-runs
  // every poll — which also lets the timeout fire even if nothing changed.
  useEffect(() => {
    setPending(prev => {
      const keys = Object.keys(prev)
      if (!keys.length) return prev
      let changed = false
      const next = { ...prev }
      for (const key of keys) {
        const b = briefings[key]
        const done = b && b._createdAt && b._createdAt !== prev[key].baseCreatedAt
        const timedOut = Date.now() - prev[key].since > 6 * 60 * 1000
        if (done || timedOut) { delete next[key]; changed = true }
      }
      return changed ? next : prev
    })
  }, [briefings])

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

      <div className="bf-nav">
        {[
          ['overview', 'Overview'],
          ['compare', 'Compare All'],
          ['briefs', 'Briefs'],
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
            competitors={unbriefedCompetitors}
            pending={pending}
            onBriefStarted={startBrief}
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
      </div>

      {toast && <div className={`bf-toast show ${toast.kind}`}>{toast.msg}</div>}
    </div>
  )
}

function WebhookBar({ competitors, onBriefStarted, showToast, refetch }) {
  const [busy, setBusy] = useState(null) // 'new' | 'loop' | null
  const [showModal, setShowModal] = useState(false)

  async function submitNew({ company, url }) {
    setBusy('new')
    try {
      await callBriefingProxy(BRIEFING_NEW_PATH, { 'Competitor Name': company, 'Competitor URL': url })
      showToast(`Generating brief for ${company}…`, 'ok')
      setShowModal(false)
      onBriefStarted?.(company)  // shows an animated Generating… card + starts polling
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
      await callBriefingProxy(BRIEFING_UPDATE_ALL_PATH, {})
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
          competitors={competitors}
          onClose={() => setShowModal(false)}
          onSubmit={submitNew}
          busy={busy === 'new'}
        />
      )}
    </>
  )
}

function NewCompetitorModal({ competitors = [], onClose, onSubmit, busy }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')

  // Options come from the tracked roster (Competitors page). Names already with a
  // brief are marked so you don't unknowingly regenerate one. Still free-text —
  // you can type a brand-new competitor not yet on the list.
  const roster = [...competitors].sort((a, b) => a.name.localeCompare(b.name))

  const trimmedName = name.trim()
  const trimmedUrl = url.trim()
  const valid = !!trimmedName && !!trimmedUrl

  // Picking a listed competitor auto-fills its website into the URL field.
  function onNameChange(v) {
    setName(v)
    const c = roster.find(x => x.name.toLowerCase() === v.trim().toLowerCase())
    if (c) { const s = siteUrlFor(c); if (s) setUrl(s) }
  }

  function handleSubmit() {
    if (!valid) return
    onSubmit({ company: trimmedName, url: trimmedUrl })
  }

  return (
    <div className="bf-ov open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bf-mod">
        <h2>New competitor</h2>
        <div className="sub">Generate a brief and write it to <code>competitor_briefings</code>. Pick a tracked competitor or type a new one.</div>
        <label>Competitor name</label>
        <input
          list="bf-competitor-list"
          value={name}
          onChange={e => onNameChange(e.target.value)}
          placeholder="e.g. Linx Security"
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && valid) handleSubmit() }}
        />
        <datalist id="bf-competitor-list">
          {roster.map(c => <option key={c.id} value={c.name} />)}
        </datalist>
        <label>Competitor URL</label>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="e.g. https://www.cerby.com"
          onKeyDown={e => { if (e.key === 'Enter' && valid) handleSubmit() }}
        />
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

function Overview({ data, competitors, pending = {}, onBriefStarted, loading, openBrief, showToast, refetch }) {
  const all = Object.values(data)
  const uniqProducts = new Set(all.flatMap(c => c.products || []))
  const highCount = all.filter(c => c.threat === 'high' || c.threat === 'critical').length
  const overlapTotal = all.reduce((s, c) => s + (c.overlap?.length || 0), 0)
  const maxProducts = Math.max(1, ...all.map(c => (c.products || []).length))
  // In-flight briefs whose finished row hasn't landed yet → animated cards.
  const pendingList = Object.entries(pending).filter(([key]) => !data[key]).map(([, p]) => p)

  return (
    <>
      <WebhookBar competitors={competitors} onBriefStarted={onBriefStarted} showToast={showToast} refetch={refetch} />

      <div className="bf-stats">
        <StatCard label="Competitors" value={all.length} />
        <StatCard label="High Threat" value={highCount} valueColor="var(--negative)" />
        <StatCard label="Overlap Areas" value={overlapTotal} valueColor="var(--neutral)" />
        <StatCard label="Products Tracked" value={uniqProducts.size} accent />
      </div>

      {all.length === 0 && !loading && pendingList.length === 0 && (
        <GlassCard className="bf-card" intensity={3} interactive>
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            No briefings yet. Generate one via n8n to populate the <code>competitor_briefings</code> table.
          </div>
        </GlassCard>
      )}

      {(all.length > 0 || pendingList.length > 0) && (
        <div className="bf-g3">
          {pendingList.map(p => <PendingBriefCard key={'pending-' + p.name} name={p.name} />)}
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

// Animated placeholder shown while a brief is generating in n8n (scrape + LLM),
// before the finished row lands. Replaced by the real card once it arrives.
function PendingBriefCard({ name }) {
  return (
    <GlassCard className="bf-card bf-generating" intensity={4} interactive>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--text-primary)' }}>{name}</div>
        <span className="bf-spin" />
      </div>
      <div className="bf-gen-label">Generating competitive brief…</div>
      <div className="bf-gen-sub">Scraping the web + analyzing — this can take a minute or two.</div>
      <div className="bf-gen-bars"><span /><span /><span /></div>
    </GlassCard>
  )
}

function CompareAll({ data, loading }) {
  const comps = Object.values(data)
  if (loading) return <GlassCard className="bf-card" intensity={3} interactive><div style={{ padding: 16, color: 'var(--text-muted)' }}>Loading…</div></GlassCard>
  if (comps.length === 0) return <GlassCard className="bf-card" intensity={3} interactive><div style={{ padding: 16, color: 'var(--text-muted)' }}>No briefings yet.</div></GlassCard>
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
  if (loading) return <GlassCard className="bf-card" intensity={3} interactive><div style={{ padding: 16, color: 'var(--text-muted)' }}>Loading…</div></GlassCard>
  const keys = Object.keys(data)
  if (keys.length === 0) return <GlassCard className="bf-card" intensity={3} interactive><div style={{ padding: 16, color: 'var(--text-muted)' }}>No briefings yet — generate one to get started.</div></GlassCard>
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

      {(c.marketingStrategy || []).length > 0 && (
        <Section title="Marketing Strategy — from Share-of-Voice signals">
          {c.marketingStrategy.map((m, i) => (
            <div className="bf-sw" key={i}><span className="m" style={{ color: 'var(--accent)' }}>◆</span>{m}</div>
          ))}
        </Section>
      )}

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

