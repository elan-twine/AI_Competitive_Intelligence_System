# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Twine Security's **internal team** — marketing and leadership tracking Twine's
competitive standing, plus **non-technical coworkers** who need at-a-glance
answers ("who's winning?", "is anything broken?") without digging. Access is
gated to `@twinesecurity.com` (Google OAuth). Primary jobs: prepare for and run
the **weekly OKR review**, monitor competitors day-to-day, and confirm the data
pipeline is healthy. Not customer- or public-facing.

## Product Purpose

A competitive-intelligence dashboard that measures Twine's **Share of Voice
(mindshare)** against tracked competitors across **LinkedIn, X, Reddit, and
Google News**. It scrapes posts, LLM-attributes each to a competitor, scores it
by engagement, and presents a ranked board, Share-of-Voice trends,
AI-visibility (GEO), curated posts of interest, competitor/social briefs, an AI
assistant, and a system-health console. Success = the team can see where Twine
stands, understand *why* it moved, and act — directly serving the OKRs (be
top-3 on SOV; grow weekly mentions).

## Positioning

The **mindshare-pool SOV model**: per-post impact is engagement-weighted,
time-decayed, and sentiment-separated; every platform's impact is converted by
research-grounded **trust multipliers** (peer/community > editorial press >
vendor social) into one pooled "share of considered attention." Direct
competitors sum to 100%; indirect competitors are tracked but excluded from the
denominator. A single post naming several competitors counts for each
(multi-company attribution). It measures *earned* mindshare (engagement), never
raw views or self-inflation — a neighboring dashboard that counts impressions
could not truthfully claim the same metric.

## Operating Context

- **Weekly OKR meeting** — a meeting-ready weekly brief targets the two tracked
  OKRs (Top-3 on SOV; weekly mentions across all platforms), owner Justin.
- **Slack** — alerts, briefs, and operational audits are delivered here.
- **n8n pipeline** — daily scrapers → raw staging queue → LLM attribution
  processor → Supabase → decay/snapshot + live aggregation.
- **Cloudflare Worker** — serves the assistant and `/api/*`; **Supabase** is the
  database/auth/RPC layer.
- **Competitor roster is managed entirely in-app**: add by LinkedIn URL → AI
  auto-fills tracking details → all scrapers/gates pick it up on the next run.
  No one edits the pipeline by hand.

## Capabilities and Constraints

- **Surfaces:** SOV Dashboard (ranked board + SOV trend chart + platform/time
  filters), Posts of Interest, AI Visibility (GEO), Compare, Social Briefs,
  Competitor Briefs, Manage Competitors (table-driven + AI auto-fill), System
  Health console (live backend map + checks + tech-stack diagram), and a
  floating AI assistant present across the app.
- **Windows:** 7-day / 30-day / year-to-date. **Platforms:** LinkedIn, X,
  Reddit, Google News.
- **Direct vs. indirect policy:** direct competitors are tracked on all
  platforms and counted in the 100% pool; indirect competitors are tracked via
  their LinkedIn presence only and excluded from the pool.
- **Auth & security constraints:** Google OAuth restricted to
  `@twinesecurity.com`; the browser uses the Supabase anon key only — the
  service-role key and scraper tokens **must never reach the frontend**.
- **Data constraints:** the board is computed by a server-side aggregation RPC
  (constant payload, independent of post volume); sentiment is a separate,
  display-only dimension (it never inflates SOV).
- **Terminology future work must keep straight:** SOV / mindshare, direct vs.
  indirect competitor, mindshare-pool, GEO / AI-visibility, attribution gate,
  post weight.

## Brand Commitments

- **Name:** "Twine" / "Twine Security" (binding).
- **Voice:** clear, concrete, non-hype — and legible to non-technical coworkers.
  Plain-language explanations are a product value (e.g. the health page states
  *what's wrong* in lay terms, not jargon).
- **Visual identity is NOT binding.** The current dark glass-morphism look, lime
  accent (`#DBFE02`), and Space Grotesk type are the **incumbent** implementation
  and a **visual refresh is explicitly on the table** (user decision,
  2026-07-29). Later visual work should treat the current look as evidence and
  anti-reference, not a fixed constraint. The Twine *name* is the only fixed
  identity element.

## Evidence on Hand

Real scraped-and-scored data lives in Supabase (`linkedin_posts`, `tweets`,
`googlenews`, `reddit_posts`, `sov_daily`/`sov_weekly`, `geo_results`,
`competitors`); the live board's direct competitors sum to 100. There are **no
customer testimonials, revenue figures, or third-party benchmarks** in this
product — future work must not fabricate customers, metrics, or competitor
claims. Competitor definitions are AI-generated and human-editable, not
authoritative company statements.

## Product Principles

1. **Recall-first, LLM-gated.** Capture broadly; let the LLM attribute (or mark
   NONE). Keep all data — narrowing at capture loses signal.
2. **Evidence over assertion.** Health and correctness are proven from data
   (freshness, sums, executions), never merely claimed.
3. **Legible to non-technical users.** Anyone can see who's winning and whether
   anything is broken without clicking through the stack.
4. **The app is the only control surface.** Competitors and config are managed
   in-app; changes reflect live without hand-editing pipelines.
5. **Faithful measurement.** SOV reflects earned engagement, not raw reach or
   self-promotion; sentiment stays a separate dimension.

## Accessibility & Inclusion

Internal tool with a mixed-technical audience: readability for non-engineers is
a first-class requirement, and the app supports both light and dark themes.
Color must stay legible in both (a prior fix corrected lime-on-pale contrast).
No formal external WCAG mandate has been set, but contrast and clarity are
treated as product requirements, not polish.
