import { useState } from 'react'
import { ArrowLeft, LogOut, Plus, Pencil, Check, X, Trash2, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { useCompetitors } from '../hooks/useCompetitors'
import '../App.css'
import './competitors.css'

// comma-separated string <-> text[] helpers
const toList = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean)
const fromList = (arr) => (Array.isArray(arr) ? arr.join(', ') : '')

// Parse a LinkedIn company URL → slug, and derive a reasonable display name.
const LI_COMPANY_RE = /linkedin\.com\/(?:company|school)\/([^/?#\s]+)/i
const slugFromUrl = (url) => (String(url).match(LI_COMPANY_RE)?.[1] || '').toLowerCase()
const nameFromSlug = (slug) =>
  slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()

const EMPTY_ADV = { aliases: '', linkedin_urn: '', domain: '', x_handle: '', subreddits: '' }

export default function Competitors({ onLogout, onNavigate }) {
  const { competitors, loading, error, addCompetitor, updateCompetitor } = useCompetitors()

  // Quick-add by URL
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [nameAuto, setNameAuto] = useState(true)   // name is auto-derived until user edits it
  const [adv, setAdv] = useState(EMPTY_ADV)
  const [showAdv, setShowAdv] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState(null)
  const [addType, setAddType] = useState('direct')   // direct = counted in SOV ranking; indirect = tracked/analyzed only

  // List / edit
  const [editId, setEditId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', aliases: '', linkedin_urn: '', linkedin_url: '', domain: '', x_handle: '', subreddits: '', type: 'direct' })
  const [busyId, setBusyId] = useState(null)
  const [showRemoved, setShowRemoved] = useState(false)

  const onUrlChange = (e) => {
    const v = e.target.value
    setUrl(v)
    if (nameAuto) {
      const slug = slugFromUrl(v)
      setName(slug ? nameFromSlug(slug) : '')
    }
  }
  const onNameChange = (e) => { setName(e.target.value); setNameAuto(false) }
  const onAdv = (e) => { const { name: n, value } = e.target; setAdv(p => ({ ...p, [n]: value })) }

  const handleAdd = async (e) => {
    e.preventDefault()
    setAddError(null)
    const slug = slugFromUrl(url)
    if (!slug) { setAddError('Paste a LinkedIn company URL, e.g. https://www.linkedin.com/company/orchid-security'); return }
    const finalName = (name || nameFromSlug(slug)).trim()
    if (!finalName) { setAddError('Could not derive a name — type one in.'); return }
    setAdding(true)
    try {
      await addCompetitor({
        name: finalName,
        aliases: toList(adv.aliases),
        linkedin_url: `https://www.linkedin.com/company/${slug}`,
        linkedin_urn: adv.linkedin_urn.trim() || null,   // resolved automatically on the next pipeline run if blank
        domain: adv.domain.trim() || null,
        x_handle: adv.x_handle.trim().replace(/^@/, '') || null,
        subreddits: toList(adv.subreddits),
        type: addType,
        is_self: false,
        active: true,
      })
      setUrl(''); setName(''); setNameAuto(true); setAdv(EMPTY_ADV); setShowAdv(false); setAddType('direct')
    } catch (err) {
      setAddError(err.message || 'Failed to add competitor')
    } finally {
      setAdding(false)
    }
  }

  const setActive = async (c, active) => {
    setBusyId(c.id)
    try { await updateCompetitor(c.id, { active }) }
    catch (err) { alert(err.message || 'Failed to update') }
    finally { setBusyId(null) }
  }

  const startEdit = (c) => {
    setEditId(c.id)
    setEditForm({
      name: c.name || '', aliases: fromList(c.aliases), linkedin_urn: c.linkedin_urn || '',
      linkedin_url: c.linkedin_url || '', domain: c.domain || '', x_handle: c.x_handle || '',
      subreddits: fromList(c.subreddits), type: c.type || 'direct',
    })
  }
  const saveEdit = async (id) => {
    if (!editForm.name.trim()) return
    setBusyId(id)
    try {
      await updateCompetitor(id, {
        name: editForm.name.trim(), aliases: toList(editForm.aliases),
        linkedin_urn: editForm.linkedin_urn.trim() || null, linkedin_url: editForm.linkedin_url.trim() || null,
        domain: editForm.domain.trim() || null, x_handle: editForm.x_handle.trim().replace(/^@/, '') || null,
        subreddits: toList(editForm.subreddits), type: editForm.type,
      })
      setEditId(null)
    } catch (err) { alert(err.message || 'Failed to save') }
    finally { setBusyId(null) }
  }

  const active = competitors.filter(c => c.active !== false)
  const removed = competitors.filter(c => c.active === false)

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <img src="/twine-logo.svg" alt="Twine" className="header-logo" />
          <h1>Twine <span>Competitors</span></h1>
        </div>
        <div className="header-right">
          {onNavigate && (
            <button className="theme-btn" onClick={() => onNavigate('dashboard')} aria-label="Back to dashboard" title="Back to dashboard">
              <ArrowLeft size={16} />
            </button>
          )}
          {onLogout && (
            <button className="theme-btn" onClick={onLogout} aria-label="Log out" title="Log out">
              <LogOut size={16} />
            </button>
          )}
        </div>
      </header>

      {/* Quick add by LinkedIn URL */}
      <GlassCard className="card" style={{ marginBottom: 32 }} intensity={3} interactive>
        <div className="card-header">
          <span className="card-title">Add a competitor</span>
          <span className="card-badge"><Plus size={11} style={{ marginRight: 4 }} />New</span>
        </div>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 13 }}>
          Paste a LinkedIn company URL and click Add — the name fills in automatically, and the LinkedIn ID is resolved on the next run.
        </p>
        <form className="comp-form" onSubmit={handleAdd}>
          <div className="comp-quickadd">
            <Field label="LinkedIn company URL *" value={url} onChange={onUrlChange}
              placeholder="https://www.linkedin.com/company/orchid-security" autoFocus />
            <Field label="Name" value={name} onChange={onNameChange} placeholder="(auto-filled from the URL)" />
            <label className="auth-field comp-field">
              <span>Type</span>
              <select value={addType} onChange={e => setAddType(e.target.value)}>
                <option value="direct">Direct — counted in SOV ranking</option>
                <option value="indirect">Indirect — track &amp; learn only</option>
              </select>
            </label>
          </div>

          <button type="button" className="comp-adv-toggle" onClick={() => setShowAdv(s => !s)}>
            {showAdv ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Advanced (aliases, domain, X, subreddits)
          </button>
          {showAdv && (
            <div className="comp-form-grid">
              <Field label="Aliases (comma-separated)" name="aliases" value={adv.aliases} onChange={onAdv} placeholder="Orchid, Orchid Sec" />
              <Field label="Domain" name="domain" value={adv.domain} onChange={onAdv} placeholder="orchid.security" />
              <Field label="X handle" name="x_handle" value={adv.x_handle} onChange={onAdv} placeholder="orchidsec" />
              <Field label="Subreddits (comma-separated)" name="subreddits" value={adv.subreddits} onChange={onAdv} placeholder="cybersecurity, netsec" />
              <Field label="LinkedIn URN (optional — auto-resolved)" name="linkedin_urn" value={adv.linkedin_urn} onChange={onAdv} placeholder="1234567" />
            </div>
          )}

          {addError && <div className="auth-error">{addError}</div>}
          <button type="submit" className="cta-primary comp-add-btn" disabled={adding}>
            {adding ? 'Adding…' : (<><Plus size={16} /> Add competitor</>)}
          </button>
        </form>
      </GlassCard>

      {/* Tracked competitors (active only by default) */}
      <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4} interactive>
        <div className="card-header">
          <span className="card-title">Tracked competitors</span>
          <span className="card-badge">{active.length} tracked</span>
        </div>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
          Remove drops a competitor from scraping and the dashboard immediately. History is kept, so you can re-add it anytime.
        </p>

        {loading ? (
          <div className="empty-state"><p>Loading…</p></div>
        ) : error ? (
          <div className="empty-state"><p>Error: {error}</p></div>
        ) : active.length === 0 ? (
          <div className="empty-state"><p>No competitors yet — add one above.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="breakdown-table comp-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Name</th>
                  <th style={{ textAlign: 'left' }}>Type</th>
                  <th style={{ textAlign: 'left' }}>Domain</th>
                  <th style={{ textAlign: 'left' }}>LinkedIn</th>
                  <th style={{ textAlign: 'left' }}>X handle</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {active.map(c => {
                  const editing = editId === c.id
                  const isBusy = busyId === c.id
                  if (editing) {
                    return (
                      <tr key={c.id} className="comp-edit-row">
                        <td><input name="name" value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} /></td>
                        <td>
                          <select value={editForm.type} onChange={e => setEditForm(p => ({ ...p, type: e.target.value }))}>
                            <option value="direct">direct</option>
                            <option value="indirect">indirect</option>
                          </select>
                        </td>
                        <td><input name="domain" value={editForm.domain} onChange={e => setEditForm(p => ({ ...p, domain: e.target.value }))} /></td>
                        <td><input name="linkedin_url" value={editForm.linkedin_url} onChange={e => setEditForm(p => ({ ...p, linkedin_url: e.target.value }))} /></td>
                        <td><input name="x_handle" value={editForm.x_handle} onChange={e => setEditForm(p => ({ ...p, x_handle: e.target.value }))} /></td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="comp-actions">
                            <button className="icon-btn" title="Save" disabled={isBusy} onClick={() => saveEdit(c.id)}><Check size={14} /></button>
                            <button className="icon-btn" title="Cancel" onClick={() => setEditId(null)}><X size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    )
                  }
                  return (
                    <tr key={c.id} className={c.is_self ? 'is-twine' : ''}>
                      <td className="col-company">
                        {c.name}
                        {c.aliases?.length > 0 && <span className="comp-aliases"> ({c.aliases.join(', ')})</span>}
                      </td>
                      <td><span className={`comp-type ${(c.type || 'direct') === 'indirect' ? 'indirect' : 'direct'}`}>{c.type || 'direct'}</span></td>
                      <td>{c.domain || '—'}</td>
                      <td>{c.linkedin_url ? <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer">page ↗</a> : '—'}</td>
                      <td>{c.x_handle ? `@${c.x_handle}` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="comp-actions">
                          <button className="icon-btn" title="Edit" disabled={isBusy} onClick={() => startEdit(c)}><Pencil size={14} /></button>
                          {!c.is_self && (
                            <button className="icon-btn danger" title="Remove (deactivate — history kept)" disabled={isBusy} onClick={() => setActive(c, false)}><Trash2 size={14} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {removed.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <button className="comp-adv-toggle" onClick={() => setShowRemoved(s => !s)}>
              {showRemoved ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Removed ({removed.length})
            </button>
            {showRemoved && (
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="breakdown-table comp-table">
                  <tbody>
                    {removed.map(c => (
                      <tr key={c.id} style={{ opacity: 0.6 }}>
                        <td className="col-company">{c.name}</td>
                        <td>{c.domain || '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="icon-btn" title="Re-add to tracking" disabled={busyId === c.id} onClick={() => setActive(c, true)}>
                            <RotateCcw size={14} /> Re-add
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </GlassCard>
    </div>
  )
}

function Field({ label, ...props }) {
  return (
    <label className="auth-field comp-field">
      <span>{label}</span>
      <input type="text" {...props} />
    </label>
  )
}
