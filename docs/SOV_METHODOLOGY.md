# New SOV Methodology (research-grounded)

_Replaces the current "sum engagement × exp-decay → share-of-total" approach. Based on 2024–2026 best practice (Brandwatch, Sprout, Britopian, YouScan, Binet/Field ESOV, Graffius post half-life study). Full sources in the research log._

## Core principle
**Within-platform share FIRST, weighted-average across platforms SECOND.** Never sum raw engagement across platforms — a LinkedIn reaction, a Reddit upvote, and a news article are incommensurable. Convert each to a 0–1 share inside its own platform, then combine.

## (a) Per-post weight
```
post_weight = log1p(engagement_score)      # dampen viral tail
            × authority_multiplier         # source/author credibility
            × sentiment_multiplier         # CLAMPED to [0.5, 1.3] — never zero a mention
            × reach_multiplier             # mild: 1 + log1p(followers)/K
            × time_decay                   # 2^(-age_days / platform_half_life)
post_weight = min(post_weight, platform_cap)   # no single post dominates
```

Per-platform `engagement_score`:
- **LinkedIn:** `reactions + 3·comments + 5·reshares` (+ image bonus, once the imageURL bug is fixed)
- **Reddit:** `max(upvotes,0) + 3·comments`
- **X:** `likes + 2·replies + 3·reposts + 4·quotes`
- **News:** no engagement → `engagement_score = 1`; let **authority_multiplier** (outlet tier) carry it + headline bonus if brand in headline

Per-platform **half-life** (relevance, not raw engagement decay):
- LinkedIn / Reddit / X social: **7–14 days** (default 14 for long B2B cycle)
- News: **30–45 days**

## (b) Per-competitor, per-platform SOV
```
brand_platform_score = Σ post_weight (brand's posts on that platform)
SOV_platform(brand)  = brand_platform_score / Σ_all_brands brand_platform_score   # already 0–1, scale-free
```

## (c) Combined cross-platform SOV
```
SOV_total(brand) = Σ_platform [ platform_weight × SOV_platform(brand) ]   # platform_weights sum to 1
```
Default platform weights for B2B cybersecurity (config, not hardcoded):
**LinkedIn 0.35, News 0.30, Reddit 0.20, X 0.15.**
Min-volume guard: if a platform's total weighted score < threshold for the period, drop it and renormalize weights.

## Sentiment
Report **both**: (1) a bounded modifier [0.5,1.3] inside post_weight, and (2) net-sentiment % + positive-SOV vs negative-SOV split as their own dashboard dimension. Prevents a negative-mention spike from reading as a "win."

## Everything config-driven
Per-platform engagement weights, half-lives, platform weights, authority tiers, sentiment clamp, per-post cap, min-volume threshold → all in one config (DB or n8n) so tuning needs no code edits.

## Adjacent scoreboards (separate pipelines, not blended in)
- **Share of Search** (Binet/Field: ~83% correlation with future market share) — leading indicator.
- **AI / "Share of Model" SOV** — how often Twine vs competitors appear in ChatGPT/Perplexity/Gemini/Claude answers for a fixed prompt set. Increasingly important (73% of B2B buyers use AI in research). Future build.

## Where this gets implemented
- **n8n** computes per-post `post_weight` (the new formula above) and stores it per row.
- **Frontend** (metrics.js / useSOVData.js) does (b) within-platform share + (c) weighted-average + sentiment split. Removes the current ad-hoc re-normalization.
