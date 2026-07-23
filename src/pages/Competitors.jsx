import { useState } from 'react'
import { Plus, Pencil, Check, X, Trash2, RotateCcw, ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import { AppHeader } from '../components/AppHeader'
import { GlassCard } from '../components/GlassCard'
import { useCompetitors } from '../hooks/useCompetitors'
import { enrichCompetitor } from '../lib/enrichCompetitor'
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

const EMPTY_ADV = { aliases: '', linkedin_urn: '', domain: '', x_handle: '', subreddits: '', definition: '', keywords: '', collision_terms: '' }

// Merge an /api/enrich-competitor result into an advanced-fields form object.
// Only fills blanks / replaces with non-empty AI values; never clobbers with ''.
const mergeEnrichment = (prev, e) => ({
  ...prev,
  definition: e.definition || prev.definition,
  keywords: e.keywords?.length ? e.keywords.join(', ') : prev.keywords,
  collision_terms: e.collision_terms?.length ? e.collision_terms.join(', ') : prev.collision_terms,
  aliases: e.aliases?.length ? e.aliases.join(', ') : prev.aliases,
  domain: e.domain || prev.domain,
  x_handle: e.x_handle || prev.x_handle,
  subreddits: e.subreddits?.length ? e.subreddits.join(', ') : prev.subreddits,
})

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
  const [enriching, setEnriching] = useState(false)   // add-form AI auto-fill in flight
  const [editEnriching, setEditEnriching] = useState(false) // edit-drawer AI auto-fill in flight

  // List / edit
  const [editId, setEditId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', aliases: '', linkedin_urn: '', linkedin_url: '', domain: '', x_handle: '', subreddits: '', type: 'direct', definition: '', keywords: '', collision_terms: '' })
  const [busyId, setBusyId] = useState(null)

  // Roster controls (net-new state)
  const [filter, setFilter] = useState('all')        // 'all' | 'direct' | 'indirect' | 'removed'
  const [confirmId, setConfirmId] = useState(null)    // id awaiting remove-confirm
  const [rowError, setRowError] = useState(null)      // { id, msg } | null — inline per-tile error
  const [editError, setEditError] = useState(null)    // string | null — inline edit error

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

  // AI auto-fill for the add form: Claude generates definition/keywords/
  // collisions (+ aliases/domain/handle/subreddits). Reveals the details so a
  // human can review/edit before adding — never required.
  const autoFillAdd = async () => {
    const slug = slugFromUrl(url)
    const finalName = (name || (slug ? nameFromSlug(slug) : '')).trim()
    if (!finalName) { setAddError('Enter a name (or a LinkedIn URL) first, then auto-fill.'); return }
    setEnriching(true); setAddError(null)
    try {
      const e = await enrichCompetitor({ name: finalName, url, domain: adv.domain })
      setAdv(p => mergeEnrichment(p, e))
      setShowAdv(true)
    } catch (err) { setAddError(err.message || 'Auto-fill failed') }
    finally { setEnriching(false) }
  }

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
        keywords: toList(adv.keywords),
        definition: adv.definition.trim() || null,
        collision_terms: toList(adv.collision_terms),
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
    setRowError(null)
    setConfirmId(null)
    try { await updateCompetitor(c.id, { active }) }
    catch (err) { setRowError({ id: c.id, msg: err.message || 'Failed to update' }) }
    finally { setBusyId(null) }
  }

  const startEdit = (c) => {
    setEditId(c.id)
    setEditError(null)
    setEditForm({
      name: c.name || '', aliases: fromList(c.aliases), linkedin_urn: c.linkedin_urn || '',
      linkedin_url: c.linkedin_url || '', domain: c.domain || '', x_handle: c.x_handle || '',
      subreddits: fromList(c.subreddits), type: c.type || 'direct',
      definition: c.definition || '', keywords: fromList(c.keywords), collision_terms: fromList(c.collision_terms),
    })
  }

  // AI auto-fill for the edit drawer — same enrichment, merged into editForm.
  const autoFillEdit = async () => {
    const nm = (editForm.name || '').trim()
    if (!nm) { setEditError('Name is required to auto-fill.'); return }
    setEditEnriching(true); setEditError(null)
    try {
      const e = await enrichCompetitor({ name: nm, url: editForm.linkedin_url, domain: editForm.domain })
      setEditForm(p => mergeEnrichment(p, e))
    } catch (err) { setEditError(err.message || 'Auto-fill failed') }
    finally { setEditEnriching(false) }
  }
  const saveEdit = async (id) => {
    if (!editForm.name.trim()) { setEditError('Name is required'); return }
    setEditError(null)
    setBusyId(id)
    try {
      await updateCompetitor(id, {
        name: editForm.name.trim(), aliases: toList(editForm.aliases),
        linkedin_urn: editForm.linkedin_urn.trim() || null, linkedin_url: editForm.linkedin_url.trim() || null,
        domain: editForm.domain.trim() || null, x_handle: editForm.x_handle.trim().replace(/^@/, '') || null,
        subreddits: toList(editForm.subreddits), type: editForm.type,
        keywords: toList(editForm.keywords), definition: editForm.definition.trim() || null,
        collision_terms: toList(editForm.collision_terms),
      })
      setEditId(null)
    } catch (err) { setRowError({ id, msg: err.message || 'Failed to save' }) }
    finally { setBusyId(null) }
  }

  // Derivations (semantics unchanged) — '!== false' keeps null/undefined active.
  const active = competitors.filter(c => c.active !== false)
  const removed = competitors.filter(c => c.active === false)
  const directCount = active.filter(c => (c.type || 'direct') !== 'indirect').length
  const indirectCount = active.filter(c => (c.type || 'direct') === 'indirect').length
  const visible = filter === 'removed'
    ? removed
    : filter === 'all'
      ? active
      : active.filter(c => (c.type || 'direct') === filter)

  // When viewing "All", split the roster into Direct / Indirect groups so the
  // distinction is unmistakable; any specific filter renders one flat group.
  const directList = visible.filter(c => (c.type || 'direct') !== 'indirect')
  const indirectList = visible.filter(c => (c.type || 'direct') === 'indirect')

  return (
    <div className="app">
      <AppHeader page="Competitors" onNavigate={onNavigate} onLogout={onLogout} />

      {/* ZONE 1 — stat strip (read-only summary) */}
      <div className="comp-stats">
        <GlassCard className="stat-card" intensity={10}>
          <div className="label">TRACKED</div>
          <div className="value">{active.length}</div>
          <div className="sub">competitors in rotation</div>
        </GlassCard>
        <GlassCard className="stat-card" intensity={10}>
          <div className="label">DIRECT</div>
          <div className="value accent">{directCount}</div>
          <div className="sub">counted in SOV ranking</div>
        </GlassCard>
        <GlassCard className="stat-card" intensity={10}>
          <div className="label">INDIRECT</div>
          <div className="value">{indirectCount}</div>
          <div className="sub">track &amp; learn only</div>
        </GlassCard>
      </div>

      {/* ZONE 2 — add a competitor */}
      <GlassCard className="card" style={{ marginBottom: 32 }} intensity={3} interactive>
        <div className="card-header">
          <span className="card-title">Add a competitor</span>
          <span className="card-badge"><Plus size={11} style={{ marginRight: 4 }} />New</span>
        </div>
        <p className="comp-help muted">
          Paste a LinkedIn company URL and click Add — the name fills in automatically, and the LinkedIn ID is resolved on the next run.
        </p>
        <form className="comp-form" onSubmit={handleAdd}>
          <div className="comp-quickadd">
            <Field label="LinkedIn company URL *" value={url} onChange={onUrlChange}
              placeholder="https://www.linkedin.com/company/orchid-security" autoFocus />
            <Field label="Name" value={name} onChange={onNameChange} placeholder="(auto-filled from the URL)" />
          </div>

          <TypeChoice value={addType} onChange={setAddType} />

          <div className="comp-adv-row">
            <button type="button" className="comp-adv-toggle" onClick={() => setShowAdv(s => !s)}>
              {showAdv ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Details (AI-generated — review or edit)
            </button>
            <button type="button" className="comp-autofill" onClick={autoFillAdd} disabled={enriching} title="Let AI fill the definition, keywords, and namesakes to reject">
              <Sparkles size={13} /> {enriching ? 'Filling…' : 'Auto-fill with AI'}
            </button>
          </div>
          {showAdv && (
            <div className="comp-form-grid">
              <TextArea label="Definition — what this company is (used for attribution)" name="definition" value={adv.definition} onChange={onAdv} placeholder="AI-generated on Auto-fill; edit if you like." />
              <Field label="Keywords (comma-separated search terms)" name="keywords" value={adv.keywords} onChange={onAdv} placeholder="Orchid identity, orchid.security" />
              <Field label="Collision terms to reject (comma-separated)" name="collision_terms" value={adv.collision_terms} onChange={onAdv} placeholder="Orchid VPN, orchid flower" />
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

      {/* ZONE 3 — roster toolbar (title + segmented filter) */}
      <div className="comp-roster-bar">
        <span className="card-title">Tracked competitors</span>
        <SegFilter
          value={filter}
          onChange={setFilter}
          counts={{ all: active.length, direct: directCount, indirect: indirectCount, removed: removed.length }}
        />
      </div>

      {/* ZONE 4 — roster card */}
      <GlassCard className="card" style={{ marginBottom: 32 }} intensity={4} interactive>
        <p className="comp-help muted">
          Remove drops a competitor from scraping and the dashboard immediately. History is kept, so you can re-add it anytime.
        </p>

        {loading ? (
          <div className="empty-state"><p>Loading…</p></div>
        ) : error ? (
          <div className="empty-state"><p>Error: {error}</p></div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <p>
              {filter === 'removed'
                ? 'No removed competitors.'
                : (filter === 'direct' || filter === 'indirect')
                  ? `No ${filter} competitors.`
                  : 'No competitors yet — add one above.'}
            </p>
          </div>
        ) : (
          (() => {
            // Shared per-tile render so grouped and flat views stay identical.
            const renderTile = (c) => (
              <CompetitorTile
                key={c.id}
                c={c}
                removedView={filter === 'removed'}
                editing={editId === c.id}
                isBusy={busyId === c.id}
                confirming={confirmId === c.id}
                editForm={editForm}
                setEditForm={setEditForm}
                editError={editError}
                onAutoFill={autoFillEdit}
                enriching={editEnriching}
                rowError={rowError && rowError.id === c.id ? rowError.msg : null}
                onEdit={() => startEdit(c)}
                onCancelEdit={() => { setEditId(null); setEditError(null) }}
                onSave={() => saveEdit(c.id)}
                onAskRemove={() => { setConfirmId(c.id); setRowError(null) }}
                onCancelRemove={() => setConfirmId(null)}
                onRemove={() => setActive(c, false)}
                onReadd={() => setActive(c, true)}
              />
            )

            // "All" → two labeled groups; a specific filter → one flat grid.
            if (filter === 'all') {
              return (
                <div className="comp-groups">
                  {directList.length > 0 && (
                    <section className="comp-group">
                      <GroupHeader kind="direct" label="Direct competitors" count={directList.length} hint="counted in SOV ranking" />
                      <div className="comp-grid">{directList.map(renderTile)}</div>
                    </section>
                  )}
                  {indirectList.length > 0 && (
                    <section className="comp-group">
                      <GroupHeader kind="indirect" label="Indirect competitors" count={indirectList.length} hint="track & learn only" />
                      <div className="comp-grid">{indirectList.map(renderTile)}</div>
                    </section>
                  )}
                </div>
              )
            }

            return <div className="comp-grid">{visible.map(renderTile)}</div>
          })()
        )}
      </GlassCard>
    </div>
  )
}

/* ---- in-file sub-components (pure markup over parent state/handlers) ---- */

function Field({ label, ...props }) {
  return (
    <label className="auth-field comp-field">
      <span>{label}</span>
      <input type="text" {...props} />
    </label>
  )
}

function TextArea({ label, ...props }) {
  return (
    <label className="auth-field comp-field comp-field-wide">
      <span>{label}</span>
      <textarea rows={3} {...props} />
    </label>
  )
}

// Descriptive direct/indirect chip pair — shared by add form AND edit drawer so labels never diverge.
function TypeChoice({ value, onChange }) {
  return (
    <div className="comp-type-choice chip-row">
      <button
        type="button"
        className={`chip ${value === 'direct' ? 'active' : ''}`}
        onClick={() => onChange('direct')}
      >
        Direct — counted in SOV ranking
      </button>
      <button
        type="button"
        className={`chip ${value === 'indirect' ? 'active' : ''}`}
        onClick={() => onChange('indirect')}
      >
        Indirect — track &amp; learn only
      </button>
    </div>
  )
}

function MetaChip({ dotColor, href, children }) {
  const dot = <span className="comp-meta-dot" style={{ background: dotColor }} />
  if (href) {
    return (
      <a className="comp-meta" href={href} target="_blank" rel="noopener noreferrer">
        {dot}{children}
      </a>
    )
  }
  return <span className="comp-meta">{dot}{children}</span>
}

function SegFilter({ value, onChange, counts }) {
  const opts = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'direct', label: 'Direct', count: counts.direct },
    { key: 'indirect', label: 'Indirect', count: counts.indirect },
    { key: 'removed', label: 'Removed', count: counts.removed },
  ]
  return (
    <div className="comp-seg">
      {opts.map(o => (
        <button
          key={o.key}
          type="button"
          className={`comp-seg-btn ${value === o.key ? 'active' : ''}`}
          onClick={() => onChange(o.key)}
        >
          {o.label} <span className="comp-seg-count">({o.count})</span>
        </button>
      ))}
    </div>
  )
}

// Subtle labeled divider that splits the roster into Direct / Indirect groups.
// Thin rule + small-caps label + count; lime accent reserved for the Direct dot.
function GroupHeader({ kind, label, count, hint }) {
  return (
    <div className={`comp-group-head ${kind}`}>
      <span className="comp-group-dot" aria-hidden="true" />
      <span className="comp-group-label">{label}</span>
      <span className="comp-group-count">{count}</span>
      {hint && <span className="comp-group-hint">{hint}</span>}
      <span className="comp-group-rule" aria-hidden="true" />
    </div>
  )
}

function CompetitorTile({
  c, removedView, editing, isBusy, confirming,
  editForm, setEditForm, editError, onAutoFill, enriching, rowError,
  onEdit, onCancelEdit, onSave, onAskRemove, onCancelRemove, onRemove, onReadd,
}) {
  const setF = (k) => (e) => setEditForm(p => ({ ...p, [k]: e.target.value }))
  const typeClass = (c.type || 'direct') === 'indirect' ? 'indirect' : 'direct'

  // REMOVED VIEW
  if (removedView) {
    return (
      <div className="comp-tile is-removed">
        <div className="comp-tile-head">
          <span className="comp-tile-name">{c.name}</span>
        </div>
        <div className="comp-tile-meta">
          {c.domain
            ? <MetaChip dotColor="var(--text-muted)">{c.domain}</MetaChip>
            : <span className="comp-meta is-empty"><span className="comp-meta-dot" style={{ background: 'var(--text-muted)' }} />No domain</span>}
        </div>
        {rowError && <div className="auth-error">{rowError}</div>}
        <div className="comp-tile-actions">
          <button className="icon-btn comp-readd" title="Re-add to tracking" disabled={isBusy} onClick={onReadd}>
            <RotateCcw size={14} /> Re-add
          </button>
        </div>
      </div>
    )
  }

  // EDIT MODE
  if (editing) {
    return (
      <div className="comp-tile is-editing">
        <div className="comp-edit-grid">
          <Field label="Name" value={editForm.name} onChange={setF('name')} />
          <div className="comp-edit-type">
            <span className="comp-edit-type-label">Type</span>
            <TypeChoice value={editForm.type} onChange={(v) => setEditForm(p => ({ ...p, type: v }))} />
          </div>
          <Field label="Domain" value={editForm.domain} onChange={setF('domain')} placeholder="orchid.security" />
          <Field label="LinkedIn URL" value={editForm.linkedin_url} onChange={setF('linkedin_url')} placeholder="https://www.linkedin.com/company/…" />
          <Field label="X handle" value={editForm.x_handle} onChange={setF('x_handle')} placeholder="orchidsec" />
          <Field label="Aliases (comma-separated)" value={editForm.aliases} onChange={setF('aliases')} placeholder="Orchid, Orchid Sec" />
          <Field label="Subreddits (comma-separated)" value={editForm.subreddits} onChange={setF('subreddits')} placeholder="cybersecurity, netsec" />
          <Field label="LinkedIn URN (optional — auto-resolved)" value={editForm.linkedin_urn} onChange={setF('linkedin_urn')} placeholder="1234567" />
          <TextArea label="Definition — what this company is (used for attribution)" value={editForm.definition} onChange={setF('definition')} placeholder="AI-generated on Auto-fill; edit if you like." />
          <Field label="Keywords (comma-separated)" value={editForm.keywords} onChange={setF('keywords')} placeholder="Orchid identity, orchid.security" />
          <Field label="Collision terms to reject (comma-separated)" value={editForm.collision_terms} onChange={setF('collision_terms')} placeholder="Orchid VPN, orchid flower" />
        </div>
        {editError && <div className="auth-error">{editError}</div>}
        {rowError && <div className="auth-error">{rowError}</div>}
        <div className="comp-tile-actions">
          <button className="icon-btn comp-autofill" title="Let AI fill definition, keywords, collisions" disabled={enriching || isBusy} onClick={onAutoFill}>
            <Sparkles size={13} /> {enriching ? 'Filling…' : 'Auto-fill'}
          </button>
          <button className="icon-btn" title="Save" disabled={isBusy} onClick={onSave}><Check size={14} /></button>
          <button className="icon-btn" title="Cancel" onClick={onCancelEdit}><X size={14} /></button>
        </div>
      </div>
    )
  }

  // DISPLAY MODE
  const hasLinks = c.domain || c.linkedin_url || c.x_handle
  return (
    <div className={`comp-tile ${c.is_self ? 'is-twine' : ''}`}>
      <div className="comp-tile-head">
        <span className="comp-tile-name">
          {c.name}
          {c.is_self && <span className="comp-you">You</span>}
        </span>
        <span className={`comp-type ${typeClass}`}>{c.type || 'direct'}</span>
      </div>

      {c.aliases?.length > 0 && <div className="comp-tile-aliases">{c.aliases.join(', ')}</div>}

      <div className="comp-tile-meta">
        {c.domain && <MetaChip dotColor="var(--text-muted)">{c.domain}</MetaChip>}
        {c.linkedin_url && <MetaChip dotColor="var(--linkedin-color)" href={c.linkedin_url}>page ↗</MetaChip>}
        {c.x_handle && <MetaChip dotColor="var(--x-color)">@{c.x_handle}</MetaChip>}
        {!hasLinks && (
          <span className="comp-meta is-empty">
            <span className="comp-meta-dot" style={{ background: 'var(--text-muted)' }} />No links yet
          </span>
        )}
      </div>

      {rowError && <div className="auth-error">{rowError}</div>}

      <div className="comp-tile-actions">
        {confirming ? (
          <div className="comp-confirm">
            <span className="comp-confirm-msg">Remove from tracking?</span>
            <button className="icon-btn comp-readd" title="Cancel" onClick={onCancelRemove}>Cancel</button>
            <button className="icon-btn comp-readd danger" title="Confirm remove" disabled={isBusy} onClick={onRemove}>Remove</button>
          </div>
        ) : (
          <>
            <button className="icon-btn" title="Edit" disabled={isBusy} onClick={onEdit}><Pencil size={14} /></button>
            {!c.is_self && (
              <button className="icon-btn danger" title="Remove (deactivate — history kept)" disabled={isBusy} onClick={onAskRemove}><Trash2 size={14} /></button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
