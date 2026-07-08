import { ArrowLeft, ArrowRight, Globe, Repeat2, Clock, Users, MessageCircle, Brain } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { AppHeader } from '../components/AppHeader'
import '../App.css'
import './equations.css'
import './about.css'

/* ------------------------------------------------------------------ */
/*  What the tool values — the principles behind the score.           */
/*  Qualitative on purpose: the exact math lives in "the brain".      */
/* ------------------------------------------------------------------ */
const PRINCIPLES = [
  {
    icon: Globe,
    title: 'Earned attention beats self-promotion',
    body: 'When someone outside a company chooses to talk about it, that counts for far more than the company posting about itself. Independent voices weigh most, employees sit in the middle, and the brand’s own page counts least — because new, unpaid eyes are the real signal of mindshare.',
  },
  {
    icon: Repeat2,
    title: 'Spread beats applause',
    body: 'A repost or share puts an item in front of a whole new audience, so it’s worth an order of magnitude more than a like. We reward the interactions that actually widen reach, not the vanity taps that don’t leave the original feed.',
  },
  {
    icon: Clock,
    title: 'Fresh beats old',
    body: 'This week’s conversation matters most. An item earns full credit for its first week, then its weight fades — quickly for X, slowly for news — so the board reflects momentum right now, not a stale all-time ledger.',
  },
  {
    icon: Users,
    title: 'Real competitors only',
    body: 'Share of Voice is measured against the direct competitive field, and those shares add up to exactly 100%. Adjacent or “learning” companies are still tracked and charted — they’re just kept out of the headline percentage.',
  },
  {
    icon: MessageCircle,
    title: 'Tone is shown, never scored',
    body: 'How the market feels about a company is tracked as its own sentiment dimension — scored per item from independent voices only and charted right alongside SOV%. But it does not touch the score: sentiment is fully decoupled from the weighting, so a glowing mention and a trashed one of the same size count the same. Share of Voice measures how much you’re talked about; the sentiment trend next to it shows how it landed — the industry-standard pairing.',
  },
]

export default function About({ onLogout, onNavigate }) {
  return (
    <div className="app">
      <AppHeader page="About" onNavigate={onNavigate} onLogout={onLogout} />

      <main className="about-page">
        {/* Intro */}
        <GlassCard className="card meth-card about-hero">
          <div className="meth-eyebrow">ABOUT</div>
          <h2 className="meth-title">A weekly read on who owns the conversation</h2>
          <p className="meth-thesis">
            <strong className="meth-lede">Twine Share of Voice tracks how much of the identity-security conversation is about Twine versus its direct competitors.</strong>
            {' '}Picture one big room where the whole market is talking — SOV% is the slice of that noise that’s about you.
          </p>
          <p className="meth-thesis">
            Every week the tool reads public mentions across <strong>LinkedIn, Google News, Reddit, and X</strong>, scores each one by
            how much attention it genuinely earned, and converts every item onto one shared “considered-attention” scale using
            research-based exchange rates — peer discussion and press count for more per engagement than vendor social. All of it
            pools together, and SOV% is your share of the total. The result is a single percentage per competitor, refreshed weekly,
            plus the trends and item-level detail behind it.
          </p>
        </GlassCard>

        {/* What it values */}
        <div className="about-section-head">
          <h3 className="about-section-title">What it values</h3>
          <p className="about-section-sub">The scoring isn’t neutral — it deliberately rewards the signals that reflect real mindshare.</p>
        </div>

        <div className="about-principles">
          {PRINCIPLES.map(({ icon: Icon, title, body }) => (
            <GlassCard key={title} className="card about-principle">
              <div className="about-principle-icon"><Icon size={18} /></div>
              <div className="about-principle-title">{title}</div>
              <p className="about-principle-body">{body}</p>
            </GlassCard>
          ))}
        </div>

        {/* Author-weighting mini-visual — the headline value, made concrete */}
        <GlassCard className="card meth-card about-tiers">
          <div className="about-tiers-head">Who’s talking is weighted like this</div>
          <div className="about-tier-row">
            <span className="about-tier about-tier-lo">
              <span className="about-tier-weight">×1</span>
              <span className="about-tier-label">Company’s own page</span>
              <span className="about-tier-note">a baseline floor — impressions</span>
            </span>
            <ArrowRight size={16} className="about-tier-arrow" />
            <span className="about-tier about-tier-mid">
              <span className="about-tier-weight">×2</span>
              <span className="about-tier-label">Employees</span>
              <span className="about-tier-note">closer to earned, but still insiders</span>
            </span>
            <ArrowRight size={16} className="about-tier-arrow" />
            <span className="about-tier about-tier-hi">
              <span className="about-tier-weight">×5</span>
              <span className="about-tier-label">External voices</span>
              <span className="about-tier-note">the real signal — new, independent eyes</span>
            </span>
          </div>
          <p className="about-tiers-foot">
            These are the baseline floors (the “B” term), not a fixed ranking. Each item’s full weight is
            <code> (B + reach × M) × freshness</code>, and engagement enters through <code>reach × M</code> — so a
            company’s own high-engagement post can still outweigh a low-engagement external one.
          </p>
        </GlassCard>

        {/* See the brain */}
        <button className="about-brain" onClick={() => onNavigate && onNavigate('methodology')}>
          <div className="about-brain-icon"><Brain size={22} /></div>
          <div className="about-brain-text">
            <div className="about-brain-title">See the brain</div>
            <div className="about-brain-sub">
              Want the exact math? Follow one item from raw likes to a final percentage — every equation, curve, and weight.
            </div>
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
