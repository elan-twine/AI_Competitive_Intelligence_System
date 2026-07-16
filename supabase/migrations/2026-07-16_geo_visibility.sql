-- GEO/AEO ("AI visibility") tracking schema.
-- Replaces the old aggregate `llm_sov` approach with prompt-level tracking: a
-- catalog of real IAM buyer questions (geo_prompts) and, per run, which tracked
-- companies each AI engine named and in what order (geo_results). The dashboard
-- aggregates client-side (visibility %, avg position, share of voice, by topic);
-- n8n writes results with the service_role key (bypasses RLS).
--
-- Prompts seeded from the GEO prompt set (48 active, 9 topics). No code reads
-- these tables until the workflow + dashboard follow-up PRs land.

-- ---- catalog: the buyer questions we ask AI engines --------------------------
create table if not exists public.geo_prompts (
  id          bigint generated always as identity primary key,
  ext_id      text unique,               -- source prompt id (stable key)
  topic       text not null,
  prompt      text not null,
  tags        text,
  volume      int,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---- results: one row per (prompt x engine x run) ----------------------------
-- `mentions` = [{ "company": "Twine Security", "position": 1 }, ...] for every
-- tracked company the answer named, ordered by first appearance.
create table if not exists public.geo_results (
  id          bigint generated always as identity primary key,
  prompt_id   bigint references public.geo_prompts(id) on delete cascade,
  topic       text,                       -- denormalized for easy grouping
  engine      text not null,              -- 'openai' | 'perplexity' | 'anthropic'
  run_date    date not null default current_date,
  week_start  date,
  web_search  boolean,
  answer      text,                       -- truncated raw answer, for audit
  mentions    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists geo_results_week_idx   on public.geo_results (week_start);
create index if not exists geo_results_prompt_idx on public.geo_results (prompt_id);

-- ---- RLS: dashboard reads with anon/user key; n8n writes via service_role -----
alter table public.geo_prompts enable row level security;
alter table public.geo_results enable row level security;
create policy geo_prompts_read on public.geo_prompts for select using (true);
create policy geo_results_read on public.geo_results for select using (true);

-- ---- seed the prompt catalog (48 active prompts) -----------------------------
insert into public.geo_prompts (ext_id, topic, prompt, tags, volume) values
  ('pr_e596bc20', 'Identity Security Solutions', 'Identify top-rated agentic AI tools for streamlining IAM processes.', 'non-branded, transactional', 4),
  ('pr_610a6299', 'IAM Automation Tools', 'Find simple tools for automating IAM tasks.', 'non-branded, transactional', 3),
  ('pr_8546de6c', 'Automated Compliance Platforms', 'Suggest easy ways to automate security compliance tasks.', 'non-branded, informational', 3),
  ('pr_a1e72b66', 'Agentic AI for Cybersecurity', 'Find me an AI tool for automating IAM tasks.', 'non-branded, transactional', 4),
  ('pr_31f93356', 'Agentic AI for Cybersecurity', 'Provide an analytical review of AI digital employees for security operations.', 'non-branded, informational', 2),
  ('pr_c12d8276', 'AI Agents for IAM', 'Which AI agents specialize in identity security?', 'non-branded, transactional', 2),
  ('pr_d865b056', 'Automated Compliance Platforms', 'Evaluate how digital employees impact audit readiness and security compliance posture.', 'non-branded, informational', 2),
  ('pr_53a381dc', 'IAM Automation Tools', 'Evaluate how AI digital employees reduce identity security risk.', 'non-branded, informational', 2),
  ('pr_64061941', 'AI Agents for IAM', 'Need an automated helper for enterprise IAM workflows.', 'non-branded, transactional', 3),
  ('pr_640cb876', 'IAM Ticket Backlog', 'Help reduce my IAM backlog.', 'non-branded, transactional', 1),
  ('pr_f9410bd8', 'Cybersecurity Workforce Automation', 'What AI agents can handle routine cybersecurity operations?', 'non-branded, transactional', 3),
  ('pr_7799317b', 'Cybersecurity Workforce Automation', 'Evaluate how AI digital employees reduce execution gaps in enterprise security infrastructures.', 'non-branded, informational', 1),
  ('pr_7f26cac2', 'Cybersecurity Workforce Automation', 'Compare the efficacy of agentic AI versus traditional IAM automation tools.', 'non-branded, informational', 4),
  ('pr_e020ddbd', 'Automated Compliance Platforms', 'Need a reliable digital employee for managing cyber compliance.', 'non-branded, transactional', 3),
  ('pr_c4010bdb', 'AI Agents for IAM', 'Find me a digital assistant that handles IAM tasks.', 'non-branded, transactional', 1),
  ('pr_6c7597cf', 'IAM Automation Tools', 'Analyze the enterprise impact of deploying automated identity management systems.', 'non-branded, informational', 1),
  ('pr_83a59fb4', 'IAM Ticket Backlog', 'Find an AI assistant for IAM ticket backlog reduction.', 'non-branded, transactional', 3),
  ('pr_d3a39dd4', 'Agentic AI for Cybersecurity', 'List platforms for autonomous identity access management.', 'non-branded, transactional', 1),
  ('pr_72b51ce0', 'Cybersecurity Workforce Automation', 'Find me tools to automate identity management tasks.', 'non-branded, transactional', 2),
  ('pr_60913043', 'IAM Ticket Backlog', 'Automate my team''s IAM backlog.', 'non-branded, transactional', 2),
  ('pr_189bb1fe', 'Access Review Automation', 'Which AI agents handle access reviews with enterprise-grade compliance features?', 'non-branded, transactional', 3),
  ('pr_424e9cce', 'AI Agents for IAM', 'Recommend an automated AI tool for managing employee access rights.', 'non-branded, transactional', 3),
  ('pr_af05a80d', 'IAM Automation Tools', 'Show me easy ways to automate identity security.', 'non-branded, transactional', 2),
  ('pr_c1fbaab5', 'Agentic AI for Cybersecurity', 'Identify top-tier agentic AI solutions for enterprise-grade cyber defense.', 'non-branded, transactional', 2),
  ('pr_8dceb599', 'IGA Automation', 'Analyze the impact of agentic AI on IGA governance workflows.', 'non-branded, informational', 4),
  ('pr_a97f4ff5', 'Automated Compliance Platforms', 'Analyze the efficacy of agentic AI in streamlining regulatory compliance workflows.', 'non-branded, informational', 4),
  ('pr_0fff7062', 'Automated Compliance Platforms', 'List top-rated IAM compliance automation tools for enterprise security.', 'non-branded, transactional', 3),
  ('pr_f68e1456', 'Identity Security Solutions', 'Need a digital employee for handling user permissions.', 'non-branded, transactional', 2),
  ('pr_7cb85754', 'IAM Ticket Backlog', 'Compare automated solutions for high-volume IAM ticket backlogs.', 'non-branded, transactional', 3),
  ('pr_62b534f0', 'Identity Security Solutions', 'Compare the efficacy of autonomous digital employees in reducing identity-based security risks.', 'non-branded, informational', 2),
  ('pr_907287b7', 'Agentic AI for Cybersecurity', 'Recommend an AI digital employee for security teams.', 'non-branded, transactional', 1),
  ('pr_2f67d945', 'AI Agents for IAM', 'Evaluate how AI-powered digital workers improve identity and access management execution gaps.', 'non-branded, informational', 1),
  ('pr_28feff5b', 'IAM Ticket Backlog', 'Clear out IAM tickets quickly.', 'non-branded, transactional', 1),
  ('pr_7fd35c16', 'AI Agents for IAM', 'Analyze the effectiveness of autonomous AI agents in reducing identity-related security risks.', 'non-branded, informational', 3),
  ('pr_76ee386f', 'AI Agents for IAM', 'Show me AI-driven solutions for streamlining user access management.', 'non-branded, transactional', 1),
  ('pr_687fb45f', 'AI Agents for IAM', 'Assess the market landscape for agentic AI solutions focused on proactive identity security.', 'non-branded, informational', 1),
  ('pr_633c46b8', 'Access Review Automation', 'Evaluate the impact of autonomous digital employees on reducing risk during access certification cycles.', 'non-branded, informational', 2),
  ('pr_56ff4b7b', 'Agentic AI for Cybersecurity', 'Show me simple agents that handle cybersecurity chores.', 'non-branded, transactional', 3),
  ('pr_bd787a03', 'Identity Security Solutions', 'Evaluate how AI-driven identity management platforms improve compliance posture for global enterprises.', 'non-branded, informational', 1),
  ('pr_f5f474fb', 'Cybersecurity Workforce Automation', 'Show me AI assistants for security team automation.', 'non-branded, transactional', 3),
  ('pr_2285386e', 'Access Review Automation', 'Compare the operational efficiency of manual versus agentic AI for access reviews.', 'non-branded, informational', 3),
  ('pr_7fb0c1e4', 'IAM Automation Tools', 'Compare the efficacy of agentic AI versus manual IAM processes.', 'non-branded, informational', 3),
  ('pr_63d3b689', 'Access Review Automation', 'Find me tools for automated access reviews.', 'non-branded, transactional', 3),
  ('pr_79cec367', 'Cybersecurity Workforce Automation', 'Find secure AI digital employees to streamline access management workflows.', 'non-branded, transactional', 2),
  ('pr_0ff0adba', 'Agentic AI for Cybersecurity', 'Compare the effectiveness of agentic frameworks in reducing IAM security risks.', 'non-branded, informational', 3),
  ('pr_92565308', 'Automated Compliance Platforms', 'Show me simple tools for identity compliance automation.', 'non-branded, transactional', 3),
  ('pr_8b468903', 'IAM Ticket Backlog', 'Suggest ways to clear IAM ticket backlogs.', 'non-branded, informational', 1),
  ('pr_3e81d0c6', 'IAM Automation Tools', 'Which AI agents for identity management offer rapid deployment?', 'non-branded, transactional', 2)
on conflict (ext_id) do nothing;
