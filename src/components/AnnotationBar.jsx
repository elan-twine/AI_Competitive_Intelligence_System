import { useState } from 'react'
import { Plus, X, Flag } from 'lucide-react'
import './annotationBar.css'

// Compact control for the SOV trend card: shows existing event markers as chips
// and a small form to add/edit one (date or range + label). Clicking one of YOUR
// OWN chips loads it into the form for editing; the × deletes it. Markers render
// on the chart (see SOVTrendChart). Backed by useAnnotations.

// "MM-DD" (or "MM-DD → MM-DD" for a range) for the chip's compact date.
function chipDate(a) {
  const s = String(a.event_date).slice(5)
  return a.end_date ? `${s} → ${String(a.end_date).slice(5)}` : s
}

export function AnnotationBar({ annotations = [], onAdd, onUpdate, onRemove, currentUserId = null }) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)   // null = adding; else editing this id
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [isRange, setIsRange] = useState(false)
  const [endDate, setEndDate] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const resetForm = () => {
    setEditingId(null)
    setDate(new Date().toISOString().slice(0, 10))
    setIsRange(false); setEndDate(''); setLabel(''); setErr(null)
  }

  // Open the form fresh in "add" mode (or close it).
  const toggleAdd = () => {
    if (open && editingId == null) { setOpen(false); return }
    resetForm(); setOpen(true)
  }

  // Load one of your own markers into the form to edit it.
  const startEdit = (a) => {
    setEditingId(a.id)
    setDate(String(a.event_date))
    setIsRange(!!a.end_date)
    setEndDate(a.end_date ? String(a.end_date) : '')
    setLabel(a.label || '')
    setErr(null); setOpen(true)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy || !label.trim()) return
    setBusy(true); setErr(null)
    const payload = { event_date: date, end_date: isRange ? endDate : null, label }
    const { error } = editingId != null ? await onUpdate(editingId, payload) : await onAdd(payload)
    setBusy(false)
    if (error) { setErr(error); return }
    resetForm(); setOpen(false)
  }

  const editing = editingId != null

  return (
    <div className="annot-bar">
      <div className="annot-chips">
        {annotations.map(a => {
          const owned = currentUserId && a.created_by === currentUserId
          const isEditing = a.id === editingId
          return (
            <span key={a.id} className={`annot-chip ${a.end_date ? 'is-range' : ''} ${isEditing ? 'is-editing' : ''}`} title={a.note || (a.end_date ? `${a.event_date} → ${a.end_date}` : a.event_date)}>
              {owned ? (
                <button type="button" className="annot-chip-body" onClick={() => startEdit(a)} aria-label={`Edit ${a.label}`} title="Edit">
                  <Flag size={10} aria-hidden="true" />
                  <span className="annot-chip-label">{a.label}</span>
                  <span className="annot-chip-date">{chipDate(a)}</span>
                </button>
              ) : (
                <span className="annot-chip-body annot-chip-static">
                  <Flag size={10} aria-hidden="true" />
                  <span className="annot-chip-label">{a.label}</span>
                  <span className="annot-chip-date">{chipDate(a)}</span>
                </span>
              )}
              {owned && (
                <button className="annot-chip-x" onClick={() => onRemove(a.id)} aria-label={`Remove ${a.label}`} title="Remove">
                  <X size={11} />
                </button>
              )}
            </span>
          )
        })}
        <button className="annot-add-btn" onClick={toggleAdd} aria-expanded={open}>
          <Plus size={12} /> Add event
        </button>
      </div>
      {open && (
        <form className="annot-form" onSubmit={submit}>
          {editing && <span className="annot-editing-tag">Editing</span>}
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="annot-input annot-date" aria-label={isRange ? 'Start date' : 'Event date'} />
          {isRange && (
            <>
              <span className="annot-range-arrow" aria-hidden="true">→</span>
              <input type="date" value={endDate} min={date} onChange={e => setEndDate(e.target.value)} required className="annot-input annot-date" aria-label="End date" />
            </>
          )}
          <label className="annot-range-toggle" title="Span a date range instead of a single day">
            <input type="checkbox" checked={isRange} onChange={e => { setIsRange(e.target.checked); if (!e.target.checked) setEndDate('') }} />
            Range
          </label>
          <input
            type="text" value={label} onChange={e => setLabel(e.target.value)} maxLength={80} autoFocus
            className="annot-input annot-label" placeholder="e.g. Launched retargeting campaign" aria-label="Event label"
          />
          <button type="submit" className="annot-save" disabled={busy || !label.trim() || (isRange && !endDate)}>{busy ? 'Saving…' : (editing ? 'Save' : 'Add')}</button>
          <button type="button" className="annot-cancel" onClick={() => { resetForm(); setOpen(false) }}>Cancel</button>
          {err && <span className="annot-err">{err}</span>}
        </form>
      )}
    </div>
  )
}
