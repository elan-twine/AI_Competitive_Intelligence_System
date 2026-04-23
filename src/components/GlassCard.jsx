import { useGlassTilt } from '../hooks/useGlassTilt'

// `interactive={true}` → skip the 3D tilt (used on panels with clickable children
// so hovering a button doesn't shove the whole panel around). Glare still tracks.
export function GlassCard({ children, className = '', style = {}, intensity = 5, interactive = false, ...props }) {
  const { ref, onMouseMove, onMouseLeave } = useGlassTilt({ intensity, disabled: interactive })

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
