-- Leaving a team, part two (issue #35). Run after 19_admin_dashboard.sql.
--
-- 05_membership.sql already lets a student leave and reopens a full
-- project. This adds the rest of the issue:
--   * the project's creator gets a notification when someone leaves;
--   * leaving is blocked once the team formation deadline has passed;
--   * private.remove_from_team(), the one place a seat is given up. An
--     admin taking a student off is #39's function, which calls it with
--     p_by_admin => true. Admins can't be on teams (18_admin_access.sql),
--     so whoever calls leave_team() is a student.
--
-- The creator still can't leave — delete_team() is their equivalent.

-- Admins are users.is_admin, checked with private.is_admin()
-- (18_admin_access.sql, issue #36). This file adds no admin system of its own.

-- --- app_settings --------------------------------------------------------
-- One row of class-wide settings. formation_deadline is when rosters lock:
-- after it, students can't leave on their own. Null means no deadline set.
-- Read it through public.formation_deadline() below, not this table: #38
-- moves the date to a milestones table and only that function changes.
--
--   update public.app_settings set formation_deadline = '2026-11-01 23:59 America/Chicago';
create table public.app_settings (
  id                 boolean primary key default true check (id),
  formation_deadline timestamptz
);

insert into public.app_settings (id) values (true);

alter table public.app_settings enable row level security;

-- Everyone can read it so the app can say when rosters lock.
create policy "app_settings_select_all"
  on public.app_settings for select
  to anon, authenticated
  using (true);

create policy "app_settings_update_admin"
  on public.app_settings for update
  to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- --- notifications -------------------------------------------------------
-- Written only by SECURITY DEFINER functions (no INSERT policy). This is
-- the shared notifications table: other stories (#20, #26, #34, #39) add
-- their own kinds. user_id is who receives it; actor_id is who caused it
-- (for 'member_left', the student who left). The page a notification opens
-- is worked out from kind + project_id in the app, not stored. Today the
-- only kind is 'member_left'. by_admin is true when an admin took the
-- student off rather than the student leaving themselves.
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  kind       text not null check (kind in ('member_left')),
  project_id uuid references public.projects(id) on delete cascade,
  actor_id   uuid references public.users(id) on delete set null,
  by_admin   boolean not null default false,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index notifications_user_id_idx on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;

create policy "notifications_select_own"
  on public.notifications for select
  to authenticated
  using (auth.uid() = user_id);

-- Marking read goes through a function instead of an UPDATE policy, so a
-- student can't rewrite what a notification says.
create or replace function public.mark_notifications_read(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.notifications
    set read_at = coalesce(read_at, now())
    where user_id = auth.uid() and id = any(p_ids);
end;
$$;

grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- --- formation_deadline -------------------------------------------------
-- The one way to read the formation deadline, for SQL and the app alike
-- (supabase.rpc('formation_deadline')). Null means no deadline. #38 will
-- rewrite this body to read its milestones table and drop app_settings;
-- callers don't change.
create or replace function public.formation_deadline()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select formation_deadline from public.app_settings;
$$;

grant execute on function public.formation_deadline() to anon, authenticated;

-- --- remove_from_team ----------------------------------------------------
-- Takes p_user_id off their team and reopens their seat: deletes the
-- membership, restores the role they held (15_release_filled_roles.sql),
-- resyncs the project's fill state and tells the creator. leave_team()
-- calls it for the caller; #39's admin removal calls it with
-- p_by_admin => true, which the creator's notification records.
--
-- Who may remove whom, the creator rule and the deadline are the caller's
-- job — this only does the removal. Not callable from the API.
create or replace function private.remove_from_team(p_user_id uuid, p_by_admin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
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

  insert into public.notifications (user_id, kind, project_id, actor_id, by_admin)
  values (v_project.creator_id, 'member_left', v_project.id, p_user_id, p_by_admin);
end;
$$;

revoke all on function private.remove_from_team(uuid, boolean) from public, anon, authenticated;

-- --- leave_team ----------------------------------------------------------
-- The caller leaves their own team. Builds on the version in
-- 15_release_filled_roles.sql. An earlier version of this file added an
-- admin form, leave_team(p_user_id uuid default null); drop it so a
-- database that ran that version doesn't keep it (and so a no-argument
-- call isn't ambiguous). This file must sort after every file that
-- (re)creates leave_team().
drop function if exists public.leave_team(uuid);

create or replace function public.leave_team()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_deadline timestamptz;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  if not exists (select 1 from public.team_members where user_id = caller) then
    raise exception 'You are not on a team';
  end if;

  if exists (
    select 1
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
      join public.projects p on p.id = t.project_id
      where tm.user_id = caller and p.creator_id = caller
  ) then
    raise exception 'You created this project, so you cannot leave it — delete the team instead';
  end if;

  v_deadline := public.formation_deadline();
  if v_deadline is not null and now() >= v_deadline then
    raise exception 'The team formation deadline has passed — ask an admin if you need to leave';
  end if;

  perform private.remove_from_team(caller, false);
end;
$$;

grant execute on function public.leave_team() to authenticated;
