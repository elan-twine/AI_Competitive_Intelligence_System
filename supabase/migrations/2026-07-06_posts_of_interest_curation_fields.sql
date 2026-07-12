-- Posts of Interest — curation fields for the weekly POI Generator.
--
-- Clones the manual bi-weekly "Competitor Social Analysis" review. The manual
-- doc is a curated list (one line per notable post + link, clustered by
-- competitor); the review MEETING adds the strategic discussion ("why this
-- matters to us / what we'd do"). The existing table only stored the list half
-- (summary + relevance_reason + url). These columns add the missing pieces so
-- the generator can reproduce BOTH halves and the frontend can render them.
--
-- All columns are nullable / defaulted so the 24 legacy April rows keep reading.
-- anon already has SELECT (the dashboard reads posts_of_interest); writes remain
-- service-role (the n8n generator). Run BEFORE publishing the POI Generator
-- workflow — PostgREST 400s on an unknown column, which would break every write.

alter table posts_of_interest
  -- The strategic angle the review meeting produces: "what this means for Twine
  -- / how we might respond". This is the highest-value half of the manual
  -- process and was entirely absent before. AI-suggested, shown labeled as such.
  add column if not exists strategic_angle text,

  -- The post's editorial category, chosen by the curator from the fixed
  -- taxonomy (Thought Leadership / Event / Webinar / Product / Funding /
  -- Partnership / Earned Media / Award / Campaign / Video / Positioning Shift /
  -- Research / Hiring / Milestone / Community / Culture / Customer Story / …).
  -- The frontend prefers this over its client-side regex fallback.
  add column if not exists post_type text,

  -- Weekly window this line belongs to (the Monday-anchored 7-day bucket start,
  -- e.g. '2026-06-29'). Lets the generator upsert/replace a week idempotently
  -- and the UI group by period without re-deriving from post dates.
  add column if not exists period_start date,

  -- Which platform the post came from (LinkedIn today; X/Reddit/News later).
  add column if not exists platform text default 'LinkedIn',

  -- The source activity/post id — stable dedup key + engagement join without
  -- fragile URL parsing (LinkedIn activity_id, tweet id, etc.).
  add column if not exists source_id text,

  -- Engagement snapshot AT CURATION TIME, so the digest is stable even after the
  -- raw post ages out or the live join misses. Frontend falls back to these when
  -- the post isn't found in the loaded linkedin_posts.
  add column if not exists reactions integer,
  add column if not exists comments integer,
  add column if not exists reshares integer,

  -- How many raw posts this ONE line represents. The manual reviewer collapses
  -- repetitive posting ("Opti posts 7 times about Identiverse" = one entry);
  -- collapsed_count = 7 lets the UI show "×7" instead of listing seven rows.
  add column if not exists collapsed_count integer default 1;

-- De-dup guard + upsert target: one curated line per (platform, source_id) so
-- re-running a week updates in place instead of piling up duplicates. The
-- generator upserts with `on_conflict=platform,source_id`. A standard (non-
-- partial) unique index treats NULLs as DISTINCT, so the legacy rows (and any
-- future null-source_id line) never collide with each other — while real posts,
-- which always carry an activity id, dedupe correctly.
create unique index if not exists posts_of_interest_platform_source_uidx
  on posts_of_interest (platform, source_id);
