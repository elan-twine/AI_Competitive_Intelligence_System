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

// ---- Dashboard assistant ----------------------------------------------------
// A session-gated Q&A endpoint. The browser sends the question + a compact
// snapshot of what's currently on screen (board, recent movement, top recent
// posts); the Worker adds the static app map + methodology below and calls
// OpenAI. The OpenAI key lives in a Worker secret (OPENAI_API_KEY), never the
// client bundle — same principle as the briefing webhooks above.
const ASSISTANT_SYSTEM = `You are the assistant built into the Twine "Share of Voice" (SOV) competitive-intelligence dashboard. You help the logged-in user understand what they're seeing and why the numbers move. Be concise, concrete, and grounded ONLY in the DATA CONTEXT provided — never invent posts, numbers, or companies. If the data doesn't contain the answer, say so and suggest where they might look.

HOW SOV IS CALCULATED (use this to explain "why"):
- Every post (LinkedIn, X, Reddit, Google News) gets a post_weight from its engagement, who posted it, and how old it is.
- Engagement → reach = engagement^(49/50). Author tier sets a baseline+multiplier: a company's own account counts least, a confirmed employee more, an unaffiliated "external" voice most (an outsider talking about you is worth ~5×). Older posts decay (LinkedIn half-life 14d, News 30d, Reddit 10d, X 7d), flat for the first 7 days.
- Each post's weight is multiplied by a per-platform trust multiplier (currently LinkedIn 1, X 1, Reddit 1.5, Google News 15) and pooled into ONE cross-platform total. A company's SOV% = its share of that pool. Only DIRECT competitors are in the denominator (they sum to 100%); indirect competitors are shown but excluded from the 100%.
- News articles have no engagement, so they score by outlet tier × decay. Sentiment is measured and displayed but currently does NOT move the ranking.
- So a "spike" almost always traces to one or a few recent high-impact posts — usually an external mention, a viral/high-engagement post, or (for News) a tier-1 article. The DATA CONTEXT's "movement" (last 7d vs prior 7d) and "recentTopPosts" are where to look; cite the specific post(s) by company/platform/date/snippet when explaining a move.

WHERE THINGS ARE IN THE APP (use this for "where do I find…" questions):
- Top nav: "SOV Dashboard", "Social Briefs" (weekly review of competitors' own LinkedIn posts with 👍/👎), "Comp Briefs" (AI-written per-competitor briefing docs).
- Inside SOV Dashboard, five tabs (all share the Platform filter + 7d/30d/YTD time window at the top):
  • Overview — the ranking table + the Share-of-Voice trend chart. Click any company row to drill in to "why is X at Y%?" (week-by-week, platform-by-platform, down to individual posts).
  • Posts of Interest — a curated weekly digest of each competitor's most notable posts.
  • AI Visibility — how often each company is named in AI-answer engines (share of model).
  • Compare — two companies side by side (SOV, sentiment, platform split).
  • Weights — an explainer of the platform trust multipliers.
- Header icons: About (what the score measures), Methodology (the full math), Manage competitors, light/dark toggle, log out.
- To remove a wrong mention: every post card has a small flag/remove control — it soft-excludes that mention from all calculations without deleting the data.

FILING FEEDBACK: You can file a GitHub issue via the create_github_issue tool. Call it when the user reports something that should change — a mis-weighted article (e.g. "this should be tier 1, not tier 2"), a wrong attribution or sentiment, a bug, or a feature request. Give it a clear title and a body capturing the specifics they referenced (company, platform, article title/URL, current vs expected value, and any reasoning they gave). Only file for genuine actionable feedback about the system — never for ordinary questions. The system posts the confirmation with the issue link automatically, so once you call the tool you don't need to add anything else.

STYLE: Answer in clean, skimmable GitHub-flavored Markdown, rendered in a narrow (~360px) chat panel. Keep it tight — usually 2–5 sentences or a short list. Lead with the direct answer in the first line. Use **bold** for the key numbers, company names, and section names. When you enumerate multiple drivers, companies, or steps, use a short bullet list (one idea per bullet) rather than a run-on sentence. Use \`inline code\` for exact tab/field names. Link a post or article as [short label](url) — never paste a bare URL. Avoid headings for short answers, avoid deeply nested lists, keep any table to 2–3 narrow columns (the panel is narrow), and never dump raw JSON. For "why" questions name the specific driver(s) + the number; for "where" questions name the exact tab/section and the path to it.`

// Tool the model can call to turn actionable feedback into a tracked GitHub issue.
const ASSISTANT_TOOLS = [{
  type: 'function',
  function: {
    name: 'create_github_issue',
    description: 'File a GitHub issue in the dashboard repo when the user reports an actionable problem or request — a mis-weighted article, wrong attribution/sentiment, a bug, or a feature idea. Do NOT call this for ordinary questions.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Concise, specific issue title (e.g. "Article X mis-weighted tier 2, should be tier 1").' },
        body: { type: 'string', description: 'Details: the specific data referenced (company, platform, article title/URL, current vs expected value) and the user\'s reasoning.' },
        category: { type: 'string', enum: ['data-correction', 'bug', 'feature-request', 'other'], description: 'Type of feedback.' },
      },
      required: ['title', 'body'],
    },
  },
}]

// Create a GitHub issue from the model's tool call. Token stays a Worker secret.
async function createGithubIssue(env, repo, args) {
  if (!env.GITHUB_TOKEN) return { message: "I couldn't file that — issue tracking isn't configured yet (missing GitHub token). Please pass this to an admin." }
  const title = (String(args && args.title || '').trim().slice(0, 240)) || 'Dashboard assistant feedback'
  const cat = args && args.category ? `\n\n_Category: ${args.category}_` : ''
  const body = (String(args && args.body || '').trim().slice(0, 6000)) + cat + '\n\n— filed via the dashboard assistant'
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
    return { message: "I couldn't reach GitHub to file that — please try again in a moment." }
  }
  if (!r.ok) return { message: `I couldn't file that (GitHub returned ${r.status}). Please try again, or file it manually.` }
  const j = await r.json().catch(() => null)
  const num = j && j.number
  const url = j && j.html_url
  return { message: `✓ Thanks — I've filed your feedback as issue #${num}: ${url}\n\nThe team will review it.` }
}

async function handleAsk(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' })
  const user = await verifyUser(request, env)
  if (!user) return json(401, { error: 'unauthorized' })
  if (!env.OPENAI_API_KEY) return json(503, { error: 'assistant not configured' })

  // Cap the body before parsing so a huge context can't burn CPU/memory.
  const clen = Number(request.headers.get('content-length') || 0)
  if (clen > 200000) return json(413, { error: 'request too large' })

  let payload
  try { payload = await request.json() } catch { return json(400, { error: 'bad request' }) }
  const question = String((payload && payload.question) || '').trim().slice(0, 2000)
  if (!question) return json(400, { error: 'empty question' })
  const context = (payload && payload.context) || {}
  const history = Array.isArray(payload && payload.history) ? payload.history.slice(-6) : []

  const messages = [
    { role: 'system', content: ASSISTANT_SYSTEM + '\n\nDATA CONTEXT (JSON — what the user is currently looking at):\n' + JSON.stringify(context).slice(0, 24000) },
    ...history
      .filter(m => m && m.content)
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content).slice(0, 4000) })),
    { role: 'user', content: question },
  ]

  // Timeout guards only the initial connect (headers). Once the stream starts we
  // let it flow to completion so a long answer isn't truncated mid-token.
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 25000)
  let resp
  try {
    resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.OPENAI_API_KEY },
      body: JSON.stringify({ model: 'gpt-4.1', messages, temperature: 0.2, max_tokens: 600, stream: true, tools: ASSISTANT_TOOLS, tool_choice: 'auto' }),
      signal: ctl.signal,
    })
  } catch {
    clearTimeout(timer)
    return json(502, { error: 'assistant upstream failed' })
  }
  clearTimeout(timer)
  // On error OpenAI sends a JSON body, not a stream — surface a generic error
  // (don't forward its raw quota/billing wording to the client).
  if (!resp.ok || !resp.body) return json(502, { error: 'assistant error' })

  // Transform OpenAI's SSE into a plain-text stream of content deltas so the
  // browser can append tokens live. If the model calls create_github_issue
  // instead of answering, accumulate the call, run it, and stream the
  // confirmation text in its place.
  const GH_REPO = env.GITHUB_REPO || 'elan-twine/AI_Competitive_Intelligence_System'
  const { readable, writable } = new TransformStream()
  ;(async () => {
    const reader = resp.body.getReader()
    const dec = new TextDecoder()
    const enc = new TextEncoder()
    const writer = writable.getWriter()
    let buf = ''
    let toolName = ''
    let toolArgs = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || '' // keep the trailing partial line for next chunk
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith('data:')) continue
          const data = t.slice(5).trim()
          if (!data || data === '[DONE]') continue
          try {
            const piece = JSON.parse(data)
            const delta = piece.choices && piece.choices[0] && piece.choices[0].delta
            if (!delta) continue
            if (delta.content) await writer.write(enc.encode(delta.content))
            const tc = delta.tool_calls && delta.tool_calls[0] && delta.tool_calls[0].function
            if (tc) {
              if (tc.name) toolName = tc.name
              if (tc.arguments) toolArgs += tc.arguments
            }
          } catch { /* keep-alive or partial JSON — skip */ }
        }
      }
      if (toolName === 'create_github_issue') {
        let args = {}
        try { args = JSON.parse(toolArgs || '{}') } catch { /* leave empty → defaulted title */ }
        const res = await createGithubIssue(env, GH_REPO, args)
        await writer.write(enc.encode(res.message))
      }
    } catch { /* upstream aborted/failed mid-stream — just close */ } finally {
      try { await writer.close() } catch { /* already closed */ }
    }
  })()

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/briefing/')) return handleBriefing(request, env, url)
    if (url.pathname === '/api/ask') return handleAsk(request, env)
    // Non-API path → static assets / SPA fallback.
    return env.ASSETS.fetch(request)
  },
}
