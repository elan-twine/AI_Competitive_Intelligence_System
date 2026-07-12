import { useState } from 'react'
import { Ban } from 'lucide-react'
import { flagMisattributed } from '../lib/misattribution'
import './misattribute.css'

// Small "this was misattributed" control for an item card. Click → inline
// confirm → flags the mention (soft; keeps the data) and removes it from the
// company's calculations. `company` labels the confirm; `onFlagged` lets a card
// optimistically drop the item locally (e.g. Posts of Interest, which reads a
// separate table the live refetch doesn't cover).
export function MisattributeButton({ post, company, onFlagged, compact = false, stop = true }) {
  const [state, setState] = useState('idle') // idle | confirming | working | done | error

  const halt = (e) => { if (stop && e) { e.stopPropagation(); e.preventDefault() } }

  const doFlag = async (e) => {
    halt(e)
    setState('working')
    try {
      await flagMisattributed(post)
      setState('done')
      if (onFlagged) onFlagged()
    } catch (err) {
      console.warn('[misattribute] failed:', err)
      setState('error')
    }
  }

  if (state === 'done') {
    return <span className="misattr-done" title="Removed from this company (data kept)">removed</span>
  }

  if (state === 'confirming' || state === 'working' || state === 'error') {
    return (
      <span className={`misattr-confirm ${compact ? 'compact' : ''}`} onClick={halt}>
        <span className="misattr-q">
          {state === 'error' ? 'Couldn’t remove — retry?' : `Not ${company || 'this company'}?`}
        </span>
        <button className="misattr-yes" disabled={state === 'working'} onClick={doFlag}>
          {state === 'working' ? '…' : 'Remove'}
        </button>
        <button className="misattr-no" disabled={state === 'working'} onClick={(e) => { halt(e); setState('idle') }}>
          Cancel
        </button>
      </span>
    )
  }

  return (
    <button
      className={`misattr-btn ${compact ? 'compact' : ''}`}
      title="Misattributed — remove this item from this company (keeps the data, adjusts the score)"
      aria-label="Mark as misattributed"
      onClick={(e) => { halt(e); setState('confirming') }}
    >
      <Ban size={compact ? 11 : 12} />
      {!compact && <span className="misattr-btn-label">misattributed</span>}
    </button>
  )
}
