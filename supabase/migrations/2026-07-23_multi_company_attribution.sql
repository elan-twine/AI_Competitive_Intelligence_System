-- Multi-company attribution: a single post/article that names several tracked
-- competitors now counts for ALL of them (full weight each), not just one.
--
-- Storage: each platform table keeps its one-row-per-post shape (PK, dedup, the
-- misattributed flag all intact) and the scalar "companyName" as the PRIMARY
-- (most-anchored) company — used by the frontend, dedup, and as a fallback. A
-- new `company_names` jsonb array holds the full set, one element per named
-- company: [{ "name": "...", "sentiment": <int -3..3>, "reasoning": "..." }].
--
-- Aggregation: sov_board_agg UNNESTS company_names so each named company earns
-- the post's FULL post_weight and its own sentiment. When company_names is
-- null/empty (every existing row, single-company posts, and any not-yet-migrated
-- write path) it FALLS BACK to the scalar companyName + scalar sentiment — so
-- this migration is inert until the n8n gates start emitting arrays, and needs
-- ZERO backfill. Weighting decision (Elan, 2026-07-23): full weight to each
-- named company across all four platforms.

alter table linkedin_posts add column if not exists company_names jsonb;
alter table tweets        add column if not exists company_names jsonb;
alter table googlenews    add column if not exists company_names jsonb;
alter table reddit_posts  add column if not exists company_names jsonb;

-- Per-post → per-company expansion. Array present → one row per named company
-- (each with its own sentiment); array null/empty → the scalar companyName.
-- jsonb_array_elements is guarded so a non-array value can never throw.
create or replace function sov_board_agg(as_of timestamptz default now(), window_days int default null)
returns table (company text, platform text, wsum numeric, cnt bigint, sent_sum numeric, sent_cnt bigint)
language sql stable as $$
  with bounds as (
    select case when window_days is null then null
                else as_of - make_interval(days => window_days) end as lo_ts
  )
  select agg.company::text, 'LinkedIn'::text,
         coalesce(sum(lp.post_weight),0), count(*),
         coalesce(sum(agg.sent) filter (where agg.sent is not null),0), count(agg.sent)
    from linkedin_posts lp, bounds
    cross join lateral (
      select e->>'name' as company, nullif(e->>'sentiment','')::numeric as sent
        from jsonb_array_elements(case when jsonb_typeof(lp.company_names)='array' then lp.company_names else '[]'::jsonb end) e
      union all
      select lp."companyName", lp.sentiment
       where lp.company_names is null or jsonb_typeof(lp.company_names) <> 'array' or jsonb_array_length(lp.company_names) = 0
    ) agg
   where agg.company is not null and agg.company <> 'NONE' and lp.post_weight is not null
     and lp."posted_at" < as_of and (bounds.lo_ts is null or lp."posted_at" >= bounds.lo_ts)
   group by agg.company
  union all
  select agg.company::text, 'X'::text,
         coalesce(sum(t.post_weight),0), count(*),
         coalesce(sum(agg.sent) filter (where agg.sent is not null),0), count(agg.sent)
    from tweets t, bounds
    cross join lateral (
      select e->>'name' as company, nullif(e->>'sentiment','')::numeric as sent
        from jsonb_array_elements(case when jsonb_typeof(t.company_names)='array' then t.company_names else '[]'::jsonb end) e
      union all
      select t."companyName", t.sentiment
       where t.company_names is null or jsonb_typeof(t.company_names) <> 'array' or jsonb_array_length(t.company_names) = 0
    ) agg
   where agg.company is not null and agg.company <> 'NONE' and t.post_weight is not null
     and t."createdAt" < as_of and (bounds.lo_ts is null or t."createdAt" >= bounds.lo_ts)
   group by agg.company
  union all
  select agg.company::text, 'Google News'::text,
         coalesce(sum(g.post_weight),0), count(*),
         coalesce(sum(agg.sent) filter (where agg.sent is not null),0), count(agg.sent)
    from googlenews g, bounds
    cross join lateral (
      select e->>'name' as company, nullif(e->>'sentiment','')::numeric as sent
        from jsonb_array_elements(case when jsonb_typeof(g.company_names)='array' then g.company_names else '[]'::jsonb end) e
      union all
      select g."companyName", g.sentiment
       where g.company_names is null or jsonb_typeof(g.company_names) <> 'array' or jsonb_array_length(g.company_names) = 0
    ) agg
   where agg.company is not null and agg.company <> 'NONE' and g.post_weight is not null
     and g."publishedAt" < as_of and (bounds.lo_ts is null or g."publishedAt" >= bounds.lo_ts)
   group by agg.company
  union all
  select agg.company::text, 'Reddit'::text,
         coalesce(sum(r.post_weight),0), count(*),
         coalesce(sum(agg.sent) filter (where agg.sent is not null),0), count(agg.sent)
    from reddit_posts r, bounds
    cross join lateral (
      select e->>'name' as company, nullif(e->>'sentiment','')::numeric as sent
        from jsonb_array_elements(case when jsonb_typeof(r.company_names)='array' then r.company_names else '[]'::jsonb end) e
      union all
      select r."companyName", r.sentiment
       where r.company_names is null or jsonb_typeof(r.company_names) <> 'array' or jsonb_array_length(r.company_names) = 0
    ) agg
   where agg.company is not null and agg.company <> 'NONE' and r.post_weight is not null
     and r."createdAt" < as_of and (bounds.lo_ts is null or r."createdAt" >= bounds.lo_ts)
   group by agg.company
$$;

grant execute on function sov_board_agg(timestamptz, int) to service_role, anon, authenticated;
