-- Twine Comp-Intel — migration 0007
-- The dashboard now uses real Supabase Auth, so it reads the SOV source tables
-- as the `authenticated` role (it used to read as `anon` via the old fake gate).
-- 0001 only added RLS policies to competitors/sov_config — not these data tables.
-- This grants logged-in users SELECT on them so the dashboard shows data again.
-- n8n keeps using the service_role key, which bypasses RLS. Safe to re-run.

do $$
declare t text;
begin
  foreach t in array array['linkedin_posts','googlenews','tweets','reddit_posts'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_auth_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true);', t || '_auth_read', t);
  end loop;
end $$;
