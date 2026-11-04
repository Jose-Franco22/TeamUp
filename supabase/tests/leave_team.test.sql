-- Leaving a team (issue #35): 05_membership.sql and 20_leave_team_rules.sql.
begin;
select plan(22);

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

-- Filtered to 'member_left': the creator also has a 'join_request'
-- notification from the member asking to join (23_join_request_notifications.sql).
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select is(
  (select count(*)::int from public.notifications where kind = 'member_left'),
  1,
  'the creator can read their notification');
select lives_ok(
  $$ select public.mark_notifications_read(array(select id from public.notifications where kind = 'member_left')) $$,
  'the creator can mark it read');
-- Filtered to 'member_left': the member has their own 'request_accepted'
-- notification from joining (21_join_request_responses.sql).
select tests.authenticate_as(current_setting('tests.member')::uuid);
select is(
  (select count(*)::int from public.notifications where kind = 'member_left'),
  0,
  'nobody else can read the creator''s notifications');
select tests.clear_authentication();

select isnt(
  (select read_at from public.notifications
   where user_id = current_setting('tests.owner')::uuid and kind = 'member_left'),
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

-- Only an admin can set the deadline (a milestone flagged as it, 26_milestones.sql).
select tests.authenticate_as(current_setting('tests.member2')::uuid);
select throws_ok(
  $$ select public.save_milestone(null, 'Team formation deadline', now() - interval '1 day', true) $$,
  '42501', 'Admin access required',
  'a student can''t set the formation deadline');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.save_milestone(null, 'Team formation deadline', now() - interval '1 day', true) $$,
  'an admin can set the formation deadline');
select tests.clear_authentication();
select isnt(
  public.formation_deadline(),
  null,
  'the admin''s deadline is saved');

select tests.authenticate_as(current_setting('tests.member2')::uuid);
select throws_ok(
  $$ select public.leave_team() $$,
  'P0001', 'The team formation deadline has passed — ask an admin if you need to leave',
  'a student can''t leave after the formation deadline');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.team_members where user_id = current_setting('tests.member2')::uuid),
  1,
  'the student is still on the team after the refused leave');

-- Admin removal after the deadline is #39's function (it calls
-- private.remove_from_team with p_by_admin => true); its tests live there.

-- --- One way to read the deadline -------------------------------------------
select is(
  public.formation_deadline(),
  (select due_at from public.milestones where is_formation_deadline),
  'formation_deadline() returns the deadline leave_team() checks');

select tests.authenticate_as(current_setting('tests.member2')::uuid);
select isnt(
  public.formation_deadline(),
  null,
  'a student can read the deadline through formation_deadline()');
select tests.clear_authentication();

-- --- leave_team() only takes the caller off -----------------------------------
select hasnt_function('public', 'leave_team', array['uuid'],
  'leave_team() has no form that takes someone else off a team');
select function_privs_are('private', 'remove_from_team', array['uuid', 'boolean'], 'authenticated', array[]::text[],
  'students can''t call remove_from_team() directly');

select * from finish();
rollback;
