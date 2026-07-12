-- Persist the RAG "taste" score the POI generator computes per pick (2026-07-09).
-- Lets the UI show how strongly each ⭐ matches the team's learned 👍/👎 taste,
-- and enables the eventual auto-select-by-confidence gate. Nullable; older rows
-- and no-RAG fallback runs simply leave it null.
alter table posts_of_interest add column if not exists taste_score double precision;
