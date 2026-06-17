-- Twine Comp-Intel — migration 0008
-- Opti's LinkedIn URL + URN, resolved via the Apify actor (slug opti-ai).
-- Run after 0001/0004. Safe to re-run.
update public.competitors
  set linkedin_url='https://www.linkedin.com/company/opti-ai', linkedin_urn='102395574'
  where name='Opti';
