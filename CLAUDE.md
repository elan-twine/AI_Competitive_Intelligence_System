# Agent orientation — Twine SOV / Competitive Intelligence

You are working on Twine's **Share of Voice** system: it measures Twine's share of
public conversation in identity security vs. tracked competitors across LinkedIn,
X, Google News, and Reddit, and serves it as a dashboard.

**Read [HANDOFF.md](HANDOFF.md) before doing anything non-trivial.** It is the
operating manual — schedules, failure modes, cost, open items. This file is only
the orientation layer.

## Where things are

| Need | Look at |
|---|---|
| How the whole system works, what's broken, what's owed | `HANDOFF.md` |
| Architecture, dev setup, API routes | `README.md` |
| Why a decision was made (read before reversing anything) | `docs/DECISIONS_LOG.md` |
| The scoring math | `docs/SOV_METHODOLOGY.md` |
| Frontend | `src/pages`, `src/components`, `src/hooks`, `src/lib` |
| Scoring/metrics logic | `src/lib/metrics.js`, `src/lib/boardAgg.js` |
| API + cron | `worker/index.js`, config in `wrangler.jsonc` |
| Scrapers/scoring pipeline | lives in n8n; **sanitized exports in `ops/n8n/`** (read these to understand the logic), IDs in `HANDOFF.md` §3 |
| Evals, backfills, migrations | `ops/scripts/`, `ops/migrations/` |

## The rules that matter most

1. **Verify with data, never with run logs.** This pipeline fails *silently*. A
   green n8n run has repeatedly meant "wrote nothing" — twice from Apify actors
   changing behaviour, once from a schema mismatch that went unnoticed for two
   weeks. Always confirm rows actually changed in Supabase.
2. **Never trigger a paid Apify run without explicit approval.** Apify is the real
   cost (~$60/mo); LLM calls are cheap by comparison. Scraping is the expensive part.
3. **Attribution stays on `gpt-4.1`.** `gpt-4.1-mini` agrees ~98% of the time but
   fails namesake collisions (it attributed a *Lumos Diagnostics* medical article
   to Lumos the identity vendor). A false attribution permanently inflates a
   competitor's score. Cheap prefilter/credibility stages may use mini.
4. **`sov_config` PATCH replaces the entire `config` object.** A partial patch once
   wiped every other key in production. GET the full config → merge one key
   client-side → PATCH the whole object → re-GET and diff.
5. **Never rotate a working credential.** The Supabase `service_role` JWT is
   embedded in ~17 n8n workflow code nodes — rotating it breaks the whole pipeline
   until every one is edited and re-published. Read existing keys from the source
   system; don't regenerate them.
6. **Cadence and scrape-window always change together.** Daily cadence + a 7-day
   window re-scrapes the same week every day (~7× cost); weekly cadence + a 1-day
   window silently loses 6 of every 7 days. This has bitten the News workflow twice.

## Conventions

- **Friday→Thursday weeks.** Every SOV metric uses this week unless explicitly
  stated otherwise — the week CLOSES on OKR-review Thursday so report day shows a
  ~full week. Helper: `isoWeekStart` in `src/lib/metrics.js` (`WEEK_ANCHOR_DAY=5`).
  stated otherwise — the week closes on the Thursday OKR-review day (Elan,
  2026-08-06; superseded the earlier Thu→Wed anchor). Helper: `isoWeekStart`,
  anchored by `WEEK_ANCHOR_DAY = 5`, in `src/lib/metrics.js`.
- **Competitors are table-driven.** Add/remove in the app UI → every scraper and
  gate picks it up live. Never hardcode a competitor, and no n8n edit is needed.
- **Direct vs indirect.** Direct competitors are tracked on all platforms and form
  the 100% pool. Indirect ones are tracked *only* via their own LinkedIn company
  page and are excluded from the pool.
- **Board logic lives in the `sov_board_agg` RPC**, not in client loops — the old
  client-side aggregation timed out as volume grew. Put new board math in the RPC.
- **Frontend never sees privileged keys.** Browser uses the Supabase **anon** key
  only; service_role and Apify tokens stay server-side.
- **Sentiment is display-only** (`sentimentClamp` is `{1,1}`) — tone does not move
  scores. This is deliberate.
- **Job ads / recruiting posts DO count** as share of voice (product decision).

## Working practices

- **Git:** branch off `main`, open a PR, get review. **Merging auto-deploys** to
  Cloudflare. Don't self-merge without review.
- **Local dev:** `npm run dev`. Login does not work on localhost (Supabase redirect
  allowlist) — see `HANDOFF.md` §7 for the preview workaround.
- **Before shipping:** `npm run build` and `npm run lint`. Worker tests: `npm test`.
- **n8n:** use the `n8n-admin` CLI (`list active`, `get <id>`, `update <id> f.json`,
  `executions <id>`). There is **no execute endpoint** — trigger runs from the UI.
  After any edit: re-fetch and verify, preserve embedded credentials verbatim, and
  publish. Never delete-and-recreate a node to fix auth — credential bindings are
  keyed to node ID, so that orphans them and yields a 401.
- **Keep `docs/DECISIONS_LOG.md` current.** Add an entry for every product or
  design decision, newest first, with the reasoning and any constraint it sets.
  Several choices in this system look wrong until you read why.

## Debugging entry points

- Dashboard → **System Health** (`#health`) runs 14 DB-evidence checks and names
  problems in plain language. Start there.
- Processor backlog: `linkedin_raw?status=eq.pending` (the drain is capped at
  400/day — if inflow exceeds it, the *newest* posts silently never process).
- Attribution health: `googlenews?companyName=is.null`, and check the latest
  `sov_weekly.week_start` for snapshot freshness.
- Suspect a third-party Apify actor first — that's been the cause of two of the
  three worst outages.

## Known-open items

See `HANDOFF.md` §9 for the full list with owners. Highlights: OKR target
percentages are undefined; `sov_weekly`/`sov_daily` history was frozen under older
platform weights and never backfilled; Firecrawl spend has never been audited.
