-- Chart annotations: allow editing your own event markers.
--
-- The original table (2026-07-21_sov_annotations.sql) had select/insert/delete
-- policies but NO update policy, so an UPDATE was silently blocked by RLS. Add
-- an update-own policy so a teammate can edit a marker they created (date/range,
-- label, note). Same ownership rule as delete: created_by = auth.uid().

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'sov_annotations'
       and policyname = 'sov_annotations_update'
  ) then
    create policy sov_annotations_update on public.sov_annotations
      for update to authenticated
      using (created_by = auth.uid())
      with check (created_by = auth.uid());
  end if;
end $$;
