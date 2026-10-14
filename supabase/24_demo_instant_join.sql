-- DEMO ONLY: join a team in one click, no creator approval. Run after
-- 23_join_request_notifications.sql, on the demo database only.
--
-- join_project() does in one transaction what create_join_request() followed
-- by the creator's respond_to_join_request(..., 'accepted', ...) would do,
-- so the tables end up exactly as they would after a real accept:
--
--   * a join_requests row, written straight in as 'accepted'
--   * the team_members row, seated in the project's first still-open role
--   * that role released (release_project_role, 15_release_filled_roles.sql)
--   * the project marked 'full' and the team formed once it reaches size
--   * any other pending requests the student had out declined
--
-- No notification is sent: there's nothing for the creator to act on, and a
-- 'join_request' notification would point them at an empty Requests page.
-- create_join_request() and respond_to_join_request() are left as they are.

create or replace function public.join_project(p_project_id uuid)
returns public.join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_team public.teams;
  v_role_id uuid;
  v_count int;
  v_row public.join_requests;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  -- Same lock order as respond_to_join_request(): requester, then project.
  perform 1 from public.users where id = caller for no key update;

  select * into v_project from public.projects where id = p_project_id for no key update;
  if not found then
    raise exception 'Project not found';
  end if;

  if v_project.creator_id = caller then
    raise exception 'You cannot join your own project';
  end if;

  if exists (select 1 from public.team_members where user_id = caller) then
    raise exception 'You are already on a team and cannot join another project';
  end if;

  select * into v_team from public.teams where project_id = v_project.id;
  select count(*) into v_count from public.team_members where team_id = v_team.id;
  if v_count >= v_project.team_size_target then
    raise exception 'This team is already full';
  end if;

  -- The first role the project is still recruiting for; failing that, any
  -- role it lists; failing that, any role at all, so the join never stalls.
  select prn.role_id into v_role_id
    from public.project_roles_needed prn
    join public.roles r on r.id = prn.role_id
   where prn.project_id = v_project.id
   order by (prn.quantity_needed > 0) desc, r.sort_order, r.name
   limit 1;
  if v_role_id is null then
    select id into v_role_id from public.roles order by sort_order, name limit 1;
  end if;
  if v_role_id is null then
    raise exception 'No roles are set up yet';
  end if;

  insert into public.join_requests (project_id, user_id, status)
  values (v_project.id, caller, 'accepted')
  returning * into v_row;

  insert into public.team_members (user_id, team_id, role_id)
  values (caller, v_team.id, v_role_id);

  perform public.release_project_role(v_project.id, v_role_id);

  if v_count + 1 >= v_project.team_size_target then
    update public.projects set status = 'full' where id = v_project.id;
    update public.teams set formed_at = coalesce(formed_at, now()) where id = v_team.id;
  end if;

  update public.join_requests
     set status = 'declined'
   where user_id = caller
     and status = 'pending';

  return v_row;
end;
$$;

grant execute on function public.join_project(uuid) to authenticated;
