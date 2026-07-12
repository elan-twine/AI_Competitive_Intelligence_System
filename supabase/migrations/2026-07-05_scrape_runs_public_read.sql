-- Allow the anon frontend to read scrape_runs so the dashboard can show a real
-- per-platform "last updated" stamp. scrape_runs holds only run metadata
-- (platform, timestamps, row counts, note) — no secrets — so public SELECT is
-- safe, matching sov_weekly / sov_daily. Writes stay service-role only (no
-- INSERT/UPDATE/DELETE policy = denied for anon/authenticated).
--
-- Until this is applied, useLastUpdated() falls back to the latest sov_daily
-- snapshot_date (already public), so the frontend degrades gracefully.

alter table scrape_runs enable row level security;  -- no-op if already enabled

drop policy if exists scrape_runs_read on scrape_runs;
create policy scrape_runs_read on scrape_runs for select using (true);
