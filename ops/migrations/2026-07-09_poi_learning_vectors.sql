-- POI "learning" via RAG over thumbs feedback (2026-07-09)
-- Store every 👍/👎-rated post as an embedding; score future candidates by the
-- verdicts of their nearest neighbours. No model fine-tuning — behaviour adapts
-- automatically as votes accumulate, and can escalate from LLM-few-shot to
-- auto-select once a candidate's neighbour score is confident.

create extension if not exists vector;

-- One row per rated post. embedding = text-embedding-3-small (1536 dims).
create table if not exists poi_vectors (
  activity_id text primary key,
  company     text,
  verdict     text check (verdict in ('up','down')),
  post_text   text,
  embedding   vector(1536),
  updated_at  timestamptz default now()
);

create index if not exists poi_vectors_embedding_idx
  on poi_vectors using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Service-role only (embeddings are written by the pipeline, never the frontend).
alter table poi_vectors enable row level security;

-- k-NN over labelled feedback: nearest rated posts + cosine similarity + verdict.
create or replace function match_poi_vectors(query_embedding vector(1536), match_count int default 10)
returns table (activity_id text, company text, verdict text, post_text text, similarity float)
language sql stable as $$
  select v.activity_id, v.company, v.verdict, v.post_text,
         1 - (v.embedding <=> query_embedding) as similarity
  from poi_vectors v
  where v.embedding is not null
  order by v.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function match_poi_vectors(vector, int) to service_role, anon, authenticated;
