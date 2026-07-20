-- Assistant P4 — semantic post search (pgvector).
--
-- Mirrors the poi_vectors pattern (text-embedding-3-small, 1536 dims). Attributed
-- posts across all four platforms get one embedding row each; the assistant's
-- search_posts tool embeds the user's query in the Worker and calls
-- assistant_semantic_search for nearest-neighbor matches ("posts about
-- passwordless", "complaints about pricing" — conceptual search that
-- text_contains keyword matching can't do).
--
-- Population: the Worker's scheduled (cron) handler calls assistant_posts_to_embed
-- with the SERVICE key to list attributed posts that don't have a vector yet,
-- embeds them via OpenAI, and inserts into post_vectors. ~800 attributed posts
-- today → no ANN index needed (exact scan is instant at this scale; add ivfflat
-- if it ever grows past ~50k rows).

create extension if not exists vector;

create table if not exists public.post_vectors (
  id          bigint generated always as identity primary key,
  platform    text        not null,
  source_url  text        not null,
  company     text        not null,
  posted_at   timestamptz,
  snippet     text,
  embedding   vector(1536) not null,
  created_at  timestamptz not null default now(),
  unique (platform, source_url)
);

alter table public.post_vectors enable row level security;
-- No policies: reads go through the search RPC; writes only via the service key.
revoke all on table public.post_vectors from anon, authenticated;

-- Nearest-neighbor search over the post embeddings (cosine). SECURITY DEFINER so
-- the logged-in user's token can search without direct table access. Returns only
-- the display fields + similarity — never the embeddings.
create or replace function public.assistant_semantic_search(
  p_embedding vector(1536),
  p_count     integer default 8,
  p_company   text    default null,
  p_platform  text    default null,
  p_since     date    default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  from (
    select company,
           platform,
           to_char(posted_at, 'YYYY-MM-DD') as date,
           snippet,
           source_url as url,
           round((1 - (embedding <=> p_embedding))::numeric, 3) as similarity
    from public.post_vectors
    where (p_company  is null or company ilike '%'||p_company||'%')
      and (p_platform is null or platform = p_platform)
      and (p_since    is null or posted_at::date >= p_since)
    order by embedding <=> p_embedding
    limit least(greatest(coalesce(p_count, 8), 1), 25)
  ) t;
$$;

revoke all on function public.assistant_semantic_search(vector, integer, text, text, date) from public;
grant execute on function public.assistant_semantic_search(vector, integer, text, text, date) to authenticated;

-- List attributed posts that don't have an embedding yet (the embed queue).
-- Normalizes the four posts tables into one shape. SERVICE-ROLE ONLY: called by
-- the Worker's cron/backfill with the service key, never by end users.
create or replace function public.assistant_posts_to_embed(p_limit integer default 200)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  from (
    select * from (
      select 'LinkedIn'::text as platform,
             post_url as source_url,
             "companyName" as company,
             posted_at as posted_at,
             left(trim(coalesce(title,'') || ' ' || coalesce(text,'')), 1000) as snippet
        from public.linkedin_posts
       where "companyName" is not null and "companyName" <> 'NONE'
         and coalesce(misattributed, false) = false and post_url is not null
      union all
      select 'X', coalesce("twitterUrl", url), "companyName", "createdAt",
             left(trim(coalesce(text,'')), 1000)
        from public.tweets
       where "companyName" is not null and "companyName" <> 'NONE'
         and coalesce(misattributed, false) = false and coalesce("twitterUrl", url) is not null
      union all
      select 'Reddit', coalesce(url, permalink), "companyName", "createdAt",
             left(trim(coalesce(title,'') || ' ' || coalesce("selfText",'')), 1000)
        from public.reddit_posts
       where "companyName" is not null and "companyName" <> 'NONE'
         and coalesce(misattributed, false) = false and coalesce(url, permalink) is not null
      union all
      select 'Google News', url, "companyName", "publishedAt",
             left(trim(coalesce(title,'') || ' (' || coalesce(source,'') || ')'), 1000)
        from public.googlenews
       where "companyName" is not null and "companyName" <> 'NONE'
         and coalesce(misattributed, false) = false and url is not null
    ) p
    where not exists (
      select 1 from public.post_vectors v
      where v.platform = p.platform and v.source_url = p.source_url
    )
    and length(p.snippet) > 0
    order by p.posted_at desc nulls last
    limit least(greatest(coalesce(p_limit, 200), 1), 500)
  ) t;
$$;

revoke all on function public.assistant_posts_to_embed(integer) from public, anon, authenticated;
grant execute on function public.assistant_posts_to_embed(integer) to service_role;
