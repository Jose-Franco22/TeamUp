-- Two accepts racing for the last seat (15_join_request_responses.sql):
-- one succeeds and the other is refused, never both.
--
-- A race needs two real connections, and each has to see data the other
-- committed, so unlike the other test files this one does NOT run inside a
-- rolled-back transaction: it commits its fixtures, drives two dblink
-- connections, and deletes what it made at the end. run.sh rebuilds the
-- database from scratch every run, so a crash midway leaves nothing behind
-- that matters.
--
-- Connection A accepts Ana and holds its transaction open. Connection B
-- then tries to accept Ben into the same (last) seat and has to wait on
-- A's lock. A commits; B wakes up, re-counts the roster, and must fail.
create extension if not exists dblink;

select plan(6);

-- Fixtures, committed: a team of 2 (owner + 1 seat) and two pending requests.
select set_config('tests.owner', tests.sign_in_with_microsoft('race-owner@utrgv.edu', 'Race Owner')::text, false);
select set_config('tests.ana', tests.sign_in_with_microsoft('race-ana@utrgv.edu', 'Race Ana')::text, false);
select set_config('tests.ben', tests.sign_in_with_microsoft('race-ben@utrgv.edu', 'Race Ben')::text, false);
select set_config('tests.role', (select id from public.roles where name = 'Frontend Developer')::text, false);

with p as (
  insert into public.projects (creator_id, title, team_size_target)
  values (current_setting('tests.owner')::uuid, 'Race Project', 2)
  returning id
)
select set_config('tests.project', id::text, false) from p;
with t as (insert into public.teams (project_id) values (current_setting('tests.project')::uuid) returning id)
select set_config('tests.team', id::text, false) from t;
insert into public.team_members (user_id, team_id, role_id)
values (current_setting('tests.owner')::uuid, current_setting('tests.team')::uuid, current_setting('tests.role')::uuid);
with r as (insert into public.join_requests (project_id, user_id)
           values (current_setting('tests.project')::uuid, current_setting('tests.ana')::uuid) returning id)
select set_config('tests.ana_req', id::text, false) from r;
with r as (insert into public.join_requests (project_id, user_id)
           values (current_setting('tests.project')::uuid, current_setting('tests.ben')::uuid) returning id)
select set_config('tests.ben_req', id::text, false) from r;

-- Two more sessions on this same database, as the same Postgres user.
select dblink_connect('race_a', format('dbname=%s user=%s port=%s', current_database(), current_user, current_setting('port')));
select dblink_connect('race_b', format('dbname=%s user=%s port=%s', current_database(), current_user, current_setting('port')));

-- A: accept Ana, but don't commit yet.
select dblink_exec('race_a', 'begin');
select * from dblink('race_a', format('select tests.authenticate_as(%L)::text', current_setting('tests.owner'))) as t(x text);
select * from dblink('race_a', format(
  'select (public.respond_to_join_request(%L, %L, %L)).status',
  current_setting('tests.ana_req'), 'accepted', current_setting('tests.role'))) as t(status text);

-- B: accept Ben, sent asynchronously because it's expected to block on A.
select dblink_exec('race_b', 'begin');
select * from dblink('race_b', format('select tests.authenticate_as(%L)::text', current_setting('tests.owner'))) as t(x text);
select dblink_send_query('race_b', format(
  'select (public.respond_to_join_request(%L, %L, %L)).status',
  current_setting('tests.ben_req'), 'accepted', current_setting('tests.role')));

-- Wait (up to 10s) until B is actually stuck waiting on a lock, so the
-- test proves the lock is what decides the race rather than timing.
create temporary table race_state (b_was_blocked boolean);
do $$
declare
  v_blocked boolean := false;
begin
  for i in 1..200 loop
    perform pg_stat_clear_snapshot();
    select exists (
      select 1 from pg_stat_activity
      where datname = current_database()
        and wait_event_type = 'Lock'
        and query like '%respond_to_join_request%'
    ) into v_blocked;
    exit when v_blocked;
    perform pg_sleep(0.05);
  end loop;
  insert into race_state values (v_blocked);
end $$;

select ok((select b_was_blocked from race_state),
  'the second accept waits for the first instead of reading a stale roster');

select dblink_exec('race_a', 'commit');

-- B's result: no row, and the error message, because its accept failed.
create temporary table race_b_result as
select status from dblink_get_result('race_b', false) as t(status text);
select set_config('tests.b_error', dblink_error_message('race_b'), false);
-- Drain the end-of-results marker so the connection can be reused.
select * from dblink_get_result('race_b', false) as t(status text);
select dblink_exec('race_b', 'rollback');

select is((select count(*)::int from race_b_result), 0,
  'the second accept for the last seat fails');
select matches(current_setting('tests.b_error'), 'This team is already full',
  'with a "team is already full" error');

select results_eq(
  format($q$select user_id from public.team_members where team_id = %L order by joined_at$q$,
    current_setting('tests.team')),
  format($q$values (%L::uuid), (%L::uuid)$q$, current_setting('tests.owner'), current_setting('tests.ana')),
  'only the first accept made it onto the roster');
select is(
  (select status from public.join_requests where id = current_setting('tests.ben_req')::uuid),
  'pending',
  'the losing request is still pending');
select is(
  (select status from public.projects where id = current_setting('tests.project')::uuid),
  'full',
  'the project is full');

select dblink_disconnect('race_a');
select dblink_disconnect('race_b');

-- Clean up the committed fixtures.
delete from public.projects where id = current_setting('tests.project')::uuid;
delete from public.users where id in (
  current_setting('tests.owner')::uuid, current_setting('tests.ana')::uuid, current_setting('tests.ben')::uuid);
delete from auth.users where id in (
  current_setting('tests.owner')::uuid, current_setting('tests.ana')::uuid, current_setting('tests.ben')::uuid);

select * from finish();
