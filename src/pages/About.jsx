import { ArrowLeft, ArrowRight, Globe, Repeat2, Clock, Users, MessageCircle, Brain } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { AppHeader } from '../components/AppHeader'
import '../App.css'
import './equations.css'
import './about.css'

/* ------------------------------------------------------------------ */
/*  What the tool values — one line each. The exact math is "the brain". */
/* ------------------------------------------------------------------ */
const PRINCIPLES = [
  { icon: Globe, title: 'Earned attention wins', body: 'An outsider choosing to talk about you counts far more than your own posts.' },
  { icon: Repeat2, title: 'Spread beats applause', body: 'A reshare reaches a whole new audience — worth an order of magnitude more than a like.' },
  { icon: Clock, title: 'Fresh beats old', body: 'Full credit for its first week, then it fades. Momentum now, not an all-time ledger.' },
  { icon: Users, title: 'Direct field only', body: 'Scored against your real competitors — their shares add up to exactly 100%.' },
  { icon: MessageCircle, title: 'Tone is shown, not scored', body: 'Sentiment is charted right alongside SOV, but never moves the score.' },
]

export default function About({ onLogout, onNavigate }) {
  return (
    <div className="app">
      <AppHeader page="About" onNavigate={onNavigate} onLogout={onLogout} />

      <main className="about-page">
        {/* Hero — editorial, not boxed */}
        <header className="about-lede">
          <div className="meth-eyebrow">ABOUT</div>
          <h2 className="about-lede-title">One number for who owns the conversation.</h2>
          <p className="about-lede-thesis">
            <strong>Share of Voice</strong> is your slice of the identity-security conversation versus your
            direct competitors — read every week across <strong>LinkedIn</strong>, <strong>Google News</strong>,
            <strong> Reddit</strong>, and <strong>X</strong>, and scored by how much attention each mention
            genuinely earned.
          </p>
        </header>

        {/* The signature idea, up front: who's talking is weighted */}
        <GlassCard className="card meth-card about-tiers">
          <div className="about-tiers-head">Not all attention is equal — who’s talking is weighted</div>
          <div className="about-tier-row">
            <span className="about-tier about-tier-lo">
              <span className="about-tier-weight">×1</span>
              <span className="about-tier-label">Company’s own page</span>
              <span className="about-tier-note">a baseline floor</span>
            </span>
            <ArrowRight size={16} className="about-tier-arrow" />
            <span className="about-tier about-tier-mid">
              <span className="about-tier-weight">×2</span>
              <span className="about-tier-label">Employees</span>
              <span className="about-tier-note">closer to earned, still insiders</span>
            </span>
            <ArrowRight size={16} className="about-tier-arrow" />
            <span className="about-tier about-tier-hi">
              <span className="about-tier-weight">×5</span>
              <span className="about-tier-label">External voices</span>
              <span className="about-tier-note">the real signal — new, independent eyes</span>
            </span>
          </div>
          <p className="about-tiers-foot">
            These are the baseline floors (the “B” term). Each item’s full weight is
            <code> (B + reach × M) × freshness</code>, so a high-engagement post on a company’s own page can
            still outweigh a quiet external one.
          </p>
        </GlassCard>

        {/* What it values — five quick principles */}
        <div className="about-principles">
          {PRINCIPLES.map(({ icon: Icon, title, body }) => (
            <GlassCard key={title} className="card about-principle">
              <div className="about-principle-icon"><Icon size={16} /></div>
              <div className="about-principle-copy">
                <div className="about-principle-title">{title}</div>
                <p className="about-principle-body">{body}</p>
              </div>
            </GlassCard>
          ))}
        </div>

        {/* See the brain */}
        <button className="about-brain" onClick={() => onNavigate && onNavigate('methodology')}>
          <div className="about-brain-icon"><Brain size={22} /></div>
          <div className="about-brain-text">
            <div className="about-brain-title">See the brain</div>
            <div className="about-brain-sub">Follow one item from raw likes to a final percentage — every equation, curve, and weight.</div>
          </div>
          <ArrowRight size={20} className="about-brain-arrow" />
        </button>

        <div className="growth-footnote about-footer">
          <span>A summary of the methodology. The full model lives in “the brain”.</span>
          {onNavigate && (
            <button className="meth-back-link" onClick={() => onNavigate('dashboard')}>
              <ArrowLeft size={14} /> Back to dashboard
            </button>
          )}
        </div>
      </main>
    </div>
  )
}
