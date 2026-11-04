-- Next steps once a team is complete (issue #30). Run after
-- 33_next_steps.sql (#42), whose tables this builds on. 31 and 32 are
-- 31_set_member_role.sql and 32_notify_on_project_delete.sql.
--
-- When a team's last seat fills, every member hears about it, and the team
-- page shows the checklist admins keep in #42 (public.next_steps, in
-- sort_order). Each team checks the items off on its own.
--
-- 33_next_steps.sql already created both tables and the admin RPCs
-- (save_next_step / delete_next_step / reorder_next_steps), and left
-- public.next_step_completions with no write path. This file adds:
--
--   * a starting list, only when the admin hasn't added any steps yet;
--   * set_next_step_done(), the write path for next_step_completions: any
--     member of a full team can check an item off or undo it, nobody else;
--   * team_checklist(): the list for one team, with the completer's name;
--   * a 'team_complete' notification to every member when the project goes
--     from open to full. It's a trigger on projects.status, so every way a
--     team fills is covered without copying any of their bodies: an
--     accepted request (21_), an admin placing or moving a student (27_),
--     and an owner lowering the target to the roster they have (17_).
--
-- No function here builds SQL from text, and every id is typed uuid.
begin;

-- --- notifications -------------------------------------------------------
-- 'team_complete' goes to every member, the one whose action filled the
-- team included. actor_id is whoever filled it (the owner who accepted, or
-- the admin who placed someone), by_admin when that was an admin.
-- 'project_removed' is #25's (32_notify_on_project_delete.sql); it's listed
-- here too so this rewrite doesn't drop it.
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('join_request', 'member_added', 'member_assigned', 'member_left',
                  'member_removed', 'project_removed', 'request_accepted', 'request_declined',
                  'team_complete'));

-- --- the starting list ---------------------------------------------------
-- Only into an empty list: an admin who has already written their own
-- steps on #42's tab keeps exactly those.
insert into public.next_steps (title, sort_order)
select v.title, v.ord
  from (values
    ('Confirm your roster', 1),
    ('Create the repo and add your adviser', 2),
    ('Schedule your first adviser meeting', 3),
    ('Submit your project proposal', 4)
  ) as v(title, ord)
 where not exists (select 1 from public.next_steps);

-- --- team_checklist ------------------------------------------------------
-- Every step in the admin's order (sort_order), with whether this team has
-- done it and who did. Members of the team and admins only. Students can
-- read each other's names anyway (the roster shows them); this just saves
-- the app a second query.
create or replace function public.team_checklist(p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not private.is_admin() and not exists (
    select 1 from public.team_members where team_id = p_team_id and user_id = auth.uid()
  ) then
    raise exception 'Only members of this team can see its checklist';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'due_at', s.due_at,
      'sort_order', s.sort_order,
      'completed_at', c.completed_at,
      'completed_by', c.completed_by,
      'completed_by_name', u.name
    ) order by s.sort_order)
    from public.next_steps s
    left join public.next_step_completions c on c.step_id = s.id and c.team_id = p_team_id
    left join public.users u on u.id = c.completed_by
  ), '[]'::jsonb);
end;
$$;

-- --- set_next_step_done --------------------------------------------------
-- Checks an item off (p_done true) or undoes it, for the caller's own team,
-- and returns the updated checklist. The checklist is for complete teams,
-- so a team still forming can't use it yet. Checking off an item someone
-- already did keeps the first record: two members ticking it at once don't
-- fight over who gets the credit.
create or replace function public.set_next_step_done(p_team_id uuid, p_step_id uuid, p_done boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;
  if not exists (select 1 from public.team_members where team_id = p_team_id and user_id = caller) then
    raise exception 'Only members of this team can check off its next steps';
  end if;
  if not exists (
    select 1 from public.teams t join public.projects p on p.id = t.project_id
     where t.id = p_team_id and p.status = 'full'
  ) then
    raise exception 'The checklist opens once the team is full';
  end if;
  if not exists (select 1 from public.next_steps where id = p_step_id) then
    raise exception 'Next step not found';
  end if;

  if coalesce(p_done, false) then
    insert into public.next_step_completions (team_id, step_id, completed_by)
    values (p_team_id, p_step_id, caller)
    on conflict (team_id, step_id) do nothing;
  else
    delete from public.next_step_completions
     where team_id = p_team_id and step_id = p_step_id;
  end if;

  return public.team_checklist(p_team_id);
end;
$$;

revoke all on function public.team_checklist(uuid), public.set_next_step_done(uuid, uuid, boolean)
from public, anon;
grant execute on function public.team_checklist(uuid), public.set_next_step_done(uuid, uuid, boolean)
to authenticated;

-- --- team complete -------------------------------------------------------
-- Fires once per open -> full change. sync_project_fill_state() rewrites
-- status on every roster change, so a team that's already full being set
-- to 'full' again isn't news. Runs after the row update, by which point the
-- member who filled the last seat is already in team_members.
create or replace function private.notify_team_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, project_id, actor_id, by_admin)
  select tm.user_id, 'team_complete', new.id, auth.uid(), private.is_admin()
    from public.teams t
    join public.team_members tm on tm.team_id = t.id
   where t.project_id = new.id;
  return null;
end;
$$;

revoke all on function private.notify_team_complete() from public, anon, authenticated;

create trigger projects_notify_team_complete
  after update of status on public.projects
  for each row
  when (old.status is distinct from 'full' and new.status = 'full')
  execute function private.notify_team_complete();

commit;
