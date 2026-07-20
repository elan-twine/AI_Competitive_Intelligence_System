-- Assistant P2 — per-company rollup RPC.
-- Powers the `get_company` tool: one call returns a company's per-platform post
-- counts, summed post_weight, and average sentiment across all four platforms in
-- a date window. The Worker multiplies sum_weight by the live platform trust
-- multipliers (from sov_config) to get the impact split — keeping the multipliers
-- in one place (sov_config) and pushing only the SUM/GROUP BY into Postgres.
--
-- SECURITY DEFINER so the aggregate is computed server-side over the posts tables
-- regardless of the caller's table RLS; it returns ONLY aggregates (never rows).
-- Honors the same exclusion as the rest of the app: misattributed = true is out
-- (null/false kept). NULL window bound = unbounded on that side.

create or replace function public.assistant_company_rollup(
  p_company text,
  p_since   date default null,
  p_until   date default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with rows as (
    select 'LinkedIn'::text as platform, post_weight, sentiment
      from public.linkedin_posts
     where "companyName" ilike '%'||p_company||'%'
       and coalesce(misattributed, false) = false
       and (p_since is null or posted_at::date >= p_since)
       and (p_until is null or posted_at::date <= p_until)
    union all
    select 'X', post_weight, sentiment
      from public.tweets
     where "companyName" ilike '%'||p_company||'%'
       and coalesce(misattributed, false) = false
       and (p_since is null or "createdAt"::date >= p_since)
       and (p_until is null or "createdAt"::date <= p_until)
    union all
    select 'Reddit', post_weight, sentiment
      from public.reddit_posts
     where "companyName" ilike '%'||p_company||'%'
       and coalesce(misattributed, false) = false
       and (p_since is null or "createdAt"::date >= p_since)
       and (p_until is null or "createdAt"::date <= p_until)
    union all
    select 'Google News', post_weight, sentiment
      from public.googlenews
     where "companyName" ilike '%'||p_company||'%'
       and coalesce(misattributed, false) = false
       and (p_since is null or "publishedAt"::date >= p_since)
       and (p_until is null or "publishedAt"::date <= p_until)
  )
  select jsonb_build_object(
    'company', p_company,
    'since', p_since,
    'until', p_until,
    'total_posts', (select count(*) from rows),
    'platforms', coalesce((
      select jsonb_object_agg(platform, obj)
      from (
        select platform,
               jsonb_build_object(
                 'posts', count(*),
                 'sum_weight', round(coalesce(sum(post_weight), 0)::numeric, 3),
                 'avg_sentiment', round(avg(sentiment)::numeric, 2)
               ) as obj
        from rows
        group by platform
      ) s
    ), '{}'::jsonb)
  );
$$;

revoke all on function public.assistant_company_rollup(text, date, date) from public;
grant execute on function public.assistant_company_rollup(text, date, date) to authenticated;
