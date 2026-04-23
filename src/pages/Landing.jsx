import { useState } from 'react'
import { ArrowRight, LogIn, X } from 'lucide-react'
import LiquidEther from '../components/LiquidEther'
import { GlassCard } from '../components/GlassCard'
import './landing.css'

export default function Landing({ onNavigate, onLoginSuccess }) {
  const [loginOpen, setLoginOpen] = useState(false)

  return (
    <div className={`landing ${loginOpen ? 'modal-open' : ''}`}>
      <div className="landing-bg">
        <LiquidEther
          colors={['#DBFE02', '#39FF14', '#00FFB3', '#C4FF00']}
          mouseForce={22}
          cursorSize={120}
          autoDemo={true}
          autoSpeed={0.55}
          autoIntensity={2.4}
          resolution={0.5}
          takeoverDuration={0.25}
          autoResumeDelay={2000}
          autoRampDuration={0.6}
          pausePointer={loginOpen}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />
      </div>

      <div className="landing-content">
        <nav className="landing-nav">
          <div className="landing-nav-left">
            <img src="/twine-logo.svg" alt="Twine" className="landing-logo" />
            <span className="landing-brand">Twine <span className="muted">SOV</span></span>
          </div>
          <div className="landing-nav-right">
            <button className="landing-nav-link" onClick={() => setLoginOpen(true)}>Login</button>
          </div>
        </nav>

        <main className="landing-hero text-only">
          <div className="landing-hero-text centered">
            <h1 className="landing-title big">
              <span className="accent-text">Twine SOV</span>
            </h1>
            <p className="landing-sub">
              Real-time Share of Voice across X, Reddit, Google News, and LinkedIn —
              weighted by reach, recency, and sentiment. Built for the Twine team.
            </p>
            <div className="landing-cta">
              <button className="cta-primary" onClick={() => setLoginOpen(true)}>
                <LogIn size={16} />
                Launch dashboard
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </main>

        <footer className="landing-footer">
          <span>© {new Date().getFullYear()} Purdue Solutions</span>
          <span className="muted"></span>
        </footer>
      </div>

      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onLoginSuccess={onLoginSuccess}
        />
      )}
    </div>
  )
}

function LoginModal({ onClose, onLoginSuccess }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!email || !password) return
    setLoading(true)
    setTimeout(() => {
      localStorage.setItem('twine-sov-auth', 'true')
      localStorage.setItem('twine-sov-user', email)
      onLoginSuccess()
    }, 500)
  }

  return (
    <div className="landing-modal-backdrop" onClick={onClose}>
      <div className="landing-modal" onClick={(e) => e.stopPropagation()}>
        <GlassCard className="auth-card" intensity={3}>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
          <div className="auth-head">
            <img src="/twine-logo.svg" alt="Twine" className="auth-logo" />
            <h2>Welcome back</h2>
            <p className="muted">Sign in to the Twine SOV dashboard</p>
          </div>
          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@twinesecurity.com"
                autoFocus
              />
            </label>
            <label className="auth-field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </label>
            <button type="submit" className="cta-primary auth-submit" disabled={loading}>
              {loading ? 'Signing in...' : (<>Sign in <ArrowRight size={16} /></>)}
            </button>
            <p className="auth-hint muted">Demo mode — any email + password will work.</p>
          </form>
        </GlassCard>
      </div>
    </div>
  )
}
