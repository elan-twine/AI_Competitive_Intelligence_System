// Cloudflare Worker entry for the SOV dashboard.
//
// Purpose: serve the built SPA (static assets) AND gate the n8n "briefing"
// webhooks behind a Supabase-session check. The real n8n webhook URLs live in
// Worker SECRETS (N8N_NEW_COMPETITOR_WEBHOOK / N8N_UPDATE_ALL_WEBHOOK) — NOT in
// the client bundle — so a random visitor can no longer read them from the JS
// and trigger (paid) briefing scrapes. Only a request carrying a valid,
// logged-in Supabase access token is forwarded to n8n.
//
// Routing: wrangler.jsonc `assets.run_worker_first: ["/api/*"]` sends only
// /api/* to this Worker; every other path is served straight from static assets
// (with SPA fallback), so this handler only ever sees API routes in practice.
// The ASSETS.fetch fallback is a safety net.

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS })

// Validate the caller's Supabase access token by asking Supabase who it belongs
// to. Authoritative (also rejects expired/revoked tokens). Returns user | null.
async function verifyUser(request, env) {
  const auth = request.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null
  let r
  try {
    r = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
    })
  } catch {
    return null
  }
  if (!r.ok) return null
  const user = await r.json().catch(() => null)
  return user && user.id ? user : null
}

async function handleBriefing(request, env, url) {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' })
  const user = await verifyUser(request, env)
  if (!user) return json(401, { error: 'unauthorized' })

  const target =
    url.pathname === '/api/briefing/new' ? env.N8N_NEW_COMPETITOR_WEBHOOK :
    url.pathname === '/api/briefing/update-all' ? env.N8N_UPDATE_ALL_WEBHOOK :
    null
  if (!target) return json(404, { error: 'unknown endpoint' })
  if (!/^https:\/\//.test(String(target))) return json(500, { error: 'webhook not configured' })

  const body = await request.text()
  let resp
  try {
    resp = await fetch(target, { method: 'POST', headers: JSON_HEADERS, body: body || '{}' })
  } catch {
    return json(502, { error: 'upstream webhook failed' })
  }
  const text = await resp.text().catch(() => '')
  return new Response(text || '{}', { status: resp.status, headers: JSON_HEADERS })
}

// ---- Dashboard assistant (v2 — agentic) -------------------------------------
// A session-gated Q&A endpoint backed by a real agentic loop on Claude Sonnet
// 4.5. The browser sends the question + a THIN UI-state header (what tab/window
// the user is looking at, ~100 tokens) — NOT a data snapshot. The agent fetches
// everything it needs itself via tools (query_data / system_status), can chain
// up to MAX_STEPS calls, and self-corrects on empty results. The Anthropic key
// lives in a Worker secret (ANTHROPIC_API_KEY), never the client bundle.
//
// Wire protocol to the client: a stream of `\x1e`-delimited JSON frames
//   {t:'progress', label}  — a tool step is running (live "thinking" visibility)
//   {t:'token', text}      — a chunk of the final answer (appended client-side)
//   {t:'draft', draft}     — an issue draft to review before filing (terminal)
//   {t:'error', message}   — something failed
// \x1e (record separator) never appears inside JSON.stringify output (control
// chars are \u-escaped), so it's a safe frame delimiter.

const MODEL = 'claude-sonnet-4-5'
const MAX_STEPS = 6           // tool-call rounds per question (guardrail)
const DEFAULT_DAILY_LIMIT = 50 // questions/user/day (override via ASSISTANT_DAILY_LIMIT)

const ASSISTANT_SYSTEM = `You are the assistant built into the Twine "Share of Voice" (SOV) competitive-intelligence dashboard. You help the logged-in user understand what they're seeing and why the numbers move. Be concise, concrete, and grounded ONLY in data you fetch with your tools — never invent posts, numbers, or companies.

WHAT YOU ARE GIVEN: only a small UI-STATE header (below) telling you what the user is currently looking at — the tab, the time window, the platform filter, and any company they've drilled into. This tells you what "this"/"here"/"they" refer to. You are NOT given the board or any posts inline. Fetch what you need yourself with the tools before citing any number, and prefer to call tools SILENTLY — do not narrate "let me check…"; just call the tool and then answer.

HOW SOV IS CALCULATED (use this to explain "why"):
- Every post (LinkedIn, X, Reddit, Google News) gets a post_weight from its engagement, who posted it, and how old it is.
- Engagement → reach = engagement^(49/50). Author tier sets a baseline+multiplier: a company's own account counts least, a confirmed employee more, an unaffiliated "external" voice most (an outsider talking about you is worth ~5×). Older posts decay (LinkedIn half-life 14d, News 30d, Reddit 10d, X 7d), flat for the first 7 days.
- Each post's weight is multiplied by a per-platform trust multiplier (currently LinkedIn 1, X 1, Reddit 1.5, Google News 15) and pooled into ONE cross-platform total. A company's SOV% = its share of that pool. Only DIRECT competitors are in the denominator (they sum to 100%); indirect competitors are shown but excluded from the 100%.
- News articles have no engagement, so they score by outlet tier × decay. Sentiment is measured and displayed but currently does NOT move the ranking.
- So a "spike" almost always traces to one or a few recent high-impact posts — usually an external mention, a viral/high-engagement post, or (for News) a tier-1 article. To explain a move: fetch the current board, then fetch that company's highest-weight recent posts and cite them by platform/date/snippet + link.

WHERE THINGS ARE IN THE APP (use this for "where do I find…" questions):
- Top nav: "SOV Dashboard", "Social Briefs" (weekly review of competitors' own LinkedIn posts with 👍/👎), "Comp Briefs" (AI-written per-competitor briefing docs).
- Inside SOV Dashboard, four tabs (all share the Platform filter + 7d/30d/YTD time window at the top):
  • Overview — the ranking table + the Share-of-Voice trend chart. Click any company row to drill in to "why is X at Y%?" (week-by-week, platform-by-platform, down to individual posts).
  • Posts of Interest — a curated weekly digest of each competitor's most notable posts.
  • AI Visibility — GEO/AEO: how often each company is named when AI engines answer buyer questions (with web search on), plus per-prompt win/miss.
  • Compare — two companies side by side (SOV, sentiment, platform split).
- Header icons: About (what the score measures), Methodology (the full math + the interactive platform-weights explainer), Manage competitors, light/dark toggle, log out.
- To remove a wrong mention: every post card has a small flag/remove control — it soft-excludes that mention from all calculations without deleting the data.

HOW DATA FLOWS (so you can reason about freshness): posts are scraped daily per platform → LinkedIn posts land in a raw staging queue and are then LLM-attributed to a competitor (or NONE) and scored; X/Reddit/News are attributed inline as they're scraped → attributed posts feed the SOV board (recomputed daily). So a very recent post can be scraped but not yet processed/attributed — that's a queue question (system_status), not a "missing data" one.

USING YOUR TOOLS (fetch first, then answer — you may chain up to ${MAX_STEPS} calls and should retry with different parameters if a result is empty or surprising):
- query_data — the read tool for board + posts + AI visibility:
  • Current standings → source 'daily_board' (window_days 7 for the trailing-7-day board, 30 for 30d, 0 for all-time cumulative); the newest snapshot_date rows are today's board.
  • SOV history over time → source 'weekly_board' or 'daily_board' with a company + date range.
  • Individual mentions / "what drove a move" / "most negative" → source 'posts' (filter by company, platform, dates; sort top_weight / most_negative / newest).
  • AI-answer visibility ("how often does ChatGPT name us", GEO) → source 'ai_visibility'.
  Answer ONLY from the rows returned; if empty, say so and suggest a narrower/broader query.
- system_status — OPERATIONAL questions: "is anything waiting to be processed/attributed?" (LinkedIn queue), "when did we last scrape X?" (per-platform freshness), "what are the current weights / multipliers / half-lives?" (live scoring config — trust this over any numbers in this prompt).
- create_github_issue — see below.

FILING FEEDBACK: When the user reports something actionable that should change — a mis-weighted article ("this should be tier 1"), a wrong attribution or sentiment, a bug, or a feature request — call create_github_issue. This does NOT file immediately: it creates a DRAFT the user reviews and confirms, so draft faithfully. Rules: (1) capture ONLY what the user actually said — never invent a cause, fix, or solution they didn't state; (2) if they raised multiple distinct points, list each as its own item labeled a bug or an enhancement; (3) their exact message is attached automatically as a verbatim quote, so prefer their wording over paraphrase. Give a concise, specific title and a body with the concrete details (company, platform, article title/URL, current vs expected value, reasoning). Only file for genuine actionable feedback — never for ordinary questions.

LANGUAGE: Always reply in the same language the user's question is written in — if they write in Hebrew, answer in Hebrew (and write any GitHub issue in that language too). All formatting rules below apply in every language.

STYLE: Answer in clean, skimmable GitHub-flavored Markdown, rendered in a narrow (~360px) chat panel. Keep it tight — usually 2–5 sentences or a short list. Lead with the direct answer in the first line. Use **bold** for key numbers, company names, and section names. When you enumerate multiple drivers, companies, or steps, use a short bullet list (one idea per bullet). Use \`inline code\` for exact tab/field names. Link a post or article as [short label](url) — never paste a bare URL. Avoid headings for short answers, avoid deeply nested lists, keep any table to 2–3 narrow columns, and never dump raw JSON. For "why" questions name the specific driver(s) + the number; for "where" questions name the exact tab/section and the path to it.`

// Tools in Anthropic format ({ name, description, input_schema }).
const ASSISTANT_TOOLS = [{
  name: 'query_data',
  description: 'Read rows from the database: the SOV board (current standings or history), individual posts/mentions across LinkedIn/X/Reddit/News, or AI-answer (GEO) visibility. E.g. "current SOV standings" (daily_board), "Twine\'s SOV by week" (weekly_board), "all Cerby news in June" or "most negative posts about Twine" (posts), "how often does ChatGPT name us?" (ai_visibility). Returns rows scoped to what this user is allowed to see; answer only from them.',
  input_schema: {
    type: 'object',
    properties: {
      source: { type: 'string', enum: ['posts', 'weekly_board', 'daily_board', 'ai_visibility'], description: 'posts = individual mentions; weekly_board/daily_board = SOV% standings/history; ai_visibility = how often each company is named in AI-answer engines.' },
      company: { type: 'string', description: 'Filter to one tracked competitor by name.' },
      platform: { type: 'string', enum: ['LinkedIn', 'X', 'Reddit', 'Google News'], description: 'posts only: limit to one platform; omit for all.' },
      since: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive).' },
      until: { type: 'string', description: 'End date YYYY-MM-DD (inclusive).' },
      sort: { type: 'string', enum: ['newest', 'top_weight', 'top_engagement', 'most_negative', 'most_positive'], description: 'posts ordering; default newest.' },
      window_days: { type: 'integer', enum: [7, 30, 0], description: 'daily_board only: 7d / 30d / 0 = all-time cumulative. Use the newest snapshot_date rows for the current board.' },
      limit: { type: 'integer', description: 'Max rows, default 25, capped at 100.' },
    },
    required: ['source'],
  },
}, {
  name: 'system_status',
  description: 'Operational/pipeline status (NOT the SOV numbers). Use for: "is anything waiting to be processed/attributed?" (the LinkedIn ingestion queue — pending vs done, oldest-pending age); "is the pipeline running / when did we last scrape X?" (per-platform last successful scrape); and "what are the current weights / the News multiplier / half-lives?" (the live scoring config). Returns a small status object; answer only from it.',
  input_schema: { type: 'object', properties: {}, required: [] },
}, {
  name: 'create_github_issue',
  description: 'File a GitHub issue in the dashboard repo when the user reports an actionable problem or request — a mis-weighted article, wrong attribution/sentiment, a bug, or a feature idea. Creates a DRAFT the user confirms; do NOT call this for ordinary questions.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Concise, specific issue title (e.g. "Article X mis-weighted tier 2, should be tier 1").' },
      body: { type: 'string', description: 'Faithful details of ONLY what the user reported — the specific data referenced (company, platform, article title/URL, current vs expected value) and their reasoning. If they raised multiple distinct points, list each as its own item labeled (bug) or (enhancement). Do NOT invent fixes, causes, or solutions they did not state.' },
      category: { type: 'string', enum: ['data-correction', 'bug', 'feature-request', 'other'], description: 'Type of feedback.' },
    },
    required: ['title', 'body'],
  },
}]

// Create a GitHub issue from a confirmed draft. Token stays a Worker secret.
// The user's verbatim message is appended as a quote so the record preserves
// their exact intent even if the model's summary drifted.
async function createGithubIssue(env, repo, args) {
  if (!env.GITHUB_TOKEN) return { ok: false, message: "I couldn't file that — issue tracking isn't configured yet (missing GitHub token). Please pass this to an admin." }
  const title = (String(args && args.title || '').trim().slice(0, 240)) || 'Dashboard assistant feedback'
  const cat = args && args.category ? `\n\n_Category: ${args.category}_` : ''
  const verbatim = String(args && args.verbatim || '').trim().slice(0, 4000)
  const quote = verbatim ? "\n\n> **Reporter's words (verbatim):**\n" + verbatim.split('\n').map(l => '> ' + l).join('\n') : ''
  const body = (String(args && args.body || '').trim().slice(0, 6000)) + cat + quote + '\n\n— filed via the dashboard assistant'
  let r
  try {
    r = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.GITHUB_TOKEN,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'twine-sov-assistant',
      },
      body: JSON.stringify({ title, body }),
    })
  } catch {
    return { ok: false, message: "I couldn't reach GitHub to file that — please try again in a moment." }
  }
  if (!r.ok) return { ok: false, message: `I couldn't file that (GitHub returned ${r.status}). Please try again, or file it manually.` }
  const j = await r.json().catch(() => null)
  const num = j && j.number
  const url = j && j.html_url
  return { ok: true, number: num, url, message: `✓ Filed as issue #${num}: ${url}` }
}

// Run a bounded, parameterized read against Supabase AS THE USER (their access
// token → their RLS permissions; the bot can't see anything they couldn't).
// Returns a compact JSON string for the model to answer from. No free-form SQL.
async function runDataQuery(env, authToken, args) {
  if (!authToken || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return JSON.stringify({ error: 'data access unavailable' })
  const H = { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + authToken }
  const BASE = env.SUPABASE_URL + '/rest/v1'
  const enc = encodeURIComponent
  const limit = Math.min(Math.max(Number(args && args.limit) || 25, 1), 100)
  const source = (args && args.source) || 'posts'
  const company = args && args.company ? String(args.company).trim() : ''
  const since = /^\d{4}-\d{2}-\d{2}/.test(String((args && args.since) || '')) ? args.since.slice(0, 10) : ''
  const until = /^\d{4}-\d{2}-\d{2}/.test(String((args && args.until) || '')) ? args.until.slice(0, 10) : ''
  const q = (parts) => parts.filter(Boolean).join('&')
  const get = async (path) => {
    try { const r = await fetch(BASE + path, { headers: H }); if (!r.ok) return null; return await r.json() } catch { return null }
  }

  if (source === 'ai_visibility') {
    // GEO / "share of model" — how often each company is named in AI answers.
    // Newest run first, then by within-answer position (earlier = more prominent).
    const rows = await get('/geo_results?' + q([
      'select=topic,engine,run_date,mentions',
      since ? `run_date=gte.${since}` : '',
      until ? `run_date=lte.${until}` : '',
      'order=run_date.desc',
      `limit=${limit}`,
    ]))
    if (rows == null) return JSON.stringify({ error: 'query failed' })
    // Flatten into company-level rows, optionally filtered to one company.
    const cf = company.toLowerCase()
    const out = []
    for (const r of rows) {
      for (const m of (Array.isArray(r.mentions) ? r.mentions : [])) {
        if (cf && !String(m.company || '').toLowerCase().includes(cf)) continue
        out.push({ company: m.company, position: m.position, engine: r.engine, topic: r.topic, run_date: String(r.run_date || '').slice(0, 10) })
      }
    }
    return JSON.stringify({ source, count: out.length, rows: out.slice(0, limit) })
  }

  if (source === 'weekly_board' || source === 'daily_board') {
    const isWeekly = source === 'weekly_board'
    const table = isWeekly ? 'sov_weekly' : 'sov_daily'
    const dateCol = isWeekly ? 'week_start' : 'snapshot_date'
    const sel = isWeekly
      ? 'company,week_start,weighted_pct,sentiment_pct,posts_count'
      : 'company,snapshot_date,window_days,weighted_pct,sentiment_pct,posts_count'
    const wd = [7, 30, 0].includes(Number(args && args.window_days)) ? Number(args.window_days) : 7
    const rows = await get('/' + table + '?' + q([
      'select=' + sel,
      company ? `company=ilike.*${enc(company)}*` : '',
      since ? `${dateCol}=gte.${since}` : '',
      until ? `${dateCol}=lte.${until}` : '',
      !isWeekly ? `window_days=eq.${wd}` : '',
      `order=${dateCol}.desc`,
      `limit=${limit}`,
    ]))
    if (rows == null) return JSON.stringify({ error: 'query failed' })
    return JSON.stringify({ source, count: rows.length, rows })
  }

  // posts (one platform, or all four merged)
  const PLAT = {
    LinkedIn: { table: 'linkedin_posts', date: 'posted_at', sel: 'companyName,posted_at,totalReactions,comments,reshares,post_weight,sentiment,text,title,post_url' },
    X: { table: 'tweets', date: 'createdAt', sel: 'companyName,createdAt,likeCount,retweetCount,replyCount,quoteCount,post_weight,sentiment,text,twitterUrl,url' },
    Reddit: { table: 'reddit_posts', date: 'createdAt', sel: 'companyName,createdAt,score,numComments,post_weight,sentiment,title,selfText,url,permalink' },
    'Google News': { table: 'googlenews', date: 'publishedAt', sel: 'companyName,publishedAt,post_weight,sentiment,title,source,url' },
  }
  const sort = (args && args.sort) || 'newest'
  const platforms = (args && args.platform && PLAT[args.platform]) ? [args.platform] : Object.keys(PLAT)
  const orderFor = (p) => {
    if (sort === 'top_weight' || sort === 'top_engagement') return 'post_weight.desc'
    if (sort === 'most_negative') return 'sentiment.asc'
    if (sort === 'most_positive') return 'sentiment.desc'
    return PLAT[p].date + '.desc'
  }
  const out = []
  await Promise.all(platforms.map(async (p) => {
    const d = PLAT[p]
    const rows = await get('/' + d.table + '?' + q([
      'select=' + d.sel,
      'companyName=not.is.null', 'companyName=neq.NONE',
      company ? `companyName=ilike.*${enc(company)}*` : '',
      since ? `${d.date}=gte.${since}` : '',
      until ? `${d.date}=lte.${until}` : '',
      'misattributed=not.is.true', // keep false+null (unflagged), exclude only flagged-true
      `order=${orderFor(p)}`,
      `limit=${limit}`,
    ]))
    for (const row of (rows || [])) {
      const eng = p === 'LinkedIn' ? { reactions: row.totalReactions, comments: row.comments, reshares: row.reshares }
        : p === 'X' ? { likes: row.likeCount, reposts: row.retweetCount, replies: row.replyCount, quotes: row.quoteCount }
        : p === 'Reddit' ? { upvotes: row.score, comments: row.numComments } : {}
      out.push({
        platform: p,
        company: row.companyName,
        date: String(row[d.date] || '').slice(0, 10),
        post_weight: row.post_weight,
        sentiment: row.sentiment,
        engagement: eng,
        snippet: String(row.text || row.title || row.selfText || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        url: row.post_url || row.twitterUrl || row.url || row.permalink || null,
      })
    }
  }))
  out.sort((a, b) => {
    if (sort === 'top_weight' || sort === 'top_engagement') return (b.post_weight || 0) - (a.post_weight || 0)
    if (sort === 'most_negative') return (a.sentiment ?? 0) - (b.sentiment ?? 0)
    if (sort === 'most_positive') return (b.sentiment ?? 0) - (a.sentiment ?? 0)
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0
  })
  return JSON.stringify({ source: 'posts', sort, count: Math.min(out.length, limit), rows: out.slice(0, limit) })
}

// Operational status: LinkedIn ingestion queue, per-platform scrape freshness,
// and the live scoring config. Backed by a SECURITY DEFINER RPC that returns only
// aggregate counts + config (no raw staging rows), so it's safe under the caller's
// token regardless of table RLS. Compact payload.
async function runSystemStatus(env, authToken) {
  if (!authToken || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return JSON.stringify({ error: 'status unavailable' })
  try {
    const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/assistant_system_status', {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + authToken, 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!r.ok) return JSON.stringify({ error: `status query failed (${r.status})` })
    return JSON.stringify(await r.json())
  } catch { return JSON.stringify({ error: 'status query failed' }) }
}

// Per-user/day rate limit. Atomically bumps a counter via a SECURITY DEFINER RPC
// (keyed on auth.uid()) and returns {allowed, count, limit, remaining}. FAIL-OPEN:
// if the RPC isn't deployed yet (migration not run) or errors, returns null and
// the caller does not block — the assistant keeps working, just uncapped.
async function bumpUsage(env, authToken, max) {
  if (!authToken || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null
  try {
    const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/assistant_bump_usage', {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + authToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_max: max }),
    })
    if (!r.ok) return null
    return await r.json().catch(() => null)
  } catch { return null }
}

// One (non-streaming) Anthropic Messages call. Returns { data } or { error }.
async function callAnthropic(env, system, messages, tools) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 40000)
  let r
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system,
        messages,
        ...(tools ? { tools } : {}),
      }),
      signal: ctl.signal,
    })
  } catch { clearTimeout(timer); return { error: 'network' } }
  clearTimeout(timer)
  if (!r.ok) return { error: 'status', status: r.status }
  const j = await r.json().catch(() => null)
  if (!j || !Array.isArray(j.content)) return { error: 'parse' }
  return { data: j }
}

// A friendly one-line label for the "thinking" progress frame of a tool step.
function labelForTool(tu) {
  if (tu.name === 'system_status') return 'Checking pipeline status…'
  if (tu.name === 'query_data') {
    const s = (tu.input && tu.input.source) || 'posts'
    if (s === 'posts') return 'Searching posts…'
    if (s === 'ai_visibility') return 'Checking AI visibility…'
    return 'Reading the SOV board…'
  }
  return 'Working…'
}

// Normalize the client history into strictly-alternating user/assistant turns
// starting with user, so the Anthropic API accepts it. The new question is
// appended by the caller after this.
function normalizeHistory(history) {
  const out = []
  for (const m of history) {
    if (!m || !m.content) continue
    const role = m.role === 'user' ? 'user' : 'assistant'
    const content = String(m.content).slice(0, 4000)
    if (!content) continue
    if (out.length === 0 && role !== 'user') continue // must start with user
    if (out.length && out[out.length - 1].role === role) { out[out.length - 1] = { role, content }; continue }
    out.push({ role, content })
  }
  // Drop a dangling trailing user turn (the current question supersedes it).
  if (out.length && out[out.length - 1].role === 'user') out.pop()
  return out
}

async function handleAsk(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' })
  const user = await verifyUser(request, env)
  if (!user) return json(401, { error: 'unauthorized' })
  if (!env.ANTHROPIC_API_KEY) return json(503, { error: 'assistant not configured' })
  // The caller's Supabase token — reused so tools read AS this user (RLS).
  const authToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()

  // Cap the body before parsing (the thin context is small; this rejects abuse).
  const clen = Number(request.headers.get('content-length') || 0)
  if (clen > 60000) return json(413, { error: 'request too large' })

  let payload
  try { payload = await request.json() } catch { return json(400, { error: 'bad request' }) }
  const question = String((payload && payload.question) || '').trim().slice(0, 2000)
  if (!question) return json(400, { error: 'empty question' })
  const uiState = (payload && payload.context) || {}
  const history = Array.isArray(payload && payload.history) ? payload.history.slice(-8) : []

  // Rate limit (fail-open — see bumpUsage). Check before spending model tokens.
  const dailyLimit = Number(env.ASSISTANT_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT
  const usage = await bumpUsage(env, authToken, dailyLimit)
  const overLimit = usage && usage.allowed === false && usage.reason !== 'unauthenticated'

  const system = ASSISTANT_SYSTEM + '\n\nUI STATE (what the user is currently looking at):\n' + JSON.stringify(uiState).slice(0, 1500)
  const GH_REPO = env.GITHUB_REPO || 'elan-twine/AI_Competitive_Intelligence_System'

  const { readable, writable } = new TransformStream()
  const enc = new TextEncoder()
  ;(async () => {
    const writer = writable.getWriter()
    const send = (obj) => writer.write(enc.encode('\x1e' + JSON.stringify(obj)))
    const streamText = async (text) => { const S = 48; for (let i = 0; i < text.length; i += S) await send({ t: 'token', text: text.slice(i, i + S) }) }
    try {
      if (overLimit) {
        await streamText(`You've reached today's limit of **${dailyLimit}** assistant questions. The count resets daily. If you need more, an admin can raise the limit.`)
        return
      }

      const messages = [...normalizeHistory(history), { role: 'user', content: question }]
      let steps = 0
      let answered = false

      while (steps < MAX_STEPS) {
        const res = await callAnthropic(env, system, messages, ASSISTANT_TOOLS)
        if (res.error) { await send({ t: 'error', message: 'The assistant hit an error reaching the model. Please try again in a moment.' }); return }
        const blocks = res.data.content
        const stop = res.data.stop_reason

        if (stop === 'tool_use') {
          // Echo the assistant turn (incl. tool_use blocks) back verbatim — required.
          messages.push({ role: 'assistant', content: blocks })
          const toolUses = blocks.filter(b => b.type === 'tool_use')

          // create_github_issue is terminal: emit a draft to review, then stop.
          const issue = toolUses.find(b => b.name === 'create_github_issue')
          if (issue) {
            const a = issue.input || {}
            await send({ t: 'draft', draft: {
              title: String(a.title || '').slice(0, 240),
              body: String(a.body || '').slice(0, 6000),
              category: a.category || null,
              verbatim: question,
            } })
            return
          }

          // Run the read tools, feed results back, loop.
          const results = []
          for (const tu of toolUses) {
            await send({ t: 'progress', label: labelForTool(tu) })
            const out = tu.name === 'system_status'
              ? await runSystemStatus(env, authToken)
              : tu.name === 'query_data'
                ? await runDataQuery(env, authToken, tu.input || {})
                : JSON.stringify({ error: 'unknown tool' })
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: String(out).slice(0, 12000) })
          }
          messages.push({ role: 'user', content: results })
          steps++
          continue
        }

        // Final answer (end_turn / max_tokens / stop_sequence).
        const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('').trim()
        if (text) { await streamText(text); answered = true }
        break
      }

      // Exhausted the tool budget without a final answer → force one last
      // answer with tools disabled, grounded in what we've already fetched.
      if (!answered) {
        const res = await callAnthropic(env, system, [...messages, { role: 'user', content: 'You have used your tool budget. Answer now using only what you already fetched; if it is not enough, say briefly what is missing.' }], null)
        const text = res.data ? res.data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim() : ''
        await streamText(text || "I looked into that but couldn't pull together a clear answer — try rephrasing, or narrow it to a specific company or date range.")
      }
    } catch { try { await send({ t: 'error', message: 'Something went wrong. Please try again.' }) } catch { /* closed */ } }
    finally { try { await writer.close() } catch { /* already closed */ } }
  })()

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Assistant-Model': MODEL },
  })
}

// Confirm-and-file: the client posts the (possibly user-edited) draft here after
// the user taps "File it" in the preview. Session-gated like /api/ask.
async function handleFileIssue(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' })
  const user = await verifyUser(request, env)
  if (!user) return json(401, { error: 'unauthorized' })
  let payload
  try { payload = await request.json() } catch { return json(400, { error: 'bad request' }) }
  const GH_REPO = env.GITHUB_REPO || 'elan-twine/AI_Competitive_Intelligence_System'
  const res = await createGithubIssue(env, GH_REPO, {
    title: payload && payload.title,
    body: payload && payload.body,
    category: payload && payload.category,
    verbatim: payload && payload.verbatim,
  })
  if (!res.ok) return json(502, { error: res.message })
  return json(200, { message: res.message, number: res.number, url: res.url })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/briefing/')) return handleBriefing(request, env, url)
    if (url.pathname === '/api/ask') return handleAsk(request, env)
    if (url.pathname === '/api/file-issue') return handleFileIssue(request, env)
    // Non-API path → static assets / SPA fallback.
    return env.ASSETS.fetch(request)
  },
}
