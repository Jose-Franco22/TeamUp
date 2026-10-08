-- Roles migration + project create/edit/delete functions. Run after
-- 03_functions.sql, against the live database described in TODO-backend.md.
-- BACK UP THE DATABASE FIRST — this rewrites project_roles_needed and
-- team_members, and drops team_members.role.
--
-- See TODO-backend.md's "Roles" and "What the backend still needs" sections
-- for the full rationale; this file is the implementation of steps 1-6 of
-- the roles migration plus the create_project / update_project /
-- delete_team / respond_to_join_request functions.

-- --- Step 1: create and seed roles --------------------------------------
create table public.roles (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  sort_order       smallint not null default 0,
  skill_categories text[] not null default '{}'
);

insert into public.roles (name, sort_order, skill_categories) values
  ('Project Manager',       10, '{Tools}'),
  ('Frontend Developer',    20, '{Frontend}'),
  ('Backend Developer',     30, '{Backend}'),
  ('Full-stack Developer',  40, '{Frontend,Backend}'),
  ('UI/UX Designer',        50, '{Frontend}'),
  ('Data / ML',             60, '{Data}'),
  ('QA & Testing',          70, '{Tools}'),
  ('DevOps',                80, '{Backend,Tools}'),
  ('Technical Writer',      90, '{Tools}');

-- A catch-all for team_members.role backfill (Step 5) that can't match one
-- of the nine above, and for any blank ('') role value — team_members.role
-- is NOT NULL today but could hold ''. Created unconditionally so Step 5's
-- SET NOT NULL can never fail for lack of a target row.
insert into public.roles (name, sort_order, skill_categories) values
  ('Unspecified', 999, '{Frontend,Backend,Data,Tools}')
on conflict (name) do nothing;

-- One extra roles row per distinct existing team_members.role value that
-- isn't already one of the ten above — done before Step 5 so the backfill
-- there can never fail to find a match, and no live data is lost. All four
-- categories: narrowing a role we invented from a free-text value would be
-- a guess that silently hides valid skills.
insert into public.roles (name, sort_order, skill_categories)
select distinct btrim(tm.role), 900, '{Frontend,Backend,Data,Tools}'::text[]
from public.team_members tm
where coalesce(btrim(tm.role), '') <> ''
  and not exists (select 1 from public.roles r where r.name = btrim(tm.role))
on conflict (name) do nothing;

alter table public.roles enable row level security;

create policy "roles_select_all"
  on public.roles for select
  to anon, authenticated
  using (true);

-- --- Step 2: project_roles_needed.role_id, backfilled from skill category
alter table public.project_roles_needed add column role_id uuid references public.roles(id);

update public.project_roles_needed prn
set role_id = r.id
from public.skills s
join public.roles r on r.name = case s.category
  when 'Frontend' then 'Frontend Developer'
  when 'Backend'  then 'Backend Developer'
  when 'Data'     then 'Data / ML'
  when 'Tools'    then 'QA & Testing'
end
where prn.skill_id = s.id
  and prn.role_id is null;

-- --- Step 3: collapse (project_id, role_id) collisions the backfill creates
with merged as (
  select project_id, role_id,
         min(skill_id::text)::uuid as skill_id,
         sum(quantity_needed) as quantity_needed,
         (array_agg(ctid))[1] as keep_ctid
  from public.project_roles_needed
  group by project_id, role_id
  having count(*) > 1
)
update public.project_roles_needed prn
set quantity_needed = m.quantity_needed,
    skill_id = m.skill_id
from merged m
where prn.ctid = m.keep_ctid;

with merged as (
  select project_id, role_id, (array_agg(ctid))[1] as keep_ctid
  from public.project_roles_needed
  group by project_id, role_id
  having count(*) > 1
)
delete from public.project_roles_needed prn
using merged m
where prn.project_id = m.project_id
  and prn.role_id = m.role_id
  and prn.ctid <> m.keep_ctid;

-- --- Step 4: swap the key, loosen skill_id ------------------------------
-- The old PK (project_id, skill_id) has to go first — Postgres won't let
-- skill_id drop its NOT NULL while it's still part of a primary key.
do $$
declare
  pk_name text;
begin
  select conname into pk_name
  from pg_constraint
  where conrelid = 'public.project_roles_needed'::regclass and contype = 'p';
  if pk_name is not null then
    execute format('alter table public.project_roles_needed drop constraint %I', pk_name);
  end if;
end $$;

alter table public.project_roles_needed alter column role_id set not null;
alter table public.project_roles_needed alter column skill_id drop not null;

alter table public.project_roles_needed add primary key (project_id, role_id);
create index project_roles_needed_skill_id_idx on public.project_roles_needed(skill_id);

-- --- Step 5: team_members.role (text) -> role_id (FK) -------------------
alter table public.team_members add column role_id uuid references public.roles(id);

update public.team_members tm
set role_id = r.id
from public.roles r
where r.name = btrim(tm.role)
  and tm.role_id is null;

update public.team_members
set role_id = (select id from public.roles where name = 'Unspecified')
where role_id is null;

alter table public.team_members alter column role_id set not null;
alter table public.team_members drop column role;

-- --- Step 6: tighten constraints -----------------------------------------
do $$
declare
  ck_name text;
begin
  select conname into ck_name
  from pg_constraint
  where conrelid = 'public.projects'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%team_size_target%';
  if ck_name is not null then
    execute format('alter table public.projects drop constraint %I', ck_name);
  end if;
end $$;
alter table public.projects add constraint projects_team_size_target_check
  check (team_size_target between 2 and 4);

do $$
declare
  ck_name text;
begin
  select conname into ck_name
  from pg_constraint
  where conrelid = 'public.project_roles_needed'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%quantity_needed%';
  if ck_name is not null then
    execute format('alter table public.project_roles_needed drop constraint %I', ck_name);
  end if;
end $$;
alter table public.project_roles_needed add constraint project_roles_needed_quantity_needed_check
  check (quantity_needed between 1 and 3);

-- --- Functions -----------------------------------------------------------
-- Old signatures dropped first — PostgREST resolves overloads by argument
-- name/type and refuses an ambiguous call otherwise.
drop function if exists public.create_project(text, text, smallint, text, jsonb);
drop function if exists public.respond_to_join_request(uuid, text, text);

-- create_project(): see TODO-backend.md "Creating a project". Validates
-- role/skill ids, role-skill category fit, per-role and total seat counts,
-- then inserts project + team + creator's team_members row + roles_needed,
-- and cascade-declines the caller's other pending join requests.
create or replace function public.create_project(
  p_title text,
  p_description text,
  p_team_size_target smallint,
  p_creator_role_id uuid,
  p_roles_needed jsonb
)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_team public.teams;
  v_role jsonb;
  v_role_id uuid;
  v_skill_id uuid;
  v_qty smallint;
  v_seen_roles uuid[] := '{}';
  v_open_seats smallint;
  v_assigned smallint := 0;
  v_role_categories text[];
  v_skill_category text;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  if p_team_size_target < 2 or p_team_size_target > 4 then
    raise exception 'A team has to be between 2 and 4 people';
  end if;

  if p_creator_role_id is null or not exists (select 1 from public.roles where id = p_creator_role_id) then
    raise exception 'A valid role is required to create a project';
  end if;

  -- Same invariant create_join_request enforces: one team per student, ever.
  if exists (select 1 from public.team_members where user_id = caller) then
    raise exception 'You are already on a team and cannot create another project';
  end if;

  v_open_seats := p_team_size_target - 1;

  for v_role in select * from jsonb_array_elements(coalesce(p_roles_needed, '[]'::jsonb))
  loop
    v_role_id := (v_role->>'role_id')::uuid;
    v_skill_id := nullif(v_role->>'skill_id', '')::uuid;
    v_qty := (v_role->>'quantity_needed')::smallint;

    if v_role_id is null then
      raise exception 'Every role you list needs a role selected';
    end if;
    if v_role_id = any(v_seen_roles) then
      raise exception 'You listed the same role twice';
    end if;
    v_seen_roles := v_seen_roles || v_role_id;

    select skill_categories into v_role_categories from public.roles where id = v_role_id;
    if v_role_categories is null then
      raise exception 'Unknown role';
    end if;

    if v_qty is null or v_qty < 1 or v_qty > 3 then
      raise exception 'Each role needs between 1 and 3 people';
    end if;

    if v_skill_id is not null then
      select category into v_skill_category from public.skills where id = v_skill_id;
      if v_skill_category is null then
        raise exception 'Unknown skill';
      end if;
      if not (v_skill_category = any(v_role_categories)) then
        raise exception 'That skill does not fit the role you picked';
      end if;
    end if;

    v_assigned := v_assigned + v_qty;
  end loop;

  if v_assigned > v_open_seats then
    raise exception 'A team of % has % open seat% besides you, but you listed % people',
      p_team_size_target, v_open_seats, case when v_open_seats = 1 then '' else 's' end, v_assigned;
  end if;

  insert into public.projects (creator_id, title, description, team_size_target)
  values (caller, p_title, p_description, p_team_size_target)
  returning * into v_project;

  insert into public.teams (project_id)
  values (v_project.id)
  returning * into v_team;

  insert into public.team_members (user_id, team_id, role_id)
  values (caller, v_team.id, p_creator_role_id);

  for v_role in select * from jsonb_array_elements(coalesce(p_roles_needed, '[]'::jsonb))
  loop
    insert into public.project_roles_needed (project_id, role_id, skill_id, quantity_needed)
    values (
      v_project.id,
      (v_role->>'role_id')::uuid,
      nullif(v_role->>'skill_id', '')::uuid,
      (v_role->>'quantity_needed')::smallint
    );
  end loop;

  -- Creating a project seats you on a team, and a student is only ever on
  -- one — any request still out is now unactionable. Same cascade
  -- respond_to_join_request does on accept.
  update public.join_requests
    set status = 'declined'
    where user_id = caller and status = 'pending';

  return v_project;
end;
$$;

grant execute on function public.create_project(text, text, smallint, uuid, jsonb) to authenticated;

-- update_project(): see TODO-backend.md "Editing a project". Creator-only;
-- target can't drop below the current roster; roles_needed is replaced
-- wholesale; raising the target on a filled project reopens it, lowering
-- it onto the roster closes it.
create or replace function public.update_project(
  p_project_id uuid,
  p_title text,
  p_description text,
  p_team_size_target smallint,
  p_own_role_id uuid,
  p_roles_needed jsonb
)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_team public.teams;
  v_member_count smallint;
  v_role jsonb;
  v_role_id uuid;
  v_skill_id uuid;
  v_qty smallint;
  v_seen_roles uuid[] := '{}';
  v_open_seats smallint;
  v_assigned smallint := 0;
  v_role_categories text[];
  v_skill_category text;
  v_full boolean;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select * into v_project from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'Project not found';
  end if;
  if v_project.creator_id <> caller then
    raise exception 'Only the project creator can edit it';
  end if;

  if p_team_size_target < 2 or p_team_size_target > 4 then
    raise exception 'A team has to be between 2 and 4 people';
  end if;

  select * into v_team from public.teams where project_id = p_project_id for update;
  select count(*) into v_member_count from public.team_members where team_id = v_team.id;

  if p_team_size_target < v_member_count then
    raise exception '% people are already on this team, so the target can''t be %', v_member_count, p_team_size_target;
  end if;

  if p_own_role_id is null or not exists (select 1 from public.roles where id = p_own_role_id) then
    raise exception 'A valid role is required';
  end if;

  v_open_seats := p_team_size_target - v_member_count;

  for v_role in select * from jsonb_array_elements(coalesce(p_roles_needed, '[]'::jsonb))
  loop
    v_role_id := (v_role->>'role_id')::uuid;
    v_skill_id := nullif(v_role->>'skill_id', '')::uuid;
    v_qty := (v_role->>'quantity_needed')::smallint;

    if v_role_id is null then
      raise exception 'Every role you list needs a role selected';
    end if;
    if v_role_id = any(v_seen_roles) then
      raise exception 'You listed the same role twice';
    end if;
    v_seen_roles := v_seen_roles || v_role_id;

    select skill_categories into v_role_categories from public.roles where id = v_role_id;
    if v_role_categories is null then
      raise exception 'Unknown role';
    end if;

    if v_qty is null or v_qty < 1 or v_qty > 3 then
      raise exception 'Each role needs between 1 and 3 people';
    end if;

    if v_skill_id is not null then
      select category into v_skill_category from public.skills where id = v_skill_id;
      if v_skill_category is null then
        raise exception 'Unknown skill';
      end if;
      if not (v_skill_category = any(v_role_categories)) then
        raise exception 'That skill does not fit the role you picked';
      end if;
    end if;

    v_assigned := v_assigned + v_qty;
  end loop;

  if v_assigned > v_open_seats then
    raise exception 'This team has % open seat% left, but you listed % people',
      v_open_seats, case when v_open_seats = 1 then '' else 's' end, v_assigned;
  end if;

  update public.projects
    set title = p_title,
        description = p_description,
        team_size_target = p_team_size_target
    where id = p_project_id;

  update public.team_members
    set role_id = p_own_role_id
    where team_id = v_team.id and user_id = caller;

  delete from public.project_roles_needed where project_id = p_project_id;
  for v_role in select * from jsonb_array_elements(coalesce(p_roles_needed, '[]'::jsonb))
  loop
    insert into public.project_roles_needed (project_id, role_id, skill_id, quantity_needed)
    values (
      p_project_id,
      (v_role->>'role_id')::uuid,
      nullif(v_role->>'skill_id', '')::uuid,
      (v_role->>'quantity_needed')::smallint
    );
  end loop;

  v_full := v_member_count >= p_team_size_target;
  update public.projects set status = case when v_full then 'full' else 'open' end where id = p_project_id;
  update public.teams
    set formed_at = case when v_full then coalesce(formed_at, now()) else null end
    where id = v_team.id;

  select * into v_project from public.projects where id = p_project_id;
  return v_project;
end;
$$;

grant execute on function public.update_project(uuid, text, text, smallint, uuid, jsonb) to authenticated;

-- delete_team(): see TODO-backend.md "Deleting a team". Deletes the whole
-- project (a team exists only to hold its roster), refused unless the
-- caller is the creator and nobody else is seated.
create or replace function public.delete_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_team public.teams;
  v_project public.projects;
  v_count int;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select * into v_team from public.teams where id = p_team_id;
  if not found then
    raise exception 'Team not found';
  end if;

  select * into v_project from public.projects where id = v_team.project_id;
  if v_project.creator_id <> caller then
    raise exception 'Only the team owner can delete this team';
  end if;

  select count(*) into v_count from public.team_members where team_id = p_team_id;
  if v_count > 1 then
    raise exception 'Remove everyone else from the team before deleting it';
  end if;

  delete from public.projects where id = v_project.id;
end;
$$;

grant execute on function public.delete_team(uuid) to authenticated;

-- respond_to_join_request(): supersedes the version in 03_functions.sql —
-- p_role text -> p_role_id uuid, plus an explicit "already on a team" check
-- so a stale request raises a readable error instead of a team_members
-- primary-key violation.
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
