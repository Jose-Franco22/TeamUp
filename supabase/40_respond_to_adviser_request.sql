-- Accept or decline a request to advise a team (issue #54). Run after
-- 39_project_advisers.sql, which this depends on entirely: 39 builds
-- adviser_requests and the owner's half (inviting, cancelling, removing),
-- and deliberately never writes 'accepted'. This is what writes it.
--
-- Five things:
--
--   * respond_to_adviser_request(request, accept) — the invitee's answer
--   * private.require_not_the_adviser()           — one person, not both
--   * step_down_as_adviser(project)              — leaving afterwards
--   * my_adviser_requests()                      — what the Requests page lists
--   * advised_project_ids()                      — what the team page reads
--
-- THE SEAT RULE STILL HOLDS, and this is where it would most easily break.
-- 39 got it by keeping advisers out of team_members and touching no roster
-- code; accepting is the moment somebody would be tempted to seat them. It
-- does not. Nothing below writes to team_members, calls
-- sync_project_fill_state(), or touches projects.status, and
-- adviser_requests.test.sql's seat cases are repeated against a *really*
-- accepted adviser in adviser_responses.test.sql rather than one whose
-- status was set by hand.
--
-- WHAT CHANGED, AND WHY (#90 review). Holding the rule by leaving the roster
-- alone was not enough. 39 checks at invite time that the invitee is not on
-- the team, but that is a single moment: nothing stopped the adviser from
-- asking to join the same project afterwards, or an admin from placing them
-- on it, and nothing re-checked on accept. Either way one person ended up a
-- member and the adviser of one team. So the rule is now written down in both
-- directions — a check in respond_to_adviser_request(), and a trigger on the
-- two tables a seat is taken through. A rule that holds only because nobody
-- wrote the code that would break it is one commit from not holding.
--
-- ON STATUSES. Stepping down lands on 'cancelled', the same as the owner
-- removing an adviser. The four statuses in 39 are the four the issue names,
-- and 'accepted' → 'left' would be a fifth that differs only in who ended
-- it. Who ended it is in the notification: 'adviser_removed' goes to the
-- adviser, 'adviser_stepped_down' goes to the owner. The row says the link
-- is closed; the notification says whose doing it was.

begin;

-- --- the new kinds --------------------------------------------------------
-- Rewritten in full, as every migration since 21_ has done: the constraint
-- is the list. This is 39_project_advisers.sql's list plus the three below.
--
-- All three go to the project's owner. The adviser's own side is already
-- covered: they are told when they are invited ('adviser_invited') and when
-- they are dropped ('adviser_removed'), both from 39.

alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('adviser_accepted', 'adviser_declined', 'adviser_invited',
                  'adviser_removed', 'adviser_stepped_down', 'deadline_reminder',
                  'join_request', 'member_added', 'member_assigned',
                  'member_left', 'member_removed', 'project_removed',
                  'request_accepted', 'request_declined', 'team_complete'));

-- --- respond_to_adviser_request -------------------------------------------
-- Only the person asked, and only while the invitation is unanswered.
--
-- No "are you already advising too many" check: that is #60's capacity
-- limit, and until it exists advising several projects is allowed on purpose
-- — the issue says so ("I can advise more than one project").
--
-- No check that the project is still open or still forming either. An
-- adviser is not a seat, so a full team can gain one, and the invitation
-- outliving the recruiting period is not a reason to refuse it.

create or replace function public.respond_to_adviser_request(
  p_request_id uuid,
  p_accept boolean
)
returns public.adviser_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_row public.adviser_requests;
  v_project public.projects;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  if p_accept is null then
    raise exception 'Answer the invitation with accept or decline';
  end if;

  -- Locked for the length of the transaction, so two answers to the same
  -- invitation cannot both pass the pending check.
  select * into v_row
    from public.adviser_requests
   where id = p_request_id
     for update;
  if not found then
    raise exception 'Adviser request not found';
  end if;

  if v_row.adviser_id <> caller then
    raise exception 'Only the person who was asked can answer this invitation';
  end if;

  -- Covers all three of the ways it stops being answerable: the owner
  -- cancelled it, they already answered, or they are already the adviser.
  if v_row.status <> 'pending' then
    raise exception 'That adviser request has already been answered';
  end if;

  -- 39 checks at invite time that the invitee is not on the team. That is one
  -- moment, and this is a later one: nothing stopped them from joining the
  -- same project in between, which would leave one person both a member and
  -- the adviser of one team. Only accepting is refused — someone on the team
  -- who somehow holds an open invitation can still decline it, and should.
  --
  -- The invitation row is already locked above, which is what makes this and
  -- the roster trigger below a pair rather than two hopeful checks: whichever
  -- of "accept" and "seat them" commits first, the other sees it and refuses.
  if p_accept and exists (
    select 1
      from public.teams t
      join public.team_members tm on tm.team_id = t.id
     where t.project_id = v_row.project_id
       and tm.user_id = caller
  ) then
    raise exception 'You are on this team, so you cannot also advise it';
  end if;

  select * into v_project from public.projects where id = v_row.project_id;

  update public.adviser_requests
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where id = v_row.id
   returning * into v_row;

  insert into public.notifications (user_id, kind, project_id, actor_id)
  values (
    v_project.creator_id,
    case when p_accept then 'adviser_accepted' else 'adviser_declined' end,
    v_project.id,
    caller);

  return v_row;
end;
$$;

revoke all on function public.respond_to_adviser_request(uuid, boolean) from public, anon;
grant execute on function public.respond_to_adviser_request(uuid, boolean) to authenticated;

-- --- the same rule from the roster side -----------------------------------
-- The check above refuses accepting while on the team. This refuses the
-- reverse: taking a seat on a project you already advise.
--
-- It is a trigger rather than a check inside create_join_request() because
-- `git grep "insert into public.team_members"` finds eight statements across
-- seven migrations — accepting a join request, admin placement, releasing a
-- filled role, create_project seating the owner, and so on. A guard in any
-- one of them leaves the other seven open, and the next one written leaves
-- it open again. One trigger on the table closes all of them at once.
--
-- Two triggers off one function, exactly as 18_admin_access.sql keeps admin
-- accounts off rosters. The join_requests one is not strictly needed to hold
-- the rule — nothing is seated by asking — but it means the adviser is told
-- "no" when they ask rather than the owner hitting a wall on accepting.
--
-- `for update` on the invitation is the other half of the pair described
-- above. Accepting locks that row and then reads the roster; this locks the
-- same row and then reads its status. Concurrent attempts serialize on it,
-- so the second one to commit always sees the first.
--
-- The lock is taken on *every* request between this user and this project,
-- whatever its status, and the status is read afterwards in a statement of
-- its own. Filtering on `status = 'accepted'` in the locking select would
-- not serialize anything: while an accept is still in flight the row reads
-- 'pending' in this statement's snapshot, so Postgres skips it without
-- waiting, and both transactions commit (#90 review, second round). Locking
-- first means this waits for the accept to finish, and the check after it
-- starts with a fresh snapshot (read committed) that sees the result.
--
-- Scoped `of user_id, team_id` so the six statements that update a member's
-- role_id don't pay for it. An adviser of *another* project is unaffected:
-- #54 says advising doesn't stop you from being on a team of your own.
create or replace function private.require_not_the_adviser()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_project uuid;
begin
  if tg_table_name = 'join_requests' then
    v_project := new.project_id;
  else
    select t.project_id into v_project
      from public.teams t
     where t.id = new.team_id;
  end if;

  -- Lock, without looking at the status: see the note above.
  perform 1
    from public.adviser_requests ar
   where ar.project_id = v_project
     and ar.adviser_id = new.user_id
     for update;

  if exists (
    select 1
      from public.adviser_requests ar
     where ar.project_id = v_project
       and ar.adviser_id = new.user_id
       and ar.status = 'accepted'
  ) then
    raise exception 'The adviser of a project cannot also hold a seat on it'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- 18_ and 26_ create their triggers bare, since the harness drops the
-- database every run. These drop first because #88 had to be re-run by hand
-- on the live database once already (merge order, not numeric order), and a
-- file that cannot be re-run is a trap the second time that happens.
drop trigger if exists team_members_not_the_adviser on public.team_members;
create trigger team_members_not_the_adviser
  before insert or update of user_id, team_id on public.team_members
  for each row execute function private.require_not_the_adviser();
drop trigger if exists join_requests_not_the_adviser on public.join_requests;
create trigger join_requests_not_the_adviser
  before insert or update of user_id, project_id on public.join_requests
  for each row execute function private.require_not_the_adviser();

revoke all on function private.require_not_the_adviser() from public, anon, authenticated;

-- --- step_down_as_adviser -------------------------------------------------
-- The mirror of remove_adviser() in 39: same end state, opposite direction,
-- and the notification goes the other way. Keyed on the project rather than
-- the request id, like the owner's two, since the unique index means there
-- is at most one to leave.

create or replace function public.step_down_as_adviser(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_row public.adviser_requests;
  v_project public.projects;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  select * into v_row
    from public.adviser_requests
   where project_id = p_project_id
     and adviser_id = caller
     and status = 'accepted'
     for update;
  if not found then
    raise exception 'You are not the adviser for this project';
  end if;

  update public.adviser_requests
     set status = 'cancelled', responded_at = now()
   where id = v_row.id;

  insert into public.notifications (user_id, kind, project_id, actor_id)
  values (v_project.creator_id, 'adviser_stepped_down', p_project_id, caller);
end;
$$;

revoke all on function public.step_down_as_adviser(uuid) from public, anon;
grant execute on function public.step_down_as_adviser(uuid) to authenticated;

-- --- my_adviser_requests --------------------------------------------------
-- The invitations waiting for the caller's answer, for the Requests page.
--
-- The issue asks for the project name, its owner and what it is building, so
-- that somebody can decide without going to look the project up. Pending
-- only: an answered invitation is not waiting for anything, and a cancelled
-- one should stop being offered the moment the owner withdraws it.
--
-- A function rather than an embed, for the reason in 39's header:
-- adviser_requests points at `users` twice, so embedding it needs
-- `!constraint_name` disambiguation — the #47 PGRST200 shape.

create or replace function public.my_adviser_requests()
returns table (
  id                  uuid,
  project_id          uuid,
  project_title       text,
  project_description text,
  owner_id            uuid,
  owner_name          text,
  created_at          timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  return query
    select ar.id,
           ar.project_id,
           p.title,
           p.description,
           p.creator_id,
           u.name,
           ar.created_at
      from public.adviser_requests ar
      join public.projects p on p.id = ar.project_id
      join public.users u on u.id = p.creator_id
     where ar.adviser_id = caller
       and ar.status = 'pending'
     order by ar.created_at;
end;
$$;

revoke all on function public.my_adviser_requests() from public, anon;
grant execute on function public.my_adviser_requests() to authenticated;

-- --- advised_project_ids --------------------------------------------------
-- The projects the caller currently advises. Ids only: the client reads the
-- projects themselves through the same select every other project view uses,
-- so an advised project is shaped exactly like any other and no second
-- composition exists to drift.
--
-- Note the shape is private.advised_teams(adviser)'s, from Jose's
-- 38_adviser_digest.sql — teams there, projects here. Filling that stub is
-- this story's too, but it cannot land in this file: on the live database
-- migrations apply in merge order, not numeric order, so a 38 applied after
-- a 40 would put the stub back. It follows once #87 has merged.

create or replace function public.advised_project_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select ar.project_id
    from public.adviser_requests ar
   where ar.adviser_id = auth.uid()
     and ar.status = 'accepted';
$$;

revoke all on function public.advised_project_ids() from public, anon;
grant execute on function public.advised_project_ids() to authenticated;

commit;
