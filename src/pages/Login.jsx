import { useState, useEffect } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { GlassCard } from '../components/GlassCard'
import { GoogleSignInButton } from '../components/GoogleSignInButton'
import { signIn } from '../lib/auth'
import './landing.css'

export default function Login({ onNavigate, onLoginSuccess }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  // Surface an OAuth rejection (e.g. a non-@twinesecurity.com Google account
  // blocked at signup) that Supabase returns as a ?error_description= param.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const desc = params.get('error_description')
    if (desc) {
      setErrorMsg(desc)
      window.history.replaceState({}, document.title, window.location.pathname + '#login')
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg(null)
    if (!email || !password) return
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      setErrorMsg(error.message || 'Invalid email or password')
      return
    }
    onLoginSuccess()
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

            {errorMsg && <div className="auth-error">{errorMsg}</div>}
            <button type="submit" className="cta-primary auth-submit" disabled={loading}>
              {loading ? 'Signing in...' : (<>Sign in <ArrowRight size={16} /></>)}
            </button>

            <div className="auth-or"><span>or</span></div>
            <GoogleSignInButton />

            <p className="auth-hint muted">
              Team members only — reach out if you need access.
            </p>
          </form>
        </GlassCard>
      </div>
    </div>
  )
}
