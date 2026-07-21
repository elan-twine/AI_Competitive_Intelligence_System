-- Chart annotations — team-authored event markers on the SOV trend chart
-- (campaign launches, funding news, product releases) so "did X move the
-- needle?" is answerable at a glance.
--
-- Shared team resource: any authenticated user reads all markers and adds new
-- ones; you can delete your own (created_by = auth.uid()). Anon has no access.

create table if not exists public.sov_annotations (
  id         bigint generated always as identity primary key,
  event_date date        not null,
  label      text        not null,
  note       text,
  created_by uuid        not null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists sov_annotations_event_date_idx on public.sov_annotations (event_date);

alter table public.sov_annotations enable row level security;

-- Any logged-in teammate can see every marker (they're shared context).
create policy sov_annotations_select on public.sov_annotations
  for select to authenticated using (true);

-- Insert only as yourself (created_by defaults to auth.uid(); enforce it).
create policy sov_annotations_insert on public.sov_annotations
  for insert to authenticated with check (created_by = auth.uid());

-- Delete only your own markers.
create policy sov_annotations_delete on public.sov_annotations
  for delete to authenticated using (created_by = auth.uid());
