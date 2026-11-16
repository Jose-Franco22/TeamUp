-- The project's creator can change a teammate's role from the Team page.
-- Run after 30_notification_bell.sql.
--
-- A role change never changes how many seats are open, because the roster
-- doesn't change. Moving someone from role A to role B gives back A's seat
-- and takes one of B's (restore_project_role / release_project_role,
-- 15_release_filled_roles.sql) only when both are possible: A is a role the
-- project lists, and B still has a seat open. Otherwise neither count moves.
-- Doing one without the other would leave a full team advertising a seat it
-- doesn't have, or an open team short of one.
--
-- The creator may change their own role too. No notification, and no
-- formation-deadline lock: the roster itself doesn't change.
--
-- Locks the project before the membership row, the same order as
-- remove_member(), so the two can't deadlock on the same student.

create or replace function public.set_member_role(p_user_id uuid, p_role_id uuid)
returns public.team_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  v_team_id uuid;
  v_membership public.team_members;
  v_project public.projects;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  if p_role_id is null or not exists (select 1 from public.roles where id = p_role_id) then
    raise exception 'Pick a role';
  end if;

  select team_id into v_team_id from public.team_members where user_id = p_user_id;
  if not found then
    raise exception 'That student is not on a team';
  end if;

  select p.* into v_project
    from public.projects p
    join public.teams t on t.project_id = p.id
   where t.id = v_team_id
     for no key update of p;

  if v_project.creator_id is distinct from caller then
    raise exception 'Only the project creator can change roles';
  end if;

  -- Now that the project is locked, the student can't be removed or moved
  -- under us; check they're still on this team.
  select * into v_membership
    from public.team_members
   where user_id = p_user_id and team_id = v_team_id
     for update;
  if not found then
    raise exception 'That student is not on a team';
  end if;

  if v_membership.role_id is not distinct from p_role_id then
    return v_membership;
  end if;

  if v_membership.role_id is not null
     and exists (
       select 1 from public.project_roles_needed
        where project_id = v_project.id and role_id = v_membership.role_id
     )
     and exists (
       select 1 from public.project_roles_needed
        where project_id = v_project.id and role_id = p_role_id and quantity_needed > 0
     ) then
    perform public.restore_project_role(v_project.id, v_membership.role_id);
    perform public.release_project_role(v_project.id, p_role_id);
  end if;

  update public.team_members
     set role_id = p_role_id
   where user_id = p_user_id
  returning * into v_membership;

  return v_membership;
end;
$$;

grant execute on function public.set_member_role(uuid, uuid) to authenticated;
