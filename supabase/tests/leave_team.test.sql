-- Leaving a team (issue #35): 05_membership.sql and 20_leave_team_rules.sql.
begin;
select plan(21);

-- --- leave_team() removes the caller from the team ------------------------
select set_config('tests.owner',  tests.sign_in_with_microsoft('owner01@utrgv.edu', 'Owner')::text, true);
select set_config('tests.member', tests.sign_in_with_microsoft('member01@utrgv.edu', 'Member')::text, true);
select set_config('tests.project',
  tests.create_full_team(current_setting('tests.owner')::uuid, current_setting('tests.member')::uuid)::text, true);

select is(
  (select status from public.projects where id = current_setting('tests.project')::uuid),
  'full',
  'setup: the two-seat project is full');

select tests.authenticate_as(current_setting('tests.member')::uuid);
select lives_ok($$ select public.leave_team() $$, 'a member can leave their team');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.team_members where user_id = current_setting('tests.member')::uuid),
  0,
  'leave_team() removes the caller from the team');

select is(
  (select count(*)::int from public.team_members
   where team_id = (select id from public.teams where project_id = current_setting('tests.project')::uuid)),
  1,
  'everyone else stays on the team');

-- --- A full project goes back to open --------------------------------------
select is(
  (select status from public.projects where id = current_setting('tests.project')::uuid),
  'open',
  'a full project goes back to open when someone leaves');

select is(
  (select formed_at from public.teams where project_id = current_setting('tests.project')::uuid),
  null,
  'the team is no longer marked as formed');

-- --- The creator gets a notification ---------------------------------------
select is(
  (select count(*)::int from public.notifications
   where user_id = current_setting('tests.owner')::uuid
     and kind = 'member_left'
     and project_id = current_setting('tests.project')::uuid
     and actor_id = current_setting('tests.member')::uuid
     and not by_admin
     and read_at is null),
  1,
  'the creator gets an unread notification naming who left');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select is(
  (select count(*)::int from public.notifications),
  1,
  'the creator can read their notification');
select lives_ok(
  $$ select public.mark_notifications_read(array(select id from public.notifications)) $$,
  'the creator can mark it read');
select tests.authenticate_as(current_setting('tests.member')::uuid);
select is(
  (select count(*)::int from public.notifications),
  0,
  'nobody else can read the creator''s notifications');
select tests.clear_authentication();

select isnt(
  (select read_at from public.notifications where user_id = current_setting('tests.owner')::uuid),
  null,
  'marking read is saved');

-- --- The creator can't leave -----------------------------------------------
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_ok(
  $$ select public.leave_team() $$,
  'P0001', 'You created this project, so you cannot leave it — delete the team instead',
  'the creator can''t leave their own project');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.team_members where user_id = current_setting('tests.owner')::uuid),
  1,
  'the creator is still on their team');

-- --- Blocked after the formation deadline ----------------------------------
select set_config('tests.owner2',  tests.sign_in_with_microsoft('owner02@utrgv.edu', 'Owner Two')::text, true);
select set_config('tests.member2', tests.sign_in_with_microsoft('member02@utrgv.edu', 'Member Two')::text, true);
select set_config('tests.admin',   tests.sign_in_with_microsoft('admin01@utrgv.edu', 'Admin')::text, true);
select set_config('tests.project2',
  tests.create_full_team(current_setting('tests.owner2')::uuid, current_setting('tests.member2')::uuid)::text, true);
-- An instructor account, made the same way 18_admin_access.sql says to.
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;

-- Only an admin can move the deadline.
select tests.authenticate_as(current_setting('tests.member2')::uuid);
update public.app_settings set formation_deadline = now() - interval '1 day';
select tests.clear_authentication();
select is(
  (select formation_deadline from public.app_settings),
  null,
  'a student can''t set the formation deadline');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ update public.app_settings set formation_deadline = now() - interval '1 day' $$,
  'an admin can set the formation deadline');
select tests.clear_authentication();
select isnt(
  (select formation_deadline from public.app_settings),
  null,
  'the admin''s deadline is saved');

select tests.authenticate_as(current_setting('tests.member2')::uuid);
select throws_ok(
  $$ select public.leave_team() $$,
  'P0001', 'The team formation deadline has passed — ask an admin if you need to leave',
  'a student can''t leave after the formation deadline');
select throws_ok(
  $$ select public.leave_team(current_setting('tests.owner')::uuid) $$,
  'P0001', 'Only an admin can take someone else off a team',
  'a student can''t take someone else off a team');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.team_members where user_id = current_setting('tests.member2')::uuid),
  1,
  'the student is still on the team after the refused leave');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.leave_team(current_setting('tests.member2')::uuid) $$,
  'an admin can take a student off a team after the deadline');
select tests.clear_authentication();

select results_eq(
  $$ select (select count(*)::int from public.team_members where user_id = current_setting('tests.member2')::uuid),
            (select status from public.projects where id = current_setting('tests.project2')::uuid),
            (select by_admin from public.notifications where user_id = current_setting('tests.owner2')::uuid) $$,
  $$ values (0, 'open'::text, true) $$,
  'after an admin does it: the student is off, the project reopens, and the creator is told an admin did it');

select * from finish();
rollback;
