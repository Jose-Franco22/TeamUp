-- Telling a project's creator someone asked to join (issue #26). Run after
-- 22_remove_member_rules.sql.
--
-- Supersedes create_join_request() from 03_functions.sql (same signature,
-- so the frontend call doesn't change). What's new: once the request is
-- written, the project's creator gets one 'join_request' notification in
-- the same transaction. A request that's refused (own project, already on a
-- team, already pending) raises before the insert, so it notifies no one.
--
-- The email copy goes out from the notify-email Edge Function
-- (supabase/functions/notify-email), fired by a database webhook on
-- notifications inserts — see TODO-backend.md. Nothing here depends on it:
-- the in-app notification is written whether or not email is set up.

-- --- notifications -------------------------------------------------------
-- One more kind. For 'join_request', user_id is the project's creator and
-- actor_id is the student who asked, which is how the app names them. The
-- app opens /requests for this kind, as it works out every page from kind.
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('join_request', 'member_left', 'member_removed', 'request_accepted', 'request_declined'));

-- --- create_join_request -------------------------------------------------
-- Same four checks, in the same order, as 03_functions.sql.
create or replace function public.create_join_request(p_project_id uuid)
returns public.join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_row public.join_requests;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  if v_project.creator_id = caller then
    raise exception 'You cannot request to join your own project';
  end if;

  -- team_members.user_id is globally unique (one team per student, ever),
  -- so this single check covers both "already on this team" and "already
  -- on some other team" — see TODO-backend.md.
  if exists (select 1 from public.team_members where user_id = caller) then
    raise exception 'You are already on a team and cannot request to join another project';
  end if;

  if exists (
    select 1 from public.join_requests
    where project_id = p_project_id and user_id = caller and status = 'pending'
  ) then
    raise exception 'You already have a pending request for this project';
  end if;

  insert into public.join_requests (project_id, user_id, status)
  values (p_project_id, caller, 'pending')
  returning * into v_row;

  insert into public.notifications (user_id, kind, project_id, actor_id)
  values (v_project.creator_id, 'join_request', p_project_id, caller);

  return v_row;
end;
$$;

grant execute on function public.create_join_request(uuid) to authenticated;
