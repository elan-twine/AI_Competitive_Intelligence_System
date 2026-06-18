-- 0010_view_reach.sql
-- Capture reach signals that the scrapers already return but the pipeline was dropping.
-- The X (tweet-scraper-v2) actor returns viewCount + author.followers on every tweet;
-- Reddit (reddit-posts-scraper) already returns estimatedViews (column exists).
-- These feed the new reach-based per-post weight:
--   reach = 1 + ln(1 + views + weightedEngagement)
-- and the non-decayed "Recent Mentions" feed impact score.
-- Idempotent; safe to re-run.

alter table public.tweets add column if not exists "viewCount" bigint;   -- tweet impressions
alter table public.tweets add column if not exists followers  bigint;    -- author follower count (reach)

-- reddit_posts.estimatedViews already exists (per live schema) — no change needed there.

comment on column public.tweets."viewCount" is 'Tweet impressions from the X scraper (author + amplified reach); used as the reach base in post_weight.';
comment on column public.tweets.followers  is 'Tweet author follower count from the X scraper; used for authorWeight/reachMult.';
