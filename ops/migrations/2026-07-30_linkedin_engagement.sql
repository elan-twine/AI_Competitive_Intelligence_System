-- LinkedIn company-engagement weekly metric (OKR KR-21).
-- Written weekly by the n8n "LinkedIn Employee Engagement" workflow (service_role);
-- read by the SOV dashboard (anon) for the "LinkedIn Engagement" KPI card.
create table if not exists public.linkedin_engagement (
  id          bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  week_start  date,
  pct         numeric,   -- weekly avg engagement %, e.g. 28  (staff who engaged / roster)
  members     integer,   -- distinct staff who engaged
  headcount   integer,   -- roster size (~38)
  post_count  integer    -- company posts in the window
);

-- App reads with the anon key → needs public SELECT (writes stay service-role only).
alter table public.linkedin_engagement enable row level security;
drop policy if exists linkedin_engagement_read on public.linkedin_engagement;
create policy linkedin_engagement_read on public.linkedin_engagement
  for select using (true);
