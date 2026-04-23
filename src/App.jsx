import { useState, useEffect } from 'react'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Docs from './pages/Docs'
import Dashboard from './pages/Dashboard'
import './App.css'

function getInitialView() {
  const hash = window.location.hash.replace('#', '')
  const loggedIn = localStorage.getItem('twine-sov-auth') === 'true'
  if (hash === 'docs') return 'docs'
  if (hash === 'login') return 'login'
  if (hash === 'dashboard') return loggedIn ? 'dashboard' : 'login'
  return 'landing'
}

const PUBLIC_VIEWS = new Set(['landing', 'login', 'docs'])

function App() {
  const [view, setView] = useState(getInitialView)

  useEffect(() => {
    window.location.hash = view === 'landing' ? '' : view
    if (view === 'landing') {
      document.documentElement.setAttribute('data-theme', 'dark')
    } else if (view === 'login' || view === 'docs') {
      document.documentElement.setAttribute('data-theme', 'light')
    } else {
      const saved = localStorage.getItem('twine-sov-theme')
      document.documentElement.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light')
    }
  }, [view])

  useEffect(() => {
    const onPop = () => setView(getInitialView())
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

  const handleLogout = () => {
    localStorage.removeItem('twine-sov-auth')
    localStorage.removeItem('twine-sov-user')
    setView('landing')
  }

  if (view === 'landing') return <Landing onNavigate={navigate} onLoginSuccess={handleLoginSuccess} />
  if (view === 'login') return <Login onNavigate={navigate} onLoginSuccess={handleLoginSuccess} />
  if (view === 'docs') return <Docs onNavigate={navigate} />
  if (view === 'dashboard') return <Dashboard onLogout={handleLogout} />

  return <Landing onNavigate={navigate} onLoginSuccess={handleLoginSuccess} />
}

export default App
