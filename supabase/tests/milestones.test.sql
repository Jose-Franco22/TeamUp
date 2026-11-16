-- Deadlines and milestones (issue #38): 26_milestones.sql.
begin;
select plan(25);

select set_config('tests.admin',   tests.sign_in_with_microsoft('admin01@utrgv.edu', 'Admin')::text, true);
select set_config('tests.student', tests.sign_in_with_microsoft('student01@utrgv.edu', 'Student')::text, true);
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;

-- --- Only admins write milestones ---------------------------------------------
select tests.authenticate_as(current_setting('tests.student')::uuid);
select throws_ok(
  $$ select public.save_milestone(null, 'Proposal due', now() + interval '7 days') $$,
  '42501', 'Admin access required',
  'a student can''t create a milestone');
select throws_ok(
  $$ insert into public.milestones (name, due_at) values ('Sneaky', now()) $$,
  '42501', null,
  'a student can''t write the table directly either');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.proposal',
  (public.save_milestone(null, '  Proposal due  ', now() + interval '7 days')).id::text, true);
select tests.clear_authentication();

select is(
  (select name from public.milestones where id = current_setting('tests.proposal')::uuid),
  'Proposal due',
  'an admin can create a milestone, and the name is trimmed');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.save_milestone(current_setting('tests.proposal')::uuid, 'Project proposal due', now() + interval '8 days') $$,
  'an admin can edit a milestone');
select tests.clear_authentication();

select is(
  (select name from public.milestones where id = current_setting('tests.proposal')::uuid),
  'Project proposal due',
  'the edit is saved');

select tests.authenticate_as(current_setting('tests.student')::uuid);
select throws_ok(
  $$ select public.save_milestone(current_setting('tests.proposal')::uuid, 'Renamed', now()) $$,
  '42501', 'Admin access required',
  'a student can''t edit a milestone');
select throws_ok(
  $$ select public.delete_milestone(current_setting('tests.proposal')::uuid) $$,
  '42501', 'Admin access required',
  'a student can''t delete a milestone');
select tests.clear_authentication();

-- --- Name and date are required ---------------------------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.save_milestone(null, '   ', now()) $$,
  'P0001', 'A milestone needs a name',
  'a blank name is refused');
select throws_ok(
  $$ select public.save_milestone(null, repeat('x', 81), now()) $$,
  'P0001', 'Keep the milestone name to 80 characters or fewer',
  'a name over 80 characters is refused');
select throws_ok(
  $$ select public.save_milestone(null, 'No date', null) $$,
  'P0001', 'A milestone needs a due date',
  'a missing date is refused');
select tests.clear_authentication();

-- --- Everyone can read the schedule -------------------------------------------
select tests.authenticate_as(current_setting('tests.student')::uuid);
select is((select count(*)::int from public.milestones), 1, 'a student can read the milestones');
select tests.clear_authentication();
select set_config('role', 'anon', true);
select is((select count(*)::int from public.milestones), 1, 'so can a guest');
select tests.clear_authentication();

-- --- Only one formation deadline ------------------------------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.first',
  (public.save_milestone(null, 'Teams due', now() + interval '10 days', true)).id::text, true);
select set_config('tests.second',
  (public.save_milestone(null, 'Teams due (extended)', now() + interval '14 days', true)).id::text, true);
select tests.clear_authentication();

select is(
  (select array_agg(id) from public.milestones where is_formation_deadline),
  array[current_setting('tests.second')::uuid],
  'flagging a second milestone moves the flag instead of adding one');

select throws_ok(
  $$ update public.milestones set is_formation_deadline = true where id = current_setting('tests.first')::uuid $$,
  '23505', null,
  'the table itself refuses a second formation deadline');

select is(
  public.formation_deadline(),
  (select due_at from public.milestones where id = current_setting('tests.second')::uuid),
  'formation_deadline() reads the flagged milestone');

-- --- Before the deadline, students can still do everything -------------------
select set_config('tests.ownerA', tests.sign_in_with_microsoft('owner0a@utrgv.edu', 'Owner A')::text, true);
select set_config('tests.ownerB', tests.sign_in_with_microsoft('owner0b@utrgv.edu', 'Owner B')::text, true);
select set_config('tests.memberA', tests.sign_in_with_microsoft('member0a@utrgv.edu', 'Member A')::text, true);
select set_config('tests.memberB', tests.sign_in_with_microsoft('member0b@utrgv.edu', 'Member B')::text, true);
select set_config('tests.memberC', tests.sign_in_with_microsoft('member0c@utrgv.edu', 'Member C')::text, true);
select set_config('tests.memberD', tests.sign_in_with_microsoft('member0d@utrgv.edu', 'Member D')::text, true);
select set_config('tests.late',    tests.sign_in_with_microsoft('late01@utrgv.edu', 'Late')::text, true);
select set_config('tests.teamA',
  tests.create_full_team(current_setting('tests.ownerA')::uuid, current_setting('tests.memberA')::uuid)::text, true);
select set_config('tests.teamB',
  tests.create_full_team(current_setting('tests.ownerB')::uuid, current_setting('tests.memberB')::uuid)::text, true);
select set_config('tests.teamC',
  tests.create_full_team(current_setting('tests.memberC')::uuid, current_setting('tests.memberD')::uuid)::text, true);

select tests.authenticate_as(current_setting('tests.student')::uuid);
select lives_ok(
  $$ select public.create_project('Before the deadline', 'Posted while teams are still forming.', 3::smallint,
       (select id from public.roles where name = 'Backend Developer'), '[]'::jsonb) $$,
  'before the deadline, a student can post a project');
select set_config('tests.studentProject',
  (select id::text from public.projects where creator_id = current_setting('tests.student')::uuid), true);

select tests.authenticate_as(current_setting('tests.late')::uuid);
select lives_ok(
  $$ select public.create_join_request(current_setting('tests.studentProject')::uuid) $$,
  'before the deadline, a student can send a request');

select tests.authenticate_as(current_setting('tests.memberA')::uuid);
select lives_ok($$ select public.leave_team() $$, 'before the deadline, a student can leave');

select tests.authenticate_as(current_setting('tests.ownerB')::uuid);
select lives_ok(
  $$ select public.remove_member(current_setting('tests.memberB')::uuid) $$,
  'before the deadline, a creator can remove a member');
select tests.clear_authentication();

-- --- After it, they can't -----------------------------------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select public.save_milestone(current_setting('tests.second')::uuid, 'Teams due (extended)', now() - interval '1 minute', true);

select tests.authenticate_as(current_setting('tests.memberA')::uuid);
select throws_ok(
  $$ select public.create_project('After the deadline', 'Posted after rosters locked.', 2::smallint,
       (select id from public.roles where name = 'Backend Developer'), '[]'::jsonb) $$,
  'P0001', 'The team formation deadline has passed, so new projects can''t be posted',
  'after the deadline, a student can''t post a project');

select tests.authenticate_as(current_setting('tests.memberB')::uuid);
select throws_ok(
  $$ select public.create_join_request(current_setting('tests.studentProject')::uuid) $$,
  'P0001', 'The team formation deadline has passed, so new join requests are closed',
  'after the deadline, a student can''t send a request');

select tests.authenticate_as(current_setting('tests.memberD')::uuid);
select throws_ok(
  $$ select public.leave_team() $$,
  'P0001', 'The team formation deadline has passed — ask an admin if you need to leave',
  'after the deadline, a student can''t leave');

select tests.authenticate_as(current_setting('tests.memberC')::uuid);
select throws_ok(
  $$ select public.remove_member(current_setting('tests.memberD')::uuid) $$,
  'P0001', 'The team formation deadline has passed — ask an admin to remove them',
  'after the deadline, a creator can''t remove a member');
select tests.clear_authentication();

-- --- Deleting the deadline unlocks rosters -----------------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.delete_milestone(current_setting('tests.second')::uuid) $$,
  'an admin can delete a milestone');
select tests.clear_authentication();

select is(public.formation_deadline(), null, 'with the deadline milestone gone, there is no deadline');

select * from finish();
rollback;
