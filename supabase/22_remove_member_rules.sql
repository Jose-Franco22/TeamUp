-- Removing a member from a team (issue #29). Run after 21_join_request_responses.sql.
--
-- 05_membership.sql / 15_release_filled_roles.sql already let a project's
-- creator take someone else off their roster and reopen the seat. This adds
-- the rest of the issue:
--   * the removed student gets a notification ('member_removed');
--   * removing is blocked once the team formation deadline has passed,
--     unless an admin does it. An admin can remove any student but the
--     creator, at any time — the creator is notified when that happens;
--   * remove_member() now goes through private.remove_from_team()
--     (20_leave_team_rules.sql), the one place a seat is given up.
--
-- Removing frees the student straight away: team_members.user_id is the
-- only thing that stops a student requesting or creating a project, and the
-- row is gone.

-- --- notifications -------------------------------------------------------
-- One more kind. For 'member_removed', user_id is the student taken off,
-- actor_id is whoever did it, and by_admin says whether that was an admin.
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('member_left', 'member_removed', 'request_accepted', 'request_declined'));

-- --- remove_from_team ----------------------------------------------------
-- Same job and signature as in 20_leave_team_rules.sql; what's new is who
-- hears about it, which depends on who called:
--   * the student themselves (leave_team): the creator gets 'member_left';
--   * the creator (remove_member): the student gets 'member_removed' —
--     the creator did it, so they aren't told;
--   * an admin (remove_member, p_by_admin): the student gets
--     'member_removed' and the creator gets 'member_left', both by_admin.
-- Who may remove whom and the deadline are still the caller's job.
create or replace function private.remove_from_team(p_user_id uuid, p_by_admin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_membership public.team_members;
  v_project public.projects;
begin
  delete from public.team_members where user_id = p_user_id
    returning * into v_membership;
  if not found then
    raise exception 'That student is not on a team';
  end if;

  select p.* into v_project
    from public.projects p
    join public.teams t on t.project_id = p.id
    where t.id = v_membership.team_id;

  perform public.restore_project_role(v_project.id, v_membership.role_id);
  perform public.sync_project_fill_state(v_project.id);

  if caller is distinct from p_user_id then
    insert into public.notifications (user_id, kind, project_id, actor_id, by_admin)
    values (p_user_id, 'member_removed', v_project.id, caller, p_by_admin);
  end if;

  if caller is not distinct from p_user_id or p_by_admin then
    insert into public.notifications (user_id, kind, project_id, actor_id, by_admin)
    values (v_project.creator_id, 'member_left', v_project.id, p_user_id, p_by_admin);
  end if;
end;
$$;

revoke all on function private.remove_from_team(uuid, boolean) from public, anon, authenticated;

-- --- remove_member -------------------------------------------------------
-- The creator takes someone else off their team, or an admin takes any
-- student but the creator off theirs. Supersedes the version in
-- 15_release_filled_roles.sql (same signature, so the frontend call
-- doesn't change).
--
-- The project row is locked before anything is checked, so a removal can't
-- interleave with an accept or another removal on the same team.
create or replace function public.remove_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_admin boolean := private.is_admin();
  v_project public.projects;
  v_deadline timestamptz;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  if p_user_id = caller then
    raise exception 'You cannot remove yourself — delete the team instead';
  end if;

  select p.* into v_project
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    join public.projects p on p.id = t.project_id
    where tm.user_id = p_user_id
    for no key update of p;
  if not found then
    raise exception 'That student is not on a team';
  end if;

  if v_project.creator_id <> caller and not v_admin then
    raise exception 'Only the project creator can remove a member';
  end if;

  if p_user_id = v_project.creator_id then
    raise exception 'The project creator cannot be removed — delete the team instead';
  end if;

  v_deadline := public.formation_deadline();
  if not v_admin and v_deadline is not null and now() >= v_deadline then
    raise exception 'The team formation deadline has passed — ask an admin to remove them';
  end if;

  perform private.remove_from_team(p_user_id, v_admin);
end;
$$;

grant execute on function public.remove_member(uuid) to authenticated;
