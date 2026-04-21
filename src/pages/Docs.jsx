import { useEffect, useState } from 'react'
import { ArrowLeft, ExternalLink, Moon, Sun, Zap, Database, Brain, LineChart } from 'lucide-react'

function GithubIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.73.5.67 5.56.67 11.83c0 5.02 3.24 9.27 7.74 10.77.57.11.78-.25.78-.55 0-.27-.01-1.17-.02-2.13-3.15.68-3.82-1.34-3.82-1.34-.52-1.31-1.26-1.66-1.26-1.66-1.03-.7.08-.69.08-.69 1.14.08 1.74 1.17 1.74 1.17 1.01 1.74 2.66 1.24 3.31.95.1-.74.4-1.24.72-1.52-2.52-.29-5.17-1.26-5.17-5.6 0-1.24.44-2.25 1.17-3.04-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.16.91-.25 1.89-.38 2.86-.39.97.01 1.95.14 2.86.39 2.18-1.47 3.14-1.16 3.14-1.16.62 1.59.23 2.76.11 3.05.73.79 1.17 1.8 1.17 3.04 0 4.35-2.66 5.3-5.19 5.59.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.21.67.79.55 4.5-1.5 7.73-5.75 7.73-10.77C23.33 5.56 18.27.5 12 .5z"/>
    </svg>
  )
}
import { GlassCard } from '../components/GlassCard'
import './landing.css'

const REPO_URL = 'https://github.com/esmyla/AI_Competitive_Intelligence_System_Twine_S26'

export default function Docs({ onNavigate }) {
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
        <button className="landing-nav-link back" onClick={() => onNavigate('landing')}>
          <ArrowLeft size={14} /> Back
        </button>
        <div className="landing-nav-right">
          <button className="landing-nav-link" onClick={() => onNavigate('login')}>Login</button>
          <button className="theme-btn" onClick={() => setDark(d => !d)} aria-label="Toggle theme">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </nav>

      <main className="docs-wrap">
        <div className="docs-head">
          <div className="landing-eyebrow">
            <span className="landing-dot" />
            Documentation
          </div>
          <h1 className="landing-title small">Twine <span className="accent-text">SOV</span> Dashboard</h1>
          <p className="landing-sub">
            An internal tool that scrapes, scores, and visualizes how competitors show up
            across the web — so the Twine team can move faster on positioning.
          </p>
          <div className="docs-cta">
            <a className="cta-primary" href={REPO_URL} target="_blank" rel="noopener noreferrer">
              <GithubIcon size={16} />
              View on GitHub
              <ExternalLink size={14} />
            </a>
          </div>
        </div>

        <div className="docs-grid">
          <GlassCard className="docs-card" intensity={3}>
            <div className="docs-icon"><Database size={18} /></div>
            <h3>Sources</h3>
            <p>
              Apify actors scrape <b>X</b>, <b>Reddit</b>, <b>Google News</b>, and <b>LinkedIn</b>
              for mentions of Twine's competitor set. Results are normalized and written
              to Supabase.
            </p>
          </GlassCard>

          <GlassCard className="docs-card" intensity={3}>
            <div className="docs-icon"><Zap size={18} /></div>
            <h3>Pipeline</h3>
            <p>
              An n8n workflow orchestrates scraping, cleaning, text extraction (Firecrawl
              for news), and batched OpenRouter calls. Runs end-to-end with a single trigger.
            </p>
          </GlassCard>

          <GlassCard className="docs-card" intensity={3}>
            <div className="docs-icon"><Brain size={18} /></div>
            <h3>Scoring</h3>
            <p>
              Each post gets an <b>unweighted SOV</b> from engagement × author_weight × time decay,
              then a <b>weighted SOV</b> using sentiment (−3 to +3) from an LLM pass.
            </p>
          </GlassCard>

          <GlassCard className="docs-card" intensity={3}>
            <div className="docs-icon"><LineChart size={18} /></div>
            <h3>Dashboard</h3>
            <p>
              This React + Vite app reads from Supabase and renders rankings, sentiment,
              per-platform breakdowns, and a live mention feed.
            </p>
          </GlassCard>
        </div>

        <GlassCard className="docs-card wide" intensity={3}>
          <h3>How it fits together</h3>
          <ol className="docs-steps">
            <li><b>Scrape</b> — Apify actors pull raw posts, articles, and threads for each competitor.</li>
            <li><b>Clean</b> — Code nodes flatten nested fields and match Supabase schemas.</li>
            <li><b>Score</b> — Unweighted SOV is computed from engagement signals and recency decay.</li>
            <li><b>Analyze</b> — OpenRouter runs sentiment on text in batches; results are upserted.</li>
            <li><b>Weight</b> — Weighted SOV = unweighted × f(sentiment); written back per row.</li>
            <li><b>Visualize</b> — This frontend reads the four tables and renders the views you see on the dashboard.</li>
          </ol>
        </GlassCard>

        <GlassCard className="docs-card wide" intensity={3}>
          <h3>Stack</h3>
          <div className="docs-tags">
            <span>React</span>
            <span>Vite</span>
            <span>Recharts</span>
            <span>Supabase</span>
            <span>n8n</span>
            <span>Apify</span>
            <span>Firecrawl</span>
            <span>OpenRouter</span>
          </div>
        </GlassCard>
      </main>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} Twine · Internal Tool</span>
        <a className="muted" href={REPO_URL} target="_blank" rel="noopener noreferrer">
          github.com/esmyla/AI_Competitive_Intelligence_System_Twine_S26
        </a>
      </footer>
    </div>
  )
}
