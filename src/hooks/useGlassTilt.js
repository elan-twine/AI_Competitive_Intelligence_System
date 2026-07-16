import { useRef, useCallback } from 'react'

// Glass tilt + glare on mouse move. Pass `disabled: true` to keep the glare but
// skip the 3D rotation/scale — used on panels with clickable children so hovering
// controls doesn't shift the whole card around.
export function useGlassTilt({ intensity = 5, glareOpacity = 0.12, disabled = false } = {}) {
  const ref = useRef(null)
  // Whether we've already applied a tilt since the pointer engaged this card.
  // The FIRST tilt after a card appears/engages must NOT animate — otherwise the
  // `transition: transform` on .glass-card makes the card visibly SWING in from
  // flat (the glitch seen when a card mounts under the cursor, e.g. right after
  // an async load). We snap the first frame with transition:none, then restore.
  const primed = useRef(false)

  const handleMouseMove = useCallback((e) => {
    const el = ref.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const glareX = (x / rect.width) * 100
    const glareY = (y / rect.height) * 100

    if (!disabled) {
      if (!primed.current) {
        primed.current = true
        el.style.transition = 'none' // snap the first tilt — no swing-in
        requestAnimationFrame(() => { if (ref.current) ref.current.style.transition = '' })
      }
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      const rotateX = ((y - centerY) / centerY) * -intensity
      const rotateY = ((x - centerX) / centerX) * intensity
      el.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.01, 1.01, 1.01)`
    }

    el.style.setProperty('--glare-x', `${glareX}%`)
    el.style.setProperty('--glare-y', `${glareY}%`)
    el.style.setProperty('--glare-opacity', glareOpacity)
  }, [intensity, glareOpacity, disabled])

  const handleMouseLeave = useCallback(() => {
    const el = ref.current
    if (!el) return
    primed.current = false // re-arm the snap for the next engagement
    if (!disabled) {
      el.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)'
    }
    el.style.setProperty('--glare-opacity', 0)
  }, [disabled])

  return { ref, onMouseMove: handleMouseMove, onMouseLeave: handleMouseLeave }
}
