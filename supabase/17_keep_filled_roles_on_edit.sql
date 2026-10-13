-- Editing a project must not destroy the roles that have been filled
-- (issue #24). Run after 16_project_validation.sql.
--
-- 15_release_filled_roles.sql keeps a filled role as a row at
-- quantity_needed = 0 rather than deleting it, so the skill pinned to that
-- role survives and the seat can reopen when the member leaves.
-- update_project() then replaced the whole roles list wholesale, which threw
-- those rows away again — and because the edit form never shows them (they
-- are not open roles), the creator did it without knowing.
--
-- Only the delete changes. The rest of the function is byte-for-byte what
-- 16_project_validation.sql installed.

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

  -- NEW: keep the roles whose seats are all filled.
  --
  -- A role at quantity_needed = 0 is hidden from the edit form, because
  -- composeProject() only returns the roles still open. The creator never
  -- saw it and cannot have meant to remove it — but replacing the whole
  -- set wholesale deleted it anyway, taking the skill pinned to it. Then
  -- restore_project_role() had no row to put the seat back into when that
  -- member left, so the seat never reopened.
  --
  -- Rows the form did submit are still replaced, so editing a role that is
  -- still open behaves exactly as before.
  delete from public.project_roles_needed
   where project_id = p_project_id
     and (quantity_needed > 0
          or role_id in (
            select (r->>'role_id')::uuid
              from jsonb_array_elements(coalesce(p_roles_needed, '[]'::jsonb)) r
          ));
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
