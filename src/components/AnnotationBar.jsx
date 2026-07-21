import { useState } from 'react'
import { Plus, X, Flag } from 'lucide-react'
import './annotationBar.css'

// Compact control for the SOV trend card: shows existing event markers as
// removable chips and a small "add event" form (date + label). Markers render as
// vertical lines on the chart (see SOVTrendChart). Backed by useAnnotations.
export function AnnotationBar({ annotations = [], onAdd, onRemove, currentUserId = null }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (busy || !label.trim()) return
    setBusy(true); setErr(null)
    const { error } = await onAdd({ event_date: date, label })
    setBusy(false)
    if (error) { setErr(error); return }
    setLabel(''); setOpen(false)
  }

  return (
    <div className="annot-bar">
      <div className="annot-chips">
        {annotations.map(a => (
          <span key={a.id} className="annot-chip" title={a.note || a.event_date}>
            <Flag size={10} aria-hidden="true" />
            <span className="annot-chip-label">{a.label}</span>
            <span className="annot-chip-date">{String(a.event_date).slice(5)}</span>
            {currentUserId && a.created_by === currentUserId && (
              <button className="annot-chip-x" onClick={() => onRemove(a.id)} aria-label={`Remove ${a.label}`} title="Remove">
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        <button className="annot-add-btn" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <Plus size={12} /> Add event
        </button>
      </div>
      {open && (
        <form className="annot-form" onSubmit={submit}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="annot-input annot-date" aria-label="Event date" />
          <input
            type="text" value={label} onChange={e => setLabel(e.target.value)} maxLength={80} autoFocus
            className="annot-input annot-label" placeholder="e.g. Launched retargeting campaign" aria-label="Event label"
          />
          <button type="submit" className="annot-save" disabled={busy || !label.trim()}>{busy ? 'Adding…' : 'Add'}</button>
          {err && <span className="annot-err">{err}</span>}
        </form>
      )}
    </div>
  )
}
