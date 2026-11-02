-- Tell the people waiting when a project they asked to join is deleted
-- (issue #25, the one criterion that shipped unbuilt). Run after
-- 31_set_member_role.sql.
--
-- Deleting a project already cancels every pending request: `join_requests`
-- cascades off `projects`. What never happened is telling the students. They
-- were left watching a request that had silently stopped existing, on a
-- project they could no longer find.
--
-- The awkward part, and why this needed a design rather than two lines:
--
--   `notifications.project_id` is `on delete cascade`. A notification about a
--   project being deleted, written the obvious way, deletes *itself* a
--   moment later along with the project it points at.
--
-- So this kind of notification carries the project's name instead of a
-- reference to it. `project_title` is nullable and only ever set here, where
-- there will be no row left to read a title from. Every other kind keeps
-- pointing at a live project and reads the title through the join, exactly as
-- before — which also means the cascade keeps tidying up their notifications
-- when a project goes, and that is still the behaviour we want for them.
--
-- The alternative was changing project_id to `on delete set null` for every
-- kind, which would leave every old notification dangling at a project nobody
-- can open, to fix one case. Not worth it.

begin;

-- --- the title, for when there is no project left to ask ------------------

alter table public.notifications
  add column if not exists project_title text;

comment on column public.notifications.project_title is
  'Set only for kinds whose project no longer exists (project_removed). Every '
  'other kind reads the title through project_id.';

-- --- the new kind ---------------------------------------------------------
-- Rewritten in full rather than added to, which is how every migration since
-- 21_ has done it: the constraint is the list, so the list has to be stated.
-- 'team_complete' is #30's (34_next_steps.sql); it's listed here too so
-- whichever of the two runs last doesn't drop the other's kind.

alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('join_request', 'member_added', 'member_assigned', 'member_left',
                  'member_removed', 'project_removed', 'request_accepted',
                  'request_declined', 'team_complete'));

-- --- delete_team ----------------------------------------------------------
-- Identical to 04_roles_and_team_deletion.sql except for the block marked
-- NEW. Reproduced in full because `create or replace` replaces the whole
-- body, and taken from that file verbatim so nothing else drifts.

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

  -- NEW: tell everyone with a request still outstanding, before the delete
  -- takes their request with it.
  --
  -- project_id is deliberately left null: it would cascade this row away
  -- with the project. The title is copied in instead, so the notification
  -- can still say which project it was about.
  --
  -- Only 'pending' requests. Someone already accepted is a member and is
  -- handled by the member rules; someone already declined has had their
  -- answer and does not need a second message about it.
  insert into public.notifications (user_id, kind, project_id, project_title, actor_id)
  select jr.user_id, 'project_removed', null, v_project.title, caller
    from public.join_requests jr
   where jr.project_id = v_project.id
     and jr.status = 'pending';

  delete from public.projects where id = v_project.id;
end;
$$;

grant execute on function public.delete_team(uuid) to authenticated;

commit;
