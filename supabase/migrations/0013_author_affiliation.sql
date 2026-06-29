-- Twine Comp-Intel — migration 0013
-- Author-affiliation cache for the employee/external classifier.
--
-- Each LinkedIn post author is classified once (cheapest-first: headline
-- heuristic -> LLM on headline -> profile scrape only if still ambiguous) and
-- cached here by key (profile_id, or name when no id). The weekly run only
-- classifies authors NOT already in this table, so cost stays ~0 ongoing.
-- The verdict drives authorType in post-weight scoring: an author who is an
-- 'employee' of the competitor they posted about is treated as company-authored,
-- not external. Server-side only (service_role); RLS on, no public policies.

create table if not exists public.author_affiliation (
  key         text primary key,        -- author.profile_id, or author.name if no id
  name        text,
  profile_id  text,
  competitor  text,                     -- the tracked competitor this verdict is about
  verdict     text not null check (verdict in ('employee','external','ambiguous')),
  employer    text,                     -- resolved current employer (from scrape) when known
  method      text check (method in ('heuristic','llm','scrape')),
  checked_at  timestamptz not null default now()
);

create index if not exists author_affiliation_profile_idx on public.author_affiliation (profile_id);

alter table public.author_affiliation enable row level security;
-- Reads are public (LinkedIn affiliation verdicts are not sensitive) so the
-- frontend can label posts company vs external for the sentiment metric and the
-- external-vs-company breakdown. Writes stay service_role-only: there is no
-- insert/update/delete policy, so only the pipeline (which bypasses RLS via the
-- service_role key) can populate the cache.
create policy "author_affiliation public read"
  on public.author_affiliation for select using (true);
