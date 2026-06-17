-- Twine Comp-Intel — migration 0004
-- Populate competitors.linkedin_url + domain (researched via web; verified
-- against each company's own site + LinkedIn). Numeric linkedin_urn is NOT set
-- here — it isn't in the public URL and must come from Apify CompURNGetter /
-- LinkedIn-authenticated tooling. Run after 0001. Safe to re-run.

update public.competitors set linkedin_url='https://www.linkedin.com/company/twinesecurity',  domain='twinesecurity.com' where name='Twine Security';
update public.competitors set linkedin_url='https://www.linkedin.com/company/lumosidentity',   domain='lumos.com'         where name='Lumos';
update public.competitors set linkedin_url='https://www.linkedin.com/company/orchid-security',  domain='orchid.security'   where name='Orchid Security';
update public.competitors set linkedin_url='https://www.linkedin.com/company/cerby',            domain='cerby.com'         where name='Cerby';
update public.competitors set linkedin_url='https://www.linkedin.com/company/linx-security',    domain='linx.security'     where name='Linx Security';
update public.competitors set linkedin_url='https://www.linkedin.com/company/blink-ops',        domain='blinkops.com'      where name='BlinkOps';
update public.competitors set linkedin_url='https://www.linkedin.com/company/surfsecurity',     domain='surf.security'     where name='Surf AI';
update public.competitors set linkedin_url='https://www.linkedin.com/company/redblock',         domain='redblock.ai'       where name='Redblock';

-- Fabrix: acquired by Silverfort (~Apr 2026); LinkedIn slug confident, domain folding into silverfort.com so left unset.
update public.competitors set linkedin_url='https://www.linkedin.com/company/fabrix-security' where name='Fabrix Security';

-- Opti: identity confirmed (opti.ai, ex-Indegy founders) but LinkedIn slug NOT confirmed via public search — source via Apify/authenticated tooling.
update public.competitors set domain='opti.ai' where name='Opti';
