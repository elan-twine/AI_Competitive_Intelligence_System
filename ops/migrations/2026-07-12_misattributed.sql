-- Soft "un-attribute" a misattributed mention from the dashboard (2026-07-12).
-- Sets a `misattributed` flag instead of deleting: the row + its text/engagement
-- stay for the record, but it's excluded from the company's SOV everywhere. The
-- companyName is preserved (auditable + reversible — flip the flag back).
--
-- Write path: the frontend uses the anon key, which has no UPDATE grant on the
-- post tables. A SECURITY DEFINER RPC (granted to authenticated only) does the
-- flagging under the function owner's rights — so signed-in dashboard users can
-- flag, anon visitors cannot, and the service_role key never touches the client.

-- 1) Flag column on each post table (default false; existing rows = false).
alter table linkedin_posts add column if not exists misattributed boolean default false;
alter table tweets         add column if not exists misattributed boolean default false;
alter table reddit_posts   add column if not exists misattributed boolean default false;
alter table googlenews     add column if not exists misattributed boolean default false;

-- 2) Flag/unflag RPC. Keyed by each table's stable id (::text-compared so it
--    works whether the id column is text or numeric). authenticated-only.
create or replace function flag_misattributed(p_platform text, p_key text, p_flag boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_platform = 'LinkedIn' then
    update linkedin_posts set misattributed = p_flag where activity_id::text = p_key;
  elsif p_platform = 'X' then
    update tweets set misattributed = p_flag where id::text = p_key;
  elsif p_platform = 'Reddit' then
    update reddit_posts set misattributed = p_flag where id::text = p_key;
  elsif p_platform = 'Google News' then
    update googlenews set misattributed = p_flag where url = p_key;
  else
    raise exception 'flag_misattributed: unknown platform %', p_platform;
  end if;
end;
$$;
revoke all on function flag_misattributed(text, text, boolean) from public;
grant execute on function flag_misattributed(text, text, boolean) to authenticated, service_role;

-- 3) Exclude flagged rows from the server-side board aggregation, so the frozen
--    board (sov_weekly/sov_daily) drops them on the next Weekly Snapshot run.
--    (Same body as 2026-07-08_sov_board_agg_rpc.sql, plus the misattributed guard.)
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
     and coalesce(misattributed, false) = false
     and "posted_at" < as_of and (bounds.lo_ts is null or "posted_at" >= bounds.lo_ts)
   group by "companyName"
  union all
  select "companyName"::text, 'X'::text,
         coalesce(sum(post_weight),0), count(*),
         coalesce(sum(sentiment) filter (where sentiment is not null),0),
         count(sentiment)
    from tweets, bounds
   where "companyName" is not null and "companyName" <> 'NONE' and post_weight is not null
     and coalesce(misattributed, false) = false
     and "createdAt" < as_of and (bounds.lo_ts is null or "createdAt" >= bounds.lo_ts)
   group by "companyName"
  union all
  select "companyName"::text, 'Google News'::text,
         coalesce(sum(post_weight),0), count(*),
         coalesce(sum(sentiment) filter (where sentiment is not null),0),
         count(sentiment)
    from googlenews, bounds
   where "companyName" is not null and "companyName" <> 'NONE' and post_weight is not null
     and coalesce(misattributed, false) = false
     and "publishedAt" < as_of and (bounds.lo_ts is null or "publishedAt" >= bounds.lo_ts)
   group by "companyName"
  union all
  select "companyName"::text, 'Reddit'::text,
         coalesce(sum(post_weight),0), count(*),
         coalesce(sum(sentiment) filter (where sentiment is not null),0),
         count(sentiment)
    from reddit_posts, bounds
   where "companyName" is not null and "companyName" <> 'NONE' and post_weight is not null
     and coalesce(misattributed, false) = false
     and "createdAt" < as_of and (bounds.lo_ts is null or "createdAt" >= bounds.lo_ts)
   group by "companyName"
$$;
grant execute on function sov_board_agg(timestamptz, int) to service_role, anon, authenticated;
