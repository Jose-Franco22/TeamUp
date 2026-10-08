-- Business-logic functions, called from the frontend via supabase.rpc().
-- Run after 02_rls_policies.sql.
--
-- These replace what TODO-backend.md described as Express endpoint logic.
-- Each function body is one Postgres transaction (a function either commits
-- entirely or rolls back entirely on the raised exception), which is what
-- "Accepting a join request must be one transaction" in TODO-backend.md
-- needs — the roster insert, the project status flip, the formed_at
-- timestamp, and the cascade-decline of the user's other pending requests
-- all happen together or not at all.

-- --- public aggregate for guests -------------------------------------------
-- team_members has no `anon` SELECT policy (see 02_rls_policies.sql), so a
-- guest's direct query returns zero rows. This function is the sanctioned
-- exception: it returns only a count, never identities, so it's safe to
-- expose to anon too.
create or replace function public.project_member_count(p_project_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  where t.project_id = p_project_id;
$$;

grant execute on function public.project_member_count(uuid) to anon, authenticated;

-- --- create_project -----------------------------------------------------
-- Mirrors createProject()'s mock-mode branch in client.js: inserts the
-- project, its one team, seats the creator on that team, and records the
-- roles still needed, all in one transaction. Re-checks what client.js
-- already checks (team size 2-4, not already on a team) since a
-- client-side check is not a security boundary. p_roles_needed is the
-- jsonb form of the `roles_needed` array client.js sends: each element
-- `{ skill_id, quantity_needed }`.
create or replace function public.create_project(
  p_title text,
  p_description text,
  p_team_size_target smallint,
  p_creator_role text,
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
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  if p_team_size_target < 2 or p_team_size_target > 4 then
    raise exception 'A team has to be between 2 and 4 people';
  end if;

  if coalesce(btrim(p_creator_role), '') = '' then
    raise exception 'A role is required to create a project';
  end if;

  -- Same invariant create_join_request enforces: one team per student, ever.
  if exists (select 1 from public.team_members where user_id = caller) then
    raise exception 'You are already on a team and cannot create another project';
  end if;

  insert into public.projects (creator_id, title, description, team_size_target)
  values (caller, p_title, p_description, p_team_size_target)
  returning * into v_project;

  insert into public.teams (project_id)
  values (v_project.id)
  returning * into v_team;

  insert into public.team_members (user_id, team_id, role)
  values (caller, v_team.id, p_creator_role);

  for v_role in select * from jsonb_array_elements(coalesce(p_roles_needed, '[]'::jsonb))
  loop
    insert into public.project_roles_needed (project_id, skill_id, quantity_needed)
    values (
      v_project.id,
      (v_role->>'skill_id')::uuid,
      (v_role->>'quantity_needed')::smallint
    );
  end loop;

  return v_project;
end;
$$;

grant execute on function public.create_project(text, text, smallint, text, jsonb) to authenticated;

-- --- create_join_request -----------------------------------------------------
-- Mirrors the four checks createJoinRequest() does in the mock client.js, in
-- the same order, inside one transaction so there's no gap between checking
-- and inserting for a second concurrent request to land in.
create or replace function public.create_join_request(p_project_id uuid)
returns public.join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_row public.join_requests;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  if v_project.creator_id = caller then
    raise exception 'You cannot request to join your own project';
  end if;

  -- team_members.user_id is globally unique (one team per student, ever),
  -- so this single check covers both "already on this team" and "already
  -- on some other team" — see TODO-backend.md.
  if exists (select 1 from public.team_members where user_id = caller) then
    raise exception 'You are already on a team and cannot request to join another project';
  end if;

  if exists (
    select 1 from public.join_requests
    where project_id = p_project_id and user_id = caller and status = 'pending'
  ) then
    raise exception 'You already have a pending request for this project';
  end if;

  insert into public.join_requests (project_id, user_id, status)
  values (p_project_id, caller, 'pending')
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_join_request(uuid) to authenticated;

-- --- respond_to_join_request --------------------------------------------------
-- p_status: 'accepted' | 'declined'. p_role is required when accepting (the
-- creator's pick from that project's roles_needed) since team_members.role
-- is NOT NULL.
create or replace function public.respond_to_join_request(
  p_request_id uuid,
  p_status text,
  p_role text default null
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

  if p_status = 'accepted' and coalesce(btrim(p_role), '') = '' then
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

  update public.join_requests set status = p_status where id = p_request_id;

  if p_status = 'accepted' then
    select * into v_team from public.teams where project_id = v_request.project_id for update;

    insert into public.team_members (user_id, team_id, role)
    values (v_request.user_id, v_team.id, p_role);

    select count(*) into v_count from public.team_members where team_id = v_team.id;

    if v_count >= v_project.team_size_target then
      update public.projects set status = 'full' where id = v_project.id;
      update public.teams set formed_at = now() where id = v_team.id;
    end if;

    -- Accepting this request means every other pending request this user
    -- has out is no longer actionable (a student can only be on one
    -- team) — cascade-decline them now rather than leaving them stuck
    -- pending. See TODO-backend.md.
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

grant execute on function public.respond_to_join_request(uuid, text, text) to authenticated;
