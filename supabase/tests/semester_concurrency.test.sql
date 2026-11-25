-- Issue #61 — the races around closing a semester, with real connections.
-- 50_semesters.sql.
--
-- Three locks in 50_ only matter when two sessions overlap, and a single
-- rolled-back transaction can't show any of them:
--
--   1. archive_guard() takes a shared advisory lock and close_semester() an
--      exclusive one on the same key, so a write already in flight finishes
--      before a close counts anything ...
--   2. ... and a write that arrives during a close waits for it, then finds
--      the semester closed. Without the pair, a join request committed in the
--      same instant as the close is left pending in an archived semester.
--   3. one_team_per_semester() serializes on the student, so two sessions
--      seating one student on two teams can't both pass the check — the race
--      the old primary key on team_members.user_id used to close.
--
-- Like join_request_concurrency.test.sql this does NOT run in a rolled-back
-- transaction: the connections have to see each other's commits. It commits
-- its fixtures, reopens Fall 2026 after each close (the files that run after
-- this one need a current semester), and deletes what it made at the end.
-- run.sh rebuilds the database every run, so a crash midway leaves nothing
-- behind that matters.
--
-- Each race first waits until the second session is actually blocked on a
-- lock, so the assertion is about the lock deciding the outcome, not timing.
create extension if not exists dblink;

select plan(11);

select set_config('tests.admin',   tests.sign_in_with_microsoft('race61-admin@utrgv.edu',  'Race Admin')::text, false);
select set_config('tests.owner_1', tests.sign_in_with_microsoft('race61-own1@utrgv.edu',   'Race Owner One')::text, false);
select set_config('tests.owner_2', tests.sign_in_with_microsoft('race61-own2@utrgv.edu',   'Race Owner Two')::text, false);
select set_config('tests.asker_1', tests.sign_in_with_microsoft('race61-ask1@utrgv.edu',   'Race Asker One')::text, false);
select set_config('tests.asker_2', tests.sign_in_with_microsoft('race61-ask2@utrgv.edu',   'Race Asker Two')::text, false);
select set_config('tests.seated',  tests.sign_in_with_microsoft('race61-seat@utrgv.edu',   'Race Seated')::text, false);
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;
select set_config('tests.role', (select id from public.roles where name = 'Frontend Developer')::text, false);
select set_config('tests.fall', (select id from public.semesters where name = 'Fall 2026')::text, false);

-- Two open projects in Fall 2026, each with its owner seated.
with p as (
  insert into public.projects (creator_id, title, description, team_size_target)
  values (current_setting('tests.owner_1')::uuid, 'Race project one', 'Somewhere to ask to join.', 3)
  returning id
)
select set_config('tests.project_1', id::text, false) from p;
with t as (insert into public.teams (project_id) values (current_setting('tests.project_1')::uuid) returning id)
select set_config('tests.team_1', id::text, false) from t;
with p as (
  insert into public.projects (creator_id, title, description, team_size_target)
  values (current_setting('tests.owner_2')::uuid, 'Race project two', 'Somewhere else to ask to join.', 3)
  returning id
)
select set_config('tests.project_2', id::text, false) from p;
with t as (insert into public.teams (project_id) values (current_setting('tests.project_2')::uuid) returning id)
select set_config('tests.team_2', id::text, false) from t;
insert into public.team_members (user_id, team_id, role_id) values
  (current_setting('tests.owner_1')::uuid, current_setting('tests.team_1')::uuid, current_setting('tests.role')::uuid),
  (current_setting('tests.owner_2')::uuid, current_setting('tests.team_2')::uuid, current_setting('tests.role')::uuid);

select dblink_connect('race_a', format('dbname=%s user=%s port=%s', current_database(), current_user, current_setting('port')));
select dblink_connect('race_b', format('dbname=%s user=%s port=%s', current_database(), current_user, current_setting('port')));

-- Polls until some session is waiting on a lock while running a statement
-- that matches p_query, for up to 10 seconds.
create function pg_temp.blocked_on(p_query text)
returns boolean
language plpgsql
as $$
declare
  v_blocked boolean := false;
begin
  for i in 1..200 loop
    perform pg_stat_clear_snapshot();
    select exists (
      select 1 from pg_stat_activity
       where datname = current_database()
         and wait_event_type = 'Lock'
         and query like p_query
    ) into v_blocked;
    exit when v_blocked;
    perform pg_sleep(0.05);
  end loop;
  return v_blocked;
end;
$$;

-- =========================================================================
-- 1. A join request is in flight when the admin closes the semester.
-- =========================================================================

select dblink_exec('race_a', 'begin');
select * from dblink('race_a', format('select tests.authenticate_as(%L)::text', current_setting('tests.asker_1'))) as t(x text);
select * from dblink('race_a', format(
  'select (public.create_join_request(%L, null)).status', current_setting('tests.project_1'))) as t(status text);

select dblink_exec('race_b', 'begin');
select * from dblink('race_b', format('select tests.authenticate_as(%L)::text', current_setting('tests.admin'))) as t(x text);
select dblink_send_query('race_b', format(
  'select public.close_semester(%L, %L)::text', current_setting('tests.fall'), 'Fall 2026'));

select ok(pg_temp.blocked_on('%close_semester%'),
  'a close waits for a join request that is still being written');

select dblink_exec('race_a', 'commit');

create temporary table race_1_close as
select summary::jsonb from dblink_get_result('race_b', false) as t(summary text);
select * from dblink_get_result('race_b', false) as t(summary text);
select dblink_exec('race_b', 'commit');

select is((select (summary ->> 'pending_join_requests')::int from race_1_close), 1,
  'then counts it among the requests it cancels');
select is(
  (select status from public.join_requests
    where user_id = current_setting('tests.asker_1')::uuid and project_id = current_setting('tests.project_1')::uuid),
  'cancelled',
  'and cancels it: no request is left pending in a closed semester');

update public.semesters set closed_at = null, closed_by = null where id = current_setting('tests.fall')::uuid;

-- =========================================================================
-- 2. The admin is closing the semester when a join request arrives.
-- =========================================================================

select dblink_exec('race_b', 'begin');
select * from dblink('race_b', format('select tests.authenticate_as(%L)::text', current_setting('tests.admin'))) as t(x text);
select * from dblink('race_b', format(
  'select (public.close_semester(%L, %L) ->> %L)', current_setting('tests.fall'), 'Fall 2026', 'name')) as t(name text);

select dblink_exec('race_a', 'begin');
select * from dblink('race_a', format('select tests.authenticate_as(%L)::text', current_setting('tests.asker_2'))) as t(x text);
select dblink_send_query('race_a', format(
  'select (public.create_join_request(%L, null)).status', current_setting('tests.project_2')));

select ok(pg_temp.blocked_on('%create_join_request%'),
  'a join request waits for a close that is still being written');

select dblink_exec('race_b', 'commit');

create temporary table race_2_request as
select status from dblink_get_result('race_a', false) as t(status text);
select set_config('tests.race_2_error', coalesce(dblink_error_message('race_a'), ''), false);
select * from dblink_get_result('race_a', false) as t(status text);
select dblink_exec('race_a', 'rollback');

select is((select count(*)::int from race_2_request), 0, 'then fails');
select matches(current_setting('tests.race_2_error'), 'Fall 2026 has been closed — past semesters are read-only',
  'because the semester it was asking into has closed');
select is(
  (select count(*)::int from public.join_requests where user_id = current_setting('tests.asker_2')::uuid),
  0, 'and nothing was written');

update public.semesters set closed_at = null, closed_by = null where id = current_setting('tests.fall')::uuid;

-- =========================================================================
-- 3. Two sessions seat one student on two teams in the same semester.
-- Direct inserts, as the superuser: this is the table's own floor, under
-- every function that checks first.
-- =========================================================================

select dblink_exec('race_a', 'begin');
select dblink_exec('race_a', format(
  'insert into public.team_members (user_id, team_id, role_id) values (%L, %L, %L)',
  current_setting('tests.seated'), current_setting('tests.team_1'), current_setting('tests.role')));

select dblink_exec('race_b', 'begin');
select dblink_send_query('race_b', format(
  'insert into public.team_members (user_id, team_id, role_id) values (%L, %L, %L) returning team_id::text',
  current_setting('tests.seated'), current_setting('tests.team_2'), current_setting('tests.role')));

select ok(pg_temp.blocked_on('%insert into public.team_members%'),
  'seating a student waits for another seating of the same student');

select dblink_exec('race_a', 'commit');

create temporary table race_3_seat as
select team_id from dblink_get_result('race_b', false) as t(team_id text);
select set_config('tests.race_3_error', coalesce(dblink_error_message('race_b'), ''), false);
select * from dblink_get_result('race_b', false) as t(team_id text);
select dblink_exec('race_b', 'rollback');

select matches(current_setting('tests.race_3_error'), 'That student is already on a team this semester',
  'then refuses: one team per student per semester');
select is(
  (select count(*)::int from public.team_members where user_id = current_setting('tests.seated')::uuid),
  1, 'and the student holds one seat');

select dblink_disconnect('race_a');
select dblink_disconnect('race_b');

-- Clean up. Fall 2026 is open again, so the guard lets these through.
select is((select is_current from public.semesters where id = current_setting('tests.fall')::uuid), true,
  'Fall 2026 is left current for the files that run after this one');
delete from public.projects where id in (current_setting('tests.project_1')::uuid, current_setting('tests.project_2')::uuid);
delete from public.users where id in (
  current_setting('tests.admin')::uuid, current_setting('tests.owner_1')::uuid, current_setting('tests.owner_2')::uuid,
  current_setting('tests.asker_1')::uuid, current_setting('tests.asker_2')::uuid, current_setting('tests.seated')::uuid);
delete from auth.users where id in (
  current_setting('tests.admin')::uuid, current_setting('tests.owner_1')::uuid, current_setting('tests.owner_2')::uuid,
  current_setting('tests.asker_1')::uuid, current_setting('tests.asker_2')::uuid, current_setting('tests.seated')::uuid);

select * from finish();
