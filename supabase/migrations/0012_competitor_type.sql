-- Twine Comp-Intel — migration 0012
-- Competitor classification: direct vs indirect.
--
-- Direct competitors are the ones we actually compete against — they alone
-- count toward the SOV % share and the competitive ranking. Indirect
-- competitors are still fully tracked, scraped, scored, and analyzed (and they
-- appear on the trend graph + Competitive Review), but they never enter the
-- head-to-head comparison — they're there to learn from, not to rank against.
--
-- Default 'direct' so every existing row keeps its current behavior. Safe to re-run.

alter table public.competitors
  add column if not exists type text not null default 'direct'
  check (type in ('direct', 'indirect'));

-- (No backfill needed — the NOT NULL DEFAULT sets every existing competitor to
-- 'direct', which matches today's behavior. Reclassify any to 'indirect' from
-- the Competitors page or with:  update public.competitors set type='indirect' where name='…';)
