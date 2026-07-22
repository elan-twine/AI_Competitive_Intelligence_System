-- Dashboard assistant — persistent, browsable chat sessions.
--
-- Extends the P3 session store (2026-07-20_assistant_sessions.sql) from a 2h
-- scratch buffer into durable, listable chat history so the UI can offer
-- "new chat" + "old chats":
--   • get no longer hides sessions after 2h idle — a chat lives until the user
--     clears it (or falls off the per-user rolling cap).
--   • put no longer purges on the 2h idle window; the per-user cap is raised
--     20 → 30 (oldest-touched dropped past that).
--   • new list/delete/clear_all RPCs power the history drawer.
-- Retention policy (Elan, 2026-07-22): keep until manual clear; rolling cap 30.
--
-- Titles: the Worker now stores data->>'title' (first question, trimmed) on the
-- first turn; list falls back to the first user turn's text, then 'New chat'.
--
-- All access stays through SECURITY DEFINER RPCs keyed on auth.uid() — no table
-- policies, so no client can read or delete another user's conversations.

-- Fetch one session's stored state for the calling user ('{}'::jsonb if none).
-- No age filter now — chats persist until explicitly cleared.
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
   where user_id = uid and session_id = p_session;
  return coalesce(out, '{}'::jsonb);
end;
$$;

-- Upsert one session's state for the calling user. Caps payload size (64KB
-- backstop; the Worker byte-bounds to ~48KB), and caps the caller at 30 live
-- sessions (oldest-touched dropped) — the RPC is callable straight from the
-- browser, so the cap bounds a scripted fresh-UUID loop. No idle purge: chats
-- persist until the user clears them or they fall off the rolling cap.
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

  insert into public.assistant_sessions (user_id, session_id, data, updated_at)
    values (uid, p_session, p_data, now())
  on conflict (user_id, session_id)
    do update set data = excluded.data, updated_at = now();

  -- Per-user session cap: keep the 30 most recently touched, drop the rest.
  delete from public.assistant_sessions
   where user_id = uid
     and session_id not in (
       select session_id from public.assistant_sessions
        where user_id = uid
        order by updated_at desc
        limit 30
     );
end;
$$;

-- List the calling user's sessions for the history drawer (newest first, 30).
-- Title = stored title, else the first user turn's text (collapsed + trimmed to
-- 80 chars), else 'New chat'. Empty sessions (no turns) are omitted.
create or replace function public.assistant_session_list()
returns table (session_id uuid, title text, updated_at timestamptz, turn_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return;
  end if;
  return query
    select s.session_id,
           coalesce(
             nullif(s.data->>'title', ''),
             nullif(left(regexp_replace(coalesce(s.data->'turns'->0->>'content', ''), E'\\s+', ' ', 'g'), 80), ''),
             'New chat'
           ) as title,
           s.updated_at,
           coalesce(jsonb_array_length(s.data->'turns'), 0) as turn_count
      from public.assistant_sessions s
     where s.user_id = uid
       and coalesce(jsonb_array_length(s.data->'turns'), 0) > 0
     order by s.updated_at desc
     limit 30;
end;
$$;

-- Delete one of the calling user's sessions (manual clear of a single chat).
create or replace function public.assistant_session_delete(p_session uuid)
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
  delete from public.assistant_sessions
   where user_id = uid and session_id = p_session;
end;
$$;

-- Delete ALL of the calling user's sessions ("clear all history").
create or replace function public.assistant_session_clear_all()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return;
  end if;
  delete from public.assistant_sessions where user_id = uid;
end;
$$;

revoke all on function public.assistant_session_get(uuid) from public;
revoke all on function public.assistant_session_put(uuid, jsonb) from public;
revoke all on function public.assistant_session_list() from public;
revoke all on function public.assistant_session_delete(uuid) from public;
revoke all on function public.assistant_session_clear_all() from public;
grant execute on function public.assistant_session_get(uuid) to authenticated;
grant execute on function public.assistant_session_put(uuid, jsonb) to authenticated;
grant execute on function public.assistant_session_list() to authenticated;
grant execute on function public.assistant_session_delete(uuid) to authenticated;
grant execute on function public.assistant_session_clear_all() to authenticated;
