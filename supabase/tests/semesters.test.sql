-- Issue #61 — semesters: the table, the backfill, exactly one current, and
-- closing one and starting the next. 50_semesters.sql.
--
-- What closing does to everything else — read-only teams, current-only
-- reads, Past semesters — is semester_archive.test.sql. This file is the
-- machinery.
--
-- The backfill case is the one to read first. The harness builds the
-- database from empty, so when 50_ runs here there is nothing to backfill
-- and the migration's own call proves nothing. This file puts the database
-- back the way the live one is before 50_ — rows with no semester — and
-- runs the same function the migration runs, then checks it the way a
-- broken one would fail: rows left behind, rows gained or lost, a second run
-- that does something.
begin;
select plan(135);

select set_config('tests.admin',   tests.sign_in_with_microsoft('admin61@utrgv.edu',   'Ana Admin')::text, true);
select set_config('tests.owner',   tests.sign_in_with_microsoft('owner61@utrgv.edu',   'Olivia Owner')::text, true);
select set_config('tests.member',  tests.sign_in_with_microsoft('member61@utrgv.edu',  'Mo Member')::text, true);
select set_config('tests.student', tests.sign_in_with_microsoft('student61@utrgv.edu', 'Sam Student')::text, true);
select set_config('tests.adviser', tests.sign_in_with_microsoft('adviser61@utrgv.edu', 'Ada Adviser')::text, true);
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;
insert into public.faculty_directory (email) values ('adviser61@utrgv.edu');

select set_config('tests.role', (select id from public.roles where name = 'Backend Developer')::text, true);
select set_config('tests.fall', (select id from public.semesters where name = 'Fall 2026')::text, true);

-- Every table the issue names, plus the ones that inherit. Counted as the
-- superuser, so RLS doesn't hide anything from the count.
create function pg_temp.row_counts()
returns jsonb
language plpgsql
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_table text;
  v_count bigint;
begin
  foreach v_table in array array[
    'semesters', 'projects', 'teams', 'team_members', 'project_roles_needed',
    'join_requests', 'adviser_requests', 'check_ins', 'deliverable_submissions',
    'deliverable_comments', 'repo_activity', 'next_step_completions',
    'notifications', 'admin_actions', 'milestones', 'announcements', 'next_steps']
  loop
    execute format('select count(*) from public.%I', v_table) into v_count;
    v_counts := v_counts || jsonb_build_object(v_table, v_count);
  end loop;
  return v_counts;
end;
$$;

-- --- the schema -----------------------------------------------------------------

select has_table('public', 'semesters', 'semesters exists');
select col_not_null('public', 'semesters', 'name', 'a semester has a name');
select col_not_null('public', 'semesters', 'starts_on', 'and a start date');
select col_not_null('public', 'semesters', 'ends_on', 'and an end date');
select has_column('public', 'semesters', 'is_current', 'and says whether it is the current one');

-- The four course-wide tables carry the semester themselves.
select col_not_null('public', 'projects', 'semester_id', 'every project belongs to a semester');
select col_not_null('public', 'milestones', 'semester_id', 'every milestone belongs to a semester');
select col_not_null('public', 'announcements', 'semester_id', 'every announcement belongs to a semester');
select col_not_null('public', 'next_steps', 'semester_id', 'every next step belongs to a semester');
select fk_ok('public', 'projects', 'semester_id', 'public', 'semesters', 'id',
  'projects.semester_id points at a semester');

-- Everything that hangs off a project or a team inherits it, and must not
-- hold a second copy that could disagree.
select hasnt_column('public', t, 'semester_id', t || ' inherits its semester rather than storing one')
  from unnest(array['teams', 'team_members', 'join_requests', 'adviser_requests', 'check_ins',
                    'deliverable_submissions', 'deliverable_comments', 'repo_activity',
                    'next_step_completions', 'notifications', 'admin_actions']) as t;

-- And what persists across semesters has none at all.
select hasnt_column('public', t, 'semester_id', t || ' persists across semesters')
  from unnest(array['users', 'roles', 'skills', 'user_skills', 'profile_evidence',
                    'faculty_directory', 'adviser_expertise', 'adviser_digests']) as t;

-- --- the first semester -----------------------------------------------------------

select is((select count(*) from public.semesters), 1::bigint,
  'the migration makes exactly one semester');
select is(
  (select row(name, starts_on, ends_on, is_current, closed_at)::text from public.semesters),
  row('Fall 2026', date '2026-08-24', date '2026-12-12', true, null::timestamptz)::text,
  'Fall 2026, open, and current');
select is(public.current_semester_id(), current_setting('tests.fall')::uuid,
  'current_semester_id() is Fall 2026');

-- --- the backfill -------------------------------------------------------------------
-- Rows of every kind, made the ordinary way, in Fall 2026.

select set_config('tests.project', tests.create_full_team(
  current_setting('tests.owner')::uuid, current_setting('tests.member')::uuid)::text, true);
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select public.save_milestone(null, 'Proposal due', now() + interval '10 days');
select public.save_milestone(null, 'Team formation deadline', now() + interval '5 days', true);
select public.save_announcement(null, 'Welcome', 'Teams form over the next three weeks.');
select public.save_next_step(null, 'Meet your adviser');
select tests.clear_authentication();

-- Now make it look like the live database before 50_: nothing has a
-- semester. Dropping NOT NULL is only possible because this transaction is
-- rolled back at the end.
alter table public.projects      alter column semester_id drop not null;
alter table public.milestones    alter column semester_id drop not null;
alter table public.announcements alter column semester_id drop not null;
alter table public.next_steps    alter column semester_id drop not null;
update public.projects      set semester_id = null;
update public.milestones    set semester_id = null;
update public.announcements set semester_id = null;
update public.next_steps    set semester_id = null;

select set_config('tests.before_backfill', pg_temp.row_counts()::text, true);
select set_config('tests.unassigned', (
  (select count(*) from public.projects) + (select count(*) from public.milestones)
  + (select count(*) from public.announcements) + (select count(*) from public.next_steps))::text, true);

select ok(current_setting('tests.unassigned')::int >= 4,
  'there are rows of all four kinds without a semester to backfill');

select lives_ok(
  $$ select set_config('tests.backfill', private.backfill_semester(current_setting('tests.fall')::uuid)::text, true) $$,
  'the backfill runs and its own checks pass');

select is(
  (select sum(value::int) from jsonb_each_text(current_setting('tests.backfill')::jsonb -> 'moved')),
  current_setting('tests.unassigned')::bigint,
  'it moved every row that had no semester');

select is((select count(*) from public.projects where semester_id is null), 0::bigint,
  'no project is left without a semester');
select is((select count(*) from public.milestones where semester_id is null), 0::bigint,
  'no milestone is left without a semester');
select is((select count(*) from public.announcements where semester_id is null), 0::bigint,
  'no announcement is left without a semester');
select is((select count(*) from public.next_steps where semester_id is null), 0::bigint,
  'no next step is left without a semester');

select is(
  (select count(*) from public.projects where semester_id = current_setting('tests.fall')::uuid)
  + (select count(*) from public.milestones where semester_id = current_setting('tests.fall')::uuid)
  + (select count(*) from public.announcements where semester_id = current_setting('tests.fall')::uuid)
  + (select count(*) from public.next_steps where semester_id = current_setting('tests.fall')::uuid),
  current_setting('tests.unassigned')::bigint,
  'and every one of them is in Fall 2026');

select is(pg_temp.row_counts(), current_setting('tests.before_backfill')::jsonb,
  'the row count of every table is the same after the backfill as before it');
select is(current_setting('tests.backfill')::jsonb -> 'after',
          current_setting('tests.backfill')::jsonb -> 'before',
  'and the function counted the same thing itself');

select is(
  (select count(*) from public.team_members tm
     join public.teams t on t.id = tm.team_id
     join public.projects p on p.id = t.project_id
    where p.semester_id = current_setting('tests.fall')::uuid),
  (select count(*) from public.team_members),
  'every roster row reaches Fall 2026 through its project — nothing is orphaned');

select is(
  (select sum(value::int) from jsonb_each_text(
     private.backfill_semester(current_setting('tests.fall')::uuid) -> 'moved')),
  0::bigint,
  'run again, it moves nothing: the backfill is idempotent');

select throws_ok(
  $$ select private.backfill_semester(gen_random_uuid()) $$,
  'P0001', null,
  'it refuses a semester that does not exist rather than writing a dangling id');

alter table public.projects      alter column semester_id set not null;
alter table public.milestones    alter column semester_id set not null;
alter table public.announcements alter column semester_id set not null;
alter table public.next_steps    alter column semester_id set not null;

-- --- new rows land in the current semester ------------------------------------------

select tests.authenticate_as(current_setting('tests.student')::uuid);
select set_config('tests.project_b', (select (public.create_project(
  'Library seat finder', 'Shows which study rooms are free right now, floor by floor.',
  3::smallint, current_setting('tests.role')::uuid, '[]'::jsonb)).id::text), true);
select tests.clear_authentication();
select is((select semester_id from public.projects where id = current_setting('tests.project_b')::uuid),
  current_setting('tests.fall')::uuid,
  'a project created now is in the current semester without anyone passing it');

-- --- exactly one current ------------------------------------------------------------

select throws_ok(
  $$ insert into public.semesters (name, starts_on, ends_on) values ('Spring 2027', '2027-01-19', '2027-05-14') $$,
  '23505', null,
  'a second current semester is refused by the database, whoever writes it');

-- --- semesters' own RLS ---------------------------------------------------------------
-- A select policy and nothing else: start_semester() and close_semester()
-- are the only way to write.

select tests.authenticate_as(current_setting('tests.student')::uuid);
select is((select name from public.semesters), 'Fall 2026',
  'a signed-in student can read the semester (the positive control for the refusals below)');
select is(has_column_privilege('authenticated', 'public.semesters', 'closed_by', 'select'), false,
  'but not who closed it: that is an admin''s id');
select is(has_column_privilege('authenticated', 'public.semesters', 'reopened_by', 'select'), false,
  'or who reopened it');
select throws_ok(
  $$ insert into public.semesters (name, starts_on, ends_on) values ('Sneaky', '2027-01-01', '2027-02-01') $$,
  '42501', null, 'a direct insert is refused');
update public.semesters set name = 'Renamed' where id = current_setting('tests.fall')::uuid;
delete from public.semesters where id = current_setting('tests.fall')::uuid;
select tests.clear_authentication();
select is((select name from public.semesters where id = current_setting('tests.fall')::uuid), 'Fall 2026',
  'a direct update matches no rows');
select is((select count(*) from public.semesters), 1::bigint,
  'and a direct delete matches none either');

select set_config('role', 'anon', true);
select is((select count(*) from public.semesters), 0::bigint,
  'a guest reads no semesters — there is no policy for anon');
select is(public.current_semester_id(), current_setting('tests.fall')::uuid,
  'but a guest can call current_semester_id(), which the projects policy needs for them');
select tests.clear_authentication();

-- The house rule: revoke from anon explicitly, because Supabase grants it
-- execute by default and revoking from public alone leaves that in place.
select ok(not has_function_privilege('anon', f, 'execute'), 'anon cannot call ' || f)
  from unnest(array[
    'public.close_semester(uuid, text)',
    'public.start_semester(text, date, date, timestamptz)',
    'public.semester_close_preview()',
    'public.current_semester()',
    'public.past_semesters()',
    'public.past_team(uuid)',
    'public.reopen_semester(uuid)']) as f;
select ok(has_function_privilege('authenticated', f, 'execute'), 'a signed-in user can call ' || f)
  from unnest(array[
    'public.close_semester(uuid, text)',
    'public.start_semester(text, date, date, timestamptz)',
    'public.semester_close_preview()',
    'public.current_semester()',
    'public.past_semesters()',
    'public.past_team(uuid)',
    'public.reopen_semester(uuid)']) as f;
select ok(not has_function_privilege('authenticated', 'private.backfill_semester(uuid)', 'execute'),
  'nobody signed in can run the backfill');

-- --- the close preview ----------------------------------------------------------------
-- A pending join request and a pending adviser invitation, so there is
-- something to cancel.

select set_config('tests.asker', tests.sign_in_with_microsoft('asker61@utrgv.edu', 'Al Asker')::text, true);
select tests.authenticate_as(current_setting('tests.asker')::uuid);
select public.create_join_request(current_setting('tests.project_b')::uuid, null);
select tests.authenticate_as(current_setting('tests.student')::uuid);
select public.invite_adviser(current_setting('tests.project_b')::uuid, current_setting('tests.adviser')::uuid);

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.preview', public.semester_close_preview()::text, true);
select is(current_setting('tests.preview')::jsonb ->> 'name', 'Fall 2026', 'the preview names the semester');
select is((current_setting('tests.preview')::jsonb ->> 'teams')::int, 2,
  'it counts the teams that will be archived');
select is((current_setting('tests.preview')::jsonb ->> 'students')::int, 3,
  'and the students on them');
select is((current_setting('tests.preview')::jsonb ->> 'pending_join_requests')::int, 1,
  'and the join requests it will cancel');
select is((current_setting('tests.preview')::jsonb ->> 'pending_adviser_requests')::int, 1,
  'and the adviser requests it will cancel');

select tests.authenticate_as(current_setting('tests.student')::uuid);
select throws_ok($$ select public.semester_close_preview() $$, '42501', 'Admin access required',
  'a student cannot see the preview');

-- --- closing is admin-only, and confirmed by name -------------------------------------

select throws_ok(
  $$ select public.close_semester(current_setting('tests.fall')::uuid, 'Fall 2026') $$,
  '42501', 'Admin access required', 'a student cannot close the semester');

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select throws_ok(
  $$ select public.close_semester(current_setting('tests.fall')::uuid, 'Fall 2026') $$,
  '42501', 'Admin access required', 'neither can a faculty adviser who is not an admin');

select tests.clear_authentication();
select set_config('role', 'anon', true);
select throws_ok(
  $$ select public.close_semester(current_setting('tests.fall')::uuid, 'Fall 2026') $$,
  '42501', null, 'nor a guest, who cannot even call it');
select tests.clear_authentication();

select is((select is_current from public.semesters where id = current_setting('tests.fall')::uuid), true,
  'after all three refusals Fall 2026 is still current');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.close_semester(current_setting('tests.fall')::uuid, 'fall 2026') $$,
  'P0001', 'Type the semester name exactly as shown to confirm',
  'the confirmation is case-sensitive');
select throws_ok(
  $$ select public.close_semester(current_setting('tests.fall')::uuid, 'Fall 2026 ') $$,
  'P0001', 'Type the semester name exactly as shown to confirm',
  'and does not forgive a trailing space');
select throws_ok(
  $$ select public.close_semester(current_setting('tests.fall')::uuid, null) $$,
  'P0001', 'Type the semester name exactly as shown to confirm',
  'or a missing name');

select throws_ok(
  $$ select public.start_semester('Spring 2027', '2027-01-19', '2027-05-14', now() + interval '30 days') $$,
  'P0001', 'Close Fall 2026 before starting the next semester',
  'the next semester cannot start while this one is open');

select set_config('tests.closed', public.close_semester(current_setting('tests.fall')::uuid, 'Fall 2026')::text, true);

select is(current_setting('tests.closed')::jsonb - 'closed_at', current_setting('tests.preview')::jsonb,
  'closing reports exactly the numbers the preview showed');

select tests.clear_authentication();
select is(
  (select row(is_current, closed_at is not null, closed_by)::text
     from public.semesters where id = current_setting('tests.fall')::uuid),
  row(false, true, current_setting('tests.admin')::uuid)::text,
  'Fall 2026 is closed, stamped with when and by whom');
select is(public.current_semester_id(), null::uuid, 'nothing is current until the next semester starts');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select is(public.current_semester(), null::jsonb, 'current_semester() says so');
select is(public.semester_close_preview(), null::jsonb, 'and there is nothing to preview');
select throws_ok(
  $$ select public.close_semester(current_setting('tests.fall')::uuid, 'Fall 2026') $$,
  'P0001', 'Fall 2026 is already closed', 'a closed semester cannot be closed twice');

-- --- undoing a close (decision 8) -------------------------------------------------------

select tests.authenticate_as(current_setting('tests.student')::uuid);
select throws_ok(
  $$ select public.reopen_semester(current_setting('tests.fall')::uuid) $$,
  '42501', 'Admin access required', 'a student cannot reopen a semester');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select is(public.reopen_semester(current_setting('tests.fall')::uuid) ->> 'name', 'Fall 2026',
  'an admin can reopen the semester just closed, before the next one starts');
select tests.clear_authentication();
select is(
  (select row(is_current, closed_at, closed_by, reopened_by)::text
     from public.semesters where id = current_setting('tests.fall')::uuid),
  row(true, null::timestamptz, null::uuid, current_setting('tests.admin')::uuid)::text,
  'it is current again, with the record of who reopened it');
select is(
  (select status from public.join_requests
    where user_id = current_setting('tests.asker')::uuid and project_id = current_setting('tests.project_b')::uuid),
  'cancelled',
  'requests the close cancelled stay cancelled: reopening undoes the archive, not the cancellations');

select tests.authenticate_as(current_setting('tests.asker')::uuid);
select lives_ok(
  $$ select public.create_join_request(current_setting('tests.project_b')::uuid, null) $$,
  'its teams take requests again, so the student can ask afresh');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.reopen_semester(current_setting('tests.fall')::uuid) $$,
  'P0001', 'Fall 2026 is not closed', 'an open semester cannot be reopened');
select throws_ok(
  $$ select public.reopen_semester(gen_random_uuid()) $$,
  'P0001', 'Semester not found', 'nor one that does not exist');
select lives_ok(
  $$ select public.close_semester(current_setting('tests.fall')::uuid, 'Fall 2026') $$,
  'and it closes again the ordinary way');

-- --- the gap between semesters --------------------------------------------------------

select throws_ok(
  $$ select public.save_milestone(null, 'Demo day', now() + interval '20 days') $$,
  'P0001', 'No semester is open right now — an admin has to start the next one first',
  'with no semester open, a milestone has nowhere to go');

select tests.authenticate_as(current_setting('tests.member')::uuid);
select throws_ok(
  $$ select public.create_project('Parking spot predictor', 'Predicts open spots from historic lot data and the time of day.',
       2::smallint, current_setting('tests.role')::uuid, '[]'::jsonb) $$,
  'P0001', 'No semester is open right now — an admin has to start the next one first',
  'and neither has a project');
select is(public.formation_deadline(), null::timestamptz, 'there is no formation deadline');

-- --- starting the next semester -------------------------------------------------------

select throws_ok(
  $$ select public.start_semester('Spring 2027', '2027-01-19', '2027-05-14', now() + interval '30 days') $$,
  '42501', 'Admin access required', 'a student cannot start a semester');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok($$ select public.start_semester('  ', '2027-01-19', '2027-05-14', now() + interval '30 days') $$,
  'P0001', 'Give the semester a name', 'it needs a name');
select throws_ok($$ select public.start_semester(repeat('x', 41), '2027-01-19', '2027-05-14', now() + interval '30 days') $$,
  'P0001', 'Keep the semester name to 40 characters or fewer', 'of at most 40 characters');
select throws_ok($$ select public.start_semester('fall 2026', '2027-01-19', '2027-05-14', now() + interval '30 days') $$,
  'P0001', 'There is already a semester called fall 2026',
  'that no other semester has, whatever the case — it is what an admin types to close it');
select throws_ok($$ select public.start_semester('Spring 2027', null, '2027-05-14', now() + interval '30 days') $$,
  'P0001', 'Give the semester a start date and an end date', 'it needs a start date');
select throws_ok($$ select public.start_semester('Spring 2027', '2027-05-14', '2027-01-19', now() + interval '30 days') $$,
  'P0001', 'The semester has to end after it starts', 'that comes before its end');
select throws_ok($$ select public.start_semester('Spring 2027', '2027-01-19', '2027-05-14', null) $$,
  'P0001', 'Set the team formation deadline', 'it needs a formation deadline');
select throws_ok($$ select public.start_semester('Spring 2027', '2027-01-19', '2027-05-14', now() - interval '1 minute') $$,
  'P0001', 'The team formation deadline has to be in the future',
  'in the future — a past one would lock every roster the day the semester opened');
select throws_ok($$ select public.start_semester('Spring 2027', '2027-01-19', '2027-05-14', '2027-06-01 12:00-05') $$,
  'P0001', 'The team formation deadline has to fall on or before the semester''s last day',
  'and not after the semester ends');
select is(public.current_semester_id(), null::uuid, 'none of those refusals started anything');

select set_config('tests.deadline', (now() + interval '30 days')::text, true);
select set_config('tests.spring', public.start_semester(
  'Spring 2027', '2027-01-19', '2027-05-14', current_setting('tests.deadline')::timestamptz)::text, true);

select is(
  current_setting('tests.spring')::jsonb - 'id',
  jsonb_build_object('name', 'Spring 2027', 'starts_on', '2027-01-19', 'ends_on', '2027-05-14',
                     'formation_deadline', to_jsonb(current_setting('tests.deadline')::timestamptz)),
  'start_semester() returns the new semester with its name, dates and formation deadline');
select is(public.current_semester_id(), (current_setting('tests.spring')::jsonb ->> 'id')::uuid,
  'and it is the current one');
select is((select count(*) from public.semesters where is_current), 1::bigint,
  'still exactly one current semester');
select is(public.formation_deadline(), current_setting('tests.deadline')::timestamptz,
  'formation_deadline() is the new semester''s');
select is(
  (select count(*) from public.milestones
    where is_formation_deadline and semester_id = (current_setting('tests.spring')::jsonb ->> 'id')::uuid),
  1::bigint,
  'stored as the new semester''s one flagged milestone');

select throws_ok(
  $$ select public.start_semester('Summer 2027', '2027-06-01', '2027-08-01', now() + interval '40 days') $$,
  'P0001', 'Close Spring 2027 before starting the next semester',
  'a second semester cannot start while one is open');
select throws_ok(
  $$ select public.reopen_semester(current_setting('tests.fall')::uuid) $$,
  'P0001', 'Spring 2027 has already started, so Fall 2026 can''t be reopened',
  'and once the next semester has started, the last one stays closed');

select tests.clear_authentication();
select throws_ok(
  $$ update public.semesters set closed_at = null where id = current_setting('tests.fall')::uuid $$,
  '23505', null,
  'reopening Fall 2026 while Spring 2027 is current is refused too — at most one, from either direction');

-- --- per-semester rules that used to be global ---------------------------------------

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select is((public.save_next_step(null, 'Pick a meeting time')).sort_order, 1,
  'the new semester''s checklist numbers from 1, beside the old one''s');
select set_config('tests.step_meet', (select id from public.next_steps where title = 'Pick a meeting time')::text, true);
select set_config('tests.step_room', (public.save_next_step(null, 'Book a room')).id::text, true);
select lives_ok(
  $$ select public.reorder_next_steps(array[current_setting('tests.step_room')::uuid, current_setting('tests.step_meet')::uuid]) $$,
  'reordering checks the list against this semester''s steps, not every step ever');
select is((select sort_order from public.next_steps where id = current_setting('tests.step_meet')::uuid), 2,
  'and reorders them');
select lives_ok(
  $$ select public.delete_next_step(current_setting('tests.step_room')::uuid) $$,
  'deleting a step renumbers this semester''s list without touching the archived one');
select is((select sort_order from public.next_steps where id = current_setting('tests.step_meet')::uuid), 1,
  'closing the gap it left');

select set_config('tests.spring_deadline',
  (select id from public.milestones where is_formation_deadline
     and semester_id = (current_setting('tests.spring')::jsonb ->> 'id')::uuid)::text, true);
select lives_ok(
  $$ select public.save_milestone(null, 'Earlier deadline', now() + interval '15 days', true) $$,
  'moving the formation-deadline flag in the new semester works — it does not reach into Fall''s, which the guard would refuse');
select is(
  (select is_formation_deadline from public.milestones where id = current_setting('tests.spring_deadline')::uuid),
  false,
  'it moves off the new semester''s old deadline');
select tests.clear_authentication();
select is(
  (select count(*) from public.milestones
    where is_formation_deadline and semester_id = current_setting('tests.fall')::uuid),
  1::bigint,
  'and Fall 2026 keeps its own');

-- --- students are free to join again ---------------------------------------------------

select tests.authenticate_as(current_setting('tests.member')::uuid);
select lives_ok(
  $$ select public.create_project('Parking spot predictor', 'Predicts open spots from historic lot data and the time of day.',
       2::smallint, current_setting('tests.role')::uuid, '[]'::jsonb) $$,
  'a student whose Fall team is archived can start a project in Spring');
select is(
  (select count(*) from public.team_members where user_id = current_setting('tests.member')::uuid),
  1::bigint,
  'the roster they can read is this semester''s only');

select tests.authenticate_as(current_setting('tests.student')::uuid);
select lives_ok(
  $$ select public.create_project('Lab equipment booking', 'Reserve shared lab hardware by the hour, with conflicts resolved up front.',
       3::smallint, current_setting('tests.role')::uuid, '[]'::jsonb) $$,
  'so can the student whose Fall project is archived');

select tests.clear_authentication();
select is(
  (select count(*) from public.team_members where user_id = current_setting('tests.member')::uuid),
  2::bigint,
  'both seats are still there — Fall''s was not deleted to make room');

select throws_ok(
  format($$ insert into public.team_members (user_id, team_id, role_id)
            select %L, t.id, %L from public.teams t
              join public.projects p on p.id = t.project_id
             where p.creator_id = %L and p.semester_id = %L $$,
         current_setting('tests.member'), current_setting('tests.role'),
         current_setting('tests.student'), (current_setting('tests.spring')::jsonb ->> 'id')),
  '23505', null,
  'but a second team in the same semester is refused at the table, whoever writes it');

-- --- reopening reaches back one close, no further -----------------------------------------

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.close_semester((current_setting('tests.spring')::jsonb ->> 'id')::uuid, 'Spring 2027') $$,
  'Spring 2027 closes too');
select throws_ok(
  $$ select public.reopen_semester(current_setting('tests.fall')::uuid) $$,
  'P0001', 'Only the most recently closed semester can be reopened',
  'Fall 2026 is two closes back now, so it stays closed');
select lives_ok(
  $$ select public.reopen_semester((current_setting('tests.spring')::jsonb ->> 'id')::uuid) $$,
  'while Spring 2027, the one closed last, can be reopened');

select * from finish();
rollback;
