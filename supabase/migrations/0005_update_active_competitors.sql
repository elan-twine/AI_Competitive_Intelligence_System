-- Twine Comp-Intel — migration 0005
-- Align the ACTIVE competitor set with Twine's current LinkedIn competitor list.
-- Per the rule: never delete competitor data — only deactivate (active=false).
-- Deactivated rows keep all history and can be reactivated anytime.
-- Run after 0001/0004. Safe to re-run.

-- Fabrix Security and Redblock are not on the current list → deactivate (keep data).
update public.competitors set active = false where name in ('Fabrix Security', 'Redblock');

-- The current competitor set stays active:
-- Twine Security (self), Lumos, Orchid Security, Cerby, Linx Security, BlinkOps, Opti, Surf AI.
update public.competitors set active = true
  where name in ('Twine Security','Lumos','Orchid Security','Cerby','Linx Security','BlinkOps','Opti','Surf AI');

-- Note: "Kai" and "Zafran Security" appear in LinkedIn's competitor analytics but are
-- NOT tracked here (per instruction to ignore them) — intentionally not inserted.
