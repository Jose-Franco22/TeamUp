-- Removing a member (issue #29): 22_remove_member_rules.sql.
begin;
select plan(27);

select set_config('tests.owner',    tests.sign_in_with_microsoft('owner01@utrgv.edu', 'Owner')::text, true);
select set_config('tests.member',   tests.sign_in_with_microsoft('member01@utrgv.edu', 'Member')::text, true);
select set_config('tests.outsider', tests.sign_in_with_microsoft('outsider01@utrgv.edu', 'Outsider')::text, true);
select set_config('tests.project',
  tests.create_full_team(current_setting('tests.owner')::uuid, current_setting('tests.member')::uuid)::text, true);

select is(
  (select status from public.projects where id = current_setting('tests.project')::uuid),
  'full',
  'setup: the two-seat project is full');

-- --- Only the creator can remove ---------------------------------------------
select tests.authenticate_as(current_setting('tests.outsider')::uuid);
select throws_ok(
  $$ select public.remove_member(current_setting('tests.member')::uuid) $$,
  'P0001', 'Only the project creator can remove a member',
  'a student who isn''t on the team can''t remove a member');

select tests.authenticate_as(current_setting('tests.member')::uuid);
select throws_ok(
  $$ select public.remove_member(current_setting('tests.owner')::uuid) $$,
  'P0001', 'Only the project creator can remove a member',
  'a member can''t remove the creator');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_ok(
  $$ select public.remove_member(current_setting('tests.owner')::uuid) $$,
  'P0001', 'You cannot remove yourself — delete the team instead',
  'the creator can''t remove themself');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.team_members
   where team_id = (select id from public.teams where project_id = current_setting('tests.project')::uuid)),
  2,
  'the refused removals left the roster alone');

-- --- The creator removes a member --------------------------------------------
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.remove_member(current_setting('tests.member')::uuid) $$,
  'the creator can remove a member');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.team_members where user_id = current_setting('tests.member')::uuid),
  0,
  'remove_member() takes the student off the team');

select is(
  (select count(*)::int from public.team_members where user_id = current_setting('tests.owner')::uuid),
  1,
  'the creator stays on the team');

-- --- A full project goes back to open ----------------------------------------
select is(
  (select status from public.projects where id = current_setting('tests.project')::uuid),
  'open',
  'a full project goes back to open after a removal');

select is(
  (select formed_at from public.teams where project_id = current_setting('tests.project')::uuid),
  null,
  'the team is no longer marked as formed');

-- --- The removed student is notified ------------------------------------------
select is(
  (select count(*)::int from public.notifications
   where user_id = current_setting('tests.member')::uuid
     and kind = 'member_removed'
     and project_id = current_setting('tests.project')::uuid
     and actor_id = current_setting('tests.owner')::uuid
     and not by_admin
     and read_at is null),
  1,
  'the removed student gets an unread notification saying who removed them');

select is(
  (select count(*)::int from public.notifications
   where user_id = current_setting('tests.owner')::uuid and kind = 'member_left'),
  0,
  'the creator isn''t notified about a removal they made');

select tests.authenticate_as(current_setting('tests.member')::uuid);
select is(
  (select count(*)::int from public.notifications where kind = 'member_removed'),
  1,
  'the removed student can read their notification');
select tests.authenticate_as(current_setting('tests.outsider')::uuid);
select is(
  (select count(*)::int from public.notifications where kind = 'member_removed'),
  0,
  'nobody else can read it');
select tests.clear_authentication();

-- --- The removed student is free to join another team -------------------------
select set_config('tests.owner3', tests.sign_in_with_microsoft('owner03@utrgv.edu', 'Owner Three')::text, true);
select tests.authenticate_as(current_setting('tests.owner3')::uuid);
select set_config('tests.project3', (public.create_project(
  'Another project', 'A two-seat project used by the tests.', 2::smallint,
  (select id from public.roles where name = 'Backend Developer'), '[]'::jsonb)).id::text, true);

select tests.authenticate_as(current_setting('tests.member')::uuid);
select lives_ok(
  $$ select public.create_join_request(current_setting('tests.project3')::uuid) $$,
  'the removed student can request another project');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.join_requests
   where user_id = current_setting('tests.member')::uuid
     and project_id = current_setting('tests.project3')::uuid
     and status = 'pending'),
  1,
  'and the request is pending');

-- --- Blocked for students after the formation deadline ------------------------
select set_config('tests.owner2',  tests.sign_in_with_microsoft('owner02@utrgv.edu', 'Owner Two')::text, true);
select set_config('tests.member2', tests.sign_in_with_microsoft('member02@utrgv.edu', 'Member Two')::text, true);
select set_config('tests.admin',   tests.sign_in_with_microsoft('admin01@utrgv.edu', 'Admin')::text, true);
select set_config('tests.project2',
  tests.create_full_team(current_setting('tests.owner2')::uuid, current_setting('tests.member2')::uuid)::text, true);
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;
insert into public.milestones (name, due_at, is_formation_deadline)
values ('Team formation deadline', now() - interval '1 day', true);

select tests.authenticate_as(current_setting('tests.owner2')::uuid);
select throws_ok(
  $$ select public.remove_member(current_setting('tests.member2')::uuid) $$,
  'P0001', 'The team formation deadline has passed — ask an admin to remove them',
  'the creator can''t remove a member after the formation deadline');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.team_members where user_id = current_setting('tests.member2')::uuid),
  1,
  'the student is still on the team after the refused removal');

select is(
  (select count(*)::int from public.notifications where user_id = current_setting('tests.member2')::uuid
     and kind = 'member_removed'),
  0,
  'and isn''t notified about a removal that didn''t happen');

-- --- An admin can still remove after the deadline -----------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.remove_member(current_setting('tests.owner2')::uuid) $$,
  'P0001', 'The project creator cannot be removed — delete the team instead',
  'not even an admin can remove the creator');
select lives_ok(
  $$ select public.remove_member(current_setting('tests.member2')::uuid) $$,
  'an admin can remove a member after the formation deadline');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.team_members where user_id = current_setting('tests.member2')::uuid),
  0,
  'the admin''s removal takes the student off');

select is(
  (select status from public.projects where id = current_setting('tests.project2')::uuid),
  'open',
  'and reopens the project');

select is(
  (select count(*)::int from public.notifications
   where user_id = current_setting('tests.member2')::uuid
     and kind = 'member_removed'
     and actor_id = current_setting('tests.admin')::uuid
     and by_admin),
  1,
  'the student removed by an admin is notified that an admin did it');

select is(
  (select count(*)::int from public.notifications
   where user_id = current_setting('tests.owner2')::uuid
     and kind = 'member_left'
     and actor_id = current_setting('tests.member2')::uuid
     and by_admin),
  1,
  'the creator is told an admin took the student off');

-- --- Leaving still notifies only the creator ----------------------------------
delete from public.milestones;
select set_config('tests.member4', tests.sign_in_with_microsoft('member04@utrgv.edu', 'Member Four')::text, true);
select set_config('tests.owner4',  tests.sign_in_with_microsoft('owner04@utrgv.edu', 'Owner Four')::text, true);
select tests.create_full_team(current_setting('tests.owner4')::uuid, current_setting('tests.member4')::uuid);
select tests.authenticate_as(current_setting('tests.member4')::uuid);
select public.leave_team();
select tests.clear_authentication();

select is(
  (select count(*)::int from public.notifications
   where user_id = current_setting('tests.member4')::uuid and kind = 'member_removed'),
  0,
  'a student who leaves isn''t sent a removal notice');

select is(
  (select count(*)::int from public.notifications
   where user_id = current_setting('tests.owner4')::uuid and kind = 'member_left' and not by_admin),
  1,
  'their creator still gets the member_left notice');

select * from finish();
rollback;
