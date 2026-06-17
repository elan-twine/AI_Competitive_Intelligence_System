-- Twine Comp-Intel — migration 0003
-- Restrict ALL new accounts (password signup AND Google OAuth) to @twinesecurity.com.
-- A BEFORE INSERT trigger on auth.users aborts creation of any other domain.
-- Existing users are unaffected; login does not re-insert.
-- Run after 0001/0002. Safe to re-run.

create or replace function public.enforce_twine_email_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or lower(new.email) not like '%@twinesecurity.com' then
    raise exception 'Access restricted to @twinesecurity.com accounts';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_twine_email_domain on auth.users;
create trigger enforce_twine_email_domain
  before insert on auth.users
  for each row execute function public.enforce_twine_email_domain();

-- ---------------------------------------------------------------------------
-- NOTE on the error message the user sees:
--   With this trigger, a blocked Google sign-in surfaces a GENERIC
--   "Database error saving new user" to the browser (Postgres wraps the
--   exception). The block is reliable; only the message is generic.
--
--   If you want the exact "Access restricted..." message to reach the user,
--   use Supabase's "Before User Created" Auth Hook instead of this trigger:
--   Dashboard -> Authentication -> Hooks -> Before User Created -> point it at
--   a function that returns {"error": {...}}. Ask and I'll provide that variant.
-- ---------------------------------------------------------------------------
