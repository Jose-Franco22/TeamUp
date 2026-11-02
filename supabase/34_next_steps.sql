-- Next steps once a team is complete (issue #30). Run after
-- 32_notify_on_project_delete.sql. 31-33 are taken by 31_set_member_role.sql,
-- 32_notify_on_project_delete.sql and #42's 33_next_steps.sql.
--
-- When a team's last seat fills, every member hears about it, and the team
-- page shows a checklist of what to do next. The items are one list for the
-- whole class, kept by admins (confirm the roster, create the repo and add
-- the adviser, ...). Each team checks them off on its own.
--
--   * public.next_steps: the admin-managed list. Title, optional due date.
--     Written only through save_next_step() / delete_next_step().
--   * public.team_next_steps: one row per item a team has done, with who
--     checked it off and when. Written only through set_next_step_done(),
--     which lets any member of a full team check an item off or undo it,
--     and nobody else.
--   * team_checklist(): the list for one team, with the completer's name.
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

-- --- next_steps ----------------------------------------------------------
-- Title rules match an announcement title (29_announcements.sql): 1-120
-- characters, trimmed, letters or numbers, no line breaks, control or
-- invisible characters. The due date is optional, and held to the same
-- range as a milestone's (28_milestone_messages.sql).
create table public.next_steps (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  due_at     timestamptz,
  -- clock_timestamp(), so rows added together still keep their order.
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  constraint next_steps_title_text check (
    char_length(title) between 1 and 120
    and title = btrim(title)
    and title ~ '[^[:space:][:punct:] -⯿⸀-⹿　-〿︀-️\U0001F000-\U0001FAFF]'
    and title !~ '[[:cntrl:]]'
    and title !~ '[​-‏‪-‮⁠-⁩﻿]'
  ),
  constraint next_steps_due_at_range check (
    due_at is null
    or (due_at >= timestamptz '2000-01-01 00:00:00+00' and due_at < timestamptz '2100-01-01 00:00:00+00')
  )
);

alter table public.next_steps enable row level security;

-- Every signed-in user can read the list; it's the same for every team.
-- No write policies — admins go through the functions below.
create policy "next_steps_select_authenticated"
  on public.next_steps for select
  to authenticated
  using (true);

-- The starting list. Admins add due dates, and edit or remove these, from
-- the Milestones tab.
insert into public.next_steps (title) values
  ('Confirm your roster'),
  ('Create the repo and add your adviser'),
  ('Schedule your first adviser meeting'),
  ('Submit your project proposal');

-- --- team_next_steps -----------------------------------------------------
-- A row means the team has done that item. completed_by goes null if the
-- student's account is deleted; the item stays done.
create table public.team_next_steps (
  team_id      uuid not null references public.teams(id) on delete cascade,
  next_step_id uuid not null references public.next_steps(id) on delete cascade,
  completed_by uuid references public.users(id) on delete set null,
  completed_at timestamptz not null default now(),
  primary key (team_id, next_step_id)
);
create index team_next_steps_next_step_id_idx on public.team_next_steps(next_step_id);

alter table public.team_next_steps enable row level security;

-- A team's progress is for its own members, and admins. No write policies:
-- set_next_step_done() is the only way in.
create policy "team_next_steps_select_member_or_admin"
  on public.team_next_steps for select
  to authenticated
  using (
    private.is_admin()
    or exists (
      select 1 from public.team_members tm
       where tm.team_id = team_next_steps.team_id and tm.user_id = auth.uid()
    )
  );

-- --- save_next_step / delete_next_step -----------------------------------
-- Adds an item (p_id null) or edits one. p_due_at null means no due date.
create or replace function public.save_next_step(p_id uuid, p_title text, p_due_at timestamptz default null)
returns public.next_steps
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_row public.next_steps;
begin
  perform public.require_admin();

  if v_title = '' then
    raise exception 'A next step needs a title';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'Keep the title to 120 characters or fewer';
  end if;
  if v_title ~ '[[:cntrl:]]' or v_title ~ '[​-‏‪-‮⁠-⁩﻿]' then
    raise exception 'The title can''t contain line breaks, hidden or control characters';
  end if;
  if v_title !~ '[^[:space:][:punct:] -⯿⸀-⹿　-〿︀-️\U0001F000-\U0001FAFF]' then
    raise exception 'The title has to include letters or numbers';
  end if;
  if p_due_at is not null
     and (p_due_at < timestamptz '2000-01-01 00:00:00+00' or p_due_at >= timestamptz '2100-01-01 00:00:00+00') then
    raise exception 'Pick a due date between 2000 and 2099';
  end if;

  if p_id is null then
    insert into public.next_steps (title, due_at)
    values (v_title, p_due_at)
    returning * into v_row;
  else
    update public.next_steps
       set title = v_title, due_at = p_due_at, updated_at = now()
     where id = p_id
    returning * into v_row;
    if not found then
      raise exception 'Next step not found';
    end if;
  end if;

  return v_row;
end;
$$;

-- Deleting an item takes it off every team's checklist, done or not.
create or replace function public.delete_next_step(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  delete from public.next_steps where id = p_id;
  if not found then
    raise exception 'Next step not found';
  end if;
end;
$$;

-- --- team_checklist ------------------------------------------------------
-- Every item, in due-date order (undated last, then the order they were
-- added), with whether this team has done it and who did. Members of the
-- team and admins only. Students can read each other's names anyway (the
-- roster shows them); this just saves the app a second query.
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
      'completed_at', d.completed_at,
      'completed_by', d.completed_by,
      'completed_by_name', u.name
    ) order by s.due_at nulls last, s.created_at, s.id)
    from public.next_steps s
    left join public.team_next_steps d on d.next_step_id = s.id and d.team_id = p_team_id
    left join public.users u on u.id = d.completed_by
  ), '[]'::jsonb);
end;
$$;

-- --- set_next_step_done --------------------------------------------------
-- Checks an item off (p_done true) or undoes it, for the caller's own team,
-- and returns the updated checklist. The checklist is for complete teams,
-- so a team still forming can't use it yet. Checking off an item someone
-- already did keeps the first record: two members ticking it at once don't
-- fight over who gets the credit.
create or replace function public.set_next_step_done(p_team_id uuid, p_next_step_id uuid, p_done boolean)
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
  if not exists (select 1 from public.next_steps where id = p_next_step_id) then
    raise exception 'Next step not found';
  end if;

  if coalesce(p_done, false) then
    insert into public.team_next_steps (team_id, next_step_id, completed_by)
    values (p_team_id, p_next_step_id, caller)
    on conflict (team_id, next_step_id) do nothing;
  else
    delete from public.team_next_steps
     where team_id = p_team_id and next_step_id = p_next_step_id;
  end if;

  return public.team_checklist(p_team_id);
end;
$$;

revoke all on function public.save_next_step(uuid, text, timestamptz), public.delete_next_step(uuid),
  public.team_checklist(uuid), public.set_next_step_done(uuid, uuid, boolean)
from public, anon;
grant execute on function public.save_next_step(uuid, text, timestamptz), public.delete_next_step(uuid),
  public.team_checklist(uuid), public.set_next_step_done(uuid, uuid, boolean)
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
