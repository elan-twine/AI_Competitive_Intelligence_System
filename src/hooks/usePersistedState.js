import { useState, useEffect } from 'react'

// useState that persists to localStorage, so navigation state (which page/tab
// you're on, active filters) survives a page reload instead of snapping back to
// the dashboard home. Fails soft if storage is unavailable.
export function usePersistedState(key, initial) {
  const [value, setValue] = useState(() => {
    try { const r = localStorage.getItem(key); return r != null ? JSON.parse(r) : initial } catch { return initial }
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* skip */ }
  }, [key, value])
  return [value, setValue]
}
