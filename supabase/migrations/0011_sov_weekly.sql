-- 0011_sov_weekly.sql
-- Weekly SOV snapshots. Each weekly run appends one row per company = that company's
-- CURRENT board SOV (cumulative, time-decay baked in) at that run, frozen forever.
-- The dashboard graph reads these immutable snapshots (so old points never re-decay),
-- forward-filling any company absent in a given week. The live board stays a separate,
-- always-recomputed view. Idempotent on (week_start, company).

create table if not exists public.sov_weekly (
  week_start      date not null,             -- ISO week (Monday) the snapshot is for
  company         text not null,             -- competitor canonical name
  overall         double precision,          -- composite 0.30 unweighted / 0.40 weighted / 0.30 sentiment
  weighted_pct    double precision,          -- cross-platform weighted SOV %
  unweighted_pct  double precision,          -- post-count share %
  sentiment_pct   double precision,          -- avg sentiment rescaled 0..100
  posts_count     integer,                   -- mentions counted as of that week
  computed_at     timestamptz not null default now(),
  primary key (week_start, company)
);

-- RLS: dashboard reads as role `authenticated` (matches migration 0007 pattern);
-- the n8n workflow writes with service_role, which bypasses RLS.
alter table public.sov_weekly enable row level security;

drop policy if exists "sov_weekly_select_authenticated" on public.sov_weekly;
create policy "sov_weekly_select_authenticated"
  on public.sov_weekly for select to authenticated using (true);

create index if not exists sov_weekly_week_idx on public.sov_weekly (week_start);
