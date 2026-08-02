import { useEffect, useMemo, useState } from 'react'
import './linkedinRoster.css'

// Modal editor for the LinkedIn engagement config (OKR KR-21): the total-staff
// headcount (rate denominator) and the roster of employee names (the matcher the
// n8n pipeline uses to detect which reactors are staff). Both persist to
// public.linkedin_roster_config via the useLinkedInRosterConfig hook's `save`.
//
// Rendered only for signed-in users (the caller gates on `canEdit`). One name per
// line keeps editing dead-simple; blank lines are dropped on save.
export function LinkedInRosterSettings({ config, saving, error, onSave, onClose }) {
  const [headcount, setHeadcount] = useState(String(config?.headcount ?? 40))
  const [namesText, setNamesText] = useState((config?.roster ?? []).join('\n'))
  const [localErr, setLocalErr] = useState(null)

  // Close on Escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const roster = useMemo(
    () => namesText.split('\n').map((s) => s.trim()).filter(Boolean),
    [namesText],
  )
  const rosterCount = roster.length
  const hc = parseInt(headcount, 10)

  const handleSave = async () => {
    setLocalErr(null)
    if (!Number.isInteger(hc) || hc <= 0) { setLocalErr('Headcount must be a positive whole number.'); return }
    if (rosterCount === 0) { setLocalErr('Add at least one employee name.'); return }
    // De-dupe (case-insensitive) while preserving the entered spelling/order.
    const seen = new Set()
    const unique = roster.filter((n) => {
      const k = n.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k); return true
    })
    const res = await onSave({ headcount: hc, roster: unique })
    if (res?.ok) onClose()
  }

  return (
    <div className="lir-overlay" role="dialog" aria-modal="true" aria-label="LinkedIn engagement settings" onClick={onClose}>
      <div className="lir-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lir-head">
          <h3>LinkedIn engagement settings</h3>
          <button className="lir-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <p className="lir-note">
          Used by the weekly engagement metric (OKR KR-21). <strong>Headcount</strong> is the
          denominator of the rate; the <strong>roster</strong> is the list of names used to
          detect which reactors are staff. Changes apply to the next weekly run.
        </p>

        <label className="lir-field">
          <span className="lir-label">Total employees (denominator)</span>
          <input
            type="number" min="1" inputMode="numeric"
            className="lir-input" value={headcount}
            onChange={(e) => setHeadcount(e.target.value)}
          />
        </label>

        <label className="lir-field">
          <span className="lir-label">
            Employee roster <span className="lir-count">{rosterCount} name{rosterCount === 1 ? '' : 's'}</span>
          </span>
          <textarea
            className="lir-textarea" rows={10} spellCheck={false}
            placeholder="One name per line — as it appears on LinkedIn"
            value={namesText}
            onChange={(e) => setNamesText(e.target.value)}
          />
          <span className="lir-hint">One name per line, exactly as it shows on LinkedIn. Blank lines and duplicates are ignored.</span>
        </label>

        {(localErr || error) && <div className="lir-error">{localErr || error}</div>}
        {config?.updated_at && (
          <div className="lir-meta">
            Last edited {new Date(config.updated_at).toLocaleDateString()}
            {config.updated_by ? ` by ${config.updated_by}` : ''}
          </div>
        )}

        <div className="lir-actions">
          <button className="lir-btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="lir-btn primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
