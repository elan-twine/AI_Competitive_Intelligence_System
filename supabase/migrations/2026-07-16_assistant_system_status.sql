-- Assistant operational-status RPC.
-- Powers the dashboard assistant's `system_status` tool: the LinkedIn ingestion
-- queue, per-platform scrape freshness, and the live scoring config — as a single
-- compact JSON. SECURITY DEFINER so it can read the service-role staging table
-- (linkedin_raw) and return ONLY aggregate counts + config (never raw rows),
-- safely callable by the logged-in user's token.

create or replace function public.assistant_system_status()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    -- LinkedIn is the only staged/queued platform (X/Reddit/News attribute inline).
    'linkedin_queue', (
      select jsonb_build_object(
        'pending',        count(*) filter (where status = 'pending'),
        'processed',      count(*) filter (where status = 'done'),
        'oldest_pending', min(scraped_at) filter (where status = 'pending'),
        'newest_scraped', max(scraped_at)
      )
      from public.linkedin_raw
    ),
    -- Last successful scrape per platform (freshness / "is it running?").
    'scrape_freshness', (
      select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      from (
        select distinct on (platform)
          platform, finished_at, rows_found, rows_written, status
        from public.scrape_runs
        where status = 'success'
        order by platform, finished_at desc
      ) t
    ),
    -- Live scoring knobs (authoritative — the assistant should trust these over
    -- any numbers baked into its prompt).
    'config', (
      select jsonb_build_object(
        'platformMultipliers', config->'platformMultipliers',
        'halfLifeDays',        config->'halfLifeDays',
        'engagementWeights',   config->'engagementWeights'
      )
      from public.sov_config
      limit 1
    )
  );
$$;

revoke all on function public.assistant_system_status() from public;
grant execute on function public.assistant_system_status() to anon, authenticated;
