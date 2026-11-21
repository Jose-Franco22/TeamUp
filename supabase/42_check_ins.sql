-- Weekly team check-ins (issue #55). Run after 40_respond_to_adviser_request.sql:
-- the adviser who can read a team's check-ins is an accepted row in
-- adviser_requests (39_project_advisers.sql, #53/#54).
--
-- Once a team is formed, each member posts one short check-in a week — what
-- they did, what's next, and anything blocking them — so the team and its
-- adviser can see progress without a meeting.
--
-- What this adds:
--
--   * public.check_in_week_start(at), the Monday a moment falls in, on
--     Central time (UTRGV's). Weeks run Monday–Sunday there, and it is the
--     one definition of "this week" everything below uses.
--     frontend/src/lib/checkIns.js weekStart() is its twin;
--   * public.check_ins, one row per (member, project, week). The unique
--     constraint is the "one check-in per member per week" rule;
--   * RLS: the team's members and its accepted adviser read; a member writes
--     only their own row, only for the current week, and only once the team
--     is formed. Editing last week's check-in is refused because its week
--     has ended — the issue's "I can edit mine until the week ends";
--   * 'check_in_reminder' notifications from private.send_check_in_reminders(),
--     run hourly by pg_cron: from Friday 6 PM Central, every member of a
--     formed team who hasn't checked in this week gets one, once.
--
-- Writes go straight at the table through supabase-js rather than through a
-- function, unlike most writes in this schema: every rule here is a property
-- of the row being written (whose it is, which week, which team), which is
-- exactly what an RLS policy checks, and it keeps the rules testable as
-- policies (supabase/tests/check_ins.test.sql).
--
-- The team is keyed by project_id, the way adviser_requests is: a project has
-- exactly one team, and the adviser is attached to the project.
begin;

-- --- the week ---------------------------------------------------------------
-- `timestamptz at time zone` gives Central wall-clock time, DST included, and
-- date_trunc('week', …) is ISO weeks, which start on Monday.
create or replace function public.check_in_week_start(p_at timestamptz default now())
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('week', p_at at time zone 'America/Chicago')::date;
$$;

-- --- the table --------------------------------------------------------------
create table if not exists public.check_ins (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.users(id) on delete cascade,
  week_start  date not null default public.check_in_week_start(),
  did         text not null,
  doing_next  text not null,
  blockers    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint check_ins_one_per_week unique (user_id, project_id, week_start),
  constraint check_ins_week_is_monday check (extract(isodow from week_start) = 1),
  -- The form's limits (frontend/src/lib/checkIns.js CHECK_IN_MAX). The first
  -- two are required; blockers is optional, and blank is stored as null by
  -- the trigger below so "has a blocker" is just `blockers is not null`.
  constraint check_ins_did_length check (btrim(did) <> '' and char_length(did) <= 500),
  constraint check_ins_doing_next_length check (btrim(doing_next) <> '' and char_length(doing_next) <= 500),
  constraint check_ins_blockers_length check (blockers is null or (btrim(blockers) <> '' and char_length(blockers) <= 500))
);

create index if not exists check_ins_project_week_idx
  on public.check_ins(project_id, week_start desc);

comment on table public.check_ins is
  'Weekly check-ins (#55): one per team member per Monday–Sunday Central week. '
  'Readable by the team and its accepted adviser only.';

-- Edits keep the row where it is: whose it is, which team and which week are
-- fixed once posted. The update policy already insists the edited row is the
-- caller's and this week's; this says so outright, with a clearer error, and
-- also pins project_id.
create or replace function private.check_ins_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.blockers := nullif(btrim(new.blockers), '');
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id
       or new.project_id is distinct from old.project_id
       or new.week_start is distinct from old.week_start then
      raise exception 'A check-in stays with its author, team and week'
        using errcode = '42501';
    end if;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists check_ins_before_write on public.check_ins;
create trigger check_ins_before_write
  before insert or update on public.check_ins
  for each row execute function private.check_ins_before_write();

-- --- who is who -------------------------------------------------------------
-- SECURITY DEFINER so the policies don't depend on what the caller may read
-- of team_members or adviser_requests, and in `private` so PostgREST doesn't
-- expose them (see 18_admin_access.sql).

create or replace function private.is_on_project_team(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.teams t
      join public.team_members tm on tm.team_id = t.id
     where t.project_id = p_project_id
       and tm.user_id = auth.uid()
  );
$$;

-- "Once my team is formed": teams.formed_at is set when the roster fills and
-- cleared if a seat opens again (05_membership.sql), so posting pauses while
-- a team is recruiting a replacement. Reading doesn't.
create or replace function private.is_on_formed_project_team(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.teams t
      join public.team_members tm on tm.team_id = t.id
     where t.project_id = p_project_id
       and t.formed_at is not null
       and tm.user_id = auth.uid()
  );
$$;

-- Accepted only. A pending invitation is not an adviser yet, and a declined or
-- cancelled one never was or no longer is.
create or replace function private.advises_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.adviser_requests ar
     where ar.project_id = p_project_id
       and ar.adviser_id = auth.uid()
       and ar.status = 'accepted'
  );
$$;

revoke all on function private.is_on_project_team(uuid) from public, anon, authenticated;
revoke all on function private.is_on_formed_project_team(uuid) from public, anon, authenticated;
revoke all on function private.advises_project(uuid) from public, anon, authenticated;
grant execute on function private.is_on_project_team(uuid) to authenticated;
grant execute on function private.is_on_formed_project_team(uuid) to authenticated;
grant execute on function private.advises_project(uuid) to authenticated;

-- --- policies ---------------------------------------------------------------
alter table public.check_ins enable row level security;

-- No delete: a check-in is a record of the week. Guests get nothing at all.
revoke all on table public.check_ins from anon;
revoke delete, truncate on table public.check_ins from authenticated;

drop policy if exists check_ins_select_team_or_adviser on public.check_ins;
create policy check_ins_select_team_or_adviser
  on public.check_ins for select
  to authenticated
  using (private.is_on_project_team(project_id) or private.advises_project(project_id));

drop policy if exists check_ins_insert_own_this_week on public.check_ins;
create policy check_ins_insert_own_this_week
  on public.check_ins for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and week_start = public.check_in_week_start()
    and private.is_on_formed_project_team(project_id)
  );

-- `using` picks which rows may be edited (mine, this week); `with check` holds
-- the edited row to the same rules as a new one.
drop policy if exists check_ins_update_own_this_week on public.check_ins;
create policy check_ins_update_own_this_week
  on public.check_ins for update
  to authenticated
  using (user_id = auth.uid() and week_start = public.check_in_week_start())
  with check (
    user_id = auth.uid()
    and week_start = public.check_in_week_start()
    and private.is_on_formed_project_team(project_id)
  );

-- --- the reminder kind ------------------------------------------------------
-- Rewritten in full, as every migration since 21_ has done: 40's list plus
-- 'check_in_reminder'. The row names the project, so the bell can say which
-- team, and has no actor — nobody sent it.
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('adviser_accepted', 'adviser_declined', 'adviser_invited',
                  'adviser_removed', 'adviser_stepped_down', 'check_in_reminder',
                  'deadline_reminder', 'join_request', 'member_added',
                  'member_assigned', 'member_left', 'member_removed',
                  'project_removed', 'request_accepted', 'request_declined',
                  'team_complete'));

-- --- what's been sent -------------------------------------------------------
-- One row per reminder sent; the primary key is what makes a second run of
-- the job in the same week a no-op. Same shape as private.deadline_reminders.
create table if not exists private.check_in_reminders (
  user_id     uuid not null references public.users(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  week_start  date not null,
  sent_at     timestamptz not null default now(),
  primary key (user_id, project_id, week_start)
);

revoke all on table private.check_in_reminders from public, anon, authenticated;

-- --- the job ----------------------------------------------------------------
-- "Friday evening" is from 6 PM Friday, Central, to the end of the week. A run
-- that is late (the scheduler was down Friday night) still reminds on
-- Saturday or Sunday, while there is still time to check in; before Friday
-- 6 PM it does nothing. Returns how many reminders it sent. p_now defaults to
-- now(); the tests pass a fixed clock.
create or replace function private.send_check_in_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'America/Chicago';
  v_week date := public.check_in_week_start(p_now);
  v_sent integer;
begin
  if p_now is null then
    return 0;
  end if;
  if not (extract(isodow from v_local) in (6, 7)
          or (extract(isodow from v_local) = 5 and extract(hour from v_local) >= 18)) then
    return 0;
  end if;

  with due as (
    select tm.user_id, t.project_id
      from public.teams t
      join public.team_members tm on tm.team_id = t.id
     where t.formed_at is not null
       and not exists (
         select 1 from public.check_ins c
          where c.user_id = tm.user_id
            and c.project_id = t.project_id
            and c.week_start = v_week
       )
  ),
  sent as (
    insert into private.check_in_reminders (user_id, project_id, week_start)
    select user_id, project_id, v_week from due
    on conflict do nothing
    returning user_id, project_id
  )
  insert into public.notifications (user_id, kind, project_id)
  select user_id, 'check_in_reminder', project_id from sent;

  get diagnostics v_sent = row_count;
  return v_sent;
end;
$$;

revoke all on function private.send_check_in_reminders(timestamptz) from public, anon, authenticated;

-- --- the schedule -----------------------------------------------------------
-- Hourly, like deadline-reminders (37_deadline_reminders.sql), so the Friday
-- 6 PM reminder goes out within the hour whatever the UTC offset is that week.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cmd$
      select cron.schedule(
        'check-in-reminders',
        '0 * * * *',
        'select private.send_check_in_reminders()'
      )
    $cmd$;
  else
    raise notice 'pg_cron is not enabled, so the check-in-reminders job was not scheduled';
  end if;
end;
$$;

commit;
