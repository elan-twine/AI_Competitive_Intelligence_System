-- Dashboard assistant P3 — server-side conversation sessions.
--
-- The client now sends a conversation id (session_id) instead of re-sending the
-- transcript each turn. The Worker loads the stored turns via assistant_session_get,
-- appends the new exchange after answering via assistant_session_put, and keeps a
-- compact record of the last tool results so follow-ups ("as you said above…",
-- "which of those posts…") stay grounded without re-fetching.
--
-- Design note: the plan sketched Cloudflare KV for this; a Supabase table behind
-- SECURITY DEFINER RPCs was chosen instead — no new Cloudflare infra/binding (auto-
-- deploy untouched), sessions are inspectable for debugging/eval seeding, and it
-- matches every other pattern in this stack. Sessions expire after 2h idle (purged
-- opportunistically on write). FAIL-OPEN: if these RPCs aren't deployed, the Worker
-- falls back to the client-sent history — nothing breaks.
--
-- Access is only through the RPCs (keyed on auth.uid()): no policies, so no client
-- can read another user's conversations or tamper with the table directly.

create table if not exists public.assistant_sessions (
  user_id    uuid        not null,
  session_id uuid        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, session_id)
);

alter table public.assistant_sessions enable row level security;
revoke all on table public.assistant_sessions from anon, authenticated;

-- Fetch one session's stored state for the calling user ('{}'::jsonb if none).
create or replace function public.assistant_session_get(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  out jsonb;
begin
  if uid is null or p_session is null then
    return '{}'::jsonb;
  end if;
  select data into out
    from public.assistant_sessions
   where user_id = uid and session_id = p_session
     and updated_at > now() - interval '2 hours';
  return coalesce(out, '{}'::jsonb);
end;
$$;

-- Upsert one session's state for the calling user. Caps payload size (64KB
-- backstop; the Worker byte-bounds its payloads to ~48KB so this shouldn't
-- trigger in normal use), opportunistically purges this user's expired sessions,
-- and caps the caller at 20 live sessions (oldest dropped) — the RPC is callable
-- straight from the browser, so without the cap a scripted loop with fresh UUIDs
-- could grow the table unbounded inside the 2h expiry window.
create or replace function public.assistant_session_put(p_session uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or p_session is null then
    return;
  end if;
  if pg_column_size(p_data) > 65536 then
    return; -- oversized payload: drop (backstop; the Worker bounds well below this)
  end if;

  delete from public.assistant_sessions
   where user_id = uid and updated_at < now() - interval '2 hours';

  insert into public.assistant_sessions (user_id, session_id, data, updated_at)
    values (uid, p_session, p_data, now())
  on conflict (user_id, session_id)
    do update set data = excluded.data, updated_at = now();

  -- Per-user session cap: keep the 20 most recently touched, drop the rest.
  delete from public.assistant_sessions
   where user_id = uid
     and session_id not in (
       select session_id from public.assistant_sessions
        where user_id = uid
        order by updated_at desc
        limit 20
     );
end;
$$;

revoke all on function public.assistant_session_get(uuid) from public;
revoke all on function public.assistant_session_put(uuid, jsonb) from public;
grant execute on function public.assistant_session_get(uuid) to authenticated;
grant execute on function public.assistant_session_put(uuid, jsonb) to authenticated;
