// Live architecture map of the whole SOV backend — every scraper, queue,
// n8n workflow, Supabase table/RPC, and serving surface as a node, wired with
// animated flow edges. Node color = worst status of its linked health checks,
// so a broken stage is visible AS a broken stage, in place, not as a row in a
// table. Pure SVG (no chart lib).
//
// EDGE ROUTING is orthogonal (circuit-diagram style), not free bezier: every
// edge runs in a straight horizontal corridor and bends at most once, inside
// the gutter between two columns (each bending edge gets its own vertical
// lane `bx` so verticals never overlap). Node rows are aligned so the main
// trunk (LinkedIn → queue → processor and X → posts, GEO → geo_results,
// classifier → author_affiliation, posts → CF Worker) is dead straight.
// Edges fan into hub nodes (Attributed posts has six producers) at distinct
// entry heights instead of piling onto the node's center.
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
// Row y's are chosen so aligned source→target pairs connect with straight
// lines (li/queue/processor at 64; x-scraper↔posts at 160; classifier↔
// author_affiliation at 256; geo-runner↔geo_results at 476).
const NODES = [
  { id: 'li-scraper', col: 0, y: 64, label: 'LinkedIn scraper', sub: 'Apify · daily 05:00', checks: ['scrape-linkedin'] },
  { id: 'x-scraper', col: 0, y: 160, label: 'X scraper', sub: 'Apify · daily 05:10', checks: ['scrape-x'] },
  { id: 'news-scraper', col: 0, y: 256, label: 'News scraper', sub: 'daily 05:45', checks: ['scrape-news'] },
  { id: 'reddit-scraper', col: 0, y: 352, label: 'Reddit scraper', sub: 'Apify · Thu 05:25', checks: ['scrape-reddit'] },
  { id: 'geo-runner', col: 0, y: 476, label: 'AI answers (GEO)', sub: 'GPT + Claude · Thu 07:30', checks: ['geo'] },

  { id: 'raw-queue', col: 1, y: 64, label: 'Raw queue', sub: 'linkedin_raw staging', checks: ['queue'] },

  { id: 'processor', col: 2, y: 64, label: 'Processor', sub: 'LLM attribution gates', checks: ['attribution', 'queue'] },
  { id: 'classifier', col: 2, y: 256, label: 'Author classifier', sub: 'employee/external · 06:25', checks: ['classifier'] },
  { id: 'engagement', col: 2, y: 352, label: 'Engagement refresh', sub: 'LI + X day-7 · ~04:00', checks: [] },
  { id: 'decay', col: 2, y: 436, label: 'Decay refresh', sub: 'half-life decay · 06:35', checks: [] },

  { id: 'posts', col: 3, y: 160, label: 'Attributed posts', sub: '4 platform tables', checks: ['attribution', 'volumes'] },
  { id: 'affiliation', col: 3, y: 256, label: 'author_affiliation', sub: 'author tiers', checks: ['classifier'] },
  { id: 'config', col: 3, y: 352, label: 'sov_config', sub: 'weights & half-lives', checks: ['config'] },
  { id: 'geo-store', col: 3, y: 476, label: 'geo_results', sub: 'AI visibility runs', checks: ['geo'] },

  { id: 'snapshot-wf', col: 4, y: 120, label: 'Weekly snapshot', sub: 'n8n · daily 06:45', checks: ['snapshot'] },
  { id: 'boards', col: 4, y: 248, label: 'sov_daily / weekly', sub: 'frozen boards', checks: ['snapshot'] },
  { id: 'board-rpc', col: 4, y: 360, label: 'sov_board_agg', sub: 'live board RPC', checks: ['board'] },

  { id: 'worker', col: 5, y: 192, label: 'CF Worker', sub: '/api — assistant · enrich', checks: ['worker'] },
  { id: 'app', col: 5, y: 336, label: 'Dashboard', sub: 'this app', checks: ['db'] },
]

// Each edge is pre-routed: exit/entry are ABSOLUTE y's on the source's right
// edge / target's left edge (fanned so hub nodes don't pile up), and bx is
// the edge's private vertical lane inside a gutter. No exit/entry/bx =
// straight horizontal (rows are aligned). kind:'v' = same-column vertical.
// kind:'back' = leftward edge (store → process), routed left out of the
// source into its gutter lane.
const EDGES = [
  { f: 'li-scraper', t: 'raw-queue' },                                      // straight @92
  { f: 'raw-queue', t: 'processor' },                                       // straight @92
  { f: 'processor', t: 'posts', exit: 92, entry: 168, bx: 630 },
  { f: 'x-scraper', t: 'posts', exit: 188, entry: 177, bx: 198 },
  { f: 'news-scraper', t: 'posts', exit: 284, entry: 186, bx: 206 },
  { f: 'reddit-scraper', t: 'posts', exit: 380, entry: 195, bx: 214 },
  { f: 'engagement', t: 'posts', exit: 380, entry: 204, bx: 640 },
  { f: 'decay', t: 'posts', exit: 464, entry: 213, bx: 650 },
  { f: 'geo-runner', t: 'geo-store' },                                      // straight @504
  { f: 'posts', t: 'classifier', exit: 210, entry: 284, bx: 636, kind: 'back' },
  { f: 'classifier', t: 'affiliation' },                                    // straight @284
  { f: 'posts', t: 'snapshot-wf', exit: 168, entry: 140, bx: 842 },
  { f: 'affiliation', t: 'snapshot-wf', exit: 284, entry: 150, bx: 852 },
  { f: 'config', t: 'snapshot-wf', exit: 372, entry: 160, bx: 862 },
  { f: 'posts', t: 'board-rpc', exit: 188, entry: 380, bx: 870 },
  { f: 'config', t: 'board-rpc', exit: 388, entry: 388 },                   // straight @388
  { f: 'snapshot-wf', t: 'boards', kind: 'v' },
  { f: 'boards', t: 'worker', exit: 268, entry: 228, bx: 1058 },
  { f: 'boards', t: 'app', exit: 284, entry: 356, bx: 1066 },
  { f: 'posts', t: 'worker', exit: 208, entry: 208 },                       // straight @208 (col-4 row gap)
  { f: 'geo-store', t: 'app', exit: 504, entry: 372, bx: 1074 },
  { f: 'board-rpc', t: 'app', exit: 388, entry: 364, bx: 1082 },
  { f: 'worker', t: 'app', kind: 'v' },
]

// Orthogonal path with rounded corners through the given waypoints.
function roundedPath(pts, r = 8) {
  if (pts.length < 3) return `M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]}`
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [cx, cy] = pts[i], [nx, ny] = pts[i + 1]
    const rr = Math.min(r, Math.abs(cx - px) + Math.abs(cy - py) - 0.01, Math.abs(nx - cx) + Math.abs(ny - cy) - 0.01)
    const inX = Math.sign(cx - px), inY = Math.sign(cy - py)
    const outX = Math.sign(nx - cx), outY = Math.sign(ny - cy)
    d += ` L ${cx - inX * rr} ${cy - inY * rr} Q ${cx} ${cy} ${cx + outX * rr} ${cy + outY * rr}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${last[0]} ${last[1]}`
  return d
}

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

  const edgePath = (e) => {
    const a = byId[e.f], b = byId[e.t]
    const ax = COLS[a.col].x, bxx = COLS[b.col].x
    if (e.kind === 'v') {
      // same-column: straight vertical, node bottom → node top
      const x = ax + NODE_W / 2
      return roundedPath([[x, a.y + NODE_H], [x, b.y]])
    }
    if (e.kind === 'back') {
      // leftward: out of the source's LEFT edge, down the gutter lane, into
      // the target's RIGHT edge
      return roundedPath([[ax, e.exit], [e.bx, e.exit], [e.bx, e.entry], [bxx + NODE_W, e.entry]])
    }
    const y1 = e.exit ?? a.y + NODE_H / 2
    const y2 = e.entry ?? b.y + NODE_H / 2
    if (e.bx == null || y1 === y2) return roundedPath([[ax + NODE_W, y1], [bxx, y2]])
    return roundedPath([[ax + NODE_W, y1], [e.bx, y1], [e.bx, y2], [bxx, y2]])
  }
  const isNear = (e) => hovered && (e.f === hovered || e.t === hovered)

  return (
    <svg
      className={`sm-svg ${hovered ? 'hovering' : ''}`}
      viewBox="0 0 1284 560"
      role="img"
      aria-label="Backend architecture map with live health status"
    >
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
        const sel = selectedId === n.id
        return (
          <g
            key={n.id}
            className={`sm-node st-${st} ${sel ? 'selected' : ''}`}
            transform={`translate(${COLS[n.col].x}, ${n.y})`}
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
