-- Semesters: close the current one and start the next (issue #61). Run after
-- 49_overdue_after_formed.sql (#105), whose teams.first_formed_at the
-- adviser_dashboard() below is built on. Every numbered file before this one
-- is assumed. (Numbered 50 because #105 took 49 first.)
--
-- APPLY THIS TO THE LIVE DATABASE BEFORE THE FRONTEND THAT READS IT SHIPS,
-- and rehearse the whole close-and-start cycle on a Supabase branch database
-- first. The backfill below touches every existing project, milestone,
-- announcement and next step.
--
-- What it adds:
--
--   * public.semesters, with exactly one current semester at a time;
--   * semester_id on the four tables that are course-wide per semester —
--     projects, milestones, announcements, next_steps — and a backfill that
--     puts every existing row in a first semester, "Fall 2026";
--   * close_semester(), start_semester() and the read functions the admin's
--     Close semester flow and the Past semesters section need;
--   * every read path that should mean "this semester" now does.
--
-- Safe to run again: the table, columns and indexes are `if not exists`, the
-- first semester is only inserted when there are none, the backfill only
-- touches rows that have no semester yet, every policy is dropped first, and
-- every function is `create or replace`.
--
-- THE DECISIONS, since most of them are not visible as a line of code:
--
-- 1. ONE RULE FOR "CURRENT": public.current_semester_id(). Nothing else
--    decides which semester is the current one, and nothing writes a semester
--    id down to filter by later.
--
--    Where a table policy can carry the filter, it does. projects' select
--    policy admits only current-semester rows, and the tables that hang off a
--    project (teams, team_members, project_roles_needed, join_requests,
--    adviser_requests, check_ins, next_step_completions) are readable only
--    when their project is — they ask by selecting the project, so the rule
--    is written once, on projects, and a future feature that reads any of
--    them gets the current semester without having to remember to. That is
--    what makes Browse, Requests and the team page current-only with no
--    change to the queries client.js sends.
--
--    SECURITY DEFINER functions walk past those policies, so each one that
--    answers a "this semester" question compares against current_semester_id()
--    itself, and each has a pgTAP case with an archived row present that
--    would fail if it didn't.
--
-- 2. SEMESTER_ID LIVES ON FOUR TABLES AND NO OTHERS.
--
--      projects        — everything a team does hangs off its project, so
--                        teams, team_members, join_requests, adviser_requests,
--                        check_ins, deliverable_submissions,
--                        deliverable_comments, repo_activity,
--                        next_step_completions, notifications and
--                        admin_actions all inherit it through project_id or
--                        team_id. A column of their own would be a second
--                        copy of the answer, and a second thing to get out of
--                        step.
--      milestones, announcements, next_steps
--                      — course-wide, but per semester: January's class gets
--                        its own schedule, notices and checklist.
--
--    Deliberately left without one, because they persist across semesters:
--    users, roles, skills, user_skills, profile_evidence, faculty_directory,
--    adviser_expertise. A student's skills and a faculty member's areas do not
--    reset in January. (app_settings, named in the issue, was dropped by
--    26_milestones.sql; the formation deadline it held is a milestone.)
--
--    adviser_digests is left without one too, on purpose: a row is keyed by
--    adviser and week_start, so it is already bounded in time, and its `data`
--    is a snapshot of what was emailed that Monday. What goes *into* that
--    snapshot is current-semester only (adviser_digest_data() below), which
--    is where the rule belongs.
--
-- 3. THE FORMATION DEADLINE IS THE SEMESTER'S FLAGGED MILESTONE, not a column
--    on semesters. It already lives in milestones (26_), save_milestone() can
--    move it, and the deadline triggers read it through formation_deadline().
--    A semesters.formation_deadline column would be a second copy of that
--    date that save_milestone() could move without. start_semester() takes
--    the date and writes the flagged milestone; current_semester() reads it
--    back; "one formation deadline" becomes one per semester.
--
-- 4. ARCHIVED MEANS READ-ONLY AT THE TABLE, NOT IN EACH FUNCTION. One trigger
--    function, private.archive_guard(), runs before every insert, update and
--    delete on every table that belongs to a semester, finds the row's
--    semester (its own column, or its project's, or its team's), and refuses
--    if that semester has been closed. Every write path there is — the
--    thirty-odd SECURITY DEFINER functions, check_ins' direct-insert policy,
--    the GitHub Edge Function's service-role writes, the SQL editor — goes
--    through it, so a function written next year cannot forget it. Closing a
--    semester writes its cancellations *before* it flips closed_at, so it
--    needs no way around its own guard.
--
-- 5. ONE TEAM PER STUDENT PER SEMESTER. team_members.user_id was the primary
--    key — one team per student, ever — which is exactly the rule that has to
--    give: a student whose Fall team is archived must be able to join one in
--    Spring without that row being deleted. The key becomes (user_id,
--    team_id), and the per-semester rule moves to a trigger that serializes
--    on the student and refuses a second team in the same semester. Every
--    "already on a team" check now asks private.current_team_id().
--
-- 6. ENDING AN ADVISER LINK IS NOT A STATUS. An accepted adviser_requests row
--    stays 'accepted' after its semester closes: it is the record that they
--    advised that team, and Past semesters reads it as exactly that. The link
--    has ended because its semester has — advised_project_ids(), capacity,
--    the dashboard, the digest and the export all count accepted rows on
--    *current* projects only. A separate 'ended' status would be a second
--    statement of "the semester closed", and the two could disagree.
--    Pending ones are different: an unanswered request is open business, so
--    closing cancels it ('cancelled', for join requests and adviser requests
--    alike). That is also why my_adviser_requests() (40_), the adviser
--    invitations on the Requests page, is not redefined here: it reads
--    pending rows only, and after a close there are none outside the current
--    semester. A semester filter in it could never change its answer.
--
-- 7. CLOSING DELETES NOTHING. It cancels pending requests, marks the
--    notifications that asked someone to answer them as read (the same thing
--    withdraw_join_request() does), and stamps the semester closed. Every row
--    in every table is still there afterwards; the pgTAP file counts them.
--
-- 8. A CLOSE CAN BE UNDONE, BRIEFLY. reopen_semester() reopens the most
--    recently closed semester, and only while no other semester has been
--    started — the window for "closed too early" or "closed the wrong one".
--    The limit is on *when*, not how often: the harm in reopening is doing it
--    after students have moved on to the next semester's teams, which no
--    count would stop and the window does. Reopening undoes the archive, not
--    the cancellations: requests the close cancelled stay cancelled, and
--    anyone who still wants in asks again. reopened_at and reopened_by keep
--    the record that it happened.
begin;

-- --- semesters ------------------------------------------------------------
-- is_current is generated from closed_at rather than stored beside it, so the
-- two can't disagree: a semester is current until it is closed. The partial
-- unique index is the "exactly one" — a second open semester is refused by
-- the index, whoever writes it.

create table if not exists public.semesters (
  id         uuid primary key default gen_random_uuid(),
  name       text not null
               constraint semesters_name_check
               check (char_length(name) between 1 and 40 and name = btrim(name)),
  starts_on  date not null,
  ends_on    date not null,
  created_at timestamptz not null default now(),
  closed_at  timestamptz,
  closed_by  uuid
               constraint semesters_closed_by_fkey
               references public.users(id) on delete set null,
  -- The last time it was reopened, and by whom (decision 8). Kept after it
  -- closes again, so the record says a close was undone once.
  reopened_at timestamptz,
  reopened_by uuid
               constraint semesters_reopened_by_fkey
               references public.users(id) on delete set null,
  is_current boolean generated always as (closed_at is null) stored,
  constraint semesters_dates_check check (ends_on > starts_on)
);

create unique index if not exists semesters_one_current
  on public.semesters (is_current) where is_current;

-- The name is what an admin types to confirm closing, so two semesters that
-- differ only in case would make that confirmation mean nothing.
create unique index if not exists semesters_name_key
  on public.semesters (lower(name));

comment on table public.semesters is
  'One row per semester. Exactly one is current (closed_at is null); closing '
  'one archives everything in it read-only. Written only by start_semester() '
  'and close_semester().';

-- Names and dates are not sensitive. A select policy and nothing else: the
-- two functions are the only way to write.
alter table public.semesters enable row level security;

drop policy if exists semesters_select_signed_in on public.semesters;
create policy semesters_select_signed_in
  on public.semesters for select
  to authenticated
  using (true);

-- --- current_semester_id ----------------------------------------------------
-- The one rule (decision 1). Null between closing one semester and starting
-- the next, when nothing is current.
--
-- Executable by anon as well as authenticated, unlike the house default:
-- projects' select policy calls it, and that policy is evaluated for guests
-- too (02_rls_policies.sql lets them browse). Revoking anon would turn every
-- guest read of projects into a permission error. It returns an id and
-- nothing else.
create or replace function public.current_semester_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.semesters s where s.is_current;
$$;

revoke all on function public.current_semester_id() from public;
grant execute on function public.current_semester_id() to anon, authenticated;

-- --- the columns --------------------------------------------------------------
-- Added nullable, backfilled, then made not null — the order that works on a
-- live table. `add column if not exists` because these four tables were
-- created in the Supabase dashboard (projects) or by earlier files, and this
-- has to run against what is there. No `on delete`: semesters are never
-- deleted, and a restrict is the right answer if one ever is.

alter table public.projects
  add column if not exists semester_id uuid references public.semesters(id);
alter table public.milestones
  add column if not exists semester_id uuid references public.semesters(id);
alter table public.announcements
  add column if not exists semester_id uuid references public.semesters(id);
alter table public.next_steps
  add column if not exists semester_id uuid references public.semesters(id);

-- --- the first semester ---------------------------------------------------------
-- Only when there are no semesters at all, so a re-run after Fall 2026 has
-- closed doesn't make a second one. Dates are UTRGV's Fall 2026 (first day
-- of classes to the end of finals); fix them with an UPDATE before shipping
-- if the registrar's calendar says otherwise — nothing reads them to decide
-- anything.

insert into public.semesters (name, starts_on, ends_on)
select 'Fall 2026', date '2026-08-24', date '2026-12-12'
 where not exists (select 1 from public.semesters);

-- --- the backfill -------------------------------------------------------------
-- The riskiest statement in this file: get it wrong and live rows are
-- orphaned with no error anywhere. So it is a function rather than four
-- loose UPDATEs — supabase/tests/semesters.test.sql calls it on rows that
-- have no semester, which is the only way CI can see it work, since the
-- harness builds from an empty database — and it checks its own work:
--
--   * every table's total row count is the same after as before (an UPDATE
--     cannot change it; this is here so that an edit that made it something
--     other than an UPDATE would be caught);
--   * no row in the four tables is left without a semester;
--   * every row that inherits a semester through a project or team can
--     reach one.
--
-- Any of those failing raises, which rolls the whole migration back. Only
-- rows with no semester are touched, so it is idempotent: a second call
-- changes nothing and says so. Returns what it counted, which the migration
-- prints as a NOTICE for whoever runs it.

create or replace function private.backfill_semester(p_semester_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tables text[] := array[
    'projects', 'milestones', 'announcements', 'next_steps',
    'teams', 'team_members', 'project_roles_needed', 'join_requests',
    'adviser_requests', 'check_ins', 'deliverable_submissions',
    'deliverable_comments', 'repo_activity', 'next_step_completions',
    'notifications', 'admin_actions'];
  v_table text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_moved jsonb := '{}'::jsonb;
  v_count bigint;
  v_orphans bigint;
begin
  if not exists (select 1 from public.semesters where id = p_semester_id) then
    raise exception 'Backfill: semester % does not exist', p_semester_id;
  end if;

  foreach v_table in array v_tables loop
    execute format('select count(*) from public.%I', v_table) into v_count;
    v_before := v_before || jsonb_build_object(v_table, v_count);
  end loop;

  update public.projects set semester_id = p_semester_id where semester_id is null;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('projects', v_count);

  update public.milestones set semester_id = p_semester_id where semester_id is null;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('milestones', v_count);

  update public.announcements set semester_id = p_semester_id where semester_id is null;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('announcements', v_count);

  update public.next_steps set semester_id = p_semester_id where semester_id is null;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('next_steps', v_count);

  foreach v_table in array v_tables loop
    execute format('select count(*) from public.%I', v_table) into v_count;
    v_after := v_after || jsonb_build_object(v_table, v_count);
  end loop;

  if v_after <> v_before then
    raise exception 'Backfill changed row counts: before %, after %', v_before, v_after;
  end if;

  foreach v_table in array array['projects', 'milestones', 'announcements', 'next_steps'] loop
    execute format('select count(*) from public.%I where semester_id is null', v_table) into v_count;
    if v_count > 0 then
      raise exception 'Backfill left % row(s) in % without a semester', v_count, v_table;
    end if;
  end loop;

  -- Inherited through project_id. notifications and admin_actions allow a
  -- null project (a deleted project's notice, a removal log), and those have
  -- nothing to inherit, so only rows that name a project are counted.
  foreach v_table in array array['teams', 'project_roles_needed', 'join_requests',
                                 'adviser_requests', 'check_ins', 'deliverable_submissions',
                                 'deliverable_comments', 'repo_activity', 'notifications'] loop
    execute format(
      'select count(*) from public.%I x
         left join public.projects p on p.id = x.project_id
        where x.project_id is not null and p.semester_id is null', v_table)
      into v_orphans;
    if v_orphans > 0 then
      raise exception 'Backfill left % row(s) in % whose project has no semester', v_orphans, v_table;
    end if;
  end loop;

  -- Inherited through team_id.
  foreach v_table in array array['team_members', 'next_step_completions'] loop
    execute format(
      'select count(*) from public.%I x
         left join public.teams t on t.id = x.team_id
         left join public.projects p on p.id = t.project_id
        where p.semester_id is null', v_table)
      into v_orphans;
    if v_orphans > 0 then
      raise exception 'Backfill left % row(s) in % whose team has no semester', v_orphans, v_table;
    end if;
  end loop;

  return jsonb_build_object('semester_id', p_semester_id, 'moved', v_moved,
                            'before', v_before, 'after', v_after);
end;
$$;

revoke all on function private.backfill_semester(uuid) from public, anon, authenticated;

do $$
declare
  v_result jsonb;
begin
  v_result := private.backfill_semester(
    (select id from public.semesters where name = 'Fall 2026'));
  raise notice 'Semester backfill: %', v_result;
end;
$$;

alter table public.projects      alter column semester_id set not null;
alter table public.milestones    alter column semester_id set not null;
alter table public.announcements alter column semester_id set not null;
alter table public.next_steps    alter column semester_id set not null;

create index if not exists projects_semester_id_idx on public.projects (semester_id);
create index if not exists announcements_semester_idx
  on public.announcements (semester_id, created_at desc);
create index if not exists milestones_semester_idx on public.milestones (semester_id, due_at);

-- One formation deadline per semester, not one ever (26_). Dropped and made
-- again rather than `if not exists`, so a re-run over the old index replaces
-- it instead of keeping it.
drop index if exists public.milestones_one_formation_deadline;
create unique index milestones_one_formation_deadline
  on public.milestones (semester_id) where is_formation_deadline;

-- Each semester's checklist numbers from 1. Still deferrable, for the reason
-- 33_next_steps.sql gives: a reorder moves several rows in one statement.
alter table public.next_steps drop constraint if exists next_steps_sort_order_unique;
alter table public.next_steps
  add constraint next_steps_sort_order_unique
  unique (semester_id, sort_order) deferrable initially immediate;

-- --- statuses ------------------------------------------------------------------
-- 'cancelled' for a join request the semester closed on. 24_'s list, plus
-- one. adviser_requests already has 'cancelled' (39_), which is what an
-- owner cancelling lands on too; from the adviser's side the two are the
-- same — nobody needs an answer any more.

alter table public.join_requests drop constraint if exists join_requests_status_check;
alter table public.join_requests
  add constraint join_requests_status_check
  check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'cancelled'));

-- --- one team per student per semester (decision 5) ---------------------------
-- The live table was made in the dashboard, so the primary key's name is read
-- rather than assumed. Only swapped while it is still the old single-column
-- key, so a re-run leaves the new one alone.

do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.team_members'::regclass
     and contype = 'p'
     and pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id)';
  if v_name is not null then
    execute format('alter table public.team_members drop constraint %I', v_name);
    alter table public.team_members add constraint team_members_pkey primary key (user_id, team_id);
  end if;
end;
$$;

-- The rule the old key held, per semester. The advisory lock is per student:
-- two transactions seating the same student take turns, so the second sees
-- the first's row and refuses — the race the unique key used to close. It
-- raises 23505, the code the key violation had, with a sentence instead of a
-- constraint name; every function checks first and says it better, so this
-- is the floor, not the message anyone normally reads.
create or replace function private.one_team_per_semester()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_semester uuid;
  -- The row being updated is not a second team; on insert there is none.
  v_self_user uuid;
  v_self_team uuid;
begin
  if tg_op = 'UPDATE' then
    v_self_user := old.user_id;
    v_self_team := old.team_id;
  end if;

  select p.semester_id into v_semester
    from public.teams t
    join public.projects p on p.id = t.project_id
   where t.id = new.team_id;

  perform pg_advisory_xact_lock(hashtext('public.team_members:' || new.user_id::text));

  if exists (
    select 1
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
      join public.projects p on p.id = t.project_id
     where tm.user_id = new.user_id
       and p.semester_id = v_semester
       and (tm.user_id, tm.team_id) is distinct from (v_self_user, v_self_team)
  ) then
    raise exception 'That student is already on a team this semester'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

revoke all on function private.one_team_per_semester() from public, anon, authenticated;

drop trigger if exists team_members_one_team_per_semester on public.team_members;
create trigger team_members_one_team_per_semester
  before insert or update of user_id, team_id on public.team_members
  for each row execute function private.one_team_per_semester();

-- --- the archive guard (decision 4) -------------------------------------------

-- Refuses if the semester has been closed. Null passes: it only arises while
-- a cascade is deleting a current project's children, after the parent row
-- is already gone — and the parent's own guard has already let that through.
create or replace function private.require_open_semester(p_semester_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_closed timestamptz;
begin
  if p_semester_id is null then
    return;
  end if;
  select s.name, s.closed_at into v_name, v_closed
    from public.semesters s
   where s.id = p_semester_id;
  if v_closed is not null then
    raise exception '% has been closed — past semesters are read-only', v_name;
  end if;
end;
$$;

-- The semester a row belongs to: its own column, its project's, or its
-- team's. jsonb so one function serves every table without a branch per
-- table name.
create or replace function private.row_semester(p_via text, p_row jsonb)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case p_via
    when 'semester' then (p_row ->> 'semester_id')::uuid
    when 'project' then (
      select p.semester_id from public.projects p
       where p.id = (p_row ->> 'project_id')::uuid)
    when 'team' then (
      select p.semester_id from public.teams t
        join public.projects p on p.id = t.project_id
       where t.id = (p_row ->> 'team_id')::uuid)
  end;
$$;

-- tg_argv[0] says how to find the row's semester. A new row on one of the
-- four semester tables that names no semester gets the current one, so no
-- insert anywhere has to pass it; when nothing is current, it is refused
-- with a sentence rather than a not-null violation.
--
-- The shared advisory lock pairs with the exclusive one close_semester()
-- takes: a write in flight finishes before a close starts counting, and a
-- write that arrives during a close waits for it and then finds the
-- semester closed. Without it a join request committed in the same instant
-- as the close could be left pending in an archived semester.
create or replace function private.archive_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_via text := tg_argv[0];
begin
  perform pg_advisory_xact_lock_shared(hashtext('public.semesters'));

  if tg_op in ('UPDATE', 'DELETE') then
    perform private.require_open_semester(private.row_semester(v_via, to_jsonb(old)));
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- Nested rather than one `and`: SQL does not promise to stop at the first
  -- false conjunct, and new.semester_id does not exist on most of these
  -- tables.
  if v_via = 'semester' then
    if tg_op = 'INSERT' then
      if new.semester_id is null then
        new.semester_id := public.current_semester_id();
        if new.semester_id is null then
          raise exception 'No semester is open right now — an admin has to start the next one first';
        end if;
      end if;
    end if;
  end if;

  perform private.require_open_semester(private.row_semester(v_via, to_jsonb(new)));
  return new;
end;
$$;

revoke all on function private.require_open_semester(uuid) from public, anon, authenticated;
revoke all on function private.row_semester(text, jsonb) from public, anon, authenticated;
revoke all on function private.archive_guard() from public, anon, authenticated;

-- Every table that belongs to a semester. Not notifications (a person's own
-- read state, which they may still clear), admin_actions (a log), or
-- adviser_digests (decision 2).
--
-- Named <table>_archive_guard because Postgres fires a table's BEFORE
-- triggers in name order, and this one has to go first: a write into a
-- closed semester should be told the semester is closed, not whatever else
-- happens to be wrong with it (one team per semester, the formation
-- deadline, the adviser rule), which is beside the point.
do $$
declare
  v_target record;
begin
  for v_target in
    select * from (values
      ('projects', 'semester'), ('milestones', 'semester'),
      ('announcements', 'semester'), ('next_steps', 'semester'),
      ('teams', 'project'), ('project_roles_needed', 'project'),
      ('join_requests', 'project'), ('adviser_requests', 'project'),
      ('check_ins', 'project'), ('deliverable_submissions', 'project'),
      ('deliverable_comments', 'project'), ('repo_activity', 'project'),
      ('team_members', 'team'), ('next_step_completions', 'team')
    ) as t(table_name, via)
  loop
    execute format('drop trigger if exists %I on public.%I',
                   v_target.table_name || '_archive_guard', v_target.table_name);
    execute format(
      'create trigger %I before insert or update or delete on public.%I
         for each row execute function private.archive_guard(%L)',
      v_target.table_name || '_archive_guard', v_target.table_name, v_target.via);
  end loop;
end;
$$;

-- A deliverable answers a milestone of its own project's semester. Only
-- reachable by naming an old milestone's id to the API, but then it would be
-- a submission no page ever shows, so it is refused where the row is written.
create or replace function private.deliverable_milestone_in_semester()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.milestones m
      join public.projects p on p.semester_id = m.semester_id
     where m.id = new.milestone_id
       and p.id = new.project_id
  ) then
    raise exception 'Milestone not found';
  end if;
  return new;
end;
$$;

revoke all on function private.deliverable_milestone_in_semester() from public, anon, authenticated;

drop trigger if exists deliverable_submissions_milestone_semester on public.deliverable_submissions;
create trigger deliverable_submissions_milestone_semester
  before insert or update of project_id, milestone_id on public.deliverable_submissions
  for each row execute function private.deliverable_milestone_in_semester();

drop trigger if exists deliverable_comments_milestone_semester on public.deliverable_comments;
create trigger deliverable_comments_milestone_semester
  before insert or update of project_id, milestone_id on public.deliverable_comments
  for each row execute function private.deliverable_milestone_in_semester();

-- --- who can read what (decision 1) -------------------------------------------
-- projects carries the rule; the rest ask "can I see its project?" by
-- selecting it, which runs projects' policy for them. A subquery in a policy
-- is evaluated as the caller, with RLS, so this is a real chain and not a
-- second copy of the comparison.
--
-- `(select public.current_semester_id())` rather than a bare call, so the
-- planner evaluates it once per query instead of once per row.

drop policy if exists projects_select_all on public.projects;
drop policy if exists projects_select_current on public.projects;
create policy projects_select_current
  on public.projects for select
  to anon, authenticated
  using (semester_id = (select public.current_semester_id()));

drop policy if exists project_roles_needed_select_all on public.project_roles_needed;
drop policy if exists project_roles_needed_select_current on public.project_roles_needed;
create policy project_roles_needed_select_current
  on public.project_roles_needed for select
  to anon, authenticated
  using (exists (select 1 from public.projects p where p.id = project_roles_needed.project_id));

drop policy if exists teams_select_all on public.teams;
drop policy if exists teams_select_current on public.teams;
create policy teams_select_current
  on public.teams for select
  to anon, authenticated
  using (exists (select 1 from public.projects p where p.id = teams.project_id));

-- 18_admin_access.sql's rule (no admin accounts on a roster) plus the chain.
drop policy if exists team_members_select_students on public.team_members;
drop policy if exists team_members_select_current on public.team_members;
create policy team_members_select_current
  on public.team_members for select
  to authenticated
  using (
    exists (select 1 from public.users u where u.id = team_members.user_id and not u.is_admin)
    and exists (select 1 from public.teams t where t.id = team_members.team_id)
  );

-- Same two policies as 02_ and 18_, same names, each now inside the chain.
drop policy if exists join_requests_select_own_or_incoming on public.join_requests;
create policy join_requests_select_own_or_incoming
  on public.join_requests for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
       where p.id = join_requests.project_id
         and (join_requests.user_id = auth.uid() or p.creator_id = auth.uid())
    )
  );

drop policy if exists join_requests_select_admin on public.join_requests;
create policy join_requests_select_admin
  on public.join_requests for select
  to authenticated
  using (
    private.is_admin()
    and exists (select 1 from public.projects p where p.id = join_requests.project_id)
  );

drop policy if exists adviser_requests_select_team_or_adviser on public.adviser_requests;
create policy adviser_requests_select_team_or_adviser
  on public.adviser_requests for select
  to authenticated
  using (
    exists (select 1 from public.projects p where p.id = adviser_requests.project_id)
    and (
      adviser_id = auth.uid()
      or invited_by = auth.uid()
      or exists (
        select 1
          from public.teams t
          join public.team_members tm on tm.team_id = t.id
         where t.project_id = adviser_requests.project_id
           and tm.user_id = auth.uid()
      )
    )
  );

-- A past team's check-ins are read through past_team(), which admins can
-- call too — the table's own policy never let them read check-ins.
drop policy if exists check_ins_select_team_or_adviser on public.check_ins;
create policy check_ins_select_team_or_adviser
  on public.check_ins for select
  to authenticated
  using (
    exists (select 1 from public.projects p where p.id = check_ins.project_id)
    and (private.is_on_project_team(project_id) or private.advises_project(project_id))
  );

drop policy if exists next_step_completions_select_member_or_admin on public.next_step_completions;
create policy next_step_completions_select_member_or_admin
  on public.next_step_completions for select
  to authenticated
  using (
    exists (select 1 from public.teams t where t.id = next_step_completions.team_id)
    and (
      private.is_admin()
      or exists (
        select 1 from public.team_members tm
         where tm.team_id = next_step_completions.team_id
           and tm.user_id = auth.uid()
      )
    )
  );

-- The course-wide tables carry their own semester.
drop policy if exists milestones_select_all on public.milestones;
drop policy if exists milestones_select_current on public.milestones;
create policy milestones_select_current
  on public.milestones for select
  to anon, authenticated
  using (semester_id = (select public.current_semester_id()));

drop policy if exists announcements_select_authenticated on public.announcements;
drop policy if exists announcements_select_current on public.announcements;
create policy announcements_select_current
  on public.announcements for select
  to authenticated
  using (semester_id = (select public.current_semester_id()));

drop policy if exists next_steps_select_signed_in on public.next_steps;
drop policy if exists next_steps_select_current on public.next_steps;
create policy next_steps_select_current
  on public.next_steps for select
  to authenticated
  using (semester_id = (select public.current_semester_id()));

-- =========================================================================
-- Functions. Each one below that already existed is the body it had on
-- Testing (the newest file that defined it is named), changed only where it
-- had to learn which semester it is in. Signatures are unchanged, so every
-- grant stands; they are restated anyway, as the house files do.
-- =========================================================================

-- --- whose team is current --------------------------------------------------
-- The caller-independent answer to "which team is this student on now".
-- Every "already on a team" check below asks this and nothing else, so the
-- day the rule changes it changes here.
create or replace function private.current_team_id(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tm.team_id
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    join public.projects p on p.id = t.project_id
   where tm.user_id = p_user_id
     and p.semester_id = public.current_semester_id();
$$;

revoke all on function private.current_team_id(uuid) from public, anon, authenticated;

-- --- the roster ---------------------------------------------------------------

-- 27_admin_placement.sql's, deleting the current seat only. Without the team
-- filter it would try to delete every seat the student ever held, and the
-- guard would refuse the archived ones.
create or replace function private.unseat(p_user_id uuid)
returns public.team_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.team_members;
  v_project_id uuid;
begin
  delete from public.team_members
   where user_id = p_user_id
     and team_id = private.current_team_id(p_user_id)
    returning * into v_membership;
  if not found then
    raise exception 'That student is not on a team';
  end if;

  select project_id into v_project_id from public.teams where id = v_membership.team_id;
  perform public.restore_project_role(v_project_id, v_membership.role_id);
  perform public.sync_project_fill_state(v_project_id);
  return v_membership;
end;
$$;

-- 16_project_validation.sql's, with "already on a team" meaning this
-- semester's team. A project is created in the current semester by the
-- guard, which also refuses when no semester is open.
create or replace function public.create_project(
  p_title text,
  p_description text,
  p_team_size_target smallint,
  p_creator_role_id uuid,
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
  v_role jsonb;
  v_role_id uuid;
  v_skill_id uuid;
  v_qty smallint;
  v_seen_roles uuid[] := '{}';
  v_open_seats smallint;
  v_assigned smallint := 0;
  v_role_categories text[];
  v_skill_category text;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  if p_team_size_target < 2 or p_team_size_target > 4 then
    raise exception 'A team has to be between 2 and 4 people';
  end if;

  perform public.assert_project_text(p_title, p_description);

  if p_creator_role_id is null or not exists (select 1 from public.roles where id = p_creator_role_id) then
    raise exception 'A valid role is required to create a project';
  end if;

  -- One team per student per semester (decision 5).
  if private.current_team_id(caller) is not null then
    raise exception 'You are already on a team and cannot create another project';
  end if;

  v_open_seats := p_team_size_target - 1;

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
    raise exception 'A team of % has % open seat% besides you, but you listed % people',
      p_team_size_target, v_open_seats, case when v_open_seats = 1 then '' else 's' end, v_assigned;
  end if;

  insert into public.projects (creator_id, title, description, team_size_target)
  values (caller, btrim(p_title), btrim(p_description), p_team_size_target)
  returning * into v_project;

  insert into public.teams (project_id)
  values (v_project.id)
  returning * into v_team;

  insert into public.team_members (user_id, team_id, role_id)
  values (caller, v_team.id, p_creator_role_id);

  for v_role in select * from jsonb_array_elements(coalesce(p_roles_needed, '[]'::jsonb))
  loop
    insert into public.project_roles_needed (project_id, role_id, skill_id, quantity_needed)
    values (
      v_project.id,
      (v_role->>'role_id')::uuid,
      nullif(v_role->>'skill_id', '')::uuid,
      (v_role->>'quantity_needed')::smallint
    );
  end loop;

  -- Creating a project seats you on a team, so any request still out is now
  -- unactionable. Pending requests are only ever current-semester ones:
  -- closing a semester cancels the rest.
  update public.join_requests
    set status = 'declined'
    where user_id = caller and status = 'pending';

  return v_project;
end;
$$;

revoke all on function public.create_project(text, text, smallint, uuid, jsonb) from public, anon;
grant execute on function public.create_project(text, text, smallint, uuid, jsonb) to authenticated;

-- 35_join_request_message.sql's, with "already on a team" meaning this
-- semester's, and an archived project refused in so many words before any of
-- the other reasons — "this project is full" would be true and beside the
-- point.
create or replace function public.create_join_request(p_project_id uuid, p_message text default null)
returns public.join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_count int;
  v_deadline timestamptz;
  v_row public.join_requests;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  perform private.require_open_semester(v_project.semester_id);

  if v_project.creator_id = caller then
    raise exception 'You cannot request to join your own project';
  end if;

  if private.current_team_id(caller) is not null then
    raise exception 'You are already on a team and cannot request to join another project';
  end if;

  if exists (
    select 1 from public.join_requests
    where project_id = p_project_id and user_id = caller and status = 'pending'
  ) then
    raise exception 'You already have a pending request for this project';
  end if;

  select count(*) into v_count
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
   where t.project_id = p_project_id;
  if v_project.status = 'full' or v_count >= v_project.team_size_target then
    raise exception 'This project is full and isn''t taking requests';
  end if;

  v_deadline := public.formation_deadline();
  if v_deadline is not null and now() >= v_deadline then
    raise exception 'The team formation deadline has passed, so new join requests are closed';
  end if;

  if char_length(v_message) > 300 then
    raise exception 'Your message can be at most 300 characters';
  end if;

  insert into public.join_requests (project_id, user_id, status, message)
  values (p_project_id, caller, 'pending', v_message)
  returning * into v_row;

  insert into public.notifications (user_id, kind, project_id, actor_id)
  values (v_project.creator_id, 'join_request', p_project_id, caller);

  return v_row;
end;
$$;

revoke all on function public.create_join_request(uuid, text) from public, anon;
grant execute on function public.create_join_request(uuid, text) to authenticated;

-- 21_join_request_responses.sql's, with "already joined a team" meaning this
-- semester's. The requester's users row is still the lock that serializes
-- two accepts of the same student.
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

    if private.current_team_id(v_request.user_id) is not null then
      raise exception 'That student has already joined a team';
    end if;
  end if;

  update public.join_requests set status = p_status where id = p_request_id;

  if p_status = 'accepted' then
    insert into public.team_members (user_id, team_id, role_id)
    values (v_request.user_id, v_team.id, p_role_id);

    perform public.release_project_role(v_project.id, p_role_id);

    if v_count + 1 >= v_project.team_size_target then
      update public.projects set status = 'full' where id = v_project.id;
      update public.teams set formed_at = coalesce(formed_at, now()) where id = v_team.id;
    end if;

    update public.join_requests
      set status = 'declined'
      where user_id = v_request.user_id
        and status = 'pending'
        and id <> p_request_id;
  end if;

  insert into public.notifications (user_id, kind, project_id, actor_id)
  values (
    v_request.user_id,
    case p_status when 'accepted' then 'request_accepted' else 'request_declined' end,
    v_project.id,
    caller
  );

  select * into v_request from public.join_requests where id = p_request_id;
  return v_request;
end;
$$;

revoke all on function public.respond_to_join_request(uuid, text, uuid) from public, anon;
grant execute on function public.respond_to_join_request(uuid, text, uuid) to authenticated;

-- 22_remove_member_rules.sql's leave_team(), about this semester's team. A
-- student whose only team is archived is not on a team.
create or replace function public.leave_team()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_team_id uuid;
  v_deadline timestamptz;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  v_team_id := private.current_team_id(caller);
  if v_team_id is null then
    raise exception 'You are not on a team';
  end if;

  if exists (
    select 1
      from public.teams t
      join public.projects p on p.id = t.project_id
     where t.id = v_team_id and p.creator_id = caller
  ) then
    raise exception 'You created this project, so you cannot leave it — delete the team instead';
  end if;

  v_deadline := public.formation_deadline();
  if v_deadline is not null and now() >= v_deadline then
    raise exception 'The team formation deadline has passed — ask an admin if you need to leave';
  end if;

  perform private.remove_from_team(caller, false);
end;
$$;

revoke all on function public.leave_team() from public, anon;
grant execute on function public.leave_team() to authenticated;

-- 27_admin_placement.sql's remove_member(), about this semester's team.
create or replace function public.remove_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_admin boolean := private.is_admin();
  v_team_id uuid;
  v_project public.projects;
  v_role_id uuid;
  v_deadline timestamptz;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  if p_user_id = caller then
    raise exception 'You cannot remove yourself — delete the team instead';
  end if;

  v_team_id := private.current_team_id(p_user_id);

  select p.* into v_project
    from public.teams t
    join public.projects p on p.id = t.project_id
   where t.id = v_team_id
     for no key update of p;
  if not found then
    raise exception 'That student is not on a team';
  end if;

  if v_project.creator_id <> caller and not v_admin then
    raise exception 'Only the project creator can remove a member';
  end if;

  if p_user_id = v_project.creator_id then
    raise exception 'The project creator cannot be removed — delete the team instead';
  end if;

  v_deadline := public.formation_deadline();
  if not v_admin and v_deadline is not null and now() >= v_deadline then
    raise exception 'The team formation deadline has passed — ask an admin to remove them';
  end if;

  select role_id into v_role_id
    from public.team_members
   where user_id = p_user_id and team_id = v_team_id;

  perform private.remove_from_team(p_user_id, v_admin);

  if v_admin then
    insert into public.admin_actions (admin_id, action, student_id, from_project_id, from_project_title, role_id)
    values (caller, 'remove', p_user_id, v_project.id, v_project.title, v_role_id);
  end if;
end;
$$;

revoke all on function public.remove_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;

-- 27_admin_placement.sql's, with "already on a team" meaning this semester's.
create or replace function public.admin_assign_student(p_user_id uuid, p_team_id uuid, p_role_id uuid)
returns public.team_members
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_membership public.team_members;
begin
  perform public.require_admin();

  if p_role_id is null or not exists (select 1 from public.roles where id = p_role_id) then
    raise exception 'Pick a role';
  end if;

  perform private.lock_student(p_user_id);

  perform 1 from public.projects p join public.teams t on t.project_id = p.id
   where t.id = p_team_id for no key update of p;
  v_project := private.open_team_project(p_team_id);

  if private.current_team_id(p_user_id) is not null then
    raise exception 'That student is already on a team — move them instead';
  end if;

  v_membership := private.seat(p_user_id, p_team_id, p_role_id);

  insert into public.notifications (user_id, kind, project_id, actor_id, by_admin)
  values (p_user_id, 'member_assigned', v_project.id, caller, true),
         (v_project.creator_id, 'member_added', v_project.id, p_user_id, true);

  insert into public.admin_actions (admin_id, action, student_id, to_project_id, to_project_title, role_id)
  values (caller, 'assign', p_user_id, v_project.id, v_project.title, p_role_id);

  return v_membership;
end;
$$;

revoke all on function public.admin_assign_student(uuid, uuid, uuid) from public, anon;
grant execute on function public.admin_assign_student(uuid, uuid, uuid) to authenticated;

-- 27_admin_placement.sql's, moving the student off this semester's team.
create or replace function public.admin_move_student(p_user_id uuid, p_team_id uuid, p_role_id uuid)
returns public.team_members
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_from_team uuid;
  v_from public.projects;
  v_to public.projects;
  v_membership public.team_members;
begin
  perform public.require_admin();

  if p_role_id is null or not exists (select 1 from public.roles where id = p_role_id) then
    raise exception 'Pick a role';
  end if;

  perform private.lock_student(p_user_id);

  v_from_team := private.current_team_id(p_user_id);
  if v_from_team is null then
    raise exception 'That student is not on a team — assign them instead';
  end if;
  if v_from_team = p_team_id then
    raise exception 'That student is already on this team';
  end if;

  perform 1 from public.projects p join public.teams t on t.project_id = p.id
   where t.id in (v_from_team, p_team_id)
   order by p.id
   for no key update of p;

  select p.* into v_from
    from public.teams t join public.projects p on p.id = t.project_id
   where t.id = v_from_team;
  if v_from.creator_id = p_user_id then
    raise exception 'A project''s creator can''t be moved off their own project';
  end if;

  v_to := private.open_team_project(p_team_id);

  perform private.unseat(p_user_id);
  v_membership := private.seat(p_user_id, p_team_id, p_role_id);

  insert into public.notifications (user_id, kind, project_id, actor_id, by_admin)
  values (v_from.creator_id, 'member_left', v_from.id, p_user_id, true),
         (p_user_id, 'member_assigned', v_to.id, caller, true),
         (v_to.creator_id, 'member_added', v_to.id, p_user_id, true);

  insert into public.admin_actions
    (admin_id, action, student_id, from_project_id, from_project_title, to_project_id, to_project_title, role_id)
  values (caller, 'move', p_user_id, v_from.id, v_from.title, v_to.id, v_to.title, p_role_id);

  return v_membership;
end;
$$;

revoke all on function public.admin_move_student(uuid, uuid, uuid) from public, anon;
grant execute on function public.admin_move_student(uuid, uuid, uuid) to authenticated;

-- 31_set_member_role.sql's, about this semester's team. The final UPDATE
-- names the team as well as the student: by user_id alone it would also
-- touch every archived seat they ever held, and the guard would refuse.
create or replace function public.set_member_role(p_user_id uuid, p_role_id uuid)
returns public.team_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  v_team_id uuid;
  v_membership public.team_members;
  v_project public.projects;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  if p_role_id is null or not exists (select 1 from public.roles where id = p_role_id) then
    raise exception 'Pick a role';
  end if;

  v_team_id := private.current_team_id(p_user_id);
  if v_team_id is null then
    raise exception 'That student is not on a team';
  end if;

  select p.* into v_project
    from public.projects p
    join public.teams t on t.project_id = p.id
   where t.id = v_team_id
     for no key update of p;

  if v_project.creator_id is distinct from caller then
    raise exception 'Only the project creator can change roles';
  end if;

  select * into v_membership
    from public.team_members
   where user_id = p_user_id and team_id = v_team_id
     for update;
  if not found then
    raise exception 'That student is not on a team';
  end if;

  if v_membership.role_id is not distinct from p_role_id then
    return v_membership;
  end if;

  if v_membership.role_id is not null
     and exists (
       select 1 from public.project_roles_needed
        where project_id = v_project.id and role_id = v_membership.role_id
     )
     and exists (
       select 1 from public.project_roles_needed
        where project_id = v_project.id and role_id = p_role_id and quantity_needed > 0
     ) then
    perform public.restore_project_role(v_project.id, v_membership.role_id);
    perform public.release_project_role(v_project.id, p_role_id);
  end if;

  update public.team_members
     set role_id = p_role_id
   where user_id = p_user_id and team_id = v_team_id
  returning * into v_membership;

  return v_membership;
end;
$$;

revoke all on function public.set_member_role(uuid, uuid) from public, anon;
grant execute on function public.set_member_role(uuid, uuid) to authenticated;

-- 18_admin_access.sql's, about this semester. A former student who becomes
-- an instructor's assistant can be made an admin without their archived team
-- having to be deleted — which, since nothing in a closed semester can be,
-- would otherwise be impossible.
create or replace function private.protect_admin_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.is_admin)
     or (tg_op = 'UPDATE' and new.is_admin is distinct from old.is_admin) then
    if current_setting('role', true) in ('anon', 'authenticated') then
      raise exception 'Admin access can only be changed by a database administrator'
        using errcode = '42501';
    end if;
    if new.is_admin and (
      private.current_team_id(new.id) is not null
      or exists (select 1 from public.projects
                  where creator_id = new.id and semester_id = public.current_semester_id())
      or exists (select 1 from public.join_requests where user_id = new.id and status = 'pending')
    ) then
      raise exception 'Remove student memberships, projects and pending requests before granting admin access'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- --- reminders -------------------------------------------------------------------

-- 37_deadline_reminders.sql's: everyone not yet on a full team *this
-- semester*. formation_deadline() is already this semester's.
create or replace function private.send_deadline_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deadline timestamptz := public.formation_deadline();
  v_days smallint;
  v_sent integer;
begin
  if v_deadline is null or p_now is null or p_now >= v_deadline then
    return 0;
  end if;

  v_days := case
    when p_now >= v_deadline - interval '1 day'  then 1
    when p_now >= v_deadline - interval '3 days' then 3
  end;
  if v_days is null then
    return 0;
  end if;

  with sent as (
    insert into private.deadline_reminders (user_id, deadline_at, days_before)
    select u.id, v_deadline, v_days
      from public.users u
     where not u.is_admin
       and not exists (
         select 1
           from public.team_members tm
           join public.teams t on t.id = tm.team_id
           join public.projects p on p.id = t.project_id
          where tm.user_id = u.id
            and p.status = 'full'
            and p.semester_id = public.current_semester_id()
       )
    on conflict do nothing
    returning user_id
  )
  insert into public.notifications (user_id, kind)
  select user_id, 'deadline_reminder' from sent;

  get diagnostics v_sent = row_count;
  return v_sent;
end;
$$;

-- 42_check_ins.sql's: only this semester's formed teams are asked to check
-- in. Without it every archived team would be nagged every weekend forever.
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
      join public.projects p on p.id = t.project_id
      join public.team_members tm on tm.team_id = t.id
     where t.formed_at is not null
       and p.semester_id = public.current_semester_id()
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

-- --- milestones, next steps, announcements -----------------------------------

-- 26_milestones.sql's, this semester's flagged milestone. Null when none is
-- flagged or no semester is open, and rosters don't lock.
create or replace function public.formation_deadline()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select m.due_at
    from public.milestones m
   where m.is_formation_deadline
     and m.semester_id = public.current_semester_id();
$$;

grant execute on function public.formation_deadline() to anon, authenticated;

-- 28_milestone_messages.sql's, moving the formation-deadline flag within this
-- semester only. A new milestone lands in the current semester (the guard);
-- editing an archived one is refused there too.
create or replace function public.save_milestone(
  p_id uuid,
  p_name text,
  p_due_at timestamptz,
  p_is_formation_deadline boolean default false,
  p_message text default ''
)
returns public.milestones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_message text := btrim(regexp_replace(coalesce(p_message, ''), E'\r\n?', E'\n', 'g'), E' \t\n');
  v_flag boolean := coalesce(p_is_formation_deadline, false);
  v_row public.milestones;
begin
  perform public.require_admin();

  if v_name = '' then
    raise exception 'A milestone needs a name';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Keep the milestone name to 80 characters or fewer';
  end if;
  if v_name ~ '[[:cntrl:]]' or v_name ~ '[​-‏‪-‮⁠-⁩﻿]' then
    raise exception 'The milestone name can''t contain line breaks, hidden or control characters';
  end if;
  if v_name !~ '[^[:space:][:punct:] -⯿⸀-⹿　-〿︀-️\U0001F000-\U0001FAFF]' then
    raise exception 'The milestone name has to include letters or numbers';
  end if;
  if p_due_at is null then
    raise exception 'A milestone needs a due date';
  end if;
  if p_due_at < '2000-01-01 00:00+00' or p_due_at >= '2100-01-01 00:00+00' then
    raise exception 'Pick a due date between 2000 and 2099';
  end if;

  if v_message <> '' then
    if char_length(v_message) > 1000 then
      raise exception 'Keep the message to 1000 characters or fewer';
    end if;
    if v_message ~ '[\x01-\x08\x0B-\x1F\x7F]' or v_message ~ '[​-‏‪-‮⁠-⁩﻿]' then
      raise exception 'The message can''t contain hidden or control characters';
    end if;
    if v_message !~ '[^[:space:][:punct:] -⯿⸀-⹿　-〿︀-️\U0001F000-\U0001FAFF]' then
      raise exception 'The message has to include letters or numbers';
    end if;
    if v_message ~ '\n[ \t]*\n[ \t]*\n' then
      raise exception 'Leave at most one blank line in a row in the message';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('public.milestones'));

  if p_id is not null and not exists (select 1 from public.milestones where id = p_id) then
    raise exception 'Milestone not found';
  end if;

  if v_flag then
    update public.milestones
       set is_formation_deadline = false, updated_at = now()
     where is_formation_deadline
       and id is distinct from p_id
       and semester_id = public.current_semester_id();
  end if;

  if p_id is null then
    insert into public.milestones (name, due_at, is_formation_deadline, message)
    values (v_name, p_due_at, v_flag, v_message)
    returning * into v_row;
  else
    update public.milestones
       set name = v_name, due_at = p_due_at, is_formation_deadline = v_flag,
           message = v_message, updated_at = now()
     where id = p_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function public.save_milestone(uuid, text, timestamptz, boolean, text) from public, anon;
grant execute on function public.save_milestone(uuid, text, timestamptz, boolean, text) to authenticated;

-- 34_next_steps.sql's. A new step goes to the end of this semester's list.
create or replace function public.save_next_step(p_id uuid, p_title text, p_due_at timestamptz default null)
returns public.next_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_row public.next_steps;
begin
  perform public.require_admin();

  if v_title = '' then
    raise exception 'A next step needs some text';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'Keep the step to 120 characters or fewer';
  end if;
  if v_title ~ '[[:cntrl:]]' or v_title ~ '[​-‏‪-‮⁠-⁩﻿]' then
    raise exception 'The step can''t contain line breaks, hidden or control characters';
  end if;
  if v_title !~ '[^[:space:][:punct:] -⯿⸀-⹿　-〿︀-️\U0001F000-\U0001FAFF]' then
    raise exception 'The step has to include letters or numbers';
  end if;
  if p_due_at is not null and (p_due_at < '2000-01-01 00:00+00' or p_due_at >= '2100-01-01 00:00+00') then
    raise exception 'Pick a due date between 2000 and 2099';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.next_steps'));

  if p_id is null then
    insert into public.next_steps (title, due_at, sort_order)
    values (v_title, p_due_at,
            coalesce((select max(sort_order) from public.next_steps
                       where semester_id = public.current_semester_id()), 0) + 1)
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

revoke all on function public.save_next_step(uuid, text, timestamptz) from public, anon;
grant execute on function public.save_next_step(uuid, text, timestamptz) to authenticated;

-- 34_next_steps.sql's. The list being reordered is this semester's, and the
-- check that it hasn't changed since it was loaded compares against that.
create or replace function public.reorder_next_steps(p_ids uuid[])
returns setof public.next_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := coalesce(p_ids, '{}');
  v_semester uuid := public.current_semester_id();
begin
  perform public.require_admin();
  perform pg_advisory_xact_lock(hashtext('public.next_steps'));

  if array_position(v_ids, null) is not null
     or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) as x)
     or cardinality(v_ids) <> (select count(*) from public.next_steps where semester_id = v_semester)
     or exists (select 1 from unnest(v_ids) as x
                 where not exists (select 1 from public.next_steps
                                    where id = x and semester_id = v_semester)) then
    raise exception 'The list has changed since it was loaded — reload and try again';
  end if;

  update public.next_steps s
     set sort_order = o.ord, updated_at = now()
    from unnest(v_ids) with ordinality as o(id, ord)
   where s.id = o.id and s.sort_order <> o.ord;

  return query select * from public.next_steps where semester_id = v_semester order by sort_order;
end;
$$;

revoke all on function public.reorder_next_steps(uuid[]) from public, anon;
grant execute on function public.reorder_next_steps(uuid[]) to authenticated;

-- 34_next_steps.sql's. Closes the gap in this semester's numbering; the
-- deleted step was this semester's, or the guard has already refused.
create or replace function public.delete_next_step(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  perform pg_advisory_xact_lock(hashtext('public.next_steps'));

  delete from public.next_steps where id = p_id;
  if not found then
    raise exception 'Next step not found';
  end if;

  update public.next_steps s
     set sort_order = n.rn, updated_at = now()
    from (select id, row_number() over (order by sort_order) as rn
            from public.next_steps
           where semester_id = public.current_semester_id()) n
   where s.id = n.id and s.sort_order <> n.rn;
end;
$$;

revoke all on function public.delete_next_step(uuid) from public, anon;
grant execute on function public.delete_next_step(uuid) to authenticated;

-- 34_next_steps.sql's. A team's checklist is its own semester's steps — so a
-- past team, read from Past semesters, still shows the list it worked from.
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
   where s.semester_id = (select p.semester_id
                            from public.teams t
                            join public.projects p on p.id = t.project_id
                           where t.id = p_team_id)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.team_checklist(uuid) from public, anon;
grant execute on function public.team_checklist(uuid) to authenticated;

-- 34_next_steps.sql's. A step from another semester is not one of this
-- team's; ticking it would write a completion no checklist shows.
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
  if not exists (
    select 1
      from public.next_steps s
      join public.projects p on p.semester_id = s.semester_id
      join public.teams t on t.project_id = p.id
     where s.id = p_step_id and t.id = p_team_id
  ) then
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

revoke all on function public.set_next_step_done(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_next_step_done(uuid, uuid, boolean) to authenticated;

-- 33_next_steps.sql's admin progress column: out of the team's own
-- semester's steps.
create or replace function private.admin_team_next_steps(p_team_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'next_steps', jsonb_build_object(
      'done', (select count(*) from public.next_step_completions c where c.team_id = p_team_id),
      'total', (select count(*)
                  from public.next_steps s
                 where s.semester_id = (select p.semester_id
                                          from public.teams t
                                          join public.projects p on p.id = t.project_id
                                         where t.id = p_team_id))
    )
  );
$$;

-- 29_announcements.sql's feed, this semester's.
create or replace function public.announcement_feed()
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'body', a.body,
      'created_at', a.created_at, 'updated_at', a.updated_at,
      'author_name', u.name
    ) order by a.created_at desc, a.id)
    from public.announcements a
    left join public.users u on u.id = a.author_id
   where a.semester_id = public.current_semester_id()
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.announcement_feed() from public, anon;
grant execute on function public.announcement_feed() to authenticated;

-- 30_notification_bell.sql's count, of this semester's announcements and
-- milestones — the Announcements tab shows nothing else.
create or replace function public.unseen_announcement_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seen timestamptz;
  v_semester uuid := public.current_semester_id();
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if private.is_admin() then
    return 0;
  end if;
  select announcements_seen_at into v_seen from public.users where id = auth.uid();
  return (select count(*) from public.announcements
           where semester_id = v_semester and (v_seen is null or updated_at > v_seen))
       + (select count(*) from public.milestones
           where semester_id = v_semester and (v_seen is null or updated_at > v_seen));
end;
$$;

revoke all on function public.unseen_announcement_count() from public, anon;
grant execute on function public.unseen_announcement_count() to authenticated;

-- --- deliverables -------------------------------------------------------------

-- 45_milestone_deliverables.sql's, with one more reader: the adviser of a
-- past team. advises_project() (42_) is an accepted row on that project in
-- any semester — decision 6 — so the adviser who reviewed a team's work can
-- still open it, and download it, from Past semesters. For a current project
-- it is the same set advised_project_ids() gave, so nobody gains anything
-- this semester.
create or replace function private.can_see_deliverables(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
      or private.is_deliverable_team_member(p_project_id)
      or private.advises_project(p_project_id);
$$;

revoke all on function private.can_see_deliverables(uuid) from public, anon;
grant execute on function private.can_see_deliverables(uuid) to authenticated;

-- 45_'s, refusing uploads to an archived project (the submission would be
-- refused anyway, after up to 25 MB had been stored) and to a milestone from
-- another semester.
create or replace function private.may_upload_deliverable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
                  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
                  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]+$'
     and storage.extension(p_name) in ('pdf', 'docx', 'pptx')
     and private.is_deliverable_team_member(split_part(p_name, '/', 1)::uuid)
     and exists (
       select 1
         from public.milestones m
         join public.projects p on p.semester_id = m.semester_id
        where m.id = split_part(p_name, '/', 2)::uuid
          and m.requires_deliverable
          and p.id = split_part(p_name, '/', 1)::uuid
          and p.semester_id = public.current_semester_id()
     );
$$;

revoke all on function private.may_upload_deliverable(text) from public, anon;
grant execute on function private.may_upload_deliverable(text) to authenticated;

-- 45_'s. The milestones are the project's own semester's, which for a past
-- team is the semester it was in — not this one.
create or replace function public.project_deliverables(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_semester uuid;
  v_result jsonb;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select semester_id into v_semester from public.projects where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  if not private.can_see_deliverables(p_project_id) then
    raise exception 'Only this team, its adviser and admins can see its deliverables';
  end if;

  select coalesce(jsonb_agg(d.item order by d.due_at, d.name), '[]'::jsonb)
    into v_result
    from (
      select m.due_at, m.name,
             jsonb_build_object(
               'milestone_id', m.id,
               'name', m.name,
               'due_at', m.due_at,
               'message', m.message,
               'status', coalesce(latest.status, 'not_submitted'),
               'is_late', coalesce(latest.is_late, false),
               'versions', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', s.id,
                          'version', s.version,
                          'kind', s.kind,
                          'file_path', s.file_path,
                          'file_name', s.file_name,
                          'file_size', s.file_size,
                          'file_type', s.file_type,
                          'link_url', s.link_url,
                          'is_late', s.is_late,
                          'status', s.status,
                          'submitted_by', s.submitted_by,
                          'submitted_by_name', u.name,
                          'submitted_at', s.submitted_at
                        ) order by s.version desc)
                   from public.deliverable_submissions s
                   left join public.users u on u.id = s.submitted_by
                  where s.project_id = p_project_id and s.milestone_id = m.id
               ), '[]'::jsonb),
               'comments', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', c.id,
                          'author_id', c.author_id,
                          'author_name', u.name,
                          'body', c.body,
                          'decision', c.decision,
                          'version', s.version,
                          'created_at', c.created_at
                        ) order by c.created_at, c.id)
                   from public.deliverable_comments c
                   left join public.users u on u.id = c.author_id
                   left join public.deliverable_submissions s on s.id = c.submission_id
                  where c.project_id = p_project_id and c.milestone_id = m.id
               ), '[]'::jsonb)
             ) as item
        from public.milestones m
        left join lateral (
          select s.status, s.is_late
            from public.deliverable_submissions s
           where s.project_id = p_project_id and s.milestone_id = m.id
           order by s.version desc
           limit 1
        ) latest on true
       where m.requires_deliverable
         and m.semester_id = v_semester
    ) d;

  return v_result;
end;
$$;

revoke all on function public.project_deliverables(uuid) from public, anon;
grant execute on function public.project_deliverables(uuid) to authenticated;

-- --- advisers -----------------------------------------------------------------

-- 40_respond_to_adviser_request.sql's: the projects the caller advises *now*.
-- Read by the Advising page, by write checks (only a current adviser may
-- comment or review), and by is_deliverable_adviser().
create or replace function public.advised_project_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ar.project_id
    from public.adviser_requests ar
    join public.projects p on p.id = ar.project_id
   where ar.adviser_id = auth.uid()
     and ar.status = 'accepted'
     and p.semester_id = public.current_semester_id();
$$;

revoke all on function public.advised_project_ids() from public, anon;
grant execute on function public.advised_project_ids() to authenticated;

-- 43_advised_teams.sql's: teams the adviser advises now. The digest's
-- recipients and its team list both come from this.
create or replace function private.advised_teams(p_adviser uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
    from public.adviser_requests ar
    join public.projects p on p.id = ar.project_id
    join public.teams t on t.project_id = ar.project_id
   where ar.adviser_id = p_adviser
     and ar.status = 'accepted'
     and p.semester_id = public.current_semester_id();
$$;

-- 48_adviser_expertise.sql's capacity: accepted teams in the current
-- semester. This is what users.advising_max_teams is compared against, by
-- invite, accept and search alike, so last semester's teams stop filling
-- spots the moment it closes.
create or replace function private.advising_accepted(p_adviser uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.adviser_requests ar
    join public.projects p on p.id = ar.project_id
   where ar.adviser_id = p_adviser
     and ar.status = 'accepted'
     and p.semester_id = public.current_semester_id();
$$;

-- 49_overdue_after_formed.sql's (#105): overdue counts only milestones due
-- on or after the team FIRST formed (teams.first_formed_at, which survives a
-- member leaving). Plus: the teams are this semester's, and so are the
-- milestones. Without the second half a new semester's dashboard would show
-- last semester's milestones as overdue. Body otherwise unchanged.
create or replace function public.adviser_dashboard()
returns table (
  project_id              uuid,
  title                   text,
  team_id                 uuid,
  formed_at               timestamptz,
  members                 jsonb,
  check_ins_submitted     integer,
  check_ins_expected      integer,
  open_blockers           integer,
  last_check_in_at        timestamptz,
  next_milestone_id       uuid,
  next_milestone_name     text,
  next_milestone_due_at   timestamptz,
  next_deliverable_status text,
  overdue_deliverables    integer,
  changes_requested       integer,
  last_commit_at          timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with advised as (
    select p.id as project_id, p.title, t.id as team_id, t.formed_at, t.first_formed_at
      from public.adviser_requests ar
      join public.projects p on p.id = ar.project_id
      left join public.teams t on t.project_id = p.id
     where ar.adviser_id = auth.uid()
       and ar.status = 'accepted'
       and p.semester_id = public.current_semester_id()
  ),
  latest as (
    select distinct on (s.project_id, s.milestone_id)
           s.project_id, s.milestone_id, s.status
      from public.deliverable_submissions s
     where s.project_id in (select a.project_id from advised a)
     order by s.project_id, s.milestone_id, s.version desc
  )
  select
    a.project_id,
    a.title,
    a.team_id,
    a.formed_at,
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', u.id, 'name', u.name) order by u.name, u.id)
        from public.team_members tm
        join public.users u on u.id = tm.user_id
       where tm.team_id = a.team_id
    ), '[]'::jsonb),
    (select count(*)::int
       from public.team_members tm
       join public.check_ins c
         on c.user_id = tm.user_id
        and c.project_id = a.project_id
        and c.week_start = public.check_in_week_start(now())
      where tm.team_id = a.team_id),
    (select count(*)::int from public.team_members tm where tm.team_id = a.team_id),
    (select count(*)::int
       from public.team_members tm
       cross join lateral (
         select c.blockers
           from public.check_ins c
          where c.user_id = tm.user_id
            and c.project_id = a.project_id
          order by c.week_start desc
          limit 1
       ) newest
      where tm.team_id = a.team_id
        and newest.blockers is not null
        and btrim(newest.blockers) <> ''),
    (select max(c.created_at) from public.check_ins c where c.project_id = a.project_id),
    nm.id,
    nm.name,
    nm.due_at,
    case when nm.requires_deliverable then coalesce(nm.status, 'not_submitted') end,
    (select count(*)::int
       from public.milestones m
      where m.semester_id = public.current_semester_id()
        and m.requires_deliverable
        and m.due_at < now()
        and m.due_at >= a.first_formed_at
        and not exists (
          select 1 from public.deliverable_submissions s
           where s.project_id = a.project_id and s.milestone_id = m.id
        )),
    (select count(*)::int
       from latest l
      where l.project_id = a.project_id
        and l.status = 'changes_requested'),
    (select r.last_commit_at from public.repo_activity r where r.project_id = a.project_id)
  from advised a
  left join lateral (
    select m.id, m.name, m.due_at, m.requires_deliverable, l.status
      from public.milestones m
      left join latest l on l.project_id = a.project_id and l.milestone_id = m.id
     where m.semester_id = public.current_semester_id()
       and m.due_at >= now()
       and not (m.requires_deliverable and l.status is not distinct from 'approved')
     order by m.due_at, m.name
     limit 1
  ) nm on true
  order by a.title, a.project_id;
$$;

revoke all on function public.adviser_dashboard() from public, anon;
grant execute on function public.adviser_dashboard() to authenticated;

-- 38_adviser_digest.sql's data function: this semester's teams (through
-- advised_teams(), above) and this semester's milestones.
create or replace function private.adviser_digest_data(p_adviser uuid, p_now timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with week as (
    select private.digest_this_monday(p_now) as this_monday
  )
  select jsonb_build_object(
    'adviser_is_admin', coalesce((select u.is_admin from public.users u where u.id = p_adviser), false),
    'week_start', (w.this_monday - 7),
    'week_end',   (w.this_monday - 1),
    'due_this_week', coalesce((
      select jsonb_agg(jsonb_build_object('name', m.name, 'due_at', m.due_at) order by m.due_at, m.name)
        from public.milestones m
       where m.semester_id = public.current_semester_id()
         and m.due_at >= (w.this_monday::timestamp at time zone 'America/Chicago')
         and m.due_at <  ((w.this_monday + 7)::timestamp at time zone 'America/Chicago')
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'team_id', t.id,
               'project_title', p.title,
               'flagged', false,
               'checkins_submitted', null,
               'checkins_expected', null,
               'blockers', '[]'::jsonb,
               'deliverables_to_review', null,
               'last_commit_at', null
             ) order by p.title, t.id)
        from private.advised_teams(p_adviser) a(team_id)
        join public.teams t on t.id = a.team_id
        join public.projects p on p.id = t.project_id
    ), '[]'::jsonb)
  )
  from week w;
$$;

-- 41_github_activity.sql's refresh gate, the one door every GitHub refresh
-- comes through (the Edge Function calls it as the signed-in user before it
-- touches GitHub). A past team's repository is left as it was last fetched.
create or replace function public.project_repo_for_refresh(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_repo text;
  v_semester uuid;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select p.github_repo, p.semester_id into v_repo, v_semester
    from public.projects p
   where p.id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  if not exists (
    select 1
      from public.teams t
      join public.team_members tm on tm.team_id = t.id
     where t.project_id = p_project_id
       and tm.user_id = caller
  ) then
    raise exception 'Only the team can refresh this repository';
  end if;

  perform private.require_open_semester(v_semester);

  if coalesce(v_repo, '') = '' then
    raise exception 'No repository is linked to this project';
  end if;

  return v_repo;
end;
$$;

revoke all on function public.project_repo_for_refresh(uuid) from public, anon;
grant execute on function public.project_repo_for_refresh(uuid) to authenticated;

-- --- admin views ------------------------------------------------------------

-- 27_admin_placement.sql's student detail: their team is this semester's.
-- (With more than one seat ever, the old scalar subquery would have raised
-- "more than one row" for anyone who had been on a team before.)
create or replace function private.admin_student_json(p_student_id uuid)
returns jsonb
language sql
stable
set search_path = ''
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
        and tm.team_id = private.current_team_id(u.id)
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

-- 33_next_steps.sql's dashboard: this semester's teams, and the students
-- who have no team this semester.
create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  team_list jsonb;
  unplaced_list jsonb;
begin
  perform public.require_admin();

  select coalesce(jsonb_agg(private.admin_team_json(t.id) || private.admin_team_next_steps(t.id)
                            order by p.title, t.id), '[]'::jsonb)
    into team_list
    from public.teams t
    join public.projects p on p.id = t.project_id
   where p.semester_id = public.current_semester_id();

  select coalesce(jsonb_agg(private.admin_student_json(u.id) order by u.name, u.id), '[]'::jsonb)
    into unplaced_list
    from public.users u
   where not u.is_admin
     and private.current_team_id(u.id) is null;

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

revoke all on function public.admin_dashboard() from public, anon;
grant execute on function public.admin_dashboard() to authenticated;

-- 46_export_rosters.sql's, scoped to this semester: an admin exports this
-- semester's teams, members and unplaced students; an adviser exports the
-- teams they advise this semester, and is refused if that is none — their
-- past teams are under Past semesters.
create or replace function public.export_rosters()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller        uuid := auth.uid();
  v_semester    uuid := public.current_semester_id();
  v_is_admin    boolean;
  v_project_ids uuid[];
  v_teams       jsonb;
  v_members     jsonb;
  v_unplaced    jsonb;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  v_is_admin := private.is_admin();

  if not v_is_admin then
    select array_agg(ar.project_id)
      into v_project_ids
      from public.adviser_requests ar
      join public.projects p on p.id = ar.project_id
     where ar.adviser_id = caller
       and ar.status = 'accepted'
       and p.semester_id = v_semester;

    if v_project_ids is null then
      raise exception 'Only an admin or an adviser can export rosters'
        using errcode = '42501';
    end if;
  end if;

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
       where p.semester_id = v_semester
         and (v_is_admin or p.id = any (v_project_ids))
    ) teams;

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
         and p.semester_id = v_semester
         and (v_is_admin or p.id = any (v_project_ids))
    ) members;

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
           and private.current_team_id(u.id) is null
           and not exists (select 1 from public.faculty_directory fd
                            where fd.email = lower(u.email))
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

-- =========================================================================
-- The semester itself.
-- =========================================================================

-- --- current_semester -------------------------------------------------------
-- What the pages show about the semester: its name, dates and formation
-- deadline (decision 3: read from its flagged milestone). Null when none is
-- open, which is how the Admin page knows to show the new-semester form.
create or replace function public.current_semester()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', s.id,
           'name', s.name,
           'starts_on', s.starts_on,
           'ends_on', s.ends_on,
           'formation_deadline', (select m.due_at
                                    from public.milestones m
                                   where m.semester_id = s.id
                                     and m.is_formation_deadline))
    from public.semesters s
   where s.is_current;
$$;

revoke all on function public.current_semester() from public, anon;
grant execute on function public.current_semester() to authenticated;

-- --- what closing will touch --------------------------------------------------
-- One definition, read by the preview the dialog shows and by
-- close_semester() itself, so the numbers an admin confirms are the numbers
-- the close reports. "Students" is distinct people with a seat; admins never
-- have one (18_).
create or replace function private.semester_counts(p_semester_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'semester_id', s.id,
           'name', s.name,
           'starts_on', s.starts_on,
           'ends_on', s.ends_on,
           'teams', (select count(*)
                       from public.teams t
                       join public.projects p on p.id = t.project_id
                      where p.semester_id = s.id),
           'students', (select count(distinct tm.user_id)
                          from public.team_members tm
                          join public.teams t on t.id = tm.team_id
                          join public.projects p on p.id = t.project_id
                         where p.semester_id = s.id),
           'pending_join_requests', (select count(*)
                                       from public.join_requests jr
                                       join public.projects p on p.id = jr.project_id
                                      where p.semester_id = s.id and jr.status = 'pending'),
           'pending_adviser_requests', (select count(*)
                                          from public.adviser_requests ar
                                          join public.projects p on p.id = ar.project_id
                                         where p.semester_id = s.id and ar.status = 'pending'),
           'adviser_links', (select count(*)
                               from public.adviser_requests ar
                               join public.projects p on p.id = ar.project_id
                              where p.semester_id = s.id and ar.status = 'accepted'))
    from public.semesters s
   where s.id = p_semester_id;
$$;

revoke all on function private.semester_counts(uuid) from public, anon, authenticated;

-- The Close semester dialog's numbers, for the current semester. Null when
-- none is open.
create or replace function public.semester_close_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return private.semester_counts(public.current_semester_id());
end;
$$;

revoke all on function public.semester_close_preview() from public, anon;
grant execute on function public.semester_close_preview() to authenticated;

-- --- close_semester ------------------------------------------------------------
-- Admin only. Names the semester twice — by id, so a page left open across
-- someone else's close can't close the next semester by accident, and by
-- the name the admin typed, so the server holds the confirmation the dialog
-- asks for rather than trusting a disabled button.
--
-- Everything it writes, it writes *before* stamping closed_at, because after
-- that the guard refuses writes to this semester — including its own. In
-- order:
--
--   1. pending join requests     → 'cancelled'
--   2. pending adviser requests  → 'cancelled'
--   3. the notifications that asked someone to answer one of those
--                                → read (as withdraw_join_request() does)
--   4. the semester              → closed_at, closed_by
--
-- Nothing is deleted (decision 7). Accepted adviser links are left as they
-- are and end with the semester (decision 6); seats are left as they are and
-- stop counting as "your team" with it (decision 5). Returns what it closed,
-- counted before step 1, so the numbers match the preview the admin saw.
--
-- The exclusive advisory lock is the other half of the guard's shared one:
-- writes already in flight finish first, and any that arrive now wait, then
-- find the semester closed.
create or replace function public.close_semester(p_semester_id uuid, p_confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  v_semester public.semesters;
  v_summary jsonb;
begin
  perform public.require_admin();

  perform pg_advisory_xact_lock(hashtext('public.semesters'));

  select * into v_semester from public.semesters where id = p_semester_id for update;
  if not found then
    raise exception 'Semester not found';
  end if;
  if not v_semester.is_current then
    raise exception '% is already closed', v_semester.name;
  end if;
  if p_confirm_name is distinct from v_semester.name then
    raise exception 'Type the semester name exactly as shown to confirm';
  end if;

  v_summary := private.semester_counts(p_semester_id);

  update public.join_requests jr
     set status = 'cancelled'
    from public.projects p
   where p.id = jr.project_id
     and p.semester_id = p_semester_id
     and jr.status = 'pending';

  update public.adviser_requests ar
     set status = 'cancelled', responded_at = now()
    from public.projects p
   where p.id = ar.project_id
     and p.semester_id = p_semester_id
     and ar.status = 'pending';

  update public.notifications n
     set read_at = now()
    from public.projects p
   where p.id = n.project_id
     and p.semester_id = p_semester_id
     and n.kind in ('join_request', 'adviser_invited')
     and n.read_at is null;

  update public.semesters
     set closed_at = now(), closed_by = caller
   where id = p_semester_id
  returning * into v_semester;

  return v_summary || jsonb_build_object('closed_at', v_semester.closed_at);
end;
$$;

revoke all on function public.close_semester(uuid, text) from public, anon;
grant execute on function public.close_semester(uuid, text) to authenticated;

-- --- reopen_semester -------------------------------------------------------------
-- Admin only (decision 8). The checks, in order: it exists, it is closed, no
-- other semester has started since, and it is the one closed last — so
-- "reopen" can never reach back past a semester that came after it. The same
-- exclusive lock as close and start, so a reopen and a start can't both win.
create or replace function public.reopen_semester(p_semester_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  v_semester public.semesters;
  v_open public.semesters;
begin
  perform public.require_admin();

  perform pg_advisory_xact_lock(hashtext('public.semesters'));

  select * into v_semester from public.semesters where id = p_semester_id for update;
  if not found then
    raise exception 'Semester not found';
  end if;
  if v_semester.is_current then
    raise exception '% is not closed', v_semester.name;
  end if;

  select * into v_open from public.semesters where is_current;
  if found then
    raise exception '% has already started, so % can''t be reopened', v_open.name, v_semester.name;
  end if;

  -- "Closed last" is asked as "nothing started after it": a semester only
  -- starts once the one before it has closed, so the newest semester is
  -- always the one closed last. Comparing closed_at instead would tie for
  -- two closes in one transaction, where now() doesn't move.
  if exists (
    select 1 from public.semesters s
     where s.created_at > v_semester.created_at
  ) then
    raise exception 'Only the most recently closed semester can be reopened';
  end if;

  update public.semesters
     set closed_at = null, closed_by = null, reopened_at = now(), reopened_by = caller
   where id = p_semester_id;

  return public.current_semester();
end;
$$;

revoke all on function public.reopen_semester(uuid) from public, anon;
grant execute on function public.reopen_semester(uuid) to authenticated;

-- --- start_semester -------------------------------------------------------------
-- Admin only, and only once the current semester is closed: two open
-- semesters is the one state the unique index exists to refuse, and saying
-- so in a sentence first is kinder than a constraint name.
--
-- The formation deadline becomes the new semester's flagged milestone
-- (decision 3), written in the same transaction, so a semester never exists
-- without one. It has to be in the future — a deadline already past would
-- lock every roster the moment the semester opened — and on or before the
-- last day. The name follows the milestone-name rules (28_) and is unique
-- regardless of case, because it is what an admin types to close it.
create or replace function public.start_semester(
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_formation_deadline timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_open public.semesters;
  v_row public.semesters;
begin
  perform public.require_admin();

  if v_name = '' then
    raise exception 'Give the semester a name';
  end if;
  if char_length(v_name) > 40 then
    raise exception 'Keep the semester name to 40 characters or fewer';
  end if;
  if v_name ~ '[[:cntrl:]]' or v_name ~ '[​-‏‪-‮⁠-⁩﻿]' then
    raise exception 'The semester name can''t contain line breaks, hidden or control characters';
  end if;
  if v_name !~ '[^[:space:][:punct:] -⯿⸀-⹿　-〿︀-️\U0001F000-\U0001FAFF]' then
    raise exception 'The semester name has to include letters or numbers';
  end if;

  if p_starts_on is null or p_ends_on is null then
    raise exception 'Give the semester a start date and an end date';
  end if;
  if p_starts_on < date '2000-01-01' or p_ends_on >= date '2100-01-01' then
    raise exception 'Pick dates between 2000 and 2099';
  end if;
  if p_ends_on <= p_starts_on then
    raise exception 'The semester has to end after it starts';
  end if;

  if p_formation_deadline is null then
    raise exception 'Set the team formation deadline';
  end if;
  if p_formation_deadline <= now() then
    raise exception 'The team formation deadline has to be in the future';
  end if;
  if (p_formation_deadline at time zone 'America/Chicago')::date > p_ends_on then
    raise exception 'The team formation deadline has to fall on or before the semester''s last day';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.semesters'));

  select * into v_open from public.semesters where is_current;
  if found then
    raise exception 'Close % before starting the next semester', v_open.name;
  end if;

  if exists (select 1 from public.semesters where lower(name) = lower(v_name)) then
    raise exception 'There is already a semester called %', v_name;
  end if;

  insert into public.semesters (name, starts_on, ends_on)
  values (v_name, p_starts_on, p_ends_on)
  returning * into v_row;

  insert into public.milestones (name, due_at, is_formation_deadline, semester_id)
  values ('Team formation deadline', p_formation_deadline, true, v_row.id);

  return public.current_semester();
end;
$$;

revoke all on function public.start_semester(text, date, date, timestamptz) from public, anon;
grant execute on function public.start_semester(text, date, date, timestamptz) to authenticated;

-- =========================================================================
-- Past semesters: read-only, and read through these two functions only.
-- The table policies are current-only by design (decision 1), so this is the
-- one door to an archived team, and it checks who is knocking.
--
-- Who sees a past team:
--   * an admin — every team in every closed semester;
--   * a student who was on it;
--   * the adviser who advised it: an accepted row on it (decision 6).
-- Nobody else, including another student from the same semester.
-- =========================================================================

create or replace function private.can_see_past_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
      or private.is_on_project_team(p_project_id)
      or private.advises_project(p_project_id);
$$;

revoke all on function private.can_see_past_project(uuid) from public, anon, authenticated;

-- The list: every closed semester the caller has a team in, newest first,
-- each with the teams they may open. An admin gets every closed semester,
-- including one that had no teams, so the list is the whole history.
create or replace function public.past_semesters()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  v_admin boolean;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;
  v_admin := private.is_admin();

  return coalesce((
    select jsonb_agg(x.semester order by x.closed_at desc, x.name)
      from (
        select s.closed_at, s.name,
               jsonb_build_object(
                 'id', s.id,
                 'name', s.name,
                 'starts_on', s.starts_on,
                 'ends_on', s.ends_on,
                 'closed_at', s.closed_at,
                 'teams', teams.list) as semester
          from public.semesters s
          cross join lateral (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'project_id', p.id,
                     'team_id', t.id,
                     'title', p.title,
                     'formed_at', t.formed_at,
                     'is_member', private.is_on_project_team(p.id),
                     'is_adviser', private.advises_project(p.id),
                     'members', coalesce((
                       select jsonb_agg(jsonb_build_object(
                                'user_id', u.id, 'name', u.name, 'role_name', r.name)
                              order by u.name, u.id)
                         from public.team_members tm
                         join public.users u on u.id = tm.user_id
                         join public.roles r on r.id = tm.role_id
                        where tm.team_id = t.id and not u.is_admin
                     ), '[]'::jsonb),
                     'adviser_name', (
                       select u.name
                         from public.adviser_requests ar
                         join public.users u on u.id = ar.adviser_id
                        where ar.project_id = p.id and ar.status = 'accepted')
                   ) order by p.title, p.id), '[]'::jsonb) as list
              from public.projects p
              join public.teams t on t.project_id = p.id
             where p.semester_id = s.id
               and private.can_see_past_project(p.id)
          ) teams
         where s.closed_at is not null
           and (v_admin or jsonb_array_length(teams.list) > 0)
      ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.past_semesters() from public, anon;
grant execute on function public.past_semesters() to authenticated;

-- One past team, everything the issue asks an admin to be able to see: its
-- members, its adviser, its deliverables and its check-ins. Refuses a team
-- that is still current (that one is on the Team page, with its controls),
-- and anyone who was not on it, did not advise it, and is not an admin.
--
-- Deliverables come from project_deliverables(), the same function the team
-- page draws from, so a past team's list can't be shaped differently from a
-- current one's.
create or replace function public.past_team(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_semester public.semesters;
  v_team public.teams;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then
    raise exception 'Team not found';
  end if;

  select * into v_semester from public.semesters where id = v_project.semester_id;
  if v_semester.is_current then
    raise exception 'That team is in the current semester';
  end if;

  if not private.can_see_past_project(p_project_id) then
    raise exception 'Only the team, its adviser and admins can see a past team'
      using errcode = '42501';
  end if;

  select * into v_team from public.teams where project_id = p_project_id;

  return jsonb_build_object(
    'project_id', v_project.id,
    'team_id', v_team.id,
    'title', v_project.title,
    'description', v_project.description,
    'team_size_target', v_project.team_size_target,
    'status', v_project.status,
    'github_repo', v_project.github_repo,
    'formed_at', v_team.formed_at,
    'semester', jsonb_build_object(
      'id', v_semester.id,
      'name', v_semester.name,
      'starts_on', v_semester.starts_on,
      'ends_on', v_semester.ends_on,
      'closed_at', v_semester.closed_at),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', u.id, 'name', u.name, 'role_name', r.name, 'joined_at', tm.joined_at)
             order by u.name, u.id)
        from public.team_members tm
        join public.users u on u.id = tm.user_id
        join public.roles r on r.id = tm.role_id
       where tm.team_id = v_team.id and not u.is_admin
    ), '[]'::jsonb),
    'adviser', (
      select jsonb_build_object('id', u.id, 'name', u.name)
        from public.adviser_requests ar
        join public.users u on u.id = ar.adviser_id
       where ar.project_id = p_project_id and ar.status = 'accepted'),
    'deliverables', public.project_deliverables(p_project_id),
    'check_ins', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'user_id', c.user_id,
               'user_name', u.name,
               'week_start', c.week_start,
               'did', c.did,
               'doing_next', c.doing_next,
               'blockers', c.blockers,
               'updated_at', c.updated_at)
             order by c.week_start desc, u.name, c.id)
        from public.check_ins c
        left join public.users u on u.id = c.user_id
       where c.project_id = p_project_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.past_team(uuid) from public, anon;
grant execute on function public.past_team(uuid) to authenticated;

commit;
