import { useState, useEffect } from 'react'
import { ArrowLeft, ArrowRight, Moon, Sun } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import './landing.css'

export default function Login({ onNavigate, onLoginSuccess }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('twine-sov-theme')
    return saved ? saved === 'dark' : false
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('twine-sov-theme', dark ? 'dark' : 'light')
  }, [dark])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!email || !password) return
    setLoading(true)
    setTimeout(() => {
      localStorage.setItem('twine-sov-auth', 'true')
      localStorage.setItem('twine-sov-user', email)
      onLoginSuccess()
    }, 600)
  }

  return (
    <div className="landing">
      <div className="landing-bg">
        <div className="landing-grid" />
        <div className="landing-blob landing-blob-1" />
        <div className="landing-blob landing-blob-2" />
      </div>

      <nav className="landing-nav">
        <button className="landing-nav-link back" onClick={() => onNavigate('landing')}>
          <ArrowLeft size={14} /> Back
        </button>
        <div className="landing-nav-right">
          <button className="theme-btn" onClick={() => setDark(d => !d)} aria-label="Toggle theme">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </nav>

      <div className="auth-wrap">
        <GlassCard className="auth-card" intensity={3}>
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

            <p className="auth-hint muted">
              Demo mode — any email + password will work.
            </p>
          </form>
        </GlassCard>
      </div>
    </div>
  )
}
