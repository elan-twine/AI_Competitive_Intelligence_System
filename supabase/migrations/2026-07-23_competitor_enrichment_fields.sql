-- Make competitor tracking 100% app-driven: move the per-competitor content that
-- currently lives HARDCODED in the n8n workflows (search keyword maps + the
-- attribution "COMPANY DEFINITIONS" / namesake-collision prose) onto the
-- competitors table, so adding/removing/retyping a competitor in the app is
-- reflected live across every scraper + gate with no workflow edits.
--
-- Fields (all nullable; the app's simple add form leaves them blank and an LLM
-- fills them, but a human can review/edit via an expandable widget):
--   keywords        search terms beyond name+aliases (e.g. ['Opti IAM','Opti Identity'])
--   definition      one-paragraph "what this company is" (category + specifics)
--                   the attribution gates use to decide a post is really about it
--   collision_terms namesakes / wrong senses to REJECT (e.g. ['Proton Lumo','Optiv'])
--
-- Backfilled from the existing hardcoded workflow content so current tuning is
-- preserved when the workflows switch to reading these columns (Stage 2).

alter table public.competitors add column if not exists keywords        text[];
alter table public.competitors add column if not exists definition      text;
alter table public.competitors add column if not exists collision_terms text[];
