-- Export every team and its roster (issue #40). Run after
-- 41_github_activity.sql, which adds projects.github_repo — the Teams sheet
-- names it as a column — and after 39_project_advisers.sql, which is where
-- the adviser columns come from.
--
-- 46 because 45 is claimed by #95 (`45_milestone_deliverables.sql`), which is
-- open. #91 learned the hard way that a number an open PR has claimed is not
-- claimed until it merges, so this takes the first number above every claim
-- rather than the first gap, and 45 is left alone whichever way #95 goes.
--
-- ONE FUNCTION, TWO SCOPES. An admin exports everything; an adviser exports
-- the teams they advise and nothing else. The issue describes these as one
-- feature with a narrower variant rather than two features, and writing them
-- as one function means the scope rule exists in one place and the pgTAP
-- file can put the two side by side. Everyone else is refused.
--
-- NO UNPLACED STUDENTS FOR AN ADVISER, which the issue states and which is
-- the one part of the scope that is not simply "fewer teams". A student with
-- no team is nobody's advisee, and the sheet is a list of names, emails and
-- skills for students who have not been placed — the sort of thing an
-- instructor chases and an adviser has no standing to hold.
--
-- WHY jsonb AND NOT THREE SET-RETURNING FUNCTIONS. The three sheets have to
-- agree with each other: a Members row naming a team the Teams sheet does
-- not list would be a bug nobody could see in the spreadsheet. One function,
-- one snapshot, one round trip. It is also the shape admin_dashboard() in
-- 19_admin_dashboard.sql already uses, so the client has the pattern.
--
-- WHAT IS NOT HERE: no spreadsheet. Postgres returns the rows and
-- frontend/src/lib/rosterWorkbook.js turns them into the .xlsx, for the same
-- reason the Edge Functions hold the GitHub and Gemini calls — this file
-- holds the rule about who may see what, which is the part worth testing in
-- pgTAP. It also means "None" and "Pending" are written once, in the place
-- that decides how a cell reads, rather than in SQL.

begin;

-- --- export_rosters -------------------------------------------------------
-- The admin's whole picture, or an adviser's slice of it.
--
-- SECURITY DEFINER, so it walks straight through RLS and has to restate
-- every rule it depends on. Three are restated below and each one is a case
-- in supabase/tests/export_rosters.test.sql:
--
--   * who may call it at all (admin, or an adviser with at least one
--     accepted invitation — not a pending one, which is not yet advising);
--   * which teams an adviser sees (only projects they hold an accepted
--     adviser_requests row for);
--   * that admin accounts are not students, so they are left out of the
--     Members and Unplaced sheets exactly as admin_team_json() leaves them
--     out. An instructor is not an unplaced student.

create or replace function public.export_rosters()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller       uuid := auth.uid();
  v_is_admin   boolean;
  v_project_ids uuid[];
  v_teams      jsonb;
  v_members    jsonb;
  v_unplaced   jsonb;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  v_is_admin := private.is_admin();

  if not v_is_admin then
    -- 'accepted' and nothing else. A pending invitation is not advising yet,
    -- and a declined or cancelled one never was — the same test the
    -- repo_activity select policy makes in 41_github_activity.sql.
    select array_agg(ar.project_id)
      into v_project_ids
      from public.adviser_requests ar
     where ar.adviser_id = caller
       and ar.status = 'accepted';

    if v_project_ids is null then
      raise exception 'Only an admin or an adviser can export rosters'
        using errcode = '42501';
    end if;
  end if;

  -- --- the Teams sheet ----------------------------------------------------
  -- One row per team. `adviser_status` rather than a rendered word: 'none',
  -- 'pending' or 'accepted'. What those read as in the cell is
  -- buildRosterWorkbook()'s to say, and it says it once.
  --
  -- The adviser is read with the same `status in ('pending','accepted')`
  -- that adviser_requests_one_open_idx is partial on, so at most one row can
  -- match and no ordering is needed to pick it.
  select coalesce(jsonb_agg(t_row order by t_row->>'team_name', t_row->>'team_id'), '[]'::jsonb)
    into v_teams
    from (
      select jsonb_build_object(
               'team_id',          t.id,
               'project_id',       p.id,
               'team_name',        p.title,
               'status',           p.status,
               'owner_name',       owner.name,
               'owner_email',      owner.email,
               'member_count',     (select count(*)
                                      from public.team_members tm
                                      join public.users mu on mu.id = tm.user_id
                                     where tm.team_id = t.id and not mu.is_admin),
               'team_size_target', p.team_size_target,
               'adviser_status',   coalesce(open_adviser.status, 'none'),
               'adviser_name',     case when open_adviser.status = 'accepted'
                                        then adviser_user.name end,
               'adviser_email',    case when open_adviser.status = 'accepted'
                                        then adviser_user.email end,
               'github_repo',      p.github_repo
             ) as t_row
        from public.teams t
        join public.projects p on p.id = t.project_id
        join public.users owner on owner.id = p.creator_id
        left join lateral (
          select ar.adviser_id, ar.status
            from public.adviser_requests ar
           where ar.project_id = p.id
             and ar.status in ('pending', 'accepted')
        ) open_adviser on true
        left join public.users adviser_user on adviser_user.id = open_adviser.adviser_id
       where v_is_admin or p.id = any (v_project_ids)
    ) teams;

  -- --- the Members sheet --------------------------------------------------
  -- One row per member, carrying its team's name so the sheet stands alone
  -- when somebody sorts or filters it in Excel — which is the whole point of
  -- handing an instructor a spreadsheet rather than a web page.
  select coalesce(jsonb_agg(m_row order by m_row->>'team_name', m_row->>'name', m_row->>'user_id'), '[]'::jsonb)
    into v_members
    from (
      select jsonb_build_object(
               'user_id',    u.id,
               'team_id',    t.id,
               'team_name',  p.title,
               'name',       u.name,
               'email',      u.email,
               'role_name',  r.name,
               'is_owner',   p.creator_id = u.id,
               'github_url', u.github_url,
               'joined_at',  tm.joined_at
             ) as m_row
        from public.team_members tm
        join public.teams t on t.id = tm.team_id
        join public.projects p on p.id = t.project_id
        join public.users u on u.id = tm.user_id
        join public.roles r on r.id = tm.role_id
       where not u.is_admin
         and (v_is_admin or p.id = any (v_project_ids))
    ) members;

  -- --- the Unplaced students sheet ----------------------------------------
  -- Admins only, for the reason in the header. An adviser gets an empty
  -- array rather than the key being absent, so the client never has to ask
  -- which kind of export it is holding to know how to read it.
  if v_is_admin then
    select coalesce(jsonb_agg(u_row order by u_row->>'name', u_row->>'user_id'), '[]'::jsonb)
      into v_unplaced
      from (
        select jsonb_build_object(
                 'user_id', u.id,
                 'name',    u.name,
                 'email',   u.email,
                 'skills',  coalesce((
                   select jsonb_agg(s.name order by s.category, s.name, s.id)
                     from public.user_skills us
                     join public.skills s on s.id = us.skill_id
                    where us.user_id = u.id
                 ), '[]'::jsonb),
                 'has_pending_request', exists (
                   select 1 from public.join_requests jr
                    where jr.user_id = u.id and jr.status = 'pending'
                 )
               ) as u_row
          from public.users u
         where not u.is_admin
           and not exists (select 1 from public.team_members tm where tm.user_id = u.id)
      ) unplaced;
  else
    v_unplaced := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'scope',             case when v_is_admin then 'admin' else 'adviser' end,
    'generated_at',      now(),
    'teams',             v_teams,
    'members',           v_members,
    'unplaced_students', v_unplaced);
end;
$$;

revoke all on function public.export_rosters() from public, anon;
grant execute on function public.export_rosters() to authenticated;

comment on function public.export_rosters() is
  'Every team, member and unplaced student for an admin; only the advised '
  'teams and their members, and no unplaced students, for an adviser. '
  'Refuses anyone else. Shaped for frontend/src/lib/rosterWorkbook.js.';

commit;
