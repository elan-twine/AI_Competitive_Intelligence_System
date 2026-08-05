-- LLM / AI-answer Share-of-Voice ("share of model", GEO) — storage for the
-- new n8n workflow "SOV — AI Answers".
--
-- Two tables:
--   llm_sov_raw : every sampled answer, verbatim (recall-first: keep everything
--                 for re-parsing / training). Service-role only.
--   llm_sov     : the compact per-week aggregate the dashboard reads.
--                 anon-readable (no secrets; same posture as sov_weekly-lite).
--
-- Run BEFORE activating the "SOV — AI Answers" workflow (PostgREST 400s on
-- unknown tables/columns would fail every write).

create table if not exists llm_sov_raw (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  week_start date not null,            -- Monday of the sampling week
  engine text not null,                -- 'openai' | 'anthropic' | 'perplexity' | ...
  prompt_idx int not null,             -- index into sov_config.config.aiAnswers.prompts
  prompt_version int not null,         -- sov_config.config.aiAnswers.version at run time
  sample_idx int not null,             -- 0..samplesPerPrompt-1 (LLM answers are stochastic)
  prompt text not null,
  answer text,                         -- the raw answer, verbatim
  brands jsonb not null default '[]',  -- [{brand, first_pos}] detected in the answer
  cited_domains jsonb not null default '[]',
  error text                           -- non-null when the engine call failed
);
create index if not exists llm_sov_raw_week_engine_idx on llm_sov_raw (week_start, engine);

create table if not exists llm_sov (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  week_start date not null,
  engine text not null,
  company text not null,
  mention_rate numeric not null,       -- fraction of sampled answers mentioning the brand (0..1)
  share_of_model numeric not null,     -- brand mentions ÷ all-tracked-brand mentions (0..100)
  avg_first_pos numeric,               -- avg position of first mention (lower = earlier)
  n_prompts int not null,
  n_samples int not null,              -- total answers sampled for this engine this week
  prompt_version int not null,
  unique (week_start, engine, company)
);

-- Lock both tables down with RLS (without it, Supabase's default grants can
-- expose them to anon/authenticated). The n8n workflow writes with the
-- service_role key, which bypasses RLS — so no write policies are needed.
alter table llm_sov_raw enable row level security;
alter table llm_sov     enable row level security;

-- The dashboard reads ONLY the aggregate with the anon key. Raw answers stay
-- service-role only (no policy on llm_sov_raw = no client access at all).
create policy "public read llm_sov"
  on llm_sov for select
  to anon, authenticated
  using (true);
grant select on llm_sov to anon, authenticated;
