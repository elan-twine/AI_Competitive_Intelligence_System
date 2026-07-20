// Methodology knowledge base for the assistant's `explain` tool. Each key is a
// topic the model can request; the value is an authoritative, detailed markdown
// chunk (deeper than the system-prompt summary — exact formulas, tiers, examples).
// Keep numbers in sync with the live scoring config (sov_config) and MEMORY.md.
// The assistant re-expresses these in the user's language + the panel's format;
// it should treat these as the source of truth over any figure elsewhere.

export const METHODOLOGY_KB = {
  scoring: `**How each post is scored (post_weight).**
For engagement-based platforms (LinkedIn, X, Reddit):
\`post_weight = (B + reach × M) × sentiment_mult × decay\`
- \`reach = engagement^(49/50)\` — near-linear in engagement, very gently dampened at the top end.
- \`B\` (baseline) and \`M\` (multiplier) come from **who posted** (author tier, below).
- \`sentiment_mult\` is currently pinned to **1** (sentiment is measured + displayed but does NOT move the ranking).
- \`decay\` fades older posts (see the \`decay\` topic).
**Google News** has no engagement, so it scores by outlet tier × decay: \`post_weight = tier × decay\` (tier-1 2.5, tier-2 1.5, wire 0.5).
A post's contribution to the board is then \`platform_multiplier × post_weight\` (see \`platform_multipliers\` and \`sov_pooling\`).`,

  author_tiers: `**Author tiers (who is talking sets B and M).**
The most valuable mention is an outsider talking about you, not your own marketing:
- **Company's own account** — B = 1, M = 1 (counts least).
- **Confirmed employee** — B = 2, M = 1.2.
- **External / unaffiliated voice** — B = 5, M = 2 (an outsider is worth ~5× your own post at equal engagement).
Author tier is set by an LLM classifier (\`author_affiliation\`) that labels each author employee/external. On X the tier is derived from whether the tweet's author handle matches the company's own handle (own → B1/M1, else external → B5/M2).`,

  decay: `**Time decay (older posts fade).**
Decay is **flat (= 1.0) for the first 7 days**, then halves every half-life:
\`decay = 2^(-(age_days − 7) / half_life)\` once age > 7 days.
Half-lives per platform: **LinkedIn 14d · Google News 30d · Reddit 10d · X 7d.**
So a 2-week-old LinkedIn post is worth ~half a fresh one; a 2-week-old tweet is worth ~1/4. The "peak" impact shown in the all-time views is \`stored_weight ÷ decay\` — i.e. what the post scored at full freshness, before decay.`,

  platform_multipliers: `**Platform trust multipliers (the "exchange rate").**
Every post's weight is multiplied by a per-platform multiplier so all channels sit on one "mindshare" scale before pooling:
**LinkedIn 1 · X 1 · Reddit 1.5 · Google News 15.**
These are trust exchange rates, not volume: editorial security press is weighted far above social because buyers trust it more. LinkedIn/X are the ×1 baseline; Reddit (peer/practitioner talk) ×1.5; News is the team's dial. A single fresh tier-1 article can be worth ~37.5 units (2.5 × 15). Live values always come from \`sov_config\` — check \`system_status\` if unsure.`,

  sov_pooling: `**How SOV% is computed (the pool + the denominator).**
Everything pools into ONE cross-platform total:
\`SOV(company) = Σ (multiplier × post_weight) for that company / Σ (multiplier × post_weight) across all DIRECT competitors × 100\`
- Only **direct** competitors are in the denominator, so their SOV%s **sum to 100**.
- **Indirect** competitors are tracked and shown but are OUT of the denominator (they don't dilute the 100%).
- It measures **share of considered attention**, not raw views. A "spike" traces to one or a few high-impact recent posts — usually an external mention, a viral post, or a tier-1 article.`,

  x_scoring: `**X (Twitter) specifics.**
X is scored on **engagement only** — \`engagement = 1×like + 2×reply + 10×repost + 4×quote\`. **viewCount is deliberately dropped** ("scrolled past" ≠ attention, and it's self-counted/non-unique). Author tier is own (B1/M1, when the tweet author handle = the company's handle) vs external (B5/M2). The follower-based author weighting was retired — \`tweets.authorWeight\` is now just a tier marker (1 = own, 5 = external).`,

  sentiment: `**Sentiment.**
Sentiment is measured per post (an LLM score, roughly −3…+3) and **displayed** (the sentiment chart + card, per-company average of external mentions), but it currently does **NOT** move the SOV ranking — the sentiment multiplier in the score is pinned to 1. So a company can lead on SOV while running negative sentiment; they're separate lenses.`,

  ai_visibility_geo: `**AI Visibility (GEO / AEO).**
Separate from SOV. It measures how often each company is **named when AI engines answer real buyer questions**. A catalog of ~48 IAM buyer prompts is run weekly through **OpenAI** (\`gpt-4o-search-preview\`) and **Anthropic** (\`claude-sonnet-4-5\`) with **web search on**; for each answer we record which companies were mentioned and their position (earlier = more prominent). The AI Visibility tab shows each company's visibility % + per-prompt win/miss, with a focus-company selector (default Twine). It answers "how often does ChatGPT/Claude name us for these questions", which is about AI-answer surfaces, not social/news share.`,

  data_flow: `**How data flows (freshness & what's "in" the numbers).**
Posts are scraped **daily** per platform. LinkedIn posts land in a raw staging queue and are then LLM-**attributed** to a competitor (or NONE) and scored; X/Reddit/News are attributed inline as they're scraped. Attributed posts feed the SOV board, which is **recomputed daily**. So a very recent post can be scraped but not yet processed/attributed — that's a queue question (use \`system_status\`), not "missing data". Engagement on posts under ~7 days old is refreshed before it's locked in, so day-0 numbers can still rise.`,

  app_map: `**Where things are in the app.**
Top nav: **SOV Dashboard**, **Social Briefs** (weekly review of competitors' own LinkedIn posts with 👍/👎), **Comp Briefs** (AI-written per-competitor briefing docs).
Inside SOV Dashboard (all share the Platform filter + 7d/30d/YTD window at top):
- **Overview** — ranking table + Share-of-Voice trend chart. Click a company row to drill in ("why is X at Y%", week-by-week, platform-by-platform, down to posts).
- **Posts of Interest** — curated weekly digest of each competitor's most notable posts.
- **AI Visibility** — GEO/AEO (see \`ai_visibility_geo\`).
- **Compare** — two companies side by side.
Header: **About** (what the score measures), **Methodology** (full math + the interactive platform-weights explainer), **Manage competitors**, light/dark toggle, log out. Every post card has a flag/remove control that soft-excludes a wrong mention from all calculations without deleting it.`,
}
