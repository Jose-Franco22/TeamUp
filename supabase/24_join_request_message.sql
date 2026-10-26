-- A short note with a join request, and the rest of the reasons a request
-- is refused (issue #32). Run after 23_join_request_notifications.sql.
--
-- Supersedes create_join_request() from 23_join_request_notifications.sql.
-- What's new:
--
--   * an optional message, up to 300 characters, stored on the request so
--     the project's creator has context when deciding;
--   * a request to a project that is already full is refused;
--   * a request after the formation deadline is refused.
--
-- Two layers, same as 16_project_validation.sql: a CHECK constraint on
-- join_requests is the boundary, and the raise in create_join_request()
-- comes first so the student sees a sentence rather than a constraint name.
-- Keep the number identical to JOIN_MESSAGE_MAX in
-- frontend/src/lib/validation.js.
--
-- The message is trimmed before it's measured or stored, and an empty one
-- is stored as null, so "no message" has one representation.

alter table public.join_requests
  add column if not exists message text;

alter table public.join_requests
  drop constraint if exists join_requests_message_length_check;
alter table public.join_requests
  add constraint join_requests_message_length_check
  check (message is null or char_length(message) <= 300);

-- --- create_join_request -------------------------------------------------
-- The new parameter has a default, so a call with only the project id still
-- works. The one-argument version has to go first: with both present that
-- call would be ambiguous.
drop function if exists public.create_join_request(uuid);

-- Checks run in this order, and each refusal raises before the insert, so
-- it notifies no one:
--   own project → already on a team → already pending → full → deadline →
--   message too long.
create or replace function public.create_join_request(p_project_id uuid, p_message text default null)
returns public.join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_count int;
  v_deadline timestamptz;
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

  -- Counted from the roster, the same way respond_to_join_request() decides
  -- a team is full, rather than trusting projects.status alone.
  select count(*) into v_count
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
   where t.project_id = p_project_id;
  if v_project.status = 'full' or v_count >= v_project.team_size_target then
    raise exception 'This project is full and isn''t taking requests';
  end if;

  v_deadline := public.formation_deadline();
  if v_deadline is not null and now() >= v_deadline then
    raise exception 'The team formation deadline has passed, so new join requests are closed';
  end if;

  if char_length(v_message) > 300 then
    raise exception 'Your message can be at most 300 characters';
  end if;

  insert into public.join_requests (project_id, user_id, status, message)
  values (p_project_id, caller, 'pending', v_message)
  returning * into v_row;

  insert into public.notifications (user_id, kind, project_id, actor_id)
  values (v_project.creator_id, 'join_request', p_project_id, caller);

  return v_row;
end;
$$;

grant execute on function public.create_join_request(uuid, text) to authenticated;
