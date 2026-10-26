-- Reviewing a requester before deciding (issue #27). Run after
-- 23_join_request_notifications.sql.
--
-- A request can now carry a short message from the student to the
-- project's creator. It's optional: '' means they didn't write one, which
-- is what every request made before this file has.
--
-- Nothing changes about who can read it. join_requests_select_own_or_incoming
-- (02_rls_policies.sql) already shows a request to its sender and to the
-- project's creator only, and the requester's profile (users, user_skills)
-- is readable by any signed-in user — so the creator's Requests page gets
-- the message, skills, availability and GitHub link in the one select it
-- already makes.

alter table public.join_requests
  add column message text not null default '';

alter table public.join_requests
  add constraint join_requests_message_length_check
  check (char_length(message) <= 500);

-- --- create_join_request -------------------------------------------------
-- Same checks and notification as 23_join_request_notifications.sql, plus
-- p_message. The old one-argument version is dropped rather than left as an
-- overload: with p_message defaulted, a call with only the project id
-- would otherwise match both.
drop function if exists public.create_join_request(uuid);

create or replace function public.create_join_request(p_project_id uuid, p_message text default '')
returns public.join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_message text := btrim(coalesce(p_message, ''));
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

  if exists (select 1 from public.team_members where user_id = caller) then
    raise exception 'You are already on a team and cannot request to join another project';
  end if;

  if exists (
    select 1 from public.join_requests
    where project_id = p_project_id and user_id = caller and status = 'pending'
  ) then
    raise exception 'You already have a pending request for this project';
  end if;

  if char_length(v_message) > 500 then
    raise exception 'Keep your message to 500 characters or fewer';
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
