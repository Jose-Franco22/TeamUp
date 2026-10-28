-- The notification bell in the header (issue #20). Run after
-- 23_join_request_notifications.sql.
--
-- The table, its select-own RLS policy and mark_notifications_read() come
-- from 20_leave_team_rules.sql; every kind is written by its own story's
-- SECURITY DEFINER function. This file adds the two things the bell needs
-- on top: a "mark all as read" that doesn't have to send every id, and
-- Realtime, so a new notification reaches the bell without a reload.

-- --- mark_all_notifications_read -----------------------------------------
-- Same shape as mark_notifications_read(): there's still no UPDATE policy,
-- so this is the only other way read_at changes, and only on the caller's
-- own rows.
create or replace function public.mark_all_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.notifications
    set read_at = now()
    where user_id = auth.uid() and read_at is null;
end;
$$;

grant execute on function public.mark_all_notifications_read() to authenticated;

-- --- Realtime ------------------------------------------------------------
-- The app subscribes to inserts on notifications filtered to its own
-- user_id (client.js subscribeToNotifications). Realtime checks the same
-- select policy before sending a row, so nobody hears about anyone else's.
-- The publication only exists on a real Supabase project, not in the test
-- harness, and adding a table twice is an error, so check both first.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
