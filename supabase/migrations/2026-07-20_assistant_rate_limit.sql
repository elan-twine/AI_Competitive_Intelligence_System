-- Dashboard assistant v2 — per-user/day rate limit.
--
-- The assistant runs an agentic loop on Claude Sonnet 4.5 (several model calls
-- per question), so each question has real cost. This caps how many questions a
-- single logged-in user can ask per UTC day. The Worker calls assistant_bump_usage
-- once per question BEFORE spending model tokens; it atomically increments the
-- day's counter and reports whether the user is still under the cap.
--
-- Access is only ever through the SECURITY DEFINER RPC (keyed on auth.uid()), so
-- the counter table stays locked down — no client can read or tamper with it, and
-- a user can only ever affect their own row. If the Worker can't reach the RPC it
-- fails OPEN (does not block), so a deploy-order hiccup never bricks the assistant.

create table if not exists public.assistant_usage (
  user_id    uuid        not null,
  day        date        not null,
  count      integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.assistant_usage enable row level security;
-- No policies: the table is reachable only via the SECURITY DEFINER function below.
revoke all on public.assistant_usage from anon, authenticated;

-- Atomically bump today's counter for the calling user and report the verdict.
-- Returns: { allowed, count, limit, remaining } — or { allowed:false, reason }
-- when there is no authenticated user. Does NOT increment once the cap is hit.
create or replace function public.assistant_bump_usage(p_max integer default 50)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  cur   integer;
  cap   integer := greatest(coalesce(p_max, 50), 1);
begin
  if uid is null then
    return json_build_object('allowed', false, 'reason', 'unauthenticated');
  end if;

  select count into cur from public.assistant_usage where user_id = uid and day = today;
  cur := coalesce(cur, 0);

  if cur >= cap then
    return json_build_object('allowed', false, 'count', cur, 'limit', cap, 'remaining', 0);
  end if;

  insert into public.assistant_usage (user_id, day, count, updated_at)
    values (uid, today, 1, now())
  on conflict (user_id, day)
    do update set count = public.assistant_usage.count + 1, updated_at = now();

  return json_build_object('allowed', true, 'count', cur + 1, 'limit', cap, 'remaining', cap - (cur + 1));
end;
$$;

grant execute on function public.assistant_bump_usage(integer) to authenticated;
