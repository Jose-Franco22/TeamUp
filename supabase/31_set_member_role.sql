-- The project's creator can change a teammate's role from the Team page.
-- Run after 29_announcements.sql.
--
-- Moving someone from role A to role B gives back A's seat and takes one of
-- B's, the same bookkeeping remove_member() and respond_to_join_request() do
-- (restore_project_role / release_project_role, 15_release_filled_roles.sql),
-- so the project's "roles needed" stays honest. The creator may change their
-- own role too. No notification, and no formation-deadline lock: the roster
-- itself doesn't change.

create or replace function public.set_member_role(p_user_id uuid, p_role_id uuid)
returns public.team_members
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_membership public.team_members;
  v_project public.projects;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  if p_role_id is null or not exists (select 1 from public.roles where id = p_role_id) then
    raise exception 'Pick a role';
  end if;

  select * into v_membership from public.team_members where user_id = p_user_id for update;
  if not found then
    raise exception 'That student is not on a team';
  end if;

  select p.* into v_project
    from public.projects p
    join public.teams t on t.project_id = p.id
   where t.id = v_membership.team_id
     for no key update of p;

  if v_project.creator_id <> caller then
    raise exception 'Only the project creator can change roles';
  end if;

  if v_membership.role_id is not distinct from p_role_id then
    return v_membership;
  end if;

  if v_membership.role_id is not null then
    perform public.restore_project_role(v_project.id, v_membership.role_id);
  end if;
  perform public.release_project_role(v_project.id, p_role_id);

  update public.team_members
     set role_id = p_role_id
   where user_id = p_user_id
  returning * into v_membership;

  return v_membership;
end;
$$;

grant execute on function public.set_member_role(uuid, uuid) to authenticated;
