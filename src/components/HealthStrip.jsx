import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle } from 'lucide-react'
import { useSystemStatus } from '../hooks/useSystemStatus'
import './healthStrip.css'

// Compact pipeline-health strip for the dashboard header. Reads the live
// operational status (LinkedIn queue + per-platform scrape freshness) and shows
// a color-coded pulse: green = healthy, amber = attention, red = stale/stuck —
// so pipeline trouble is visible without having to ask the assistant.
//
// Freshness thresholds are generous: the daily scrape runs ~02:00–06:00 Israel
// time, so anything scraped in the last ~30h is normal; >30h is amber, >54h red.
const HOUR = 3600000
const fresh = (iso, now) => {
  if (!iso) return { level: 'red', ago: 'never' }
  const ms = now - new Date(iso).getTime()
  const h = ms / HOUR
  const ago = h < 1 ? `${Math.max(1, Math.round(ms / 60000))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`
  return { level: h > 54 ? 'red' : h > 30 ? 'amber' : 'green', ago }
}

export function HealthStrip() {
  const { status } = useSystemStatus()
  // Wall-clock "now" is captured in an effect (never read during render) and
  // refreshed each minute so the "ago" labels stay live between data fetches.
  const [now, setNow] = useState(0)
  useEffect(() => {
    // Impure Date.now() must run in an effect, not render — hence the initial set
    // here (the lint rule flags the synchronous set, but it's the correct place).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])

  const model = useMemo(() => {
    if (!status || !now) return null
    const q = status.linkedin_queue || {}
    const pending = Number(q.pending || 0)
    const oldestH = q.oldest_pending ? (now - new Date(q.oldest_pending).getTime()) / HOUR : 0
    // Queue: 0 pending = green; a backlog forming = amber; old backlog stuck = red.
    const queueLevel = pending === 0 ? 'green' : oldestH > 24 ? 'red' : 'amber'
    const platforms = (Array.isArray(status.scrape_freshness) ? status.scrape_freshness : [])
      .map(p => ({ platform: p.platform, ...fresh(p.finished_at, now) }))
      .sort((a, b) => a.platform.localeCompare(b.platform))
    const worst = ['red', 'amber', 'green'].find(l => queueLevel === l || platforms.some(p => p.level === l)) || 'green'
    return { pending, queueLevel, platforms, worst }
  }, [status, now])

  if (!model) return null
  const overall = model.worst

  return (
    <div className={`health-strip level-${overall}`} title="Pipeline health — scrape freshness + ingestion queue">
      <span className="health-pulse" aria-hidden="true">
        {overall === 'red' ? <AlertTriangle size={13} /> : <Activity size={13} />}
      </span>
      <span className={`health-pill level-${model.queueLevel}`} title={`LinkedIn ingestion queue: ${model.pending} pending`}>
        queue {model.pending}
      </span>
      {model.platforms.map(p => (
        <span key={p.platform} className={`health-pill level-${p.level}`} title={`${p.platform}: last successful scrape ${p.ago} ago`}>
          {p.platform === 'Google News' ? 'News' : p.platform} {p.ago}
        </span>
      ))}
    </div>
  )
}
