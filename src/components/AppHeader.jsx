import { useEffect, useState } from 'react'
import { Info, Brain, Users, LayoutDashboard, Sun, Moon, LogOut, Activity } from 'lucide-react'

// Shared top bar for every authed page (Dashboard, About, Methodology,
// Competitors). One place owns the light/dark toggle — single source of truth is
// localStorage 'twine-sov-theme' + <html data-theme> (App.jsx re-applies the
// saved value on each view change, so this stays consistent across navigation).
//
// `page` is the title suffix after "Twine" (also used to hide the nav button for
// the page you're already on). Pass `view` + `onViewChange` (Dashboard only) to
// render the centered SOV Dashboard / Social Briefs / Comp Briefs switch.
const DASHBOARD_VIEWS = [
  ['sov', 'SOV Dashboard'],
  ['social', 'Social Briefs'],
  ['briefings', 'Comp Briefs'],
]
const DASHBOARD_PAGES = new Set(['SOV', 'Social Briefs', 'Comp Briefs'])

export function AppHeader({ page, onNavigate, onLogout, view, onViewChange, onHome }) {
  // Dark is the default; only an explicit 'light' choice opts out.
  const [dark, setDark] = useState(() => localStorage.getItem('twine-sov-theme') !== 'light')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('twine-sov-theme', dark ? 'dark' : 'light')
  }, [dark])

  const onDashboard = DASHBOARD_PAGES.has(page)
  const NAV = [
    { key: 'dashboard', tip: 'Dashboard', label: 'Dashboard', Icon: LayoutDashboard, show: !!onNavigate && !onDashboard },
    { key: 'about', tip: 'About', label: 'About — what this measures', Icon: Info, show: !!onNavigate && page !== 'About' },
    { key: 'methodology', tip: 'Methodology', label: 'Methodology — the math', Icon: Brain, show: !!onNavigate && page !== 'Methodology' },
    { key: 'competitors', tip: 'Competitors', label: 'Manage competitors', Icon: Users, show: !!onNavigate && page !== 'Competitors' },
    { key: 'health', tip: 'System health', label: 'System health — pipeline & data console', Icon: Activity, show: !!onNavigate && page !== 'System health' },
  ]

  // Logo → home: back to the dashboard overview. Reset the dashboard's
  // persisted internal nav FIRST so a fresh mount reads sov/overview; a page
  // that already has the dashboard mounted passes onHome to flip live state.
  const goHome = () => {
    try {
      localStorage.setItem('twinesov:nav:view', JSON.stringify('sov'))
      localStorage.setItem('twinesov:nav:tab', JSON.stringify('overview'))
    } catch { /* storage unavailable — navigation still works */ }
    if (onHome) onHome()
    else if (onNavigate) onNavigate('dashboard')
  }

  return (
    <header className="header">
      <div
        className="header-left header-home"
        role="button"
        tabIndex={0}
        title="Back to the dashboard"
        onClick={goHome}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') goHome() }}
      >
        <img src="/twine-logo.svg" alt="Twine" className="header-logo" />
        <h1>Twine <span>{page}</span></h1>
      </div>

      {view && onViewChange && (
        <div className="view-switch">
          {DASHBOARD_VIEWS.map(([k, label]) => (
            <button key={k} className={`view-seg ${view === k ? 'active' : ''}`} onClick={() => onViewChange(k)}>{label}</button>
          ))}
        </div>
      )}

      <div className="header-right">
        {/* data-tip drives the instant CSS tooltip (App.css); no `title` so the
            browser's delayed native tooltip doesn't double up. */}
        {NAV.filter(n => n.show).map(({ key, tip, label, Icon }) => (
          <button key={key} className="theme-btn" onClick={() => onNavigate(key)} aria-label={label} data-tip={tip}>
            <Icon size={16} />
          </button>
        ))}
        <button className="theme-btn" onClick={() => setDark(d => !d)} aria-label="Toggle light or dark theme" data-tip={dark ? 'Light mode' : 'Dark mode'}>
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {onLogout && (
          <button className="theme-btn" onClick={onLogout} aria-label="Log out" data-tip="Log out">
            <LogOut size={16} />
          </button>
        )}
      </div>
    </header>
  )
}
