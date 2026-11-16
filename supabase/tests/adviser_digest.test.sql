-- Weekly adviser digest (issue #59): 38_adviser_digest.sql.
--
-- Nothing links an adviser to a team until #53/#54, so the first tests check
-- the stub sends nobody anything. The rest swap private.advised_teams() for
-- one that reads a table of this test's own (all rolled back at the end), the
-- way #53/#54's real version will answer, and check everything built on it.
begin;
select plan(32);

select set_config('tests.adv',    tests.sign_in_with_microsoft('dgadv@utrgv.edu', 'Adviser Ana')::text, true);
select set_config('tests.off',    tests.sign_in_with_microsoft('dgoff@utrgv.edu', 'Adviser Off')::text, true);
select set_config('tests.idle',   tests.sign_in_with_microsoft('dgidle@utrgv.edu', 'Adviser Idle')::text, true);
select set_config('tests.s1',     tests.sign_in_with_microsoft('dgs1@utrgv.edu', 'Student One')::text, true);
select set_config('tests.s2',     tests.sign_in_with_microsoft('dgs2@utrgv.edu', 'Student Two')::text, true);
select set_config('tests.s3',     tests.sign_in_with_microsoft('dgs3@utrgv.edu', 'Student Three')::text, true);
select set_config('tests.s4',     tests.sign_in_with_microsoft('dgs4@utrgv.edu', 'Student Four')::text, true);
update public.users set is_admin = true
 where id in (current_setting('tests.adv')::uuid, current_setting('tests.off')::uuid,
              current_setting('tests.idle')::uuid);

-- Two teams, titled so their order is known.
select set_config('tests.proj_b', tests.create_full_team(current_setting('tests.s1')::uuid, current_setting('tests.s2')::uuid)::text, true);
select set_config('tests.proj_a', tests.create_full_team(current_setting('tests.s3')::uuid, current_setting('tests.s4')::uuid)::text, true);
select set_config('tests.team_b', (select id from public.teams where project_id = current_setting('tests.proj_b')::uuid)::text, true);
select set_config('tests.team_a', (select id from public.teams where project_id = current_setting('tests.proj_a')::uuid)::text, true);
update public.projects set title = 'Bravo' where id = (select project_id from public.teams where id = current_setting('tests.team_b')::uuid);
update public.projects set title = 'Alpha' where id = (select project_id from public.teams where id = current_setting('tests.team_a')::uuid);

-- --- the setting ---------------------------------------------------------------
select has_column('public', 'users', 'adviser_digest', 'users has an adviser_digest column');
select col_not_null('public', 'users', 'adviser_digest', 'adviser_digest is never null');
select is((select adviser_digest from public.users where id = current_setting('tests.adv')::uuid), true,
  'the digest is on by default');

select tests.authenticate_as(current_setting('tests.off')::uuid);
update public.users set adviser_digest = false where id = auth.uid();
update public.users set adviser_digest = false where id = current_setting('tests.adv')::uuid;
select tests.clear_authentication();
select is((select adviser_digest from public.users where id = current_setting('tests.off')::uuid), false,
  'an adviser can turn their own digest off');
select is((select adviser_digest from public.users where id = current_setting('tests.adv')::uuid), true,
  'but not someone else''s');

-- --- until #53/#54: nobody advises anything, so nobody gets one --------------
select is((select count(*)::int from private.advised_teams(current_setting('tests.adv')::uuid)), 0,
  'the stub says an adviser advises no teams');
select is((select count(*)::int from private.adviser_digest_recipients()), 0,
  'so the send list is empty');
-- Monday 2026-11-16, 8:00 AM CST = 14:00 UTC.
select is(private.send_adviser_digests('2026-11-16 14:00+00'), 0,
  'and the job sends nothing, even at 8 AM on a Monday');

-- --- with advisers linked to teams ------------------------------------------------
-- adv advises both teams, off advises one but turned the digest off, idle
-- advises nothing. s1 (a student) is linked to a team too, to show students
-- never get one.
create table tests.advising (adviser_id uuid, team_id uuid);
insert into tests.advising values
  (current_setting('tests.adv')::uuid,  current_setting('tests.team_b')::uuid),
  (current_setting('tests.adv')::uuid,  current_setting('tests.team_a')::uuid),
  (current_setting('tests.off')::uuid,  current_setting('tests.team_a')::uuid),
  (current_setting('tests.s1')::uuid,   current_setting('tests.team_a')::uuid);

create or replace function private.advised_teams(p_adviser uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select team_id from tests.advising where adviser_id = p_adviser;
$$;

select results_eq(
  $$ select id from private.adviser_digest_recipients() r(id) $$,
  $$ values (current_setting('tests.adv')::uuid) $$,
  'the send list is the advisers with the digest on who advise a team: not those who turned it off, advise nothing, or are students');

-- --- the data -------------------------------------------------------------------
-- The class calendar, around the week of Monday 2026-11-16 (Central).
delete from public.milestones;
insert into public.milestones (name, due_at) values
  ('Last week',        '2026-11-15 23:59 America/Chicago'),
  ('Monday standup',   '2026-11-16 00:00 America/Chicago'),
  ('Demo day',         '2026-11-18 12:00 America/Chicago'),
  ('Sunday night',     '2026-11-22 23:59 America/Chicago'),
  ('Next week',        '2026-11-23 00:00 America/Chicago');

select set_config('tests.data',
  private.adviser_digest_data(current_setting('tests.adv')::uuid, '2026-11-16 14:00+00')::text, true);

select is(current_setting('tests.data')::jsonb ->> 'week_start', '2026-11-09',
  'a digest sent Monday Nov 16 covers the week starting Monday Nov 9');
select is(current_setting('tests.data')::jsonb ->> 'week_end', '2026-11-15', '... through Sunday Nov 15');
select is(
  (select jsonb_agg(x ->> 'name') from jsonb_array_elements(current_setting('tests.data')::jsonb -> 'due_this_week') x),
  '["Monday standup", "Demo day", "Sunday night"]'::jsonb,
  'what''s due this week: Monday 00:00 through Sunday night Central, in date order');
select is(
  (select jsonb_agg(x ->> 'project_title') from jsonb_array_elements(current_setting('tests.data')::jsonb -> 'teams') x),
  '["Alpha", "Bravo"]'::jsonb,
  'one section per advised team, by title');
select is(current_setting('tests.data')::jsonb -> 'teams' -> 0 ->> 'team_id', current_setting('tests.team_a'),
  'each team carries its id, for the link to its page');
select is(current_setting('tests.data')::jsonb -> 'teams' -> 0 -> 'flagged', 'false'::jsonb,
  'no team is flagged until #56''s rules exist');
select is(current_setting('tests.data')::jsonb -> 'teams' -> 0 -> 'checkins_submitted', 'null'::jsonb,
  'check-ins are null (not tracked yet) until #55');
select is(current_setting('tests.data')::jsonb -> 'teams' -> 0 -> 'blockers', '[]'::jsonb,
  'blockers are an empty list until #55');
select is(current_setting('tests.data')::jsonb -> 'teams' -> 0 -> 'deliverables_to_review', 'null'::jsonb,
  'deliverables are null until #57');
select is(current_setting('tests.data')::jsonb -> 'teams' -> 0 -> 'last_commit_at', 'null'::jsonb,
  'last commit is null until #58');
select is(
  private.adviser_digest_data(current_setting('tests.adv')::uuid, '2026-11-22 23:00 America/Chicago') ->> 'week_start',
  '2026-11-09', 'any time in the week of Nov 16 still means last week was Nov 9');

-- --- the job --------------------------------------------------------------------
select is(private.send_adviser_digests('2026-11-16 13:59+00'), 0, 'Monday 7:59 AM Central: nothing yet');
select is(private.send_adviser_digests('2026-11-16 14:00+00'), 1, 'Monday 8:00 AM Central: one digest');
select results_eq(
  $$ select adviser_id, week_start from public.adviser_digests $$,
  $$ values (current_setting('tests.adv')::uuid, '2026-11-09'::date) $$,
  'it is for the one adviser on the send list, for last week');
select is((select data from public.adviser_digests),
  private.adviser_digest_data(current_setting('tests.adv')::uuid, '2026-11-16 14:00+00'),
  'the row holds that adviser''s digest data');
select is(private.send_adviser_digests('2026-11-16 14:30+00'), 0, 'running again the same morning sends nothing more');
select is(private.send_adviser_digests('2026-11-16 15:00+00'), 0, 'Monday 9:00 AM Central: nothing');
select is(private.send_adviser_digests('2026-11-17 14:00+00'), 0, 'Tuesday 8:00 AM Central: nothing');
-- In daylight time 8 AM Central is 13:00 UTC: Monday 2027-06-14.
select is(private.send_adviser_digests('2027-06-14 13:00+00'), 1, 'in daylight time, Monday 13:00 UTC is 8 AM Central: sends');
select is(private.send_adviser_digests('2027-06-14 14:00+00'), 0, '... and 14:00 UTC (9 AM CDT) sends nothing');

-- --- nobody reads it through the API ----------------------------------------------
select tests.authenticate_as(current_setting('tests.adv')::uuid);
select throws_ok($$ select * from public.adviser_digests $$, '42501', null,
  'signed-in users cannot read adviser_digests');
select throws_ok($$ select private.send_adviser_digests() $$, '42501', null,
  'signed-in users cannot run the job');
select tests.clear_authentication();

-- --- the schedule -------------------------------------------------------------------
-- pg_cron isn't in the test database, so this only checks the job where it
-- is; the job itself is checked in the Supabase dashboard before each demo.
create function pg_temp.digest_job_scheduled() returns boolean
language plpgsql as $$
declare
  v_found boolean;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return true;
  end if;
  execute $q$ select exists (select 1 from cron.job
                              where jobname = 'adviser-digest' and schedule = '0 13,14 * * 1') $q$
    into v_found;
  return v_found;
end;
$$;
select ok(pg_temp.digest_job_scheduled(),
  'the adviser-digest job is scheduled for Monday 13:00 and 14:00 UTC wherever pg_cron is enabled');

select * from finish();
rollback;
