-- Issue #36: database-controlled admin access. Run after 15_release_filled_roles.sql.
-- Existing accounts remain students. Promote an instructor only through the
-- SQL editor/service role after they have signed in; never through a browser.
begin;

alter table public.users add column is_admin boolean not null default false;

-- Keep policy helpers outside PostgREST's exposed public schema. Definer
-- helpers avoid recursive RLS when checking users or team_members themselves.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((select is_admin from public.users where id = auth.uid()), false);
$$;

create or replace function private.is_team_member(p_team_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.team_members
                 where team_id = p_team_id and user_id = auth.uid());
$$;

revoke all on function private.is_admin() from public, anon, authenticated;
revoke all on function private.is_team_member(uuid) from public, anon, authenticated;
grant execute on function private.is_admin(), private.is_team_member(uuid) to authenticated;

-- Own-row UPDATE policies alone do not stop someone changing their role.
-- Check the request role too: SECURITY DEFINER functions run as their owner
-- but must not accidentally let a browser caller promote themselves.
create or replace function private.protect_admin_flag()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.is_admin)
     or (tg_op = 'UPDATE' and new.is_admin is distinct from old.is_admin) then
    if current_setting('role', true) in ('anon', 'authenticated') then
      raise exception 'Admin access can only be changed by a database administrator'
        using errcode = '42501';
    end if;
    if new.is_admin and (
      exists (select 1 from public.team_members where user_id = new.id)
      or exists (select 1 from public.projects where creator_id = new.id)
      or exists (select 1 from public.join_requests where user_id = new.id and status = 'pending')
    ) then
      raise exception 'Remove student memberships, projects and pending requests before granting admin access'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_admin_flag before insert or update on public.users
for each row execute function private.protect_admin_flag();

-- Enforce student participation at the table boundary, including writes
-- made by existing SECURITY DEFINER RPCs that bypass RLS.
create or replace function private.require_student_participant()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  participant uuid;
begin
  if tg_table_name = 'projects' then
    participant := new.creator_id;
  else
    participant := new.user_id;
  end if;
  -- Serialize participation with changes to the account's admin flag.
  if (select is_admin from public.users where id = participant for update) then
    raise exception 'Admin accounts cannot create or join student teams'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger projects_require_student before insert or update of creator_id on public.projects
for each row execute function private.require_student_participant();
create trigger team_members_require_student before insert or update of user_id on public.team_members
for each row execute function private.require_student_participant();
create trigger join_requests_require_student before insert or update of user_id on public.join_requests
for each row execute function private.require_student_participant();

revoke all on function private.protect_admin_flag(), private.require_student_participant()
from public, anon, authenticated;

drop policy users_select_authenticated on public.users;
create policy users_select_students_or_admin on public.users for select to authenticated
using (not is_admin or id = auth.uid() or private.is_admin());

drop policy user_skills_select_authenticated on public.user_skills;
create policy user_skills_select_students_or_admin on public.user_skills for select to authenticated
using (exists (select 1 from public.users u where u.id = user_id));

-- Projects, role requirements and team existence remain public recruiting
-- information. Private roster rows are available to teammates and admins.
drop policy team_members_select_authenticated on public.team_members;
create policy team_members_select_team_or_admin on public.team_members for select to authenticated
using (private.is_admin() or private.is_team_member(team_id));

create policy join_requests_select_admin on public.join_requests for select to authenticated
using (private.is_admin());

-- Aggregate recruiting information keeps Browse counts/matching accurate
-- without granting seekers access to every team's raw membership rows.
create or replace function public.project_recruiting_stats(p_project_id uuid)
returns table (member_count integer, avg_availability_hours integer)
language sql stable security definer set search_path = ''
as $$
  select count(*)::integer,
         case when auth.uid() is not null
              then coalesce(round(avg(u.availability_hours)), 0)::integer end
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    join public.users u on u.id = tm.user_id
   where t.project_id = p_project_id and not u.is_admin;
$$;
revoke all on function public.project_recruiting_stats(uuid) from public;
grant execute on function public.project_recruiting_stats(uuid) to anon, authenticated;

-- All subsequent admin RPCs must call this guard before accessing data or
-- writing anything, so stale/forged UI state cannot make a student pass the
-- server check. The admin pages rely on those guarded RPCs rather than
-- calling this directly.
create or replace function public.require_admin()
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.require_admin() from public, anon;
grant execute on function public.require_admin() to authenticated;

commit;
