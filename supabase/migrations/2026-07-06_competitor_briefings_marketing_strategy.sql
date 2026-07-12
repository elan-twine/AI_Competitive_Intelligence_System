-- Add a marketing_strategy column to competitor_briefings so the Competitor
-- Brief Generator can store SOV-derived marketing-motion insights (channels,
-- content themes, momentum, and Twine's suggested response) as a JSON array of
-- strings — same shape as the other list fields the UI already renders.
--
-- ⚠️ RUN THIS BEFORE publishing the updated "Competitor Brief Generator" n8n
-- workflow. PostgREST rejects an insert/upsert that references a column which
-- doesn't exist (400), which would break EVERY brief save. Order: apply this
-- migration first, then publish the workflow.
--
-- jsonb default '[]' so existing rows read as an empty list (UI hides the
-- section when empty). anon already has SELECT on competitor briefings via the
-- app's read path; writes remain service-role (the n8n workflow).

alter table competitor_briefings
  add column if not exists marketing_strategy jsonb not null default '[]'::jsonb;
