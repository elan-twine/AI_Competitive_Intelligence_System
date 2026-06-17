-- Twine Comp-Intel — migration 0001
-- Source-of-truth competitor list + tunable SOV config.
-- Run in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT.

-- ---------------------------------------------------------------------------
-- 1. competitors: the single source of truth. Replaces hardcoded company lists
--    in the frontend (TRACKED_COMPANIES), the n8n attribution prompts, and the
--    one-Apify-task-per-company design.
-- ---------------------------------------------------------------------------
create table if not exists public.competitors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,         -- canonical display name, e.g. "Orchid Security"
  aliases       text[] not null default '{}', -- alternate names the LLM should attribute, e.g. {"Orchid"}
  linkedin_urn  text,                          -- numeric URN for the URN-based Apify actor (5QnEH5N71IK2mFLrP)
  linkedin_url  text,
  domain        text,                          -- e.g. orchid.security  (used for URL-based attribution)
  x_handle      text,                          -- without @
  subreddits    text[] not null default '{}', -- optional per-competitor subreddit hints
  is_self       boolean not null default false,-- true for Twine itself
  active        boolean not null default true, -- inactive = kept for history, not scraped/ranked
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists competitors_active_idx on public.competitors (active);

-- keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists competitors_set_updated_at on public.competitors;
create trigger competitors_set_updated_at
  before update on public.competitors
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. sov_config: one row of tunable knobs for the new SOV methodology, so the
--    weights can be changed without editing code (see SOV_METHODOLOGY.md).
-- ---------------------------------------------------------------------------
create table if not exists public.sov_config (
  id          int primary key default 1,
  config      jsonb not null,
  updated_at  timestamptz not null default now(),
  constraint sov_config_singleton check (id = 1)
);

insert into public.sov_config (id, config) values (1, '{
  "platformWeights":   { "LinkedIn": 0.35, "Google News": 0.30, "Reddit": 0.20, "X": 0.15 },
  "halfLifeDays":      { "LinkedIn": 14, "Google News": 30, "Reddit": 10, "X": 7 },
  "engagementWeights": {
    "LinkedIn": { "reaction": 1, "comment": 3, "reshare": 5, "image": 1.5 },
    "Reddit":   { "upvote": 1, "comment": 3 },
    "X":        { "like": 1, "reply": 2, "repost": 3, "quote": 4 }
  },
  "sentimentClamp":    { "min": 0.5, "max": 1.3 },
  "perPostCapPct":     0.10,
  "minPlatformVolume": 3
}'::jsonb)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Seed competitors (URNs/domains to be filled in — see note in chat).
--    Twine is flagged is_self. ON CONFLICT keeps existing rows untouched.
-- ---------------------------------------------------------------------------
insert into public.competitors (name, aliases, domain, is_self) values
  ('Twine Security',  '{"Twine"}',  'twinesecurity.com', true),
  ('Lumos',           '{}',         'lumos.com',         false),
  ('Orchid Security', '{"Orchid"}', 'orchid.security',   false),
  ('Cerby',           '{}',         'cerby.com',         false),
  ('Linx Security',   '{"Linx"}',   'linx.security',     false),
  ('BlinkOps',        '{"Blink Ops","Blink"}', 'blinkops.com', false),
  ('Opti',            '{}',         null,                false),
  ('Fabrix Security', '{"Fabrix"}', 'fabrixsecurity.com',false),
  ('Surf AI',         '{"Surf"}',   null,                false),
  ('Redblock',        '{}',         'redblock.ai',       false)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Row-Level Security. We are moving to full Supabase Auth, so only
--    authenticated users (logged-in team members) can read/write these tables.
--    n8n uses the service_role key, which bypasses RLS automatically.
-- ---------------------------------------------------------------------------
alter table public.competitors enable row level security;
alter table public.sov_config  enable row level security;

drop policy if exists competitors_auth_all on public.competitors;
create policy competitors_auth_all on public.competitors
  for all to authenticated using (true) with check (true);

drop policy if exists sov_config_auth_read on public.sov_config;
create policy sov_config_auth_read on public.sov_config
  for select to authenticated using (true);

drop policy if exists sov_config_auth_write on public.sov_config;
create policy sov_config_auth_write on public.sov_config
  for update to authenticated using (true) with check (true);
