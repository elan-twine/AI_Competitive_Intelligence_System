-- ============================================================================
-- Decoupled scrape→process pipeline — staging queue for LinkedIn
-- Run in the Supabase SQL editor (DDL is not available over PostgREST/REST).
-- Additive: creates ONE new table. Touches nothing existing.
-- Plan: sov-tooling/DAILY_MIGRATION_PLAN.md (decoupled-pipeline section)
--
-- WHY: the per-company Execute-Workflow fan-out (scrape+attribution+write in one
-- execution, 14x) OOMs the n8n worker. Split it: a Scraper dumps raw posts here
-- (memory-light, no LLM), and a Processor drains this queue in 50-row batches
-- (LLM attribution + ternary post_weight), so neither ever holds a whole week.
-- ============================================================================

create table if not exists public.linkedin_raw (
  activity_id    text primary key,          -- LinkedIn post id (same key as linkedin_posts)
  raw            jsonb not null,            -- full flattened post: author{name,headline,profile_id},
                                            --   text, title, totalReactions, comments, reshares,
                                            --   imageURL, posted_at, post_url, ...
  source         text,                      -- 'keyword' | 'company_page'
  search_input   text,                      -- the keyword the post was found under
  owner_company  text,                      -- for company_page rows: the competitor that owns the
                                            --   page (Processor force-attributes these, bypassing the LLM)
  scraped_at     timestamptz not null default now(),
  status         text not null default 'pending'  -- 'pending' | 'done' | 'error'
);

-- Processor pulls the oldest pending rows first.
create index if not exists linkedin_raw_status_idx
  on public.linkedin_raw (status, scraped_at);

-- service_role-only (like author_profiles / scrape_runs): RLS on, zero policies.
-- The queue is internal plumbing; the dashboard never reads it.
alter table public.linkedin_raw enable row level security;

-- rollback: drop table if exists public.linkedin_raw;
