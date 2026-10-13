-- Leaving a team, part two (issue #35). Run after 19_admin_dashboard.sql.
--
-- 05_membership.sql already lets a student leave and reopens a full
-- project. This adds the rest of the issue:
--   * the project's creator gets a notification when someone leaves;
--   * leaving is blocked once the team formation deadline has passed;
--   * an admin can still take a student off after the deadline. Admins
--     can't be on teams (18_admin_access.sql), so an admin never leaves
--     for themselves.
--
-- The creator still can't leave — delete_team() is their equivalent.

-- Admins are users.is_admin, checked with private.is_admin()
-- (18_admin_access.sql, issue #36). This file adds no admin system of its own.

-- --- app_settings --------------------------------------------------------
-- One row of class-wide settings. formation_deadline is when rosters lock:
-- after it, students can't leave on their own. Null means no deadline set.
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

-- --- leave_team ----------------------------------------------------------
-- leave_team() takes the caller off their team. leave_team(p_user_id) is
-- the admin form: take that student off theirs. Builds on the version in
-- 15_release_filled_roles.sql. Dropped and recreated rather than replaced —
-- a second leave_team(uuid default null) alongside the old leave_team()
-- would make a no-argument call ambiguous, so this file must sort after
-- every file that (re)creates leave_team().
drop function if exists public.leave_team();

create or replace function public.leave_team(p_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_target uuid := coalesce(p_user_id, auth.uid());
  v_is_admin boolean;
  v_deadline timestamptz;
  v_membership public.team_members;
  v_team public.teams;
  v_project public.projects;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  v_is_admin := private.is_admin();

  if v_target <> caller and not v_is_admin then
    raise exception 'Only an admin can take someone else off a team';
  end if;

  select * into v_membership from public.team_members where user_id = v_target;
  if not found then
    if v_target = caller then
      raise exception 'You are not on a team';
    end if;
    raise exception 'That student is not on a team';
  end if;

  select * into v_team from public.teams where id = v_membership.team_id;
  select * into v_project from public.projects where id = v_team.project_id;

  if v_project.creator_id = v_target then
    if v_target = caller then
      raise exception 'You created this project, so you cannot leave it — delete the team instead';
    end if;
    raise exception 'The project creator cannot leave — delete the team instead';
  end if;

  select formation_deadline into v_deadline from public.app_settings;
  if v_deadline is not null and now() >= v_deadline and not v_is_admin then
    raise exception 'The team formation deadline has passed — ask an admin if you need to leave';
  end if;

  delete from public.team_members where user_id = v_target;

  -- From 15_release_filled_roles.sql: their seat is open again.
  perform public.restore_project_role(v_project.id, v_membership.role_id);

  perform public.sync_project_fill_state(v_project.id);

  insert into public.notifications (user_id, kind, project_id, actor_id, by_admin)
  values (v_project.creator_id, 'member_left', v_project.id, v_target, v_target <> caller);
end;
$$;

grant execute on function public.leave_team(uuid) to authenticated;
