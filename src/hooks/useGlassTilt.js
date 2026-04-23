import { useRef, useCallback } from 'react'

// Mouse-tracked glare only — panel no longer rotates/scales on hover.
// Kept the function signature so callers don't need to change.
export function useGlassTilt({ glareOpacity = 0.12 } = {}) {
  const ref = useRef(null)

  const handleMouseMove = useCallback((e) => {
    const el = ref.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const glareX = (x / rect.width) * 100
    const glareY = (y / rect.height) * 100

    el.style.setProperty('--glare-x', `${glareX}%`)
    el.style.setProperty('--glare-y', `${glareY}%`)
    el.style.setProperty('--glare-opacity', glareOpacity)
  }, [glareOpacity])

  const handleMouseLeave = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--glare-opacity', 0)
  }, [])

  return { ref, onMouseMove: handleMouseMove, onMouseLeave: handleMouseLeave }
}
