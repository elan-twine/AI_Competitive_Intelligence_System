-- Editable config for the weekly LinkedIn employee-engagement metric (OKR KR-21).
--
-- Two jobs, both previously hardcoded in the n8n "Compute metrics" node:
--   * headcount -> the denominator of the engagement rate (members who reacted / headcount)
--   * roster    -> the list of employee names used to DETECT which reactors are staff
-- Moving them here lets a logged-in user edit them from the SOV dashboard as the
-- company grows, with no workflow/code change. The n8n workflow reads row id=1
-- before computing; the dashboard shows + edits the same row.
--
-- Single-row (id=1) config table.
create table if not exists public.linkedin_roster_config (
  id         int primary key default 1,
  headcount  int  not null default 40,      -- total staff -> denominator
  roster     text[] not null default '{}',  -- employee display names -> reaction matcher
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint linkedin_roster_config_singleton check (id = 1)
);

-- Seed the current headcount (40) and the existing 38-name roster (from the
-- n8n node). Runs once; a re-run leaves an existing row untouched.
insert into public.linkedin_roster_config (id, headcount, roster)
values (
  1,
  40,
  array[
    'Omri Green','Nadav Erez','Yiftach Keshet','Yuval Carmel','Benny Porat',
    'Guilad Regev','Ron Kormanek','Alona Liechtenstein','Justin Woody','Ben Ofer',
    'Charly Setbon','Ofir Tal-Friedman','Yasmin Hefer','Liad Shachoach','Chen Fradkin',
    'Alon Danoch','Matan Coriat','Daniel Shalev','Dustin Rabin','Nadav Misgav',
    'Ariel Zinman','Noa Milshtein','Omer Movshovits','Danielle Hersonsky Sarid','Miki Chernyak',
    'Dotan Reis','Yaniv Wolfus','Elan Smyla','Maayan Arbely','Tanya Gershnov',
    'Danny Nia','Lior Krupnik','Omer Kaplan','Akiva Adler','Noam Bar Uryan',
    'Nadav Barak','Peleg Dvir','Ittay Toledo'
  ]
)
on conflict (id) do nothing;

alter table public.linkedin_roster_config enable row level security;

-- Anyone may READ (the dashboard shows the current headcount/roster).
drop policy if exists linkedin_roster_config_read on public.linkedin_roster_config;
create policy linkedin_roster_config_read on public.linkedin_roster_config
  for select using (true);

-- Only a logged-in (authenticated) user may EDIT it — the app is auth-gated, so
-- this is "any signed-in Twine user can update the headcount/roster", and the
-- public anon key alone cannot write.
drop policy if exists linkedin_roster_config_update on public.linkedin_roster_config;
create policy linkedin_roster_config_update on public.linkedin_roster_config
  for update to authenticated using (true) with check (true);
