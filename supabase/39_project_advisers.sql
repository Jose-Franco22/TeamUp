-- Ask someone to advise my project (issue #53). Run after
-- 38_adviser_digest.sql (PR #87) if that has landed, otherwise after
-- 37_deadline_reminders.sql. Nothing here depends on 38.
--
-- A project may have one adviser: a student the owner asks to be the team's
-- contact. This file only builds the asking half — sending, cancelling and
-- removing, all of which are the owner's. Answering an invitation is #54,
-- which is why no function here ever writes 'accepted'.
--
-- The rule that shapes everything below:
--
--   AN ADVISER TAKES NO SEAT.
--
-- Not in `team_members`, so not in `project_member_count()`, not in
-- `sync_project_fill_state()`'s comparison, not against the `team_members`
-- primary key (one team per student), and not against the "you are already
-- on a team" guards in `create_join_request()` and `create_project()`. The
-- way to get all of that for free is to keep advisers out of `team_members`
-- entirely, which is what this does: a separate table, and not one line of
-- the roster code is touched. supabase/tests/adviser_requests.test.sql has a
-- case per guard, because "we changed nothing" is only true until someone
-- does.
--
-- Two decisions worth stating, since neither is obvious from the code:
--
-- 1. ADVISERS ARE STUDENTS, NOT ADMINS. 18_admin_access.sql hides admin
--    accounts from students (`users_select_students_or_admin`) and keeps them
--    off rosters. The search function below is SECURITY DEFINER and would
--    sail straight through that policy, so it filters admins out itself and
--    `invite_adviser()` refuses one. If the course decides faculty advisers
--    should be admin accounts, that is a change to an access rule somebody
--    made on purpose, and it belongs in its own issue — #60 is where adviser
--    identity gets revisited anyway.
--
-- 2. EVERY READ GOES THROUGH A FUNCTION, not a PostgREST embed. This table
--    has two foreign keys to `users` (adviser_id, invited_by), so embedding
--    it under a project needs `!constraint_name` disambiguation — the same
--    shape of query that shipped broken in #47 and answered PGRST200 in
--    production because mock mode could not see it. The two read functions
--    at the bottom return exactly what the two screens need, and there is no
--    embed to get wrong.

begin;

-- --- the new kinds --------------------------------------------------------
-- Rewritten in full rather than added to, as every migration since 21_ has
-- done: the constraint *is* the list, so the list has to be restated. This
-- is 37_deadline_reminders.sql's list plus the two below.
--
-- 'adviser_invited' goes to the person being asked — without it nothing
-- tells them there is anything to answer. 'adviser_removed' goes to an
-- adviser the owner drops after they had accepted. Cancelling a request
-- they never answered notifies nobody: there was nothing to undo for them.

alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('adviser_invited', 'adviser_removed', 'deadline_reminder',
                  'join_request', 'member_added', 'member_assigned',
                  'member_left', 'member_removed', 'project_removed',
                  'request_accepted', 'request_declined', 'team_complete'));

-- --- the table ------------------------------------------------------------
-- One row per invitation, including the ones that went nowhere: a declined
-- or cancelled row stays, so the owner can see what happened and ask someone
-- else. That history is also what makes "declined is visible and
-- re-invitable" expressible at all.
--
-- `status` is the four the issue names. Removing an adviser who had accepted
-- also lands on 'cancelled' — from the project's side both are the owner
-- withdrawing, and 'accepted' then 'removed' would be a fifth state that only
-- ever differs by how it is reported. Who was told is the difference, and
-- that is in the notification, not here.

create table if not exists public.adviser_requests (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  adviser_id   uuid not null
                 constraint adviser_requests_adviser_id_fkey
                 references public.users(id) on delete cascade,
  invited_by   uuid not null
                 constraint adviser_requests_invited_by_fkey
                 references public.users(id) on delete cascade,
  status       text not null default 'pending'
                 constraint adviser_requests_status_check
                 check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint adviser_requests_not_self check (adviser_id <> invited_by)
);

-- "At most one adviser and at most one pending request per project" is one
-- index, not three checks: pending and accepted are the two open states, and
-- a project may hold one row across both. The same shape as
-- join_requests_one_pending_idx, which has been doing this since the
-- baseline schema. It also closes the race two concurrent invites would
-- otherwise win together.
create unique index if not exists adviser_requests_one_open_idx
  on public.adviser_requests(project_id)
  where status in ('pending', 'accepted');

create index if not exists adviser_requests_adviser_idx
  on public.adviser_requests(adviser_id, status);

comment on table public.adviser_requests is
  'One project adviser, asked for by the project owner. Advisers are not '
  'team members and hold no seat: nothing here is counted by '
  'project_member_count() or sync_project_fill_state().';

-- --- who can read it ------------------------------------------------------
-- The team sees its own adviser, and the person asked sees their own
-- invitation. There is no insert, update or delete policy on purpose: every
-- write goes through the SECURITY DEFINER functions below, so the rules
-- cannot be sidestepped by posting straight at the table.

alter table public.adviser_requests enable row level security;

drop policy if exists adviser_requests_select_team_or_adviser on public.adviser_requests;
create policy adviser_requests_select_team_or_adviser
  on public.adviser_requests for select
  to authenticated
  using (
    adviser_id = auth.uid()
    or invited_by = auth.uid()
    or exists (
      select 1
        from public.teams t
        join public.team_members tm on tm.team_id = t.id
       where t.project_id = adviser_requests.project_id
         and tm.user_id = auth.uid()
    )
  );

-- --- invite_adviser -------------------------------------------------------
-- Checks run in this order, and every refusal raises before the insert, so a
-- rejected invitation notifies nobody:
--   signed in → project exists → caller owns it → invitee exists → not an
--   admin → not yourself → not on this team → no open request already.
--
-- "Not on this team" rather than "not on any team": a student advising
-- someone else's project while on a team of their own is the normal case, and
-- refusing it would make advisers scarce for no reason. Their own seat is
-- somewhere else and stays there.

create or replace function public.invite_adviser(p_project_id uuid, p_adviser_id uuid)
returns public.adviser_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_adviser public.users;
  v_open public.adviser_requests;
  v_row public.adviser_requests;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  if v_project.creator_id <> caller then
    raise exception 'Only the project creator can invite an adviser';
  end if;

  select * into v_adviser from public.users where id = p_adviser_id;
  if not found then
    raise exception 'That account does not exist';
  end if;

  -- See the header: this function reads `users` as its owner, so the policy
  -- that hides admins from students does not apply and has to be restated.
  if v_adviser.is_admin then
    raise exception 'Admin accounts cannot advise a student project';
  end if;

  if p_adviser_id = caller then
    raise exception 'You cannot invite yourself to advise your own project';
  end if;

  if exists (
    select 1
      from public.teams t
      join public.team_members tm on tm.team_id = t.id
     where t.project_id = p_project_id and tm.user_id = p_adviser_id
  ) then
    raise exception 'They are already on this team, so they cannot advise it';
  end if;

  -- Read before writing only to say which of the two it is; the unique index
  -- is what actually holds the rule.
  select * into v_open
    from public.adviser_requests
   where project_id = p_project_id and status in ('pending', 'accepted')
   limit 1;
  if found then
    if v_open.status = 'accepted' then
      raise exception 'This project already has an adviser';
    else
      raise exception 'This project already has a pending adviser request';
    end if;
  end if;

  insert into public.adviser_requests (project_id, adviser_id, invited_by)
  values (p_project_id, p_adviser_id, caller)
  returning * into v_row;

  insert into public.notifications (user_id, kind, project_id, actor_id)
  values (p_adviser_id, 'adviser_invited', p_project_id, caller);

  return v_row;
end;
$$;

grant execute on function public.invite_adviser(uuid, uuid) to authenticated;

-- --- cancel_adviser_request -----------------------------------------------
-- The owner withdraws an invitation nobody has answered. Keyed on the
-- project rather than the request id: the unique index above means there is
-- at most one to cancel, so the caller does not need to know which.
--
-- Nobody is notified. The invitation is gone before they acted on it, and a
-- 'your invitation was withdrawn' note for something they never saw is noise.
-- Their unread 'adviser_invited' notification is left alone deliberately —
-- rewriting history read as "we told you and then we didn't" in review of
-- #25, and #54's list is where a withdrawn invitation stops being offered.

create or replace function public.cancel_adviser_request(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_row public.adviser_requests;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  if v_project.creator_id <> caller then
    raise exception 'Only the project creator can cancel an adviser request';
  end if;

  select * into v_row
    from public.adviser_requests
   where project_id = p_project_id and status = 'pending'
     for update;
  if not found then
    raise exception 'There is no pending adviser request to cancel';
  end if;

  update public.adviser_requests
     set status = 'cancelled', responded_at = now()
   where id = v_row.id;
end;
$$;

grant execute on function public.cancel_adviser_request(uuid) to authenticated;

-- --- remove_adviser -------------------------------------------------------
-- The owner drops an adviser who had accepted. Separate from cancelling
-- because the two differ in what they mean to the other person: this one
-- takes away something they said yes to, so they are told.

create or replace function public.remove_adviser(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_row public.adviser_requests;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  if v_project.creator_id <> caller then
    raise exception 'Only the project creator can remove the adviser';
  end if;

  select * into v_row
    from public.adviser_requests
   where project_id = p_project_id and status = 'accepted'
     for update;
  if not found then
    raise exception 'This project has no adviser to remove';
  end if;

  update public.adviser_requests
     set status = 'cancelled', responded_at = now()
   where id = v_row.id;

  insert into public.notifications (user_id, kind, project_id, actor_id)
  values (v_row.adviser_id, 'adviser_removed', p_project_id, caller);
end;
$$;

grant execute on function public.remove_adviser(uuid) to authenticated;

-- --- search_advisers ------------------------------------------------------
-- Who the owner may ask, by name or email. Returns id, name and email and
-- nothing else — this runs as its owner, so every column it selects is a
-- column it has decided to expose.
--
-- Excluded: the owner, everyone already on the team, admin accounts, and
-- whoever currently holds an open request (so the one person who would be
-- refused is not offered). Someone who declined earlier is still listed:
-- re-inviting them is allowed, and hiding them would make a declined
-- invitation look like a ban.
--
-- Two characters minimum, so an empty box does not return the student body.
-- Ordered by name and capped at 10. #60 adds availability, expertise and a
-- capacity limit on top: it will want to reorder this list and mark some
-- people 'Full', which is why the cap and the order are in one place here
-- rather than in the client.

create or replace function public.search_advisers(p_project_id uuid, p_query text)
returns table (id uuid, name text, email text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_query text := btrim(coalesce(p_query, ''));
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  if v_project.creator_id <> caller then
    raise exception 'Only the project creator can look for an adviser';
  end if;

  if char_length(v_query) < 2 then
    return;
  end if;

  return query
    select u.id, u.name, u.email
      from public.users u
     where not u.is_admin
       and u.id <> caller
       and (u.name ilike '%' || v_query || '%' or u.email ilike '%' || v_query || '%')
       and not exists (
         select 1
           from public.teams t
           join public.team_members tm on tm.team_id = t.id
          where t.project_id = p_project_id and tm.user_id = u.id
       )
       and not exists (
         select 1
           from public.adviser_requests ar
          where ar.project_id = p_project_id
            and ar.adviser_id = u.id
            and ar.status in ('pending', 'accepted')
       )
     order by u.name
     limit 10;
end;
$$;

grant execute on function public.search_advisers(uuid, text) to authenticated;

-- --- project_adviser ------------------------------------------------------
-- What the team page shows: the open request if there is one, otherwise the
-- most recent answered one, so a decline stays visible instead of the panel
-- silently emptying. Null when the project has never asked anyone.
--
-- Readable by anyone signed in, like the roster itself
-- (`team_members_select_students`), so a student can see who advises a
-- project before asking to join it. Email comes back only to the owner:
-- the team needs the name, and only the owner has a reason to contact them
-- through the app.

create or replace function public.project_adviser(p_project_id uuid)
returns table (
  status        text,
  adviser_id    uuid,
  adviser_name  text,
  adviser_email text,
  created_at    timestamptz,
  responded_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_is_owner boolean;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select p.creator_id = caller into v_is_owner
    from public.projects p where p.id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  return query
    select ar.status,
           ar.adviser_id,
           u.name,
           case when v_is_owner then u.email else null end,
           ar.created_at,
           ar.responded_at
      from public.adviser_requests ar
      join public.users u on u.id = ar.adviser_id
     where ar.project_id = p_project_id
       -- 'cancelled' is left out rather than ordered last: the owner undid
       -- it on purpose, and the panel should be empty again afterwards, not
       -- showing who they just dropped. A decline is someone else's answer,
       -- so that one stays.
       and ar.status <> 'cancelled'
     -- Open first, then newest.
     order by (ar.status in ('pending', 'accepted')) desc, ar.created_at desc
     limit 1;
end;
$$;

grant execute on function public.project_adviser(uuid) to authenticated;

-- --- project_advisers -----------------------------------------------------
-- The Browse list's version: accepted advisers for many projects in one
-- call, the same shape as project_member_counts() in 18_admin_access.sql and
-- for the same reason — one round trip for a page of cards instead of one
-- per card.
--
-- Accepted only, names only, and authenticated only: a guest browsing gets
-- seat counts but no identities anywhere else, and an adviser is an identity.

create or replace function public.project_advisers(p_project_ids uuid[])
returns table (project_id uuid, adviser_id uuid, adviser_name text)
language sql
stable
security definer
set search_path = public
as $$
  select ar.project_id, ar.adviser_id, u.name
    from public.adviser_requests ar
    join public.users u on u.id = ar.adviser_id
   where ar.project_id = any(p_project_ids)
     and ar.status = 'accepted';
$$;

revoke all on function public.project_advisers(uuid[]) from public, anon;
grant execute on function public.project_advisers(uuid[]) to authenticated;

commit;
