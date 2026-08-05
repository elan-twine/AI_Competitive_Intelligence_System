-- Social Briefs post-level feedback: Elan thumbs 👍/👎 each competitor-authored
-- post in the weekly meeting ("interesting?"). Ground truth for training the POI
-- generator (compare its auto-picks vs these human choices over time).
--
-- One row per post (keyed by the LinkedIn activity_id, which is also the POI
-- source_id). `verdict` NULL = rated-then-cleared. `generator_picked` snapshots
-- whether the POI generator had flagged this post at rating time, so agreement
-- can be measured even as the generator's picks change later.
--
-- The dashboard is behind a Google-OAuth login gate but reads via the anon key;
-- feedback is low-risk internal data, so allow anon+authenticated read/write.

create table if not exists post_feedback (
  activity_id      text primary key,
  platform         text not null default 'LinkedIn',
  company          text,
  week_start       date,
  verdict          text check (verdict in ('up','down')),
  generator_picked boolean not null default false,
  post_url         text,
  updated_at       timestamptz not null default now()
);

create index if not exists post_feedback_week_idx on post_feedback (week_start);
create index if not exists post_feedback_company_idx on post_feedback (company);

alter table post_feedback enable row level security;

drop policy if exists post_feedback_rw on post_feedback;
create policy post_feedback_rw on post_feedback
  for all to anon, authenticated
  using (true) with check (true);

grant select, insert, update on post_feedback to anon, authenticated;
