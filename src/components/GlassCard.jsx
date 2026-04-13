import { useGlassTilt } from '../hooks/useGlassTilt'

export function GlassCard({ children, className = '', style = {}, intensity = 6, ...props }) {
  const { ref, onMouseMove, onMouseLeave } = useGlassTilt({ intensity })

  return (
    <div
      ref={ref}
      className={`glass-card ${className}`}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      style={style}
      {...props}
    >
      <div className="glass-glare" />
      {children}
    </div>
  )
}
