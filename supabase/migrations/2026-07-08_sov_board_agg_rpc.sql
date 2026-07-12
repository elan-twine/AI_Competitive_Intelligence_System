-- Weekly Snapshot OOM redesign: move the board aggregation from the n8n Code
-- node INTO Postgres. The compute node was OOMing the 320 MiB scheduled-worker
-- process because it loaded posts + ran 17 board computes in-process. This RPC
-- does the heavy SUM/COUNT server-side and returns ~52 tiny rows per board, so
-- n8n only normalizes + writes (memory-trivial, immune to data growth).
--
-- Board unit = SUM(post_weight) per (company, platform) over ATTRIBUTED posts,
-- within a post-date window ending at `as_of`. post_weight already encodes the
-- full weight model (author tier · reach · tier-mult · decay), set by the Decay
-- Refresh — so the RPC needs no model logic, just aggregation.
--
-- Window: rows with the platform's post-date in [as_of - window_days, as_of).
-- window_days IS NULL  → all-time as-of `as_of` (the weekly board).
-- Note: this uses the STORED post_weight (decayed as-of the last Decay run) for
-- every board, i.e. it does NOT re-age decay per historical day. Chart smoothness
-- is preserved by the post-date windowing (weekly-scraped posts land on their real
-- dates); only historical daily points lose a small amount of decay precision.
-- (If exact per-day re-aging is later wanted, store a base_weight column and
-- multiply by decay(as_of) here.)

create or replace function sov_board_agg(as_of timestamptz default now(), window_days int default null)
returns table (company text, platform text, wsum numeric, cnt bigint, sent_sum numeric, sent_cnt bigint)
language sql stable as $$
  with bounds as (
    select case when window_days is null then null
                else as_of - make_interval(days => window_days) end as lo_ts
  )
  select "companyName"::text, 'LinkedIn'::text,
         coalesce(sum(post_weight),0), count(*),
         coalesce(sum(sentiment) filter (where sentiment is not null),0),
         count(sentiment)
    from linkedin_posts, bounds
   where "companyName" is not null and "companyName" <> 'NONE' and post_weight is not null
     and "posted_at" < as_of and (bounds.lo_ts is null or "posted_at" >= bounds.lo_ts)
   group by "companyName"
  union all
  select "companyName"::text, 'X'::text,
         coalesce(sum(post_weight),0), count(*),
         coalesce(sum(sentiment) filter (where sentiment is not null),0),
         count(sentiment)
    from tweets, bounds
   where "companyName" is not null and "companyName" <> 'NONE' and post_weight is not null
     and "createdAt" < as_of and (bounds.lo_ts is null or "createdAt" >= bounds.lo_ts)
   group by "companyName"
  union all
  select "companyName"::text, 'Google News'::text,
         coalesce(sum(post_weight),0), count(*),
         coalesce(sum(sentiment) filter (where sentiment is not null),0),
         count(sentiment)
    from googlenews, bounds
   where "companyName" is not null and "companyName" <> 'NONE' and post_weight is not null
     and "publishedAt" < as_of and (bounds.lo_ts is null or "publishedAt" >= bounds.lo_ts)
   group by "companyName"
  union all
  select "companyName"::text, 'Reddit'::text,
         coalesce(sum(post_weight),0), count(*),
         coalesce(sum(sentiment) filter (where sentiment is not null),0),
         count(sentiment)
    from reddit_posts, bounds
   where "companyName" is not null and "companyName" <> 'NONE' and post_weight is not null
     and "createdAt" < as_of and (bounds.lo_ts is null or "createdAt" >= bounds.lo_ts)
   group by "companyName"
$$;

-- The n8n workflow calls this with the service_role key (bypasses RLS). Grant
-- execute broadly so PostgREST exposes /rest/v1/rpc/sov_board_agg.
grant execute on function sov_board_agg(timestamptz, int) to service_role, anon, authenticated;
