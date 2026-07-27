// Live architecture map of the whole SOV backend — every scraper, queue,
// n8n workflow, Supabase table/RPC, and serving surface as a node, wired with
// animated flow edges. Node color = worst status of its linked health checks,
// so a broken stage is visible AS a broken stage, in place, not as a row in a
// table. Pure SVG (no chart lib): the layout is a hand-tuned column graph.
import { useMemo, useState } from 'react'

const NODE_W = 172
const NODE_H = 56

// Columns: x of each node's left edge, plus the lane header.
const COLS = [
  { x: 16, label: 'SOURCES' },
  { x: 232, label: 'INGEST' },
  { x: 448, label: 'PROCESS · n8n' },
  { x: 664, label: 'STORE · Supabase' },
  { x: 880, label: 'AGGREGATE' },
  { x: 1096, label: 'SERVE' },
]

// checks: which health-check ids drive this node's color (worst wins).
// No checks -> 'idle' (a stage with no direct DB evidence — shown neutral).
const NODES = [
  { id: 'li-scraper', col: 0, y: 64, label: 'LinkedIn scraper', sub: 'Apify · daily 05:00', checks: ['scrape-linkedin'] },
  { id: 'x-scraper', col: 0, y: 160, label: 'X scraper', sub: 'Apify · daily 05:10', checks: ['scrape-x'] },
  { id: 'news-scraper', col: 0, y: 256, label: 'News scraper', sub: 'daily 05:45', checks: ['scrape-news'] },
  { id: 'reddit-scraper', col: 0, y: 352, label: 'Reddit scraper', sub: 'Apify · Thu 05:25', checks: ['scrape-reddit'] },
  { id: 'geo-runner', col: 0, y: 476, label: 'AI answers (GEO)', sub: 'GPT + Claude · Thu 07:30', checks: ['geo'] },

  { id: 'raw-queue', col: 1, y: 64, label: 'Raw queue', sub: 'linkedin_raw staging', checks: ['queue'] },

  { id: 'processor', col: 2, y: 96, label: 'Processor', sub: 'LLM attribution gates', checks: ['attribution', 'queue'] },
  { id: 'classifier', col: 2, y: 208, label: 'Author classifier', sub: 'employee/external · 06:25', checks: ['classifier'] },
  { id: 'engagement', col: 2, y: 304, label: 'Engagement refresh', sub: 'LI + X day-7 · ~04:00', checks: [] },
  { id: 'decay', col: 2, y: 400, label: 'Decay refresh', sub: 'half-life decay · 06:35', checks: [] },

  { id: 'posts', col: 3, y: 160, label: 'Attributed posts', sub: '4 platform tables', checks: ['attribution', 'volumes'] },
  { id: 'affiliation', col: 3, y: 272, label: 'author_affiliation', sub: 'author tiers', checks: ['classifier'] },
  { id: 'config', col: 3, y: 368, label: 'sov_config', sub: 'weights & half-lives', checks: ['config'] },
  { id: 'geo-store', col: 3, y: 476, label: 'geo_results', sub: 'AI visibility runs', checks: ['geo'] },

  { id: 'snapshot-wf', col: 4, y: 128, label: 'Weekly snapshot', sub: 'n8n · daily 06:45', checks: ['snapshot'] },
  { id: 'boards', col: 4, y: 240, label: 'sov_daily / weekly', sub: 'frozen boards', checks: ['snapshot'] },
  { id: 'board-rpc', col: 4, y: 352, label: 'sov_board_agg', sub: 'live board RPC', checks: ['board'] },

  { id: 'worker', col: 5, y: 160, label: 'CF Worker', sub: '/api — assistant · enrich', checks: ['worker'] },
  { id: 'app', col: 5, y: 304, label: 'Dashboard', sub: 'this app', checks: ['db'] },
]

const EDGES = [
  ['li-scraper', 'raw-queue'], ['raw-queue', 'processor'], ['processor', 'posts'],
  ['x-scraper', 'posts'], ['news-scraper', 'posts'], ['reddit-scraper', 'posts'],
  ['engagement', 'posts'], ['decay', 'posts'],
  ['posts', 'classifier', 'back'], ['classifier', 'affiliation'],
  ['geo-runner', 'geo-store'], ['geo-store', 'app'],
  ['posts', 'snapshot-wf'], ['config', 'snapshot-wf'], ['affiliation', 'snapshot-wf'],
  ['snapshot-wf', 'boards'], ['boards', 'app'],
  ['posts', 'board-rpc'], ['config', 'board-rpc'], ['board-rpc', 'app'],
  ['posts', 'worker'], ['boards', 'worker'], ['worker', 'app'],
]

const RANK = { crit: 4, warn: 3, unknown: 2, ok: 1, info: 1, idle: 0 }
function nodeStatus(node, checkById) {
  let worst = node.checks.length ? 'ok' : 'idle'
  for (const id of node.checks) {
    const c = checkById[id]
    const s = c ? (c.status === 'info' ? 'ok' : c.status) : 'unknown'
    if (RANK[s] > RANK[worst]) worst = s
  }
  return worst
}

export function SystemMap({ checks, onSelect, selectedId }) {
  const checkById = useMemo(() => Object.fromEntries((checks || []).map(c => [c.id, c])), [checks])
  const [hovered, setHovered] = useState(null)
  const byId = useMemo(() => Object.fromEntries(NODES.map(n => [n.id, n])), [])

  const pos = (n) => ({ x: COLS[n.col].x, y: n.y })
  const edgePath = ([fromId, toId, dir]) => {
    const a = pos(byId[fromId]); const b = pos(byId[toId])
    const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2
    const x2 = b.x, y2 = b.y + NODE_H / 2
    if (dir === 'back') {
      // reverse-direction edge (store → process): loop under the nodes
      const x1b = byId[fromId] ? pos(byId[fromId]).x : x1
      const y = Math.max(y1, y2) + 84
      return `M ${x1b + NODE_W / 2} ${a.y + NODE_H} C ${x1b + NODE_W / 2} ${y}, ${x2 + NODE_W / 2} ${y}, ${x2 + NODE_W / 2} ${b.y + NODE_H}`
    }
    const dx = Math.max(40, (x2 - x1) / 2)
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
  }
  const isNear = (edge) => hovered && (edge[0] === hovered || edge[1] === hovered)

  return (
    <svg className="sm-svg" viewBox="0 0 1284 600" role="img" aria-label="Backend architecture map with live health status">
      {/* lane headers */}
      {COLS.map(c => (
        <text key={c.label} className="sm-lane" x={c.x + NODE_W / 2} y={28} textAnchor="middle">{c.label}</text>
      ))}
      {/* edges under nodes */}
      <g>
        {EDGES.map((e, i) => (
          <path key={i} d={edgePath(e)} className={`sm-edge ${isNear(e) ? 'near' : ''}`} />
        ))}
      </g>
      {/* nodes */}
      {NODES.map(n => {
        const st = nodeStatus(n, checkById)
        const p = pos(n)
        const sel = selectedId === n.id
        return (
          <g
            key={n.id}
            className={`sm-node st-${st} ${sel ? 'selected' : ''}`}
            transform={`translate(${p.x}, ${n.y})`}
            onClick={() => onSelect && onSelect(n)}
            onMouseEnter={() => setHovered(n.id)}
            onMouseLeave={() => setHovered(null)}
            role="button"
            aria-label={`${n.label}: ${st}`}
          >
            <rect className="sm-box" width={NODE_W} height={NODE_H} rx={12} />
            <circle className="sm-dot" cx={18} cy={NODE_H / 2} r={5} />
            <text className="sm-label" x={34} y={24}>{n.label}</text>
            <text className="sm-sub" x={34} y={41}>{n.sub}</text>
          </g>
        )
      })}
    </svg>
  )
}
