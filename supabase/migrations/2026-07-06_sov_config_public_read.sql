-- Allow the anon frontend to READ sov_config so the dashboard computes SOV on
-- the LIVE weights instead of the hardcoded DEFAULT_SOV_CONFIG fallback.
--
-- Why this matters (audit F2): sov_config is currently authenticated-only, so
-- the web app's anon key gets an empty result and silently falls back to the
-- baked-in defaults in useSOVConfig.js. Today the defaults happen to match the
-- live row, but the moment anyone tunes weights in sov_config (e.g. the task-#7
-- platform-weighting rethink) the dashboard would keep computing on stale
-- numbers while the n8n board uses the new ones — a silent divergence. This
-- grant MUST land before any sov_config tuning.
--
-- sov_config holds only tuning knobs (platform weights, half-lives, engagement
-- weights, author tiers, learned negation tokens) — NO secrets — so public
-- SELECT is safe, matching sov_weekly / sov_daily / scrape_runs. Writes stay
-- service-role only (no INSERT/UPDATE/DELETE policy = denied for anon).

alter table sov_config enable row level security;  -- no-op if already enabled

drop policy if exists sov_config_read on sov_config;
create policy sov_config_read on sov_config for select using (true);
