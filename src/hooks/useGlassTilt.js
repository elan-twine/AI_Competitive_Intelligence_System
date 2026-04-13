import { useRef, useCallback } from 'react'

export function useGlassTilt({ intensity = 8, glareOpacity = 0.12 } = {}) {
  const ref = useRef(null)

  const handleMouseMove = useCallback((e) => {
    const el = ref.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    const rotateX = ((y - centerY) / centerY) * -intensity
    const rotateY = ((x - centerX) / centerX) * intensity

    const glareX = (x / rect.width) * 100
    const glareY = (y / rect.height) * 100

    el.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`
    el.style.setProperty('--glare-x', `${glareX}%`)
    el.style.setProperty('--glare-y', `${glareY}%`)
    el.style.setProperty('--glare-opacity', glareOpacity)
  }, [intensity, glareOpacity])

  const handleMouseLeave = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)'
    el.style.setProperty('--glare-opacity', 0)
  }, [])

  return { ref, onMouseMove: handleMouseMove, onMouseLeave: handleMouseLeave }
}
