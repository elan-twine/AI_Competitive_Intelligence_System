-- ============================================================================
-- Daily-model migration — Phase 0 (schema only, additive, reversible)
-- Run in the Supabase SQL editor (DDL is not available over PostgREST/REST).
-- Safe: creates two NEW tables, touches nothing existing. sov_weekly stays.
-- Plan: sov-tooling/DAILY_MIGRATION_PLAN.md
-- ============================================================================

-- ── scrape_runs ────────────────────────────────────────────────────────────
-- One row per scrape execution. Fixes the "no reliable last-scraped time" gap
-- (runDate is a dead legacy field). Each scrape workflow inserts a row at start
-- and PATCHes it at finish; the snapshot Freshness Guard reads this instead of
-- guessing from newest posted_at; the frontend shows a real "last updated".
create table if not exists public.scrape_runs (
  id           bigint generated always as identity primary key,
  platform     text not null,            -- 'LinkedIn' | 'Google News' | 'Reddit' | 'X'
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  window_from  timestamptz,              -- scrape window covered (informational)
  window_to    timestamptz,
  rows_found   integer,                  -- raw rows the actor returned
  rows_written integer,                  -- rows upserted to the platform table
  status       text not null default 'running',  -- 'running' | 'success' | 'error'
  note         text
);
create index if not exists scrape_runs_platform_started_idx
  on public.scrape_runs (platform, started_at desc);

-- service_role-only (like author_profiles): RLS on, ZERO policies => anon/authenticated denied.
alter table public.scrape_runs enable row level security;

-- ── sov_daily ────────────────────────────────────────────────────────────────
-- Daily board, computed over ROLLING trailing windows (window_days = 7 or 30).
-- One row per (snapshot_date, company, window_days). sov_weekly is kept as-is for
-- historical continuity; sov_daily is the new daily/weekly/monthly source.
create table if not exists public.sov_daily (
  snapshot_date date    not null,
  company       text    not null,
  window_days   integer not null,        -- 7 or 30 (which rolling window this row is)
  overall       numeric,
  weighted_pct  numeric,
  sentiment_pct numeric,
  posts_count   integer,
  primary key (snapshot_date, company, window_days)
);
create index if not exists sov_daily_window_date_idx
  on public.sov_daily (window_days, snapshot_date);

-- Public READ (mirrors sov_weekly: the dashboard reads it with the anon key).
-- Writes are service_role only (no write policy => only the service key can insert/upsert).
alter table public.sov_daily enable row level security;
create policy sov_daily_public_read on public.sov_daily
  for select using (true);

-- ── rollback (if ever needed) ────────────────────────────────────────────────
-- drop table if exists public.sov_daily;
-- drop table if exists public.scrape_runs;
