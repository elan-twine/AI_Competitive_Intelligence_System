-- Twine Comp-Intel — migration 0006
-- Numeric LinkedIn company URNs, resolved via the Apify actor
-- apimaestro/linkedin-company-detail (id ipHw77V2NMJPy8sbS), input field
-- `identifier` (array of slugs/URLs), URN at output `company_urn`.
-- Cross-checked against the URNs already present in Posts_Of_Interest.
-- Run after 0001/0004. Safe to re-run.

update public.competitors set linkedin_urn='101710081' where name='Twine Security';
update public.competitors set linkedin_urn='68564822'  where name='Lumos';
update public.competitors set linkedin_urn='105421652' where name='Orchid Security';
update public.competitors set linkedin_urn='67094527'  where name='Cerby';
update public.competitors set linkedin_urn='92514012'  where name='Linx Security';
update public.competitors set linkedin_urn='71967893'  where name='BlinkOps';
update public.competitors set linkedin_urn='5314961'   where name='Surf AI';

-- Opti: URN unresolved — no confirmed LinkedIn URL/slug yet. Filled once its slug is known.
