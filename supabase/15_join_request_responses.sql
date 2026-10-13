-- Accepting/declining join requests: full-team check, a race-safe last
-- seat, and notifying the requester. Run after 14_validate_profile_rules.sql.
--
-- Supersedes respond_to_join_request() from 04_roles_and_team_deletion.sql
-- (same signature, so the frontend call doesn't change). What's new:
--
--   * Accepting into a team that's already full is refused. Before, a
--     request sent while the project was open could still be accepted after
--     it filled, putting the roster over team_size_target.
--   * Two owners' clicks (or two tabs) accepting different requests for the
--     last seat at the same moment: exactly one wins. The project row is
--     locked before the roster is counted, so the second accept waits for
--     the first to commit, then counts again and sees the team is full.
--   * The requester gets one notification row either way.
--
-- This reverses TODO-backend.md's "notifications was considered and
-- deliberately dropped" for this one case: the join-request story requires
-- the requester to hear back. It's the "one table, no infrastructure"
-- activity-feed version that note describes, not push or email.

-- --- notifications -------------------------------------------------------
-- message is written at insert time, with the project title in it, so a
-- notification still reads correctly after the project is renamed or
-- deleted — which is also why the foreign keys SET NULL instead of
-- cascading: a declined student should still see "declined" after the
-- owner deletes the project.
create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  kind            text not null check (kind in ('request_accepted', 'request_declined')),
  join_request_id uuid references public.join_requests(id) on delete set null,
  project_id      uuid references public.projects(id) on delete set null,
  message         text not null,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists notifications_user_id_idx on public.notifications(user_id, created_at desc);

-- Students read and mark-as-read their own notifications. There's no
-- INSERT/DELETE policy: rows are only written by respond_to_join_request.
alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- --- respond_to_join_request ---------------------------------------------
-- Lock order, always the same so concurrent calls can't deadlock each
-- other: the requester's users row, then the request, then the project.
--
-- The requester lock serialises two owners accepting the same student onto
-- different teams at once: without it, each transaction holds its own
-- request row and the cascade-decline below waits on the other's, which
-- Postgres would break by killing one with a deadlock error.
create or replace function public.respond_to_join_request(
  p_request_id uuid,
  p_status text,
  p_role_id uuid default null
)
returns public.join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_requester uuid;
  v_request public.join_requests;
  v_project public.projects;
  v_team public.teams;
  v_count int;
begin
  if p_status is null or p_status not in ('accepted', 'declined') then
    raise exception 'status must be accepted or declined';
  end if;

  if p_status = 'accepted' and p_role_id is null then
    raise exception 'A role is required to accept a request';
  end if;

  select user_id into v_requester from public.join_requests where id = p_request_id;
  if not found then
    raise exception 'Request not found';
  end if;

  perform 1 from public.users where id = v_requester for no key update;

  select * into v_request from public.join_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;

  -- Locked before counting the roster: a second accept for the same team
  -- blocks here until the first commits, then sees its new member.
  select * into v_project from public.projects where id = v_request.project_id for no key update;

  if caller is null or v_project.creator_id <> caller then
    raise exception 'Only the project creator can respond to this request';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request has already been responded to';
  end if;

  if p_status = 'accepted' then
    if not exists (select 1 from public.roles where id = p_role_id) then
      raise exception 'A role is required to accept a request';
    end if;

    select * into v_team from public.teams where project_id = v_project.id;
    select count(*) into v_count from public.team_members where team_id = v_team.id;
    if v_count >= v_project.team_size_target then
      raise exception 'This team is already full';
    end if;

    if exists (select 1 from public.team_members where user_id = v_request.user_id) then
      raise exception 'That student has already joined a team';
    end if;
  end if;

  update public.join_requests set status = p_status where id = p_request_id;

  if p_status = 'accepted' then
    insert into public.team_members (user_id, team_id, role_id)
    values (v_request.user_id, v_team.id, p_role_id);

    if v_count + 1 >= v_project.team_size_target then
      update public.projects set status = 'full' where id = v_project.id;
      update public.teams set formed_at = coalesce(formed_at, now()) where id = v_team.id;
    end if;

    -- A student is only ever on one team, so every other request they have
    -- out is now unactionable. No notification for these: the student just
    -- got the "accepted" one, which is the news that matters.
    update public.join_requests
      set status = 'declined'
      where user_id = v_request.user_id
        and status = 'pending'
        and id <> p_request_id;
  end if;

  insert into public.notifications (user_id, kind, join_request_id, project_id, message)
  values (
    v_request.user_id,
    case p_status when 'accepted' then 'request_accepted' else 'request_declined' end,
    v_request.id,
    v_project.id,
    case p_status
      when 'accepted' then format('You were accepted onto %s', v_project.title)
      else format('Your request to join %s was declined', v_project.title)
    end
  );

  select * into v_request from public.join_requests where id = p_request_id;
  return v_request;
end;
$$;

grant execute on function public.respond_to_join_request(uuid, text, uuid) to authenticated;
