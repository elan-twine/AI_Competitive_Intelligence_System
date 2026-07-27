import { createElement } from 'react'

// Tech-stack diagram for the foot of the System Health page. A logo-forward,
// categorized showcase of what actually powers the system, laid out in flow
// order (collect → automate → store → serve → view, with the AI models that
// feed it). Emblems are inline SVG (self-contained, theme-aware via
// currentColor) tinted with each product's brand color.

const Atom = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <ellipse cx="12" cy="12" rx="10.5" ry="4" />
    <ellipse cx="12" cy="12" rx="10.5" ry="4" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="10.5" ry="4" transform="rotate(120 12 12)" />
  </svg>
)
const Bolt = () => (
  <svg viewBox="0 0 24 24"><path d="M13 2 4 13.5h6l-1 8.5L20 9.5h-6z" fill="currentColor" /></svg>
)
const Cloud = () => (
  <svg viewBox="0 0 24 24"><path d="M7.5 18.5h9.7a3.4 3.4 0 0 0 .5-6.75A5.4 5.4 0 0 0 7.3 9.4 4.2 4.2 0 0 0 7.5 18.5z" fill="currentColor" /></svg>
)
const Nodes = () => (
  <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" fill="none">
    <path d="M6 12 12 6.5M12 6.5 18 12M12 6.5V18" />
    <circle cx="6" cy="12" r="2.4" fill="currentColor" />
    <circle cx="18" cy="12" r="2.4" fill="currentColor" />
    <circle cx="12" cy="6.5" r="2.4" fill="currentColor" />
    <circle cx="12" cy="18" r="2.4" fill="currentColor" />
  </svg>
)
const Hex = () => (
  <svg viewBox="0 0 24 24"><path d="M12 2.6 20.1 7.3v9.4L12 21.4 3.9 16.7V7.3z" fill="none" stroke="currentColor" strokeWidth="1.7" /></svg>
)
const Burst = () => (
  <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
    <path d="M12 3.5v17M4.6 7.75 19.4 16.25M19.4 7.75 4.6 16.25" />
  </svg>
)
const Fork = () => (
  <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.9" fill="none">
    <circle cx="6.5" cy="6" r="2.3" /><circle cx="6.5" cy="18" r="2.3" /><circle cx="17.5" cy="8" r="2.3" />
    <path d="M6.5 8.3v7.4M6.5 12h6.5a4 4 0 0 0 4-4" />
  </svg>
)
const Spider = () => (
  <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6" fill="none">
    <circle cx="12" cy="12" r="3.2" fill="currentColor" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" />
  </svg>
)

// [key, name, role, brandColor, Emblem]
const LAYERS = [
  {
    lane: 'Collect', items: [
      ['apify', 'Apify', 'Social & news scrapers', '#22C55E', Spider],
    ],
  },
  {
    lane: 'Automate', items: [
      ['n8n', 'n8n', 'Pipeline orchestration — scrape → attribute → score', '#EA4B71', Nodes],
    ],
  },
  {
    lane: 'AI models', items: [
      ['anthropic', 'Anthropic', 'Assistant + attribution gates (Claude)', '#D97757', Burst],
      ['openai', 'OpenAI', 'Embeddings + AI-visibility search', '#10A37F', Hex],
    ],
  },
  {
    lane: 'Store', items: [
      ['supabase', 'Supabase', 'Postgres database, auth, aggregation RPCs', '#3ECF8E', Bolt],
    ],
  },
  {
    lane: 'Serve', items: [
      ['cloudflare', 'Cloudflare', 'Workers + Pages hosting, cron, /api', '#F38020', Cloud],
      ['github', 'GitHub', 'Source, PRs, auto-deploy on merge', 'var(--text-primary)', Fork],
    ],
  },
  {
    lane: 'View', items: [
      ['react', 'React + Vite', 'The dashboard you\'re looking at', '#61DAFB', Atom],
    ],
  },
]

export function TechStack() {
  return (
    <div className="ts-flow">
      {LAYERS.map((layer, i) => (
        <div className="ts-lane" key={layer.lane}>
          <div className="ts-lane-label">{layer.lane}</div>
          <div className="ts-lane-items">
            {layer.items.map(([key, name, role, color, Emblem]) => (
              <div className="ts-tile" key={key} style={{ '--brand': color }}>
                <span className="ts-emblem">{createElement(Emblem)}</span>
                <div className="ts-tile-text">
                  <span className="ts-name">{name}</span>
                  <span className="ts-role">{role}</span>
                </div>
              </div>
            ))}
          </div>
          {i < LAYERS.length - 1 && <div className="ts-arrow" aria-hidden="true">↓</div>}
        </div>
      ))}
    </div>
  )
}
