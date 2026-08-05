# Twine Comp-Intel — Workflow Prompt & Logic Diagnostic

_Generated 2026-06-17. Covers all 4 Comp-Intel n8n workflows: SOV_Workflow, Competitor Brief Generator, Posts_Of_Interest, Error Handling. Reflects live workflow state at time of writing._

---

## A. Cross-cutting findings (affect multiple workflows)

1. **Competitor list is hardcoded in 3+ places** and they have drifted apart:
   - Frontend `TRACKED_COMPANIES` (useSOVData.js): 10 companies.
   - n8n attribution prompts: list varies node-to-node — some say "...Surf AI, or Redblock", some add **"Nagomi"**, some say "EXCLUSIVELY among", some omit Surf AI. No single source of truth.
   - Apify: 11 separate saved tasks (one per company) for LinkedIn; company list also baked into Google News task config.
   - **Impact:** adding/removing a competitor requires editing code, prompts, and Apify by hand; attribution is inconsistent across platforms.

2. **Stale "Groq" references.** Parser nodes in Competitor Brief Generator throw `"Groq returned empty content"` though all calls are now OpenAI. Leftover from a previous implementation; misleading during debugging.

3. **Secrets in plaintext** (see separate security note): OpenAI keys in SOV_Workflow HTTP headers; Apify token + Supabase **service_role JWT** in Competitor Brief Generator; team password in frontend bundle.

4. **"Fill gaps from your training knowledge" prompting** (Competitor Brief Generator LLM1 & LLM2) instructs the model to invent fields when scraped data is missing. This produces confident-but-unverifiable competitive intel — dangerous for decisions. Should be constrained or clearly labeled as model-inferred.

---

## B. SOV_Workflow (cWJoWUW0ST3o8CiT) — INACTIVE

**Trigger:** weekly Schedule (Mon 5am) → fans out to LinkedIn (11 actors), Google News, X, Reddit. A manual trigger exists but is disconnected (dead).

### LLM "thinking" nodes (all gpt-4o-mini, OpenAI chat completions)

There are **6 LLM nodes**, not 2:

1. **Per-item sentiment + company attribution** — 4 near-duplicate variants (LinkedIn / Google News / X / Reddit). Core system prompt (LinkedIn variant):
   > "You are an expert linguistic analyst specializing in granular sentiment detection. Analyze the sentiment of the provided text sources using a specific integer scale from -3 to 3. Additionally, identify the main company discussed or the authoring company among Twine Security, Lumos, Orchid Security, Cerby, Linx Security, BlinkOps, Opti, Fabrix Security, Surf AI, or Redblock. CRITICAL RULE: Companies frequently post about their own updates using first-person pronouns ('we', 'our') without naming themselves... inspect the 'post_url' field for domain names... Rating Scale: 3 (Very Positive)... -3 (Very Negative)... Output: Return ONLY a valid JSON array ... fields: activity_id, companyName, sentiment, reasoning."
   - **Issues:** company enum drift across variants (Nagomi appears in some); "EXCLUSIVELY among" vs "among" inconsistency; single-pass sentiment with no few-shot calibration; the −3..3 scale is collapsed to pos/neg/neutral in the frontend anyway.

2. **Source-credibility scorer** (`HTTP OpenAI analysis - X2`, used in Google News weighted path):
   > "You are an expert analyst evaluating the credibility of news sources... Scoring Guide: 80–100 Highly credible... 0–49 Low credibility... Output ONLY a valid JSON array... credibility_score (0-100), credibility_label, reasoning."
   - **Issue:** credibility_score is computed but the WeightedSOV code node comments that it's **not actually used** — falls back to sentiment. Wasted LLM call + the credibility weighting the deck advertises isn't wired in.

3. **Relevance filter** (`HTTP OpenAI analysis - X1`, X branch):
   > "You are a strict data filtering system... REMOVE IF... 'Lumos' refers to a crypto token, Harry Potter spell, medical device... FIELD INTEGRITY — CRITICAL: Copy ALL fields from the input object exactly as received... if not relevant: return []."
   - This is actually a **good** pattern (addresses the Lumos false-match problem from the deck) but only exists on X — LinkedIn/News/Reddit lack an equivalent disambiguation gate.

### Code "thinking" nodes — SOV math

- **LinkedIn UnweightedSOV:** `engagement = reactions + 3·comments + 5·reshares + 1.5·hasImage`, `× e^(-LN2/336 · hours)` (14-day half-life). **BUG:** reads `row.image_url` but the upsert stores `imageURL` → hasImage always 0.
- **X UnweightedSOV:** `(like·1 + retweet·3 + reply·2 + quote·2.5) × authorWeight × e^(-LN2/336·hours)`.
- **Reddit UnweightedSOV:** `log1p(max(0,score)) × (1 + log1p(numComments))`.
- **Google News UnweightedSOV:** article count / total (per company). **WeightedSOV:** sentiment-tier weight (≥2→1.0, ≥0→0.5, else 0.1) / total — credibility ignored.
- **Naming bug:** the "Unweighted" nodes output a key named `weightedSOV`; `unweightedSOV` columns are separately hardcoded to `1`. Column names don't match what's computed.
- **Methodology weakness (see SOV_METHODOLOGY.md):** raw cross-platform values are summed downstream; no log-damping on LinkedIn/X engagement; one global 14-day half-life; no per-post cap; no min-volume guard; credibility/authority dimension unused.

### Dead/parked
- Manual trigger disconnected; one Apify node has empty actorId; If2 true-branch dead-ends; X & Reddit branches parked (sticky notes: "low activity").

---

## C. Competitor Brief Generator (CLz0IumaOJpg4XaG) — ACTIVE

**Trigger:** Form (Competitor Name + URL) + a webhook; both feed one pipeline. On-demand only.

### LLM nodes (both gpt-4o-mini)

- **LLM 1 — competitor profile:**
  > "You are a competitive intelligence analyst with deep knowledge of the cybersecurity industry. You have two sources of information: scraped website content and search results... IMPORTANT: If any field would be empty based on the provided content, use your own training knowledge about ${competitorClean} to fill it in. Never leave an array empty if you know the answer... Respond with valid JSON only."
  - Produces 14-field JSON (positioning, customers, industries, pricing, funding, flagship models, etc.).
- **LLM 2 — comparative analysis vs Twine:**
  > "You are a senior competitive intelligence strategist at Twine Security... If any field in the competitor profile is empty or missing, use your own training knowledge about ${competitorClean} to fill the gaps before doing your analysis. Never leave an array empty... Output ONLY a valid JSON object."
  - Embeds a hardcoded Twine positioning blurb; outputs strengths/weaknesses/differentiation/overlap/threat_level/battle_card.

**Prompt issues:**
- Both explicitly instruct the model to **fabricate from training data** when scraping fails → unverifiable intel presented as fact. Recommend: (a) constrain to scraped+search evidence, or (b) tag each field with `source: scraped | inferred`.
- `competitor_name` is set to the **URL** in Firecrawl-Extract, then cleaned to a domain — the LLM keys off the domain, not the typed name.
- Twine positioning is hardcoded in the prompt; should be a config field so it's editable without touching node code.

### Dead weight
- A fully-duplicated, **unreachable** `…1`-suffixed branch (~26 nodes) — copy-paste clone with no trigger. Should be deleted.
- Disconnected Apify LinkedIn node + orphan "Webhook - Loop".
- Parser nodes throw stale "Groq returned empty content".

---

## D. Posts_Of_Interest (UPmrzKtBdpTotsxX) — INACTIVE

**Trigger:** Manual → Apify LinkedIn-by-URN (actor `5QnEH5N71IK2mFLrP`, **accepts comma-separated company_urns in ONE call** — the model for dynamic LinkedIn scraping) → relevance LLM → format → Supabase `linkedin_scrape` + Google Doc.

- **LLM (Build OpenAI Payload, gpt-4o):**
  > "You are a competitive intelligence analyst for Twine Security, a cybersecurity company focused on non-human identity (NHI) security and secrets management... A post is relevant if it touches on: NHI security, secrets management, machine identity, service accounts, API key management, credential security, IAM, cloud security posture... Ignore posts about hiring, culture, awards... Return ONLY a valid JSON array... keys: url, author, date, relevance_reason, summary."
  - **Inconsistency:** there are TWO model configs in this workflow — the active HTTP path uses **gpt-4o**, while an unused langchain "AI Agent" subgraph references **gpt-5-mini** with a Simple Memory node. The agent subgraph appears to be an abandoned experiment (disconnected from the main path).
  - The hardcoded `company_urns` (7 URNs) are unlabeled and unmapped to names.

---

## E. Error Handling (E6P5SOCGjq6yrOSO) — ACTIVE

Error Trigger → Gmail to `elansmyla@gmail.com`, fixed subject/body. No detail on which workflow/node failed.
- **Improvement:** include `{{$json.workflow.name}}`, node name, and error message in the body; consider routing to Slack per the deck's "Next Steps".

---

## F. Prioritized fix list (from this diagnostic)

| # | Fix | Workflow | Effort |
|---|-----|----------|--------|
| 1 | Single source-of-truth competitor list (DB-driven) injected into all prompts/Apify | all | high |
| 2 | Rewrite SOV math per SOV_METHODOLOGY.md | SOV_Workflow + frontend | high |
| 3 | Fix imageURL bug | SOV_Workflow | trivial |
| 4 | Wire credibility into News WeightedSOV (or drop the wasted LLM call) | SOV_Workflow | low |
| 5 | Add Lumos-style relevance/disambiguation gate to LinkedIn/News/Reddit | SOV_Workflow | med |
| 6 | Delete duplicate `…1` branch + dead nodes; remove stale Groq strings | Competitor Brief Gen | low |
| 7 | Constrain or label "fill from training knowledge" prompting | Competitor Brief Gen | low |
| 8 | Move secrets to credentials | all | med |
| 9 | Enrich error notifications | Error Handling | trivial |
