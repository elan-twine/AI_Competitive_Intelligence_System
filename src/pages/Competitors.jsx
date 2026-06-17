import { useState } from 'react'
import { ArrowLeft, LogOut, Plus, Pencil, Check, X } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { useCompetitors } from '../hooks/useCompetitors'
import '../App.css'
import './competitors.css'

// comma-separated string <-> text[] helpers
const toList = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean)
const fromList = (arr) => (Array.isArray(arr) ? arr.join(', ') : '')

const EMPTY_FORM = {
  name: '',
  aliases: '',
  linkedin_urn: '',
  linkedin_url: '',
  domain: '',
  x_handle: '',
  subreddits: '',
}

function buildPayload(form) {
  return {
    name: form.name.trim(),
    aliases: toList(form.aliases),
    linkedin_urn: form.linkedin_urn.trim() || null,
    linkedin_url: form.linkedin_url.trim() || null,
    domain: form.domain.trim() || null,
    x_handle: form.x_handle.trim().replace(/^@/, '') || null,
    subreddits: toList(form.subreddits),
  }
}

export default function Competitors({ onLogout, onNavigate }) {
  const {
    competitors, loading, error,
    addCompetitor, updateCompetitor,
  } = useCompetitors()

  const [form, setForm] = useState(EMPTY_FORM)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState(null)
  const [editId, setEditId] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_FORM)
  const [busyId, setBusyId] = useState(null)

  const onField = (setter) => (e) => {
    const { name, value } = e.target
    setter(prev => ({ ...prev, [name]: value }))
  }

  const handleAdd = async (e) => {
    e.preventDefault()
    setAddError(null)
    if (!form.name.trim()) { setAddError('Name is required'); return }
    setAdding(true)
    try {
      await addCompetitor({ ...buildPayload(form), is_self: false, active: true })
      setForm(EMPTY_FORM)
    } catch (err) {
      setAddError(err.message || 'Failed to add competitor')
    } finally {
      setAdding(false)
    }
  }

  const startEdit = (c) => {
    setEditId(c.id)
    setEditForm({
      name: c.name || '',
      aliases: fromList(c.aliases),
      linkedin_urn: c.linkedin_urn || '',
      linkedin_url: c.linkedin_url || '',
      domain: c.domain || '',
      x_handle: c.x_handle || '',
      subreddits: fromList(c.subreddits),
    })
  }

  const saveEdit = async (id) => {
    if (!editForm.name.trim()) return
    setBusyId(id)
    try {
      await updateCompetitor(id, buildPayload(editForm))
      setEditId(null)
    } catch (err) {
      alert(err.message || 'Failed to save')
    } finally {
      setBusyId(null)
    }
  }

  const toggleActive = async (c) => {
    setBusyId(c.id)
    try {
      await updateCompetitor(c.id, { active: !(c.active !== false) })
    } catch (err) {
      alert(err.message || 'Failed to update')
    } finally {
      setBusyId(null)
    }
  }

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

      {/* Add competitor */}
      <GlassCard className="card" style={{ marginBottom: 32 }} intensity={3} interactive>
        <div className="card-header">
          <span className="card-title">Add competitor</span>
          <span className="card-badge"><Plus size={11} style={{ marginRight: 4 }} />New</span>
        </div>
        <form className="comp-form" onSubmit={handleAdd}>
          <div className="comp-form-grid">
            <Field label="Name *" name="name" value={form.name} onChange={onField(setForm)} placeholder="Orchid Security" autoFocus />
            <Field label="Aliases (comma-separated)" name="aliases" value={form.aliases} onChange={onField(setForm)} placeholder="Orchid, Orchid Sec" />
            <Field label="LinkedIn URN" name="linkedin_urn" value={form.linkedin_urn} onChange={onField(setForm)} placeholder="1234567" />
            <Field label="LinkedIn URL" name="linkedin_url" value={form.linkedin_url} onChange={onField(setForm)} placeholder="https://linkedin.com/company/…" />
            <Field label="Domain" name="domain" value={form.domain} onChange={onField(setForm)} placeholder="orchid.security" />
            <Field label="X handle" name="x_handle" value={form.x_handle} onChange={onField(setForm)} placeholder="orchidsec" />
            <Field label="Subreddits (comma-separated)" name="subreddits" value={form.subreddits} onChange={onField(setForm)} placeholder="cybersecurity, netsec" />
          </div>
          {addError && <div className="auth-error">{addError}</div>}
          <button type="submit" className="cta-primary comp-add-btn" disabled={adding}>
            {adding ? 'Adding…' : (<><Plus size={16} /> Add competitor</>)}
          </button>
        </form>
      </GlassCard>

      {/* Competitor list */}
      <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4} interactive>
        <div className="card-header">
          <span className="card-title">Tracked competitors</span>
          <span className="card-badge">{competitors.filter(c => c.active !== false).length} tracked</span>
        </div>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
          Removing a competitor just deactivates it — it stops being scraped and drops off the dashboard, but its history is kept and you can re-add it anytime.
        </p>

        {loading ? (
          <div className="empty-state"><p>Loading…</p></div>
        ) : error ? (
          <div className="empty-state"><p>Error: {error}</p></div>
        ) : competitors.length === 0 ? (
          <div className="empty-state"><p>No competitors yet — add one above.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="breakdown-table comp-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Name</th>
                  <th style={{ textAlign: 'left' }}>Domain</th>
                  <th style={{ textAlign: 'left' }}>LinkedIn URN</th>
                  <th style={{ textAlign: 'left' }}>X handle</th>
                  <th>Tracked</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {competitors.map(c => {
                  const editing = editId === c.id
                  const isBusy = busyId === c.id
                  if (editing) {
                    return (
                      <tr key={c.id} className="comp-edit-row">
                        <td><input name="name" value={editForm.name} onChange={onField(setEditForm)} /></td>
                        <td><input name="domain" value={editForm.domain} onChange={onField(setEditForm)} /></td>
                        <td><input name="linkedin_urn" value={editForm.linkedin_urn} onChange={onField(setEditForm)} /></td>
                        <td><input name="x_handle" value={editForm.x_handle} onChange={onField(setEditForm)} /></td>
                        <td style={{ textAlign: 'center' }}>—</td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="comp-actions">
                            <button className="icon-btn" title="Save" disabled={isBusy} onClick={() => saveEdit(c.id)}><Check size={14} /></button>
                            <button className="icon-btn" title="Cancel" onClick={() => setEditId(null)}><X size={14} /></button>
                          </div>
                          {(editForm.aliases || editForm.subreddits || editForm.linkedin_url) && (
                            <div className="comp-edit-extra">
                              <input name="aliases" placeholder="aliases" value={editForm.aliases} onChange={onField(setEditForm)} />
                              <input name="subreddits" placeholder="subreddits" value={editForm.subreddits} onChange={onField(setEditForm)} />
                              <input name="linkedin_url" placeholder="linkedin url" value={editForm.linkedin_url} onChange={onField(setEditForm)} />
                            </div>
                          )}
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
                      <td>{c.domain || '—'}</td>
                      <td>{c.linkedin_urn || '—'}</td>
                      <td>{c.x_handle ? `@${c.x_handle}` : '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          className={`comp-toggle ${c.active !== false ? 'on' : 'off'}`}
                          disabled={isBusy}
                          onClick={() => toggleActive(c)}
                          title={c.active !== false
                            ? 'Tracked — click to remove from scraping + dashboard (data is kept)'
                            : 'Removed — click to re-add to tracking'}
                        >
                          {c.active !== false ? 'Tracked' : 'Removed'}
                        </button>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="comp-actions">
                          <button className="icon-btn" title="Edit" disabled={isBusy} onClick={() => startEdit(c)}><Pencil size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
