-- Membership changes: a student leaving their team, or a project creator
-- removing someone else. Run after 04_roles_and_team_deletion.sql. Both
-- free a seat and reopen the project if it had filled — the exact inverse
-- of what respond_to_join_request does on accept.
--
-- Design choice: leaving is immediate and unilateral, not owner-approved.
-- The person who wants to leave is usually on a team whose owner has
-- stopped responding, so an approval gate fails in exactly the case it
-- exists for, while adding friction to amicable departures that don't need
-- one. It would also hand one student unilateral control over another
-- student's semester, enforced by the database. See TODO-backend.md's "Why
-- leaving is not owner-approved" for the full reasoning.
--
-- Neither function has a direct table policy backing it — like
-- create_project/update_project/delete_team, both are SECURITY DEFINER and
-- do their own authorization, so no UPDATE/DELETE policy on team_members or
-- projects is needed for this.

-- Helper both leave_team and remove_member call: recomputes
-- projects.status/teams.formed_at from the current roster. Mirrors the
-- comparison respond_to_join_request makes when an accept fills a team,
-- just run after a seat frees up instead of after one fills.
create or replace function public.sync_project_fill_state(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects;
  v_team public.teams;
  v_count int;
  v_full boolean;
begin
  select * into v_project from public.projects where id = p_project_id;
  select * into v_team from public.teams where project_id = p_project_id;
  select count(*) into v_count from public.team_members where team_id = v_team.id;
  v_full := v_count >= v_project.team_size_target;
  update public.projects set status = case when v_full then 'full' else 'open' end where id = p_project_id;
  update public.teams
    set formed_at = case when v_full then coalesce(formed_at, now()) else null end
    where id = v_team.id;
end;
$$;

-- The caller removes themselves from whatever team they're on. Refused for
-- a project's creator — projects.creator_id points at them, and a project
-- with no creator isn't a state this schema allows; delete_team() is their
-- equivalent.
create or replace function public.leave_team()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_membership public.team_members;
  v_team public.teams;
  v_project public.projects;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select * into v_membership from public.team_members where user_id = caller;
  if not found then
    raise exception 'You are not on a team';
  end if;

  select * into v_team from public.teams where id = v_membership.team_id;
  select * into v_project from public.projects where id = v_team.project_id;

  if v_project.creator_id = caller then
    raise exception 'You created this project, so you cannot leave it — delete the team instead';
  end if;

  delete from public.team_members where user_id = caller;
  perform public.sync_project_fill_state(v_project.id);
end;
$$;

grant execute on function public.leave_team() to authenticated;

-- The project's creator removes someone else from the roster. Refused for
-- the creator removing themselves — the owner is always on their own team,
-- so "leave" and "remove" cover disjoint cases with no rule about who
-- outranks whom needed.
create or replace function public.remove_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_membership public.team_members;
  v_team public.teams;
  v_project public.projects;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  if p_user_id = caller then
    raise exception 'You cannot remove yourself — delete the team instead';
  end if;

  select * into v_membership from public.team_members where user_id = p_user_id;
  if not found then
    raise exception 'That student is not on a team';
  end if;

  select * into v_team from public.teams where id = v_membership.team_id;
  select * into v_project from public.projects where id = v_team.project_id;

  if v_project.creator_id <> caller then
    raise exception 'Only the team owner can remove a member';
  end if;

  delete from public.team_members where user_id = p_user_id;
  perform public.sync_project_fill_state(v_project.id);
end;
$$;

grant execute on function public.remove_member(uuid) to authenticated;
