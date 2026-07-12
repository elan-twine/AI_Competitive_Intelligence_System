import { useState, useMemo } from 'react'
import { RotateCcw, Lock, Info } from 'lucide-react'
import { GlassCard } from './GlassCard'
import { computeWeightedSOV } from '../lib/metrics'
import { colorForCompany, isTwine } from '../lib/colors'
import './platformWeights.css'

// Interactive explainer for the platform multipliers, aimed at a non-technical
// owner who sets the News value. Framing: multipliers are TRUST EXCHANGE RATES
// that put every platform on one "mindshare" scale. Drag a dial → watch the real
// board recompute live. LinkedIn/X/Reddit are research-locked; News is the dial.
// Nothing here saves — it's a preview; the chosen value is applied by the team.

const FALLBACK = { LinkedIn: 1, X: 1, Reddit: 3, 'Google News': 30 }

// Display order + copy. `tunable` = the one the owner sets.
const ROWS = [
  { key: 'Google News', label: 'Google News', tunable: true, min: 5, max: 60, step: 1,
    why: 'Editorial security press — the credibility layer buyers trust most. This is the dial to set.' },
  { key: 'Reddit', label: 'Reddit', min: 1, max: 12, step: 1,
    why: 'Peer / practitioner community talk — high trust, lowest volume. Research-locked.' },
  { key: 'LinkedIn', label: 'LinkedIn', min: 1, max: 12, step: 1,
    why: 'Vendor + professional social — the baseline everything else is priced against.' },
  { key: 'X', label: 'X', min: 1, max: 12, step: 1,
    why: 'Vendor + community social — baseline; a brand’s own tweets are already discounted.' },
]

function fmtPlat(k) { return k === 'Google News' ? 'news article' : k === 'Reddit' ? 'Reddit post' : k === 'LinkedIn' ? 'LinkedIn post' : 'tweet' }

export function PlatformWeightsExplainer({ posts = [], config }) {
  const base = useMemo(
    () => ({ ...FALLBACK, ...(config?.platformMultipliers || {}) }),
    [config]
  )
  const [mults, setMults] = useState(base)
  const [advanced, setAdvanced] = useState(false)

  // Recompute the real board with the slider values vs the live (saved) config.
  const board = useMemo(
    () => computeWeightedSOV(posts, { ...config, platformMultipliers: mults }),
    [posts, config, mults]
  )
  const baseline = useMemo(
    () => computeWeightedSOV(posts, { ...config, platformMultipliers: base }),
    [posts, config, base]
  )

  const ranked = useMemo(() => {
    const rows = [...board.weightedPct.entries()].map(([company, pct]) => ({
      company, pct, base: baseline.weightedPct.get(company) || 0,
    }))
    return rows.sort((a, b) => b.pct - a.pct)
  }, [board, baseline])

  const maxPct = Math.max(1, ...ranked.map(r => r.pct))
  const li = mults.LinkedIn || 1
  const newsShare = Math.round((board.effectiveWeights['Google News'] || 0) * 100)
  const dirty = ROWS.some(r => mults[r.key] !== base[r.key])

  const setMult = (k, v) => setMults(m => ({ ...m, [k]: Number(v) }))
  const reset = () => setMults(base)

  return (
    <GlassCard className="card pw-card" intensity={4}>
      <div className="card-header">
        <span className="card-title">Platform weights — the trust dial</span>
        {dirty && (
          <button className="pw-reset" onClick={reset}><RotateCcw size={13} /> Reset to current</button>
        )}
      </div>
      <p className="pw-lede">
        A “multiplier” is a <strong>trust exchange rate</strong>. It converts a post’s engagement into shared
        <strong> mindshare units</strong> so a mention in the security press and a LinkedIn post sit on one scale.
        Bigger multiplier = that channel earns more trust per post. Drag the dial and watch the live board react —
        <strong> nothing here saves</strong>; it’s a sandbox to find the number, then tell the team.
      </p>

      {/* The dial */}
      <div className="pw-dial">
        <div className="pw-dial-head">
          <span className="pw-dial-name">Google News multiplier</span>
          <span className="pw-dial-val">×{mults['Google News']}</span>
        </div>
        <input
          className="pw-slider pw-slider-news"
          type="range"
          min={5} max={60} step={1}
          value={mults['Google News']}
          onChange={e => setMult('Google News', e.target.value)}
          aria-label="Google News multiplier"
        />
        <div className="pw-dial-scale"><span>5</span><span>provisional 30</span><span>60</span></div>
        <div className="pw-equiv-sentence">
          Right now, <strong>1 news article</strong> counts as much as <strong>{Math.round(mults['Google News'] / li)} LinkedIn posts</strong> of equal engagement.
        </div>
      </div>

      {/* Equivalence cards */}
      <div className="pw-equiv-cards">
        {ROWS.filter(r => r.key !== 'LinkedIn').map(r => (
          <div key={r.key} className={`pw-equiv-card ${r.tunable ? 'tunable' : ''}`}>
            <div className="pw-equiv-x">×{mults[r.key]}</div>
            <div className="pw-equiv-txt">1 {fmtPlat(r.key)} ≈ <strong>{Math.round(mults[r.key] / li)}</strong> LinkedIn {Math.round(mults[r.key] / li) === 1 ? 'post' : 'posts'}</div>
            <div className="pw-equiv-plat">{r.label}</div>
          </div>
        ))}
      </div>

      {/* Emergent influence */}
      <div className="pw-influence">
        <Info size={14} />
        <span>At News ×{mults['Google News']}, trade-press coverage drives <strong>{newsShare}%</strong> of the entire board’s score right now. Raise it and the board leans harder on who gets written about; lower it and engagement on social matters more.</span>
      </div>

      {/* Live board */}
      <div className="pw-board">
        <div className="pw-board-head">Live board — direct competitors {dirty && <span className="pw-board-preview">preview</span>}</div>
        {ranked.map(r => {
          const delta = r.pct - r.base
          const showDelta = dirty && Math.abs(delta) >= 0.05
          return (
            <div className="pw-bar-row" key={r.company}>
              <span className="pw-bar-name" style={isTwine(r.company) ? { fontWeight: 700 } : undefined}>{r.company}</span>
              <div className="pw-bar-track">
                <div className="pw-bar-fill" style={{ width: `${(r.pct / maxPct) * 100}%`, background: colorForCompany(r.company) }} />
              </div>
              <span className="pw-bar-pct">{r.pct.toFixed(1)}%</span>
              <span className={`pw-bar-delta ${showDelta ? (delta > 0 ? 'up' : 'down') : 'flat'}`}>
                {showDelta ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : ''}
              </span>
            </div>
          )
        })}
      </div>

      {/* The locked platforms */}
      <div className="pw-locked">
        <div className="pw-locked-head">
          <span><Lock size={12} /> Research-locked baselines</span>
          <button className="pw-adv-toggle" onClick={() => setAdvanced(a => !a)}>
            {advanced ? 'Hide' : 'Adjust anyway'}
          </button>
        </div>
        <p className="pw-locked-note">
          Peer/community talk ≈ 3× and editorial press ≈ 2× vendor social is grounded in B2B-buyer research
          (6sense, Gartner, TrustRadius, Edelman). LinkedIn and X are the ×1 baseline; Reddit ×3. These are
          settled — News is the one still being tuned.
        </p>
        {advanced && ROWS.filter(r => !r.tunable).map(r => (
          <div className="pw-adv-row" key={r.key}>
            <span className="pw-adv-name">{r.label}</span>
            <input type="range" className="pw-slider" min={r.min} max={r.max} step={r.step}
              value={mults[r.key]} onChange={e => setMult(r.key, e.target.value)} aria-label={`${r.label} multiplier`} />
            <span className="pw-adv-val">×{mults[r.key]}</span>
          </div>
        ))}
      </div>

      <div className="pw-foot">
        This is a preview — moving the dials doesn’t change the live board. Found the right News value?
        Tell the team and we’ll lock it in (one config change + a recompute).
      </div>
    </GlassCard>
  )
}
