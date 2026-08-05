# SOV / Competitive-Intelligence System — Ownership Handoff

**From:** Elan Smyla · **To:** Dustin Rabin · **Effective:** 2026-08-06
**Audience:** Dustin, and any AI agent working on this system.

This is the complete operating manual. Read §1–§4 before touching anything.
Companion documents: `README.md` (architecture + dev setup), `docs/SOV_METHODOLOGY.md`
(the scoring math), `docs/DECISIONS_LOG.md` (why things are the way they are — read
this before reversing any decision).

---

## 1. What this system is

A competitive-intelligence platform that measures Twine's **Share of Voice (SOV)**
— its share of public conversation in identity security — against tracked
competitors, across four platforms: **LinkedIn, X, Google News, Reddit**.

Three layers:

1. **Collection + scoring (n8n + Apify).** ~17 scheduled workflows scrape posts,
   an LLM decides which company each post is genuinely about, and each post gets
   an impact weight.
2. **Storage (Supabase / Postgres).** Posts, frozen weekly snapshots, config, and
   a server-side aggregation RPC.
3. **Dashboard (React + Cloudflare Worker).** Live board, trends, per-company
   drill-in, an AI assistant, OKR cards, and a system-health console.

**Live URL:** the Cloudflare Worker deployment (`competitive-intelligence-system`).
**Repo:** `elan-twine/AI_Competitive_Intelligence_System` — the `app/` directory
is the git root.

### The two OKRs it serves
| OKR | Owner | Where it shows |
|---|---|---|
| Top 3 on SOV | Justin | Dashboard KPI "Twine Rank" + the ranking table |
| # mentions, all platforms, past week | Justin | KPI "Mentions This Week" |
| KR-21: % of staff engaging with company LinkedIn posts | Twine | KPI "LinkedIn Engagement" |

⚠️ **No numeric targets are defined yet** for the mentions and KR-21 cards. They
show the live number with no goal line. That's a product decision waiting on
Elan/Justin — see §9.

---

## 2. Access you need on day one

| System | What for | Current owner / note |
|---|---|---|
| **n8n** | all scrapers + scoring | ⚠️ MCP/CLI is authed as **Dustin** already. Instance transfer still pending. |
| **Supabase** (`addwjngdezmmnxddulll`) | database | org transfer pending |
| **Cloudflare** | Worker + hosting | account is **justin@twinesecurity.com** |
| **Apify** | all scraping (~$60/mo) | transfer pending |
| **OpenAI** | attribution LLM | Twine's key (Elan's personal keys must be revoked — §9) |
| **Anthropic** | dashboard assistant | Twine's key |
| **GitHub** | `elan-twine/AI_Competitive_Intelligence_System` | org ownership transfer pending |
| **Google Cloud** | dashboard "Continue with Google" OAuth | ✅ **DONE** — project "Twine Scheduler", transferred to Dustin |

### Credentials on disk (not in git)
`sov-tooling/` sits **outside the git root** and holds working credentials:
- `.sbkey` — Supabase **service_role** JWT (full DB access; never put in frontend)
- `.oakey` — OpenAI API key, used only by the local eval/backfill scripts
- `~/.n8n_key` — n8n Public API key, used by the `n8n-admin` CLI

⚠️ Rotate all three when Elan's accounts are deactivated.

---

## 3. The daily pipeline (Israel time)

Everything is scheduled in n8n. IDs are stable — use them, not names.

| Time | Workflow | ID | What it does |
|---|---|---|---|
| 04:00 | LI Engagement Refresh | `ZIo4udMp7tl6p5Ai` | re-scrapes engagement for LinkedIn posts crossing 7 days old, recomputes weight |
| 04:15 | X Engagement Refresh | `wqG66ZNm43McKx0i` | same for tweets |
| 04:45 | URN Resolver | `4vdZBbeTJRPwrF6W` | resolves LinkedIn company URNs (self-gates, ~$0) |
| 05:00 | **LinkedIn Scraper v2** | `BbG5NbWDjQgHHIGw` | past-24h keyword + company-page scrape → `linkedin_raw` |
| 05:10 | X | `3aYO4hfbwRbx7tv0` | tweet search → `tweets` |
| 05:15/35, 06:00/20 | **LinkedIn Processor** | `F2EclaqNpxi054iI` | drains `linkedin_raw` → `linkedin_posts` with attribution. **100/run × 4 = 400/day cap** |
| 05:45 | **Google News** | `xVOA25o3tZlAnSCx` | `timeframe: 1d`, `maxArticles: 20` per keyword |
| 06:25 | Author Relationship | `LiFignB8kRZzWLKQ` | classifies post authors as employee/external → `author_affiliation` |
| 06:35 | Decay Refresh | `QW3X8MfWMvnTuI4N` | re-applies time decay to post weights |
| 06:45 | **Weekly Snapshot** | `hNauQrczVV1VDxCF` | writes `sov_weekly` + `sov_daily`; **re-derives the trailing 8 days** |
| 06:50 | Embed Feedback | `x6jkdpG4gW5AEnex` | 👍/👎 → embeddings → `poi_vectors` |
| 07:45 | Spike Alerts | `hfsxSUpewVOTl02f` | alerts on unusual movement (does **not** read news) |
| 05:10 **UTC** | Worker cron | `wrangler.jsonc` | prunes + embeds attributed posts for assistant semantic search |

### Weekly (Thursday)
| Time | Workflow | ID |
|---|---|---|
| 04:30–09:30 hourly ×6 | LI "This Week" Engagement Refresh | `SYyoZMl6FVXO58vo` |
| 04:45–09:45 hourly ×6 | X "This Week" Engagement Refresh | `gkjjbJq0W3TpPilA` |
| 05:25 | Reddit | `qN2hd39B7AlUlXb3` |
| 07:00 | Posts of Interest | `YuFF9TKneDykROOx` |
| 07:30 | AI Answers (GEO visibility) | `84SYvmU9SID6Ikxd` |
| 08:30 | Weekly Digest | `HReiMg5ddmYkMrMA` |
| 12:00 | LinkedIn Employee Engagement (KR-21) | `WvL1T5evClTBlioK` |

**Error handling:** every SOV workflow points at `E6P5SOCGjq6yrOSO` (Error
Handling). If something breaks you should get an alert — but see §5, "success"
does not mean "worked".

**Also active, not SOV:** Competitor Brief Generator (`CLz0IumaOJpg4XaG`, on
demand), Clay/Salesforce/recruiting workflows. Leave those alone unless you own
them too.

---

## 4. The scoring model (why numbers are what they are)

Full detail in `docs/SOV_METHODOLOGY.md`. The essentials:

**Per-post impact weight:**
```
pw = (B + reach × M) × sentimentMult × decay        (LinkedIn / X / Reddit)
reach = engagement ^ (49/50)
pw = newsTier × sentimentMult × decay               (Google News)
```
- **Author tier** (`B` baseline / `M` engagement multiplier): company 1/1 ·
  employee 2/1.2 · external 5/2. An outsider talking about you counts far more
  than your own post.
- **Decay** half-lives: LinkedIn 14d · News 30d · Reddit 10d · X 7d.
- **News tiers:** tier-1 2.5 · tier-2 1.5 · wire 0.5, matched on URL domain.
- **X uses engagement only** — `1·like + 2·reply + 10·repost + 4·quote`. View
  counts were deliberately dropped (views ≠ attention).
- `sentimentClamp` is currently `{min:1, max:1}` — i.e. **sentiment does not
  affect scores**; it's display-only. That was deliberate.

**Rollup — one shared pool:**
```
SOV(company) = Σ mult × pw(company) / Σ mult × pw(all direct) × 100
```
**Platform multipliers** (`sov_config.platformMultipliers`): LinkedIn 1 · X 1 ·
Reddit 1.5 · **Google News 15**. News is weighted heaviest because earned
editorial coverage is worth far more than vendor social. **This is the team's
main dial** — Elan set News to 15 on 2026-07-13 (down from a provisional 30).

**Direct vs indirect competitors:**
- **Direct** — tracked on all four platforms, and they form the 100% pool.
- **Indirect** (7AI, BlinkOps, Console, Kai) — tracked **only via their own
  LinkedIn company page**, never keyword-searched, and **excluded from the pool**.

⚠️ **The `sov_weekly` / `sov_daily` history was frozen under older platform
weights.** A backfill to re-derive it under the current weights was never run.
Old trend points are therefore not strictly comparable to new ones.

### Config lives in the database
`sov_config` (single row, `id=1`, jsonb `config`). ⚠️ **A PATCH replaces the
whole `config` object.** A partial patch once wiped every other key in prod.
Always: GET the full config → merge one key client-side → PATCH the whole
object → re-GET and diff.

---

## 5. Failure modes that have actually happened

Read this section twice. Every item below is a real incident. The recurring
theme: **this pipeline fails silently. A green run does not mean it worked.**

1. **News attribution wrote nothing for 2 weeks (Jul 20 – Aug 5, 2026).** The
   multi-company refactor changed the LLM's output shape to
   `{url, companies:[…]}` but the News branch still read flat `companyName`.
   Runs reported success, called the LLM ~44×/day, and saved zero verdicts.
   Fixed in the `Parse News LLM` node. **Detection: check DB rows, not run logs.**
2. **X engagement refresh silently returned 0 items for weeks.** The Apify actor
   `apidojo/tweet-scraper` started *forbidding* single-tweet fetches. Runs
   "succeeded" with empty datasets. Now on `apidojo/twitter-scraper-lite`
   ($0.05/tweet URL). **Third-party actors change behaviour without notice.**
3. **The Processor is a FIFO drain with a hard cap (400/day).** If LinkedIn
   inflow exceeds it, the backlog grows and the *newest* posts never process —
   silently. Check `linkedin_raw?status=eq.pending`.
4. **In-process aggregation OOMs the 320 MB scheduled worker** even at ~700 rows
   (manual runs have more headroom — always verify memory fixes in *scheduled*
   mode). Push aggregation into Postgres RPCs instead.
5. **n8n Code nodes have a hard 60s timeout.** Sequential Apify `run-sync` calls
   time out past ~20–30 posts, with partial writes. Parallelise (`Promise.all`
   over chunks).
6. **Cadence and scrape-window must always change together.** Daily cadence with
   a 7-day window re-scrapes the same week every day (~7× cost); weekly cadence
   with a 1-day window silently loses 6 of every 7 days. This trap has bitten
   the News workflow twice.
7. **n8n credential bindings are keyed to node ID, not name.** Deleting and
   recreating a node — even with the same name — orphans its credential and you
   get a 401. Fix by re-selecting the credential in the UI; never "recreate the
   node" to fix auth.
8. **`runDate` is NULL** on `linkedin_posts` / `tweets`. You cannot use it as a
   "scraped today" marker; use the posted-time window.
9. **n8n Code sandbox lacks `new URL()` and global `fetch`.** Use regex for
   hostnames and `this.helpers.httpRequest` for HTTP.

### How to actually verify a run
```bash
# 1. did it run?
~/bin/n8n-admin executions <workflowId>
# 2. did it WRITE? (this is the real test)
curl -s "$SUPABASE_URL/rest/v1/googlenews?select=url&companyName=not.is.null&publishedAt=gte.<today>" \
  -H "apikey: $SB" -H "Authorization: Bearer $SB" -H "Prefer: count=exact" -H "Range: 0-0" -D -
```
The dashboard's **System Health** page (`#health`) automates 14 of these
DB-evidence checks. Use it.

---

## 6. Attribution — the part that matters most

Every scraped post goes through an LLM gate that answers: *is this genuinely
about a tracked company?* Getting this wrong is the main quality risk, because
**a false attribution permanently inflates a competitor's SOV.**

**Model policy (do not change casually):**
| Stage | Model | Why |
|---|---|---|
| News prefilter | `gpt-4.1-mini` | deliberately permissive; a miss costs one extra scrape |
| News credibility | `gpt-4.1-mini` | mechanical 0–100 domain score |
| **All attribution gates** | **`gpt-4.1`** | mini fails namesake collisions |

That last row is evidence-based, not caution: in testing, `gpt-4.1-mini`
attributed a **Lumos *Diagnostics*** article (a medical test) to Lumos the
identity vendor; `gpt-4.1` correctly returned NONE. Reproduce with
`sov-tooling/eval_news_gate_mini.mjs` before revisiting.

**The gate requires a positive anchor** — the company's own domain, a unique
product, a named founder/employee, a funding round, a named customer, or the
company named in its real category. A shared name token is never enough.

**Known collisions** (stored per competitor in `competitors.collision_terms`):
Lumos vs Proton's "Lumo" / Lumos Diagnostics / Lumos Fiber · Surf AI vs Surf Air
Mobility / a crypto token · Twine vs Meta's internal "Twine" / the Python `twine`
tool · 7AI vs `[24]7.ai` · Console vs gaming consoles · Torch vs PyTorch /
Torch.AI · Opti vs Optiv / Optimizely · Orchid vs Orchid VPN · Oak vs the "Oak
Security" web3 audit firm.

**Human correction path:** the `misattributed` boolean on each post table. The
board RPC excludes flagged rows. There is intentionally **no review queue** —
Elan wanted the system autonomous.

**Policy: job ads / recruiting posts DO count as share of voice** (Elan,
2026-08-05). Don't "fix" the recruiter posts that attribute to Lumos — that's
intended. Note 10 such posts are currently flagged `misattributed` and are
therefore excluded; whether to unflag them is open (§9).

---

## 7. The dashboard

React 19 + Vite, served by a Cloudflare Worker that also hosts the `/api/*`
routes. Auth is Supabase (Google OAuth + email); data reads use the **anon** key
with public-read RLS.

**Pages:** SOV Dashboard (board, trends, drill-in, OKR KPIs) · Posts of Interest
· AI Visibility (GEO) · Compare · Social Briefs · Comp Briefs · System Health
(`#health`) · Methodology.

**Worker API routes:** `/api/ask` (assistant, SSE) · `/api/briefing/*` ·
`/api/enrich-competitor` · `/api/embed-posts` · `/api/file-issue` ·
`/api/openai-usage` · `/api/health`.

**Worker secrets** (Cloudflare dashboard or `wrangler secret put`):
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_KEY`, `GITHUB_TOKEN`,
`GITHUB_REPO`, `ASSISTANT_DAILY_LIMIT`, `OPENAI_ADMIN_KEY` *(optional — powers
the usage card; requires an OpenAI **Admin** key, which is org-wide read, so it
was deliberately left unset)*.
`SUPABASE_URL` and `SUPABASE_ANON_KEY` are plain vars in `wrangler.jsonc`.

**Competitors are table-driven.** The app is the only control surface: add a
competitor in the UI → ✨Auto-fill → every scraper and gate picks it up live. **No
n8n edits are needed to add or remove a competitor.**

**The board reads a Postgres RPC** (`sov_board_agg`), not the raw post firehose.
That's deliberate — the old client-side approach timed out as post volume grew.
Any new board-affecting logic belongs in the RPC, not in a client loop.

**Local dev cannot log in** (localhost isn't in Supabase's redirect allowlist).
To preview with real data, plant a session in `localStorage` using the anon key
as the access token — see `memory/local-preview-auth.md` for the snippet.

---

## 8. Cost — ~$80–90/month

Measured 2026-08-05.

| Service | Cost | Notes |
|---|---:|---|
| **Apify** | **~$60/mo** | measured $57/30d |
| └ LinkedIn post search | $31 | **the dominant line**; $0.005/post |
| └ Google News | $7.5 | $0.0040/article, **no per-run fee** |
| └ LI engagement refresh | ~$8 | incl. Thursday batches |
| └ Reddit / X / misc | ~$5 | |
| **OpenAI** | **~$20–30** | estimated, not measured — attribution on 4.1 dominates |
| **Anthropic** | small | dashboard assistant |
| n8n / Supabase / Cloudflare | plan-dependent | Supabase + CF likely free tier |
| **Firecrawl** | ⚠️ **unknown** | scrapes ~1,200 news article bodies/mo — never audited |

### The one cost lesson worth inheriting
LinkedIn search is **fuzzy/semantic by default**. Unquoted multi-word keywords
get semantically expanded — `Opti IAM` returned **122 posts/day** and produced
**one** real mention in a month. Quoting it (`"Opti IAM"`) cut that to 1/day.
Only **7.3%** of scraped LinkedIn posts are ever attributed; effective cost is
~$0.07 per real mention.

- ✅ Fixed: `Opti` and `Torch Security` keywords are now quoted (~$9.50/mo saved).
- ❌ Quoting does **not** help single generic words — `"Lumos"` returns *more*
  than unquoted. That's the honest price of a generic brand name.
- Verify any keyword change by test-running the actor before shipping it. Both
  "obvious" fixes I tried (bare `"Opti"`, bare `"Linx"`) tested **worse**.

---

## 9. Open items on hand-over

**Security / offboarding (do first):**
1. **Revoke Elan's personal OpenAI keys.** Run Competitor Brief Generator once
   to confirm its credential works on Twine's key, then revoke.
2. **Delete + rotate 25 hardcoded `sk-` keys** sitting in 5 inactive junk
   workflows (`My workflow 2`, `SOV_Workflow`, `SOV_Workflow copy`, `Share Of
   Voice Workflow`, `Share Of Voice Workflow copy SAm`).
3. **Rotate** `sov-tooling/.sbkey`, `.oakey`, `~/.n8n_key`.
4. **Delete the personal repo** `esmyla/AI_Competitive_Intelligence_System_Twine_S26`
   — an old private copy of company code that received an accidental push. Also
   delete its `feat/linkedin-engagement-kpi` and `fix/board-rpc-cache` branches.
5. Complete account transfers (§2).

**Product decisions waiting:**
6. **Define OKR target %s** for "Mentions This Week" and KR-21 — the cards have
   no goal line without them.
7. **The 10 flagged Lumos recruiter posts** — under the new "job ads count"
   policy they're correct attributions. Unflag all, unflag one (they're 10
   near-duplicates of the same post, so unflagging all inflates Lumos ~10×), or
   leave. Elan's call was never made.

**Verification owed:**
8. **Tomorrow's 05:45 News run is the first live test of the repaired parse
   node.** Confirm articles actually receive `companyName` and `post_weight`.
9. **Backfill `sov_weekly`/`sov_daily`** under current platform weights, or
   accept that old trend points aren't comparable.
10. **Audit Firecrawl spend** — the one unmeasured cost.

**Known-good deferred:** the older Jun 26 – Jul 20 unattributed news gap (~666
rows) was deliberately left alone.

---

## 10. Working on this system

**Tooling:** the n8n MCP is dead; use the CLI.
```bash
~/bin/n8n-admin list active          # all workflows + IDs
~/bin/n8n-admin get <id>             # full JSON
~/bin/n8n-admin update <id> f.json   # PUT (name/nodes/connections/settings only)
~/bin/n8n-admin executions <id>      # recent runs
```
There is **no execute endpoint** — trigger runs from the UI.

**Editing a workflow safely:**
1. `get` → edit the JSON → `node --check` any changed `jsCode`
   (wrap in `async function _(){…}`)
2. `update` → **re-fetch and verify** (typos in embedded JWTs have shipped before)
3. Preserve embedded service_role JWTs verbatim; strip unsupported `settings`
   keys or the PUT is rejected
4. Publish for it to go live

**Frontend:** branch off `main` → `npm run dev -- --port 5273` → review → PR →
merge. **Merging auto-deploys** to Cloudflare. Never self-merge without review.

**Operational scripts** in `ops/scripts/` (mirrored from Elan's `sov-tooling/`, credentials stripped):
- `eval_news_gate_mini.mjs` / `eval_li_gate_mini.mjs` — attribution model evals
- `backfill_news_attribution.mjs` — re-attribute news (replicates prod math)
- `parity_board.mjs` — proves the RPC board matches client math
- `run_assistant_evals.mjs` — assistant regression tests
- `verify_features.py` — smoke suite
- `ops/migrations/` — dated SQL migrations (apply in the Supabase SQL editor)

**Cost discipline (Elan's standing rules, worth keeping):**
- **Never trigger a paid Apify run without explicit approval.** LLM calls are
  effectively free by comparison; Apify is the real spend.
- Prefer lean scrape windows + error alerts + manual backfill over defensive
  overlap.
- **Recall-first:** capture broadly and let the LLM gate reject. Don't narrow
  keywords to save money — quote them instead (§8).

**Maintain `docs/DECISIONS_LOG.md`.** Every change with its reasoning, newest first.
It is the reason this handoff could be written at all — several decisions in this
system look wrong until you read why they were made.

---

## 11. If something breaks tomorrow

1. Open the dashboard → **System Health** (`#health`). It runs 14 DB-evidence
   checks and names what's wrong in plain language.
2. Check whether data actually landed — **not** whether the run was green:
   `linkedin_raw?status=eq.pending` (Processor backlog),
   `googlenews?companyName=is.null` (attribution), latest `sov_weekly.week_start`
   (snapshot).
3. `~/bin/n8n-admin executions <id>` for the error, then `get <id>` to inspect.
4. Suspect a third-party actor first — two of the three worst outages in this
   system's history were Apify actors silently changing behaviour (§5).
5. The dashboard degrades gracefully: if the post firehose fails but the RPC
   works, the board still renders with a warning. A blank board means the RPC or
   auth is down, not the scrapers.
