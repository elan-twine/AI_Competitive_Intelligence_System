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

function App() {
  const [view, setView] = useState(getInitialView)

  useEffect(() => {
    window.location.hash = view === 'landing' ? '' : view
  }, [view])

  useEffect(() => {
    const onPop = () => setView(getInitialView())
    window.addEventListener('hashchange', onPop)
    return () => window.removeEventListener('hashchange', onPop)
  }, [])

  const navigate = (next) => setView(next)

  const handleLoginSuccess = () => setView('dashboard')

  const handleLogout = () => {
    localStorage.removeItem('twine-sov-auth')
    localStorage.removeItem('twine-sov-user')
    setView('landing')
  }

  if (view === 'landing') return <Landing onNavigate={navigate} />
  if (view === 'login') return <Login onNavigate={navigate} onLoginSuccess={handleLoginSuccess} />
  if (view === 'docs') return <Docs onNavigate={navigate} />
  if (view === 'dashboard') return <Dashboard onLogout={handleLogout} />

  return <Landing onNavigate={navigate} />
}

export default App
