-- Twine Comp-Intel — migration 0002
-- Adds the per-post `post_weight` column produced by the new SOV math in n8n
-- (see SOV_METHODOLOGY.md). The frontend prefers post_weight and falls back to
-- the legacy weightedSOV, so this is safe to run before n8n is updated.
-- Run after 0001. Safe to re-run.

alter table public.linkedin_posts add column if not exists post_weight double precision;
alter table public.googlenews     add column if not exists post_weight double precision;
alter table public.reddit_posts   add column if not exists post_weight double precision;
alter table public.tweets         add column if not exists post_weight double precision;
