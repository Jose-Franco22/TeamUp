-- Issue #37: read-only team formation dashboard and detail views.
-- Run after 16_admin_access.sql. Every exposed RPC checks the caller's role.
begin;

-- Internal builders keep dashboard cards and detail pages on the same shape.
-- They run only inside guarded SECURITY DEFINER RPCs; API roles cannot call them.
create or replace function private.admin_team_json(p_team_id uuid)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id, 'project_id', p.id, 'title', p.title, 'description', p.description,
    'creator_id', p.creator_id, 'creator_name', owner.name,
    'team_size_target', p.team_size_target, 'status', p.status, 'formed_at', t.formed_at,
    'member_count', (select count(*) from public.team_members where team_id = t.id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', u.id, 'name', u.name, 'email', u.email,
        'role_id', tm.role_id, 'role_name', r.name,
        'availability_hours', u.availability_hours
      ) order by u.name, u.id)
      from public.team_members tm
      join public.users u on u.id = tm.user_id
      join public.roles r on r.id = tm.role_id
      where tm.team_id = t.id and not u.is_admin
    ), '[]'::jsonb),
    'roles_needed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'role_id', rn.role_id, 'role_name', r.name, 'skill_id', rn.skill_id,
        'skill_name', s.name, 'category', s.category, 'quantity_needed', rn.quantity_needed
      ) order by r.sort_order, r.id)
      from public.project_roles_needed rn
      join public.roles r on r.id = rn.role_id
      left join public.skills s on s.id = rn.skill_id
      where rn.project_id = p.id and rn.quantity_needed > 0
    ), '[]'::jsonb),
    'pending_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', jr.id, 'user_id', u.id, 'user_name', u.name, 'created_at', jr.created_at
      ) order by jr.created_at, jr.id)
      from public.join_requests jr join public.users u on u.id = jr.user_id
      where jr.project_id = p.id and jr.status = 'pending' and not u.is_admin
    ), '[]'::jsonb)
  )
  from public.teams t
  join public.projects p on p.id = t.project_id
  join public.users owner on owner.id = p.creator_id
  where t.id = p_team_id;
$$;

create or replace function private.admin_student_json(p_student_id uuid)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', u.id, 'name', u.name, 'email', u.email, 'bio', u.bio,
    'availability_hours', u.availability_hours, 'github_url', u.github_url,
    'skills', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'category', s.category, 'source', us.source
      ) order by s.category, s.name, s.id)
      from public.user_skills us join public.skills s on s.id = us.skill_id
      where us.user_id = u.id
    ), '[]'::jsonb),
    'membership', (
      select jsonb_build_object(
        'team_id', t.id, 'project_id', p.id, 'project_title', p.title,
        'role_id', tm.role_id, 'role_name', r.name
      )
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
      join public.projects p on p.id = t.project_id
      join public.roles r on r.id = tm.role_id
      where tm.user_id = u.id
    ),
    'pending_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', jr.id, 'project_id', p.id, 'team_id', t.id,
        'project_title', p.title, 'created_at', jr.created_at
      ) order by jr.created_at, jr.id)
      from public.join_requests jr
      join public.projects p on p.id = jr.project_id
      left join public.teams t on t.project_id = p.id
      where jr.user_id = u.id and jr.status = 'pending'
    ), '[]'::jsonb)
  )
  from public.users u where u.id = p_student_id and not u.is_admin;
$$;

revoke all on function private.admin_team_json(uuid), private.admin_student_json(uuid)
from public, anon, authenticated, service_role;

create or replace function public.admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  team_list jsonb;
  unplaced_list jsonb;
begin
  perform public.require_admin();

  select coalesce(jsonb_agg(private.admin_team_json(t.id) order by p.title, t.id), '[]'::jsonb)
    into team_list
    from public.teams t join public.projects p on p.id = t.project_id;

  select coalesce(jsonb_agg(private.admin_student_json(u.id) order by u.name, u.id), '[]'::jsonb)
    into unplaced_list
    from public.users u
   where not u.is_admin
     and not exists (select 1 from public.team_members tm where tm.user_id = u.id);

  return jsonb_build_object(
    'teams', team_list, 'unplaced_students', unplaced_list,
    'summary', jsonb_build_object(
      'formed_teams', (select count(*) from jsonb_array_elements(team_list) as team where team->>'status' = 'full'),
      'open_teams', (select count(*) from jsonb_array_elements(team_list) as team where team->>'status' = 'open'),
      'unplaced_students', jsonb_array_length(unplaced_list)
    )
  );
end;
$$;

create or replace function public.admin_team_details(p_team_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  details jsonb;
begin
  perform public.require_admin();
  details := private.admin_team_json(p_team_id);
  if details is null then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;
  return details;
end;
$$;

create or replace function public.admin_student_details(p_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  details jsonb;
begin
  perform public.require_admin();
  details := private.admin_student_json(p_student_id);
  if details is null then
    raise exception 'Student not found' using errcode = 'P0002';
  end if;
  return details;
end;
$$;

revoke all on function public.admin_dashboard(), public.admin_team_details(uuid), public.admin_student_details(uuid)
from public, anon;
grant execute on function public.admin_dashboard(), public.admin_team_details(uuid), public.admin_student_details(uuid)
to authenticated;

commit;
