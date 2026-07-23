-- Chart annotations: support a DATE RANGE, not just a single date.
--
-- Adds a nullable `end_date`. NULL = a single-date event (a vertical marker on
-- the trend chart, as before). When set, the event spans event_date..end_date
-- and renders as a shaded band. Guard: end_date, when present, must be on/after
-- event_date. Existing rows (end_date NULL) are unaffected — still single-date.

alter table public.sov_annotations add column if not exists end_date date;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sov_annotations_range_chk'
  ) then
    alter table public.sov_annotations
      add constraint sov_annotations_range_chk
      check (end_date is null or end_date >= event_date);
  end if;
end $$;
