-- An admin places, moves or removes students (issue #39). Run after
-- 26_milestones.sql.
--
--   * admin_assign_student(): put an unplaced student on a team with an
--     open seat, in a chosen role.
--   * admin_move_student(): take a student off their team and put them on
--     another, in one transaction, so both rosters settle together.
--   * remove_member() keeps doing removals (22_remove_member_rules.sql); an
--     admin calling it now leaves an audit row too.
--
-- All three work after the formation deadline — the deadline only binds
-- students (20_, 22_, 26_). The student and the project owners affected
-- are notified, and every change lands in public.admin_actions with who
-- made it and when.
--
-- Lock order matches respond_to_join_request() (21_): the student's users
-- row, then project rows. A move locks both projects in id order, so two
-- moves in opposite directions can't deadlock.
begin;

-- --- notifications -------------------------------------------------------
-- Two more kinds, both by_admin:
--   'member_assigned' — to the student; project_id is the team they were
--                       put on, actor_id the admin.
--   'member_added'    — to that project's owner; actor_id is the student,
--                       which is how the app names them.
-- A move also sends the old owner the existing 'member_left' (by_admin).
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('join_request', 'member_added', 'member_assigned', 'member_left',
                  'member_removed', 'request_accepted', 'request_declined'));

-- --- admin_actions -------------------------------------------------------
-- The audit trail. Project titles are copied in so the history still reads
-- after a project is deleted; the ids go null then. No write policies:
-- only the SECURITY DEFINER functions below insert rows.
create table public.admin_actions (
  id                 uuid primary key default gen_random_uuid(),
  admin_id           uuid references public.users(id) on delete set null,
  action             text not null check (action in ('assign', 'move', 'remove')),
  student_id         uuid references public.users(id) on delete set null,
  from_project_id    uuid references public.projects(id) on delete set null,
  from_project_title text,
  to_project_id      uuid references public.projects(id) on delete set null,
  to_project_title   text,
  role_id            uuid references public.roles(id) on delete set null,
  -- The moment of the change, not the start of its transaction.
  created_at         timestamptz not null default clock_timestamp()
);
create index admin_actions_created_at_idx on public.admin_actions(created_at desc);

alter table public.admin_actions enable row level security;

create policy "admin_actions_select_admin"
  on public.admin_actions for select
  to authenticated
  using (private.is_admin());

-- --- unseat / seat -------------------------------------------------------
-- private.unseat() is the seat-giving-up half of remove_from_team()
-- (22_remove_member_rules.sql) without its notifications, so a move can
-- send its own. remove_from_team() is redefined on top of it below, with
-- the same behaviour as before.
create or replace function private.unseat(p_user_id uuid)
returns public.team_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.team_members;
  v_project_id uuid;
begin
  delete from public.team_members where user_id = p_user_id
    returning * into v_membership;
  if not found then
    raise exception 'That student is not on a team';
  end if;

  select project_id into v_project_id from public.teams where id = v_membership.team_id;
  perform public.restore_project_role(v_project_id, v_membership.role_id);
  perform public.sync_project_fill_state(v_project_id);
  return v_membership;
end;
$$;

-- Seats a student the way an accepted request does (21_): the membership,
-- the role's seat taken, the project filled once it reaches its target,
-- and every request the student still has out declined. The caller has
-- already checked there's room and the student is free.
create or replace function private.seat(p_user_id uuid, p_team_id uuid, p_role_id uuid)
returns public.team_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.team_members;
  v_project_id uuid;
begin
  select project_id into v_project_id from public.teams where id = p_team_id;

  insert into public.team_members (user_id, team_id, role_id)
  values (p_user_id, p_team_id, p_role_id)
  returning * into v_membership;

  perform public.release_project_role(v_project_id, p_role_id);
  perform public.sync_project_fill_state(v_project_id);

  update public.join_requests
     set status = 'declined'
   where user_id = p_user_id and status = 'pending';

  return v_membership;
end;
$$;

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
  v_membership := private.unseat(p_user_id);

  select p.* into v_project
    from public.projects p
    join public.teams t on t.project_id = p.id
    where t.id = v_membership.team_id;

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

revoke all on function private.unseat(uuid), private.seat(uuid, uuid, uuid),
  private.remove_from_team(uuid, boolean)
from public, anon, authenticated;

-- --- shared checks -------------------------------------------------------
-- Locks the student's users row and refuses anyone who isn't a student.
create or replace function private.lock_student(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.users where id = p_user_id and not is_admin for no key update;
  if not found then
    raise exception 'Student not found';
  end if;
end;
$$;

-- The project behind a team, which must have a seat free. The caller has
-- already locked the project row.
create or replace function private.open_team_project(p_team_id uuid)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects;
begin
  select p.* into v_project
    from public.teams t join public.projects p on p.id = t.project_id
   where t.id = p_team_id;
  if not found then
    raise exception 'Team not found';
  end if;
  if (select count(*) from public.team_members where team_id = p_team_id) >= v_project.team_size_target then
    raise exception 'This team is already full';
  end if;
  return v_project;
end;
$$;

revoke all on function private.lock_student(uuid), private.open_team_project(uuid)
from public, anon, authenticated;

-- --- admin_assign_student ------------------------------------------------
create or replace function public.admin_assign_student(p_user_id uuid, p_team_id uuid, p_role_id uuid)
returns public.team_members
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_membership public.team_members;
begin
  perform public.require_admin();

  if p_role_id is null or not exists (select 1 from public.roles where id = p_role_id) then
    raise exception 'Pick a role';
  end if;

  perform private.lock_student(p_user_id);

  perform 1 from public.projects p join public.teams t on t.project_id = p.id
   where t.id = p_team_id for no key update of p;
  v_project := private.open_team_project(p_team_id);

  if exists (select 1 from public.team_members where user_id = p_user_id) then
    raise exception 'That student is already on a team — move them instead';
  end if;

  v_membership := private.seat(p_user_id, p_team_id, p_role_id);

  insert into public.notifications (user_id, kind, project_id, actor_id, by_admin)
  values (p_user_id, 'member_assigned', v_project.id, caller, true),
         (v_project.creator_id, 'member_added', v_project.id, p_user_id, true);

  insert into public.admin_actions (admin_id, action, student_id, to_project_id, to_project_title, role_id)
  values (caller, 'assign', p_user_id, v_project.id, v_project.title, p_role_id);

  return v_membership;
end;
$$;

-- --- admin_move_student --------------------------------------------------
-- A project's creator can't be moved: their project would be left without
-- them (05_membership.sql), and only they can delete it.
create or replace function public.admin_move_student(p_user_id uuid, p_team_id uuid, p_role_id uuid)
returns public.team_members
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_from_team uuid;
  v_from public.projects;
  v_to public.projects;
  v_membership public.team_members;
begin
  perform public.require_admin();

  if p_role_id is null or not exists (select 1 from public.roles where id = p_role_id) then
    raise exception 'Pick a role';
  end if;

  perform private.lock_student(p_user_id);

  -- The student's row is locked, so their membership can't change under us.
  select team_id into v_from_team from public.team_members where user_id = p_user_id;
  if not found then
    raise exception 'That student is not on a team — assign them instead';
  end if;
  if v_from_team = p_team_id then
    raise exception 'That student is already on this team';
  end if;

  perform 1 from public.projects p join public.teams t on t.project_id = p.id
   where t.id in (v_from_team, p_team_id)
   order by p.id
   for no key update of p;

  select p.* into v_from
    from public.teams t join public.projects p on p.id = t.project_id
   where t.id = v_from_team;
  if v_from.creator_id = p_user_id then
    raise exception 'A project''s creator can''t be moved off their own project';
  end if;

  v_to := private.open_team_project(p_team_id);

  perform private.unseat(p_user_id);
  v_membership := private.seat(p_user_id, p_team_id, p_role_id);

  insert into public.notifications (user_id, kind, project_id, actor_id, by_admin)
  values (v_from.creator_id, 'member_left', v_from.id, p_user_id, true),
         (p_user_id, 'member_assigned', v_to.id, caller, true),
         (v_to.creator_id, 'member_added', v_to.id, p_user_id, true);

  insert into public.admin_actions
    (admin_id, action, student_id, from_project_id, from_project_title, to_project_id, to_project_title, role_id)
  values (caller, 'move', p_user_id, v_from.id, v_from.title, v_to.id, v_to.title, p_role_id);

  return v_membership;
end;
$$;

-- --- remove_member -------------------------------------------------------
-- Same as 22_remove_member_rules.sql, plus the audit row when an admin
-- does it (marked NEW).
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
  v_role_id uuid;
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

  -- NEW: the role they held, for the audit row, before the seat is gone.
  select role_id into v_role_id from public.team_members where user_id = p_user_id;

  perform private.remove_from_team(p_user_id, v_admin);

  -- NEW
  if v_admin then
    insert into public.admin_actions (admin_id, action, student_id, from_project_id, from_project_title, role_id)
    values (caller, 'remove', p_user_id, v_project.id, v_project.title, v_role_id);
  end if;
end;
$$;

grant execute on function public.remove_member(uuid) to authenticated;

-- --- admin_recent_actions ------------------------------------------------
-- The latest admin changes, newest first, with names filled in for the
-- dashboard.
create or replace function public.admin_recent_actions(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc, x.id)
      from (
        select a.id, a.action, a.created_at,
               a.admin_id, admin.name as admin_name,
               a.student_id, student.name as student_name,
               a.from_project_title, a.to_project_title,
               r.name as role_name
          from public.admin_actions a
          left join public.users admin on admin.id = a.admin_id
          left join public.users student on student.id = a.student_id
          left join public.roles r on r.id = a.role_id
         order by a.created_at desc, a.id
         limit greatest(1, least(coalesce(p_limit, 20), 100))
      ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_assign_student(uuid, uuid, uuid),
  public.admin_move_student(uuid, uuid, uuid), public.admin_recent_actions(integer)
from public, anon;
grant execute on function public.admin_assign_student(uuid, uuid, uuid),
  public.admin_move_student(uuid, uuid, uuid), public.admin_recent_actions(integer)
to authenticated;

commit;
