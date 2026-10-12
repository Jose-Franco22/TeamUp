-- Keep project_roles_needed honest about what is still open.
--
-- Until now it recorded the open seats as they were when the creator last
-- saved the project, and nothing ever touched it again. Accepting a request
-- seated the student in team_members but left the role listed as needed, so
-- Browse kept advertising a Frontend Developer slot that was already filled,
-- and the matching engine kept scoring students against it.
--
-- Run after 14_validate_profile_rules.sql.
--
-- Two design choices worth stating, because the obvious implementations are
-- both worse:
--
--   * The count is decremented rather than derived. Deriving it (quantity
--     minus the members holding that role) would be self-correcting, but
--     update_project lets a creator rewrite quantity_needed afterwards, and
--     "I need 2 more" and "I need 2 in total" would then mean different
--     things depending on when it was saved. Decrementing keeps one meaning:
--     what is still open, right now.
--
--   * A row at zero is kept rather than deleted. Deleting it would throw
--     away skill_id, so a member leaving could only restore the role without
--     the skill that was pinned to it, quietly degrading the project. The
--     check constraint is relaxed to allow zero and readers filter on
--     quantity_needed > 0 instead.
--
-- Not a trigger on team_members on purpose: create_project seats the creator
-- in their own role, and the creator's seat is already excluded from the
-- counts the form collects. A trigger would decrement for them too.

-- --- Step 1: a role may sit at zero -------------------------------------
--
-- The new bound is `between 0 and 3`, not `>= 0`: the live rule from
-- 04_roles_and_team_deletion.sql is `between 1 and 3`, and only the lower
-- end is being relaxed. Dropping the upper end would let a creator ask for
-- four people in one role.
--
-- Constraints are found by definition rather than by name, since the live
-- project and the test harness named theirs differently (`between 1 and 3`
-- and `> 0`). Every match is dropped, not just the first: if both ever
-- existed on the same table, leaving one behind would silently keep zero
-- forbidden and the release below would fail at runtime.
do $$
declare
  check_name text;
begin
  for check_name in
    select conname
    from pg_constraint
    where conrelid = 'public.project_roles_needed'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%quantity_needed%'
  loop
    execute format('alter table public.project_roles_needed drop constraint %I', check_name);
  end loop;
end $$;

alter table public.project_roles_needed
  add constraint project_roles_needed_quantity_needed_check
  check (quantity_needed between 0 and 3);

-- --- Step 2: the two helpers --------------------------------------------
-- Internal. Called only from the SECURITY DEFINER functions below, which
-- have already decided the caller is allowed to do this, so execute is
-- revoked from the API roles rather than granted.

create or replace function public.release_project_role(p_project_id uuid, p_role_id uuid)
returns void
language sql
set search_path = public
as $$
  update public.project_roles_needed
     set quantity_needed = quantity_needed - 1
   where project_id = p_project_id
     and role_id = p_role_id
     and quantity_needed > 0;
$$;

-- Only ever restores a role the project already lists. A member seated in a
-- role that was never recruited for — the creator's own, or one added by
-- hand — leaves nothing to put back, and inventing a row here would list a
-- role with no skill attached that the creator never asked for.
create or replace function public.restore_project_role(p_project_id uuid, p_role_id uuid)
returns void
language sql
set search_path = public
as $$
  update public.project_roles_needed
     set quantity_needed = quantity_needed + 1
   where project_id = p_project_id
     and role_id = p_role_id;
$$;

revoke execute on function public.release_project_role(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.restore_project_role(uuid, uuid) from public, anon, authenticated;

-- --- Step 3: accepting a request fills the role --------------------------
-- Identical to 04_roles_and_team_deletion.sql except for the release call,
-- marked below.

create or replace function public.respond_to_join_request(
  p_request_id uuid,
  p_status text,
  p_role_id uuid default null
)
returns public.join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_request public.join_requests;
  v_project public.projects;
  v_team public.teams;
  v_count int;
begin
  if p_status not in ('accepted', 'declined') then
    raise exception 'status must be accepted or declined';
  end if;

  if p_status = 'accepted' and p_role_id is null then
    raise exception 'A role is required to accept a request';
  end if;

  select * into v_request from public.join_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;

  select * into v_project from public.projects where id = v_request.project_id;

  if v_project.creator_id <> caller then
    raise exception 'Only the project creator can respond to this request';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request has already been responded to';
  end if;

  if p_status = 'accepted' and exists (select 1 from public.team_members where user_id = v_request.user_id) then
    raise exception 'That student has already joined a team';
  end if;

  update public.join_requests set status = p_status where id = p_request_id;

  if p_status = 'accepted' then
    select * into v_team from public.teams where project_id = v_request.project_id for update;

    insert into public.team_members (user_id, team_id, role_id)
    values (v_request.user_id, v_team.id, p_role_id);

    -- NEW: the seat they just took is no longer open.
    perform public.release_project_role(v_project.id, p_role_id);

    select count(*) into v_count from public.team_members where team_id = v_team.id;

    if v_count >= v_project.team_size_target then
      update public.projects set status = 'full' where id = v_project.id;
      update public.teams set formed_at = now() where id = v_team.id;
    end if;

    -- Accepting this request means every other pending request this user
    -- has out is no longer actionable — cascade-decline them now.
    update public.join_requests
      set status = 'declined'
      where user_id = v_request.user_id
        and status = 'pending'
        and id <> p_request_id;
  end if;

  select * into v_request from public.join_requests where id = p_request_id;
  return v_request;
end;
$$;

grant execute on function public.respond_to_join_request(uuid, text, uuid) to authenticated;

-- --- Step 4: leaving or being removed reopens the role -------------------
-- Both are identical to 05_membership.sql except for the restore call. The
-- membership row is read before it is deleted, because that is where the
-- role_id lives.

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

  -- NEW: their seat is open again.
  perform public.restore_project_role(v_project.id, v_membership.role_id);

  perform public.sync_project_fill_state(v_project.id);
end;
$$;

grant execute on function public.leave_team() to authenticated;

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

  -- NEW: their seat is open again.
  perform public.restore_project_role(v_project.id, v_membership.role_id);

  perform public.sync_project_fill_state(v_project.id);
end;
$$;

grant execute on function public.remove_member(uuid) to authenticated;

-- --- Step 5: backfill ----------------------------------------------------
--
-- Projects that already have accepted members may still be advertising
-- those seats. Bring them in line once.
--
-- Only projects that are actually over-subscribed are touched. A member who
-- had already joined when the creator last ran update_project() was already
-- excluded from quantity_needed by the form, so subtracting them again
-- would take the same seat away twice — and there is no join timestamp to
-- tell the two cases apart. "The listed roles add up to more than the seats
-- that exist" is the one signal that something is definitely wrong, so it
-- is the only case corrected here. Everything else is left alone, and
-- release/restore keep it right from now on.
--
-- This is a no-op on the current data, which has no joined members.

with seats as (
  select p.id as project_id,
         greatest(0, p.team_size_target - (
           select count(*) from public.team_members tm
             join public.teams t on t.id = tm.team_id
            where t.project_id = p.id
         )) as open_seats,
         coalesce((
           select sum(quantity_needed) from public.project_roles_needed
            where project_id = p.id
         ), 0) as listed
    from public.projects p
),
over_subscribed as (
  select project_id from seats where listed > open_seats
),
filled as (
  select t.project_id, tm.role_id, count(*)::smallint as taken
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    join public.projects p on p.id = t.project_id
   where tm.user_id <> p.creator_id
   group by t.project_id, tm.role_id
)
update public.project_roles_needed prn
   set quantity_needed = greatest(0, prn.quantity_needed - filled.taken)
  from filled
  join over_subscribed o on o.project_id = filled.project_id
 where prn.project_id = filled.project_id
   and prn.role_id = filled.role_id;
