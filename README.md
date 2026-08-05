# Twine Competitive Intelligence — Share of Voice

Measures Twine's **share of public conversation** in identity security against
tracked competitors across **LinkedIn, X, Google News, and Reddit** — and serves
it as a live dashboard with trends, per-company drill-in, an AI analyst, and OKR
tracking.

> **New owner, or an AI agent picking this up?** Read **[HANDOFF.md](HANDOFF.md)**
> first — the complete operating manual: access, schedules, every production
> failure mode, costs, and open items. Then
> [docs/DECISIONS_LOG.md](docs/DECISIONS_LOG.md), which explains why anything
> surprising is the way it is.

---

## How it works

```
 Apify scrapers          n8n workflows            Supabase (Postgres)         Cloudflare Worker
 ──────────────          ─────────────            ───────────────────         ─────────────────
 LinkedIn ──┐                                     linkedin_raw (staging)
 X ─────────┼─▶ scrape ─▶ LLM attribution ─▶ score ─▶ linkedin_posts / tweets ─▶ sov_board_agg ─▶ React SPA
 Google News┤            (gpt-4.1 gate)    (weight) │ googlenews / reddit_posts     (RPC)         + /api/*
 Reddit ────┘                                       └ sov_weekly / sov_daily                      (assistant,
                                                      (frozen snapshots)                           enrichment)
```

1. **Collect** — ~17 scheduled n8n workflows pull posts per competitor keyword
   and company page.
2. **Attribute** — an LLM gate decides whether each post is *genuinely* about a
   tracked company, requiring a concrete anchor (own domain, unique product,
   named founder, funding round, named customer). A shared name token is never
   enough; namesake collisions are the main quality risk.
3. **Score** — each post gets an impact weight from engagement, author tier
   (outsiders count more than your own posts), source credibility, and time decay.
4. **Roll up** — weights pool across platforms into a single 100% share, with
   Google News weighted heaviest (earned coverage beats vendor social).
5. **Serve** — a Postgres RPC aggregates server-side; the SPA renders the board,
   trends, and OKR cards.

### Scoring, condensed
```
pw = (B + engagement^(49/50) × M) × sentimentMult × decay    # LinkedIn / X / Reddit
pw = newsTier × sentimentMult × decay                         # Google News

SOV(company) = Σ mult × pw(company) / Σ mult × pw(all direct) × 100
```
Author tiers `B/M`: company `1/1` · employee `2/1.2` · external `5/2`.
Half-lives: LinkedIn 14d · News 30d · Reddit 10d · X 7d.
Platform multipliers: LinkedIn 1 · X 1 · Reddit 1.5 · **News 15**.

Everything above is tunable at runtime from the `sov_config` table — no deploy
needed. Full derivation in [docs/SOV_METHODOLOGY.md](docs/SOV_METHODOLOGY.md).

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19, Vite, Recharts, lucide-react |
| Hosting / API | Cloudflare Workers — static assets and `/api/*` in one Worker |
| Database | Supabase (Postgres, RLS, SECURITY DEFINER RPCs, pgvector) |
| Orchestration | n8n scheduled workflows |
| Scraping | Apify actors |
| LLMs | OpenAI `gpt-4.1` (attribution), `gpt-4.1-mini` (cheap gates), `text-embedding-3-small`; Anthropic (dashboard assistant) |

---

## Getting started

```bash
npm install
npm run dev            # http://localhost:5173
```

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | production build → `dist/` |
| `npm run preview` | build, then serve through the real Worker locally |
| `npm run deploy` | build + `wrangler deploy` |
| `npm run lint` | ESLint |
| `npm test` | Worker unit tests (`node --test`) |

> **Login does not work on localhost** — `localhost` isn't in Supabase Auth's
> redirect allowlist. Data reads use the anon key regardless of session, so for a
> local preview you can plant a session in `localStorage` and the dashboard
> renders normally. See [HANDOFF.md](HANDOFF.md) §7.

### Configuration

Public values are in `wrangler.jsonc` → `vars` (`SUPABASE_URL`,
`SUPABASE_ANON_KEY`; the anon key is public by design and protected by RLS).

Secrets are set in Cloudflare and never committed:

```bash
wrangler secret put ANTHROPIC_API_KEY      # dashboard assistant
wrangler secret put OPENAI_API_KEY         # embeddings, enrichment
wrangler secret put SUPABASE_SERVICE_KEY   # server-side writes
wrangler secret put GITHUB_TOKEN           # in-app issue filing
wrangler secret put GITHUB_REPO
wrangler secret put ASSISTANT_DAILY_LIMIT
wrangler secret put OPENAI_ADMIN_KEY       # optional: usage card (org-wide read)
```

⚠️ The **service_role** key and Apify tokens must never reach the frontend
bundle — the browser only ever uses the anon key.

---

## Layout

```
├── src/
│   ├── pages/          9 pages — Dashboard, SystemHealth, Briefings, Landing, …
│   ├── components/     18 components — SOVTrendChart, CompanyDrillIn, AssistantChat, …
│   ├── hooks/          20 hooks — data fetching, caching, board aggregation
│   ├── lib/            17 modules — metrics/scoring, colors, cache, supabase client
│   └── App.css         design system + component styles
├── worker/index.js     Cloudflare Worker: /api/* routes + nightly cron
├── wrangler.jsonc      Worker config, public vars, cron triggers
├── supabase/migrations schema history (0001…)
├── ops/
│   ├── scripts/        evals, backfills, parity checks, smoke tests
│   └── migrations/     dated operational migrations (run in the Supabase SQL editor)
├── HANDOFF.md          operating manual — read this first
└── docs/               methodology, decision log, deploy notes, product intent
```

### API routes

| Route | Purpose |
|---|---|
| `POST /api/ask` | AI analyst over live SOV data (streams via SSE) |
| `POST /api/enrich-competitor` | auto-fill a new competitor's profile |
| `POST /api/briefing/new`, `/update-all` | trigger competitor briefings |
| `POST /api/embed-posts` | embed attributed posts for semantic search |
| `POST /api/file-issue` | file a GitHub issue from the UI |
| `GET /api/openai-usage` | 30-day token usage by model (needs an admin key) |
| `GET /api/health` | public liveness probe |

Every route except `/api/health` verifies the caller's Supabase session.

---

## Key design decisions

Each looks arbitrary until you read the reasoning in
[docs/DECISIONS_LOG.md](docs/DECISIONS_LOG.md).

- **The board reads a Postgres RPC, not raw posts.** Client-side aggregation
  timed out as volume grew and then cached the empty result. New board logic
  belongs in the RPC.
- **Competitors are table-driven.** Add one in the UI → ✨Auto-fill → every
  scraper and gate picks it up live. No workflow edits.
- **Direct vs indirect.** Direct competitors are tracked everywhere and form the
  100% pool; indirect ones are tracked only via their own LinkedIn page and stay
  out of the pool.
- **Attribution stays on `gpt-4.1`.** `gpt-4.1-mini` agrees ~98% of the time but
  fails namesake collisions — it attributed a *Lumos Diagnostics* medical article
  to Lumos — and a false positive permanently inflates a competitor's score.
- **Recall-first collection.** Capture broadly, let the LLM reject. Cost is
  controlled by *quoting* keywords (LinkedIn search is fuzzy by default), not by
  narrowing them.
- **X ignores view counts.** Engagement only — a view is not attention.
- **Sentiment is display-only.** `sentimentClamp` is `{1,1}`, so tone doesn't
  move scores.
- **All SOV metrics use a Thursday→Wednesday week** unless explicitly stated
  otherwise, matching OKR reporting.
- **Every post table has a `misattributed` flag** as the human correction path,
  and the board RPC excludes flagged rows. There is deliberately no review queue.

---

## Operations

**Deploy:** merging to `main` auto-deploys to Cloudflare. Work on a branch, open
a PR, get review.

**Monitoring:** the **System Health** page (`#health`) runs 14 DB-evidence checks
across pipeline, database, and serving layers, with run history and a live
backend map.

⚠️ **This pipeline fails silently.** Scrapers have reported success while writing
nothing — twice because a third-party Apify actor changed behaviour, once from a
schema mismatch that went unnoticed for two weeks. **Verify by querying the data,
never by reading run logs.** [HANDOFF.md](HANDOFF.md) §5 lists every failure mode
seen in production and how to detect each.

---

## Documentation

| File | Contents |
|---|---|
| [HANDOFF.md](HANDOFF.md) | **operating manual** — access, schedules, failure modes, cost, open items |
| [CLAUDE.md](CLAUDE.md) | orientation for AI agents — auto-loaded by Claude Code; the rules that must not be broken |
| [docs/SOV_METHODOLOGY.md](docs/SOV_METHODOLOGY.md) | full scoring methodology and research basis |
| [docs/DECISIONS_LOG.md](docs/DECISIONS_LOG.md) | every product/design decision, newest first |
| [docs/CLOUDFLARE_DEPLOY.md](docs/CLOUDFLARE_DEPLOY.md) | deployment specifics |
| [docs/PRODUCT.md](docs/PRODUCT.md) | product intent and design principles |
| [docs/SOV_PROJECT_STATE.md](docs/SOV_PROJECT_STATE.md) | historical build state |
| `ops/scripts/` | evals, backfills, parity checks, smoke suite |

---

Internal Twine Security project.
