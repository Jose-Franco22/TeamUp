-- Project validation (issue #23). Run after 15_release_filled_roles.sql.
--
-- Until now a project's title and description were only "not empty", and
-- only in the form. Anyone signed in can call create_project() directly with
-- their session, so a one-character title and an empty description were both
-- accepted by the database.
--
-- Two layers, same as the profile rules in 11_profile_validation.sql:
--
--   * CHECK constraints on `projects` are the boundary. They hold whatever
--     path the write arrives by.
--   * Explicit raises in create_project() and update_project() come first,
--     so the student sees "Title must be between 5 and 100 characters"
--     rather than a constraint name.
--
-- Keep the numbers identical to frontend/src/lib/validation.js; the test
-- in frontend/src/lib/validation.test.js fails if they drift.
--
-- Lengths are measured after trimming, because the functions trim before
-- inserting and " a " is a one-character title.
--
-- NOT VALID: the rules apply to every write from now on but do not fail this
-- migration on a live row that already breaks them. To find those rows:
--
--   select id, title, char_length(btrim(description)) as description_chars
--   from public.projects
--   where char_length(btrim(title)) not between 5 and 100
--      or char_length(btrim(description)) not between 20 and 2000;
--
-- Once that returns nothing:
--   alter table public.projects validate constraint projects_title_length_check;
--   alter table public.projects validate constraint projects_description_length_check;

alter table public.projects
  add constraint projects_title_length_check
    check (char_length(btrim(title)) between 5 and 100) not valid;

alter table public.projects
  add constraint projects_description_length_check
    check (char_length(btrim(description)) between 20 and 2000) not valid;

-- --- The readable errors, raised before the insert -----------------------
-- A small helper rather than the same twelve lines in both functions.
-- Internal: the functions that call it have already authorised the caller.

create or replace function public.assert_project_text(p_title text, p_description text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
begin
  if char_length(v_title) not between 5 and 100 then
    raise exception 'Title must be between 5 and 100 characters';
  end if;
  if char_length(v_description) not between 20 and 2000 then
    raise exception 'Description must be between 20 and 2000 characters';
  end if;
end;
$$;

revoke execute on function public.assert_project_text(text, text) from public, anon, authenticated;

-- --- create_project ------------------------------------------------------
-- Identical to 04_roles_and_team_deletion.sql except for the two lines
-- marked NEW: the text check, and trimming on the way in so the stored row
-- matches what was validated.

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

  -- NEW: title and description are checked here, not only in the form.
  perform public.assert_project_text(p_title, p_description);

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

  -- NEW: store the trimmed text, so what is saved is what was validated.
  insert into public.projects (creator_id, title, description, team_size_target)
  values (caller, btrim(p_title), btrim(p_description), p_team_size_target)
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

-- --- update_project ------------------------------------------------------
-- The constraints above apply to updates too, so without the same raise
-- here an edit with a short title would fail with a constraint name instead
-- of a sentence. Only the two marked lines differ from 04_.

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

  -- NEW: the same text rules create_project() applies. Without this an edit
  -- with a short title would fail on the CHECK constraint and surface a
  -- constraint name instead of a sentence.
  perform public.assert_project_text(p_title, p_description);

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
    -- NEW: store the trimmed text, so what is saved is what was validated.
    set title = btrim(p_title),
        description = btrim(p_description),
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
