-- LinkedIn video engagement bonus (2026-07-13).
-- Mirrors the existing image bonus: a post carrying a native video gets a small
-- flat boost to its engagement score. The video signal (content.type === 'video')
-- is present in the raw Apify scrape and reaches linkedin_raw, but is currently
-- dropped before linkedin_posts — so we persist a boolean here for the Processor
-- to populate and the Engagement Refresh (day-7 rescore) to read.
--
-- MUST be applied BEFORE the matching n8n edits go live, or the Processor upsert
-- and the Engagement Refresh SELECT will error on a missing column.
alter table linkedin_posts add column if not exists has_video boolean;
