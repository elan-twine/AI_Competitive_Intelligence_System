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

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/briefing/')) return handleBriefing(request, env, url)
    // Non-API path → static assets / SPA fallback.
    return env.ASSETS.fetch(request)
  },
}
