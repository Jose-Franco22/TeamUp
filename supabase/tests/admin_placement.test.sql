-- An admin places, moves or removes students (issue #39): 27_admin_placement.sql.
begin;
select plan(45);

select set_config('tests.admin',   tests.sign_in_with_microsoft('admin01@utrgv.edu', 'Admin')::text, true);
select set_config('tests.owner1',  tests.sign_in_with_microsoft('owner01@utrgv.edu', 'Owner One')::text, true);
select set_config('tests.owner2',  tests.sign_in_with_microsoft('owner02@utrgv.edu', 'Owner Two')::text, true);
select set_config('tests.owner3',  tests.sign_in_with_microsoft('owner03@utrgv.edu', 'Owner Three')::text, true);
select set_config('tests.member2', tests.sign_in_with_microsoft('member02@utrgv.edu', 'Member Two')::text, true);
select set_config('tests.amy',     tests.sign_in_with_microsoft('amy@utrgv.edu', 'Amy')::text, true);
select set_config('tests.ben',     tests.sign_in_with_microsoft('ben@utrgv.edu', 'Ben')::text, true);
select set_config('tests.cal',     tests.sign_in_with_microsoft('cal@utrgv.edu', 'Cal')::text, true);
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;

select set_config('tests.frontend', (select id::text from public.roles where name = 'Frontend Developer'), true);
select set_config('tests.backend',  (select id::text from public.roles where name = 'Backend Developer'), true);

-- Team one: three seats, recruiting one Frontend Developer.
select tests.authenticate_as(current_setting('tests.owner1')::uuid);
select set_config('tests.project1', (public.create_project(
  'Team one', 'A three-seat project used by the tests.', 3::smallint,
  current_setting('tests.backend')::uuid,
  jsonb_build_array(jsonb_build_object('role_id', current_setting('tests.frontend'), 'quantity_needed', 1))
)).id::text, true);
-- Team three: three seats, nothing listed.
select tests.authenticate_as(current_setting('tests.owner3')::uuid);
select set_config('tests.project3', (public.create_project(
  'Team three', 'A three-seat project used by the tests.', 3::smallint,
  current_setting('tests.backend')::uuid, '[]'::jsonb)).id::text, true);
-- Ben has a request out to team three.
select tests.authenticate_as(current_setting('tests.ben')::uuid);
select public.create_join_request(current_setting('tests.project3')::uuid);
select tests.clear_authentication();
-- Team two: two seats, already full.
select set_config('tests.project2',
  tests.create_full_team(current_setting('tests.owner2')::uuid, current_setting('tests.member2')::uuid)::text, true);

select set_config('tests.team1', (select id::text from public.teams where project_id = current_setting('tests.project1')::uuid), true);
select set_config('tests.team2', (select id::text from public.teams where project_id = current_setting('tests.project2')::uuid), true);
select set_config('tests.team3', (select id::text from public.teams where project_id = current_setting('tests.project3')::uuid), true);

-- --- Students can't call these ----------------------------------------------
select tests.authenticate_as(current_setting('tests.owner1')::uuid);
select throws_ok(
  $$ select public.admin_assign_student(current_setting('tests.amy')::uuid, current_setting('tests.team1')::uuid, current_setting('tests.frontend')::uuid) $$,
  '42501', 'Admin access required',
  'a student can''t assign anyone');
select throws_ok(
  $$ select public.admin_move_student(current_setting('tests.member2')::uuid, current_setting('tests.team1')::uuid, current_setting('tests.frontend')::uuid) $$,
  '42501', 'Admin access required',
  'a student can''t move anyone');
select throws_ok(
  $$ select public.admin_recent_actions() $$,
  '42501', 'Admin access required',
  'a student can''t read the admin history');
select tests.clear_authentication();

-- --- Refused assignments ------------------------------------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.admin_assign_student(current_setting('tests.amy')::uuid, current_setting('tests.team2')::uuid, current_setting('tests.frontend')::uuid) $$,
  'P0001', 'This team is already full',
  'assigning to a full team is refused');
select throws_ok(
  $$ select public.admin_assign_student(current_setting('tests.amy')::uuid, current_setting('tests.team1')::uuid, null) $$,
  'P0001', 'Pick a role',
  'assigning without a role is refused');
select throws_ok(
  $$ select public.admin_assign_student(current_setting('tests.admin')::uuid, current_setting('tests.team1')::uuid, current_setting('tests.frontend')::uuid) $$,
  'P0001', 'Student not found',
  'an admin account can''t be put on a team');
select throws_ok(
  $$ select public.admin_assign_student(current_setting('tests.amy')::uuid, gen_random_uuid(), current_setting('tests.frontend')::uuid) $$,
  'P0001', 'Team not found',
  'assigning to a team that doesn''t exist is refused');
select throws_ok(
  $$ select public.admin_assign_student(current_setting('tests.member2')::uuid, current_setting('tests.team1')::uuid, current_setting('tests.frontend')::uuid) $$,
  'P0001', 'That student is already on a team — move them instead',
  'assigning a student who already has a team is refused');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.team_members where user_id = current_setting('tests.amy')::uuid),
  0,
  'the refused assignments left Amy unplaced');

-- --- Assigning an unplaced student ------------------------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.admin_assign_student(current_setting('tests.ben')::uuid, current_setting('tests.team1')::uuid, current_setting('tests.frontend')::uuid) $$,
  'an admin can assign an unplaced student to a team with an open seat');
select tests.clear_authentication();

select is(
  (select role_id from public.team_members
    where user_id = current_setting('tests.ben')::uuid and team_id = current_setting('tests.team1')::uuid),
  current_setting('tests.frontend')::uuid,
  'Ben is on team one in the chosen role');
select is(
  (select quantity_needed::int from public.project_roles_needed
    where project_id = current_setting('tests.project1')::uuid and role_id = current_setting('tests.frontend')::uuid),
  0,
  'the role he fills is no longer open');
select is(
  (select status from public.join_requests where user_id = current_setting('tests.ben')::uuid),
  'declined',
  'the request he had out is declined, as an accept would');
select is(
  (select status from public.projects where id = current_setting('tests.project1')::uuid),
  'open',
  'team one still has a seat, so it stays open');
select is(
  (select count(*)::int from public.notifications
    where user_id = current_setting('tests.ben')::uuid and kind = 'member_assigned'
      and project_id = current_setting('tests.project1')::uuid
      and actor_id = current_setting('tests.admin')::uuid and by_admin),
  1,
  'Ben is told an admin put him on team one');
select is(
  (select count(*)::int from public.notifications
    where user_id = current_setting('tests.owner1')::uuid and kind = 'member_added'
      and project_id = current_setting('tests.project1')::uuid
      and actor_id = current_setting('tests.ben')::uuid and by_admin),
  1,
  'team one''s owner is told who was added');
select is(
  (select count(*)::int from public.admin_actions
    where action = 'assign' and admin_id = current_setting('tests.admin')::uuid
      and student_id = current_setting('tests.ben')::uuid
      and to_project_id = current_setting('tests.project1')::uuid and to_project_title = 'Team one'
      and role_id = current_setting('tests.frontend')::uuid and created_at is not null),
  1,
  'the assignment is recorded with the admin, student, team, role and time');

-- Filling the last seat forms the team.
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select public.admin_assign_student(current_setting('tests.amy')::uuid, current_setting('tests.team1')::uuid, current_setting('tests.backend')::uuid);
select tests.clear_authentication();
select is(
  (select status from public.projects where id = current_setting('tests.project1')::uuid),
  'full',
  'assigning into the last seat fills the project');
select isnt(
  (select formed_at from public.teams where id = current_setting('tests.team1')::uuid),
  null,
  'and marks the team formed');

-- --- Moving a student ----------------------------------------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.admin_move_student(current_setting('tests.amy')::uuid, current_setting('tests.team2')::uuid, current_setting('tests.backend')::uuid) $$,
  'P0001', 'This team is already full',
  'moving to a full team is refused');
select throws_ok(
  $$ select public.admin_move_student(current_setting('tests.amy')::uuid, current_setting('tests.team1')::uuid, current_setting('tests.backend')::uuid) $$,
  'P0001', 'That student is already on this team',
  'moving to the team they''re on is refused');
select throws_ok(
  $$ select public.admin_move_student(current_setting('tests.owner3')::uuid, current_setting('tests.team1')::uuid, current_setting('tests.backend')::uuid) $$,
  'P0001', 'A project''s creator can''t be moved off their own project',
  'a project''s creator can''t be moved');
select throws_ok(
  $$ select public.admin_move_student(current_setting('tests.cal')::uuid, current_setting('tests.team3')::uuid, current_setting('tests.backend')::uuid) $$,
  'P0001', 'That student is not on a team — assign them instead',
  'moving a student who has no team is refused');
select tests.clear_authentication();
select is(
  (select team_id from public.team_members where user_id = current_setting('tests.amy')::uuid),
  current_setting('tests.team1')::uuid,
  'the refused moves left Amy where she was');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.admin_move_student(current_setting('tests.amy')::uuid, current_setting('tests.team3')::uuid, current_setting('tests.frontend')::uuid) $$,
  'an admin can move a student to another team');
select tests.clear_authentication();

select is(
  (select team_id from public.team_members where user_id = current_setting('tests.amy')::uuid),
  current_setting('tests.team3')::uuid,
  'Amy is on team three now');
select is(
  (select status from public.projects where id = current_setting('tests.project1')::uuid),
  'open',
  'the team she left reopens');
select is(
  (select formed_at from public.teams where id = current_setting('tests.team1')::uuid),
  null,
  'and is no longer formed');
select is(
  (select count(*)::int from public.team_members where team_id = current_setting('tests.team3')::uuid),
  2,
  'the team she joined counts her');
select is(
  (select count(*)::int from public.notifications
    where user_id = current_setting('tests.owner1')::uuid and kind = 'member_left'
      and actor_id = current_setting('tests.amy')::uuid and by_admin),
  1,
  'the old team''s owner is told an admin took her off');
select is(
  (select count(*)::int from public.notifications
    where user_id = current_setting('tests.owner3')::uuid and kind = 'member_added'
      and actor_id = current_setting('tests.amy')::uuid and by_admin),
  1,
  'the new team''s owner is told who was added');
select is(
  (select count(*)::int from public.notifications
    where user_id = current_setting('tests.amy')::uuid and kind = 'member_assigned'
      and project_id = current_setting('tests.project3')::uuid and by_admin),
  1,
  'Amy is told which team she was moved to');
select is(
  (select count(*)::int from public.notifications
    where user_id = current_setting('tests.amy')::uuid and kind = 'member_removed'),
  0,
  'and isn''t also sent a removal notice');
select is(
  (select count(*)::int from public.admin_actions
    where action = 'move' and student_id = current_setting('tests.amy')::uuid
      and from_project_title = 'Team one' and to_project_title = 'Team three'
      and admin_id = current_setting('tests.admin')::uuid),
  1,
  'the move is recorded with both teams');

-- --- After the formation deadline, admins still can -------------------------
insert into public.milestones (name, due_at, is_formation_deadline)
values ('Team formation deadline', now() - interval '1 day', true);

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.admin_assign_student(current_setting('tests.cal')::uuid, current_setting('tests.team1')::uuid, current_setting('tests.backend')::uuid) $$,
  'an admin can assign after the formation deadline');
select lives_ok(
  $$ select public.admin_move_student(current_setting('tests.cal')::uuid, current_setting('tests.team3')::uuid, current_setting('tests.backend')::uuid) $$,
  'an admin can move after the formation deadline');
select lives_ok(
  $$ select public.remove_member(current_setting('tests.cal')::uuid) $$,
  'an admin can remove after the formation deadline');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.team_members where user_id = current_setting('tests.cal')::uuid),
  0,
  'Cal is off every team');
select is(
  (select count(*)::int from public.admin_actions
    where action = 'remove' and student_id = current_setting('tests.cal')::uuid
      and from_project_title = 'Team three' and role_id = current_setting('tests.backend')::uuid
      and admin_id = current_setting('tests.admin')::uuid),
  1,
  'an admin''s removal is recorded too');
select is(
  (select count(*)::int from public.notifications
    where user_id = current_setting('tests.cal')::uuid and kind = 'member_removed' and by_admin),
  1,
  'and the removed student is told');

-- --- A creator's own removals aren't admin actions ---------------------------
delete from public.milestones;
select tests.authenticate_as(current_setting('tests.owner3')::uuid);
select public.remove_member(current_setting('tests.amy')::uuid);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.admin_actions where student_id = current_setting('tests.amy')::uuid and action = 'remove'),
  0,
  'a creator removing a member writes no audit row');

-- --- Who can read the history ---------------------------------------------
select tests.authenticate_as(current_setting('tests.owner1')::uuid);
select is((select count(*)::int from public.admin_actions), 0, 'a student can''t read admin_actions');
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select is(
  jsonb_array_length(public.admin_recent_actions()),
  6,
  'an admin reads every change through admin_recent_actions()');
select is(
  public.admin_recent_actions(1)->0->>'action',
  'remove',
  'newest first');
select is(
  public.admin_recent_actions(1)->0->>'student_name',
  'Cal',
  'with the names filled in');
select tests.clear_authentication();

select * from finish();
rollback;
