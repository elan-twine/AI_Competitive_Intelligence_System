-- Twine Comp-Intel — migration 0009
-- Same RLS gap as 0007, for the tables the Briefings page reads. After real
-- Supabase Auth, the dashboard reads as `authenticated`; these tables had no
-- authenticated SELECT policy → empty Briefings page. Skips tables that don't
-- exist. n8n writes via service_role (bypasses RLS). Safe to re-run.

do $$
declare t text;
begin
  foreach t in array array['competitor_briefings','postsOfInterest','linkedin_URNs','linkedin_scrape'] loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table public.%I enable row level security;', t);
      execute format('drop policy if exists %I on public.%I;', t || '_auth_read', t);
      execute format('create policy %I on public.%I for select to authenticated using (true);', t || '_auth_read', t);
    end if;
  end loop;
end $$;
