import { useEffect, useState } from 'react'
import { Moon, Sun, ArrowRight, BookOpen, LogIn } from 'lucide-react'
import GlassKnot from '../components/GlassKnot'
import './landing.css'

export default function Landing({ onNavigate }) {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('twine-sov-theme')
    return saved ? saved === 'dark' : false
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('twine-sov-theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <div className="landing">
      <div className="landing-bg">
        <div className="landing-grid" />
        <div className="landing-blob landing-blob-1" />
        <div className="landing-blob landing-blob-2" />
      </div>

      <nav className="landing-nav">
        <div className="landing-nav-left">
          <img src="/twine-logo.svg" alt="Twine" className="landing-logo" />
          <span className="landing-brand">Twine <span className="muted">SOV</span></span>
        </div>
        <div className="landing-nav-right">
          <button className="landing-nav-link" onClick={() => onNavigate('docs')}>Docs</button>
          <button className="landing-nav-link" onClick={() => onNavigate('login')}>Login</button>
          <button className="theme-btn" onClick={() => setDark(d => !d)} aria-label="Toggle theme">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </nav>

      <main className="landing-hero">
        <div className="landing-hero-text">
          <div className="landing-eyebrow">
            <span className="landing-dot" />
            Competitive Intelligence · Live
          </div>
          <h1 className="landing-title">
            See how the world<br />is talking about<br /><span className="accent-text">your competitors.</span>
          </h1>
          <p className="landing-sub">
            Real-time Share of Voice across X, Reddit, Google News, and LinkedIn —
            weighted by reach, recency, and sentiment. Built for the Twine team.
          </p>
          <div className="landing-cta">
            <button className="cta-primary" onClick={() => onNavigate('login')}>
              <LogIn size={16} />
              Launch dashboard
              <ArrowRight size={16} />
            </button>
            <button className="cta-secondary" onClick={() => onNavigate('docs')}>
              <BookOpen size={16} />
              Read the docs
            </button>
          </div>
          <div className="landing-tags">
            <span>X</span><span>Reddit</span><span>Google News</span><span>LinkedIn</span>
          </div>
        </div>

        <div className="landing-orb-wrap">
          <GlassKnot />
        </div>
      </main>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} Twine · Internal Tool</span>
        <span className="muted">S26 Competitive Intelligence System</span>
      </footer>
    </div>
  )
}
