import { useMemo } from 'react'
import { TrendingUp, Target, Zap, Newspaper, Radio, Info } from 'lucide-react'
import { GlassCard } from './GlassCard'
import { growthAnalysis } from '../lib/growth'

const fmtPts = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`

// Pick the cheapest reachable LinkedIn tier for a target (fewest mentions).
function bestTier(target) {
  if (!target) return null
  const reachable = target.linkedin.filter(t => t.mentions != null)
  if (!reachable.length) return null
  return reachable.reduce((a, b) => (b.mentions < a.mentions ? b : a))
}

export function GrowthStrategy({ posts, config }) {
  const a = useMemo(() => growthAnalysis(posts, config), [posts, config])
  if (!a || !a.twine) return null

  const { twine, above1, leader, components, weakest, platforms, targets, effectiveWeights } = a
  const gapToNext = above1 ? above1.overall - twine.overall : 0
  const li = platforms.find(p => p.platform === 'LinkedIn') || {}
  const viralRatio = li.unitMedian > 0 ? li.unitP90 / li.unitMedian : 0
  const newsWeightPct = Math.round((effectiveWeights?.['Google News'] || 0) * 100)
  const dormant = platforms.filter(p => !p.eligible)
  const nextTier = bestTier(targets.next)
  const nextNextTier = bestTier(targets.nextNext)
  const maxContribComp = Math.max(...components.map(c => c.leaderPct * c.weight), 0.0001)

  return (
    <GlassCard className="card growth-card" style={{ marginBottom: 32 }} intensity={4} interactive>
      <div className="card-header">
        <span className="card-title"><TrendingUp size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
          Twine Growth Strategy — Where You're Weak & How to Climb
        </span>
      </div>

      {/* Headline */}
      <div className="growth-headline">
        <div>
          <span className="growth-rank">#{twine.rank}</span>
          <span className="growth-rank-of"> of {a.total}</span>
        </div>
        <div className="growth-headline-main">
          Overall <strong>{twine.overall.toFixed(1)}</strong>
          {above1 && (
            <span className="growth-gap">
              {' '}— <strong>{gapToNext.toFixed(2)}</strong> behind {above1.company} (#{twine.rank - 1})
            </span>
          )}
        </div>
      </div>

      {/* Where you're weak — component bars vs leader */}
      <div className="growth-section-label">Where the gap is</div>
      <div className="growth-bars">
        {components.map(c => {
          const isWeak = c.key === weakest.key
          return (
            <div className={`growth-bar-row ${isWeak ? 'weak' : ''}`} key={c.key}>
              <div className="growth-bar-label">
                {c.label}{isWeak && <span className="growth-tag">biggest gap</span>}
              </div>
              <div className="growth-bar-track">
                <div className="growth-bar-fill twine" style={{ width: `${Math.min(100, (c.pct * c.weight / maxContribComp) * 100)}%` }} />
                <div className="growth-bar-marker leader" style={{ left: `${Math.min(100, (c.leaderPct * c.weight / maxContribComp) * 100)}%` }} title={`${leader.company} (leader)`} />
              </div>
              <div className="growth-bar-num">
                {c.pct.toFixed(1)}% <span className="growth-bar-sub">→ {c.contribution.toFixed(1)} pts</span>
              </div>
            </div>
          )
        })}
        <div className="growth-legend">
          <span><i className="dot twine" /> Twine contribution</span>
          <span><i className="dot leader" /> {leader.company} (leader)</span>
          <span className="growth-legend-note">bars scaled by each dimension's weight ({Math.round(components.find(c=>c.key==='unweighted').weight*100)}/{Math.round(components.find(c=>c.key==='weighted').weight*100)}/{Math.round(components.find(c=>c.key==='sentiment').weight*100)})</span>
        </div>
      </div>

      {/* The plays */}
      <div className="growth-section-label">The plays — concrete, highest-leverage first</div>
      <div className="growth-plays">

        {/* Play 1: LinkedIn quality */}
        <div className="growth-play">
          <div className="growth-play-icon"><Zap size={18} /></div>
          <div className="growth-play-body">
            <div className="growth-play-title">1 · Earn high-engagement LinkedIn mentions <span className="growth-play-flag">primary lever</span></div>
            <div className="growth-play-text">
              LinkedIn is {Math.round((effectiveWeights?.LinkedIn || 0) * 100)}% of weighted SOV and your deepest pool.
              {' '}Reshares count <strong>10×</strong> and external (earned) mentions <strong>2×</strong>, so one
              {viralRatio > 1.5 ? <> high-engagement mention ≈ <strong>{viralRatio.toFixed(0)}</strong> average ones.</> : <> strong mention is worth several flat ones.</>}
            </div>
            {nextTier && above1 && (
              <div className="growth-deliverable">
                <Target size={14} /> Create <strong>~{nextTier.mentions} {nextTier.label}</strong> mentions → pass <strong>{above1.company}</strong> into <strong>#{twine.rank - 1}</strong>
                <span className="growth-deliverable-sub"> ({fmtPts(nextTier.overall - twine.overall)} → {nextTier.overall.toFixed(1)})</span>
              </div>
            )}
            {nextNextTier && targets.nextNext && (
              <div className="growth-deliverable secondary">
                <Target size={14} /> Or <strong>~{nextNextTier.mentions} {nextNextTier.label}</strong> mentions → <strong>#{twine.rank - 2}</strong> (pass {targets.nextNext.company})
              </div>
            )}
            <div className="growth-play-hint">
              Topics that travel: funding/product milestones, named customer wins, and conference presence —
              the current #1 ({leader.company}) is largely riding event buzz.
            </div>
          </div>
        </div>

        {/* Play 2: PR / News */}
        {targets.next?.news?.mentions != null && (
          <div className="growth-play">
            <div className="growth-play-icon"><Newspaper size={18} /></div>
            <div className="growth-play-body">
              <div className="growth-play-title">2 · Land earned press</div>
              <div className="growth-play-text">
                News is a tiny pool carrying <strong>{newsWeightPct}%</strong> of weighted SOV — each article moves the
                share hard. About <strong>~{targets.next.news.mentions} articles</strong> alone would also pass {above1?.company}.
              </div>
              <div className="growth-play-hint">Trade press, analyst notes, and funding coverage. Harder to manufacture than LinkedIn, but high weight-per-item.</div>
            </div>
          </div>
        )}

        {/* Play 3: activate dormant platforms */}
        {dormant.length > 0 && (
          <div className="growth-play">
            <div className="growth-play-icon"><Radio size={18} /></div>
            <div className="growth-play-body">
              <div className="growth-play-title">3 · Wake up dormant platforms</div>
              <div className="growth-play-text">
                {dormant.map(d => d.platform).join(', ').replace(/, ([^,]*)$/, dormant.length > 1 ? ' & $1' : '$1')} {dormant.length > 1 ? 'are' : 'is'} below the
                {' '}<strong>{a.config.minVolume}</strong>-volume gate — contributing <strong>nothing</strong> to weighted SOV today.
                Getting a real presence there opens <strong>{dormant.length}</strong> more scoring {dormant.length > 1 ? 'lanes' : 'lane'}.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Platform leverage table */}
      <div className="growth-section-label">Per-platform leverage</div>
      <div className="table-wrap">
        <table className="breakdown-table growth-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Platform</th>
              <th>Twine posts</th>
              <th>Twine share</th>
              <th>Counts now?</th>
              <th>Lift / +10 avg mentions</th>
            </tr>
          </thead>
          <tbody>
            {platforms.map(p => (
              <tr key={p.platform} className={!p.eligible ? 'growth-dim' : ''}>
                <td className="col-company">{p.platform}</td>
                <td>{p.twineCount}</td>
                <td><strong>{p.twinePwShare.toFixed(1)}%</strong></td>
                <td>{p.eligible ? <span className="growth-yes">yes</span> : <span className="growth-no">dormant</span>}</td>
                <td><strong style={{ color: p.liftPer10Typical > 0.001 ? 'var(--accent)' : 'var(--text-secondary)' }}>{fmtPts(p.liftPer10Typical)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="growth-footnote">
        <Info size={13} /> Sentiment is already a strength (and is capped — everyone clusters high), so it's not a lever.
        All numbers recompute live from the same methodology as the board; simulations add synthetic Twine mentions at each platform's typical engagement and re-rank.
      </div>
    </GlassCard>
  )
}
