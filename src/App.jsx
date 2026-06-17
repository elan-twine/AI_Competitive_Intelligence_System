import { useState, useEffect } from 'react'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Docs from './pages/Docs'
import Dashboard from './pages/Dashboard'
import Competitors from './pages/Competitors'
import { getSession, onAuthChange, signOut } from './lib/auth'
import './App.css'

function getHashView() {
  const hash = window.location.hash.replace('#', '')
  if (hash === 'docs') return 'docs'
  if (hash === 'login') return 'login'
  if (hash === 'dashboard') return 'dashboard'
  if (hash === 'competitors') return 'competitors'
  return 'landing'
}

// Views that require a live Supabase session.
const GATED_VIEWS = new Set(['dashboard', 'competitors'])

function App() {
  const [view, setView] = useState(getHashView)
  // null = unknown (still checking), false = no session, true = signed in
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)

  // Bootstrap + subscribe to Supabase auth state.
  useEffect(() => {
    let mounted = true
    getSession().then((s) => {
      if (!mounted) return
      setSession(s)
      setAuthReady(true)
    })
    const unsub = onAuthChange((s) => {
      setSession(s)
      setAuthReady(true)
    })
    return () => { mounted = false; unsub() }
  }, [])

  // Resolve the effective view: gated views fall back to login without a session.
  const effectiveView = GATED_VIEWS.has(view) && !session ? 'login' : view

  useEffect(() => {
    window.location.hash = view === 'landing' ? '' : view
    if (effectiveView === 'landing') {
      document.documentElement.setAttribute('data-theme', 'dark')
    } else if (effectiveView === 'login' || effectiveView === 'docs') {
      document.documentElement.setAttribute('data-theme', 'light')
    } else {
      const saved = localStorage.getItem('twine-sov-theme')
      document.documentElement.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light')
    }
  }, [view, effectiveView])

  useEffect(() => {
    const onPop = () => setView(getHashView())
    window.addEventListener('hashchange', onPop)
    return () => window.removeEventListener('hashchange', onPop)
  }, [])

  const navigate = (next) => setView(next)

  const handleLoginSuccess = () => {
    if (!localStorage.getItem('twine-sov-theme')) {
      localStorage.setItem('twine-sov-theme', 'dark')
    }
    setView('dashboard')
  }

  const handleLogout = async () => {
    await signOut()
    setView('landing')
  }

  // After a Google OAuth redirect the URL carries a ?code= (PKCE) that
  // supabase-js exchanges for a session asynchronously. Keep showing the
  // loader until that resolves, so we don't flash the login screen.
  const isOAuthCallback =
    typeof window !== 'undefined' &&
    (window.location.search.includes('code=') || window.location.hash.includes('access_token'))

  // Avoid a flash of the login screen on a gated view while the session
  // is still being restored from storage (or exchanged from an OAuth redirect).
  if ((!authReady || (isOAuthCallback && !session)) && GATED_VIEWS.has(view)) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading...</p>
      </div>
    )
  }

  if (effectiveView === 'landing') return <Landing onNavigate={navigate} onLoginSuccess={handleLoginSuccess} />
  if (effectiveView === 'login') return <Login onNavigate={navigate} onLoginSuccess={handleLoginSuccess} />
  if (effectiveView === 'docs') return <Docs onNavigate={navigate} />
  if (effectiveView === 'dashboard') return <Dashboard onLogout={handleLogout} onNavigate={navigate} />
  if (effectiveView === 'competitors') return <Competitors onLogout={handleLogout} onNavigate={navigate} />

  return <Landing onNavigate={navigate} onLoginSuccess={handleLoginSuccess} />
}

export default App
