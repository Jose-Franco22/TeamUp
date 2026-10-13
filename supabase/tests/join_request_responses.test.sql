-- Accepting/declining join requests (15_join_request_responses.sql).
-- The two-accepts-at-once race is in join_request_concurrency.test.sql,
-- since it needs a second connection and data that's actually committed.
begin;
select plan(19);

select set_config('tests.owner', tests.sign_in_with_microsoft('owner01@utrgv.edu', 'Owner')::text, true);
select set_config('tests.owner2', tests.sign_in_with_microsoft('owner02@utrgv.edu', 'Owner Two')::text, true);
select set_config('tests.ana', tests.sign_in_with_microsoft('ana01@utrgv.edu', 'Ana')::text, true);
select set_config('tests.ben', tests.sign_in_with_microsoft('ben01@utrgv.edu', 'Ben')::text, true);
select set_config('tests.cal', tests.sign_in_with_microsoft('cal01@utrgv.edu', 'Cal')::text, true);
select set_config('tests.pm', (select id from public.roles where name = 'Project Manager')::text, true);
select set_config('tests.fe', (select id from public.roles where name = 'Frontend Developer')::text, true);
select set_config('tests.be', (select id from public.roles where name = 'Backend Developer')::text, true);

-- Owner's project: team of 3 (owner + 2 seats). Owner Two's: team of 4.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select set_config('tests.p1',
  (public.create_project('Trail Finder', '', 3::smallint, current_setting('tests.pm')::uuid, '[]'::jsonb)).id::text, true);
select tests.authenticate_as(current_setting('tests.owner2')::uuid);
select set_config('tests.p2',
  (public.create_project('Study Buddy', '', 4::smallint, current_setting('tests.pm')::uuid, '[]'::jsonb)).id::text, true);

-- Ana asks to join both; Ben and Cal ask to join the owner's.
select tests.authenticate_as(current_setting('tests.ana')::uuid);
select set_config('tests.ana_p1', (public.create_join_request(current_setting('tests.p1')::uuid)).id::text, true);
select set_config('tests.ana_p2', (public.create_join_request(current_setting('tests.p2')::uuid)).id::text, true);
select tests.authenticate_as(current_setting('tests.ben')::uuid);
select set_config('tests.ben_p1', (public.create_join_request(current_setting('tests.p1')::uuid)).id::text, true);
select tests.authenticate_as(current_setting('tests.cal')::uuid);
select set_config('tests.cal_p1', (public.create_join_request(current_setting('tests.p1')::uuid)).id::text, true);

-- --- Who can respond, and how --------------------------------------------
select tests.authenticate_as(current_setting('tests.owner')::uuid);

select throws_ok(
  format('select public.respond_to_join_request(%L, %L)', current_setting('tests.ana_p1'), 'accepted'),
  'P0001', 'A role is required to accept a request',
  'accepting without a role is rejected');

select tests.authenticate_as(current_setting('tests.owner2')::uuid);
select throws_ok(
  format('select public.respond_to_join_request(%L, %L, %L)',
    current_setting('tests.ana_p1'), 'accepted', current_setting('tests.fe')),
  'P0001', 'Only the project creator can respond to this request',
  'another project''s owner cannot respond');

select tests.authenticate_as(current_setting('tests.ana')::uuid);
select throws_ok(
  format('select public.respond_to_join_request(%L, %L)', current_setting('tests.ana_p1'), 'declined'),
  'P0001', 'Only the project creator can respond to this request',
  'the requester cannot respond to their own request');

-- --- Accepting -----------------------------------------------------------
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select is(
  (public.respond_to_join_request(current_setting('tests.ana_p1')::uuid, 'accepted', current_setting('tests.fe')::uuid)).status,
  'accepted',
  'the owner can accept a request');

select tests.clear_authentication();
select is(
  (select role_id from public.team_members where user_id = current_setting('tests.ana')::uuid),
  current_setting('tests.fe')::uuid,
  'accepting adds the requester to team_members in the chosen role');

select is(
  (select t.project_id from public.team_members tm join public.teams t on t.id = tm.team_id
   where tm.user_id = current_setting('tests.ana')::uuid),
  current_setting('tests.p1')::uuid,
  'on the project''s team');

select is(
  (select status from public.join_requests where id = current_setting('tests.ana_p2')::uuid),
  'declined',
  'accepting auto-declines the requester''s other pending requests');

select is(
  (select status from public.projects where id = current_setting('tests.p1')::uuid),
  'open',
  'the project stays open while seats remain');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_ok(
  format('select public.respond_to_join_request(%L, %L)', current_setting('tests.ana_p1'), 'declined'),
  'P0001', 'This request has already been responded to',
  'responding twice is rejected');

-- --- Filling the last seat -----------------------------------------------
select is(
  (public.respond_to_join_request(current_setting('tests.ben_p1')::uuid, 'accepted', current_setting('tests.be')::uuid)).status,
  'accepted',
  'the owner can accept into the last seat');

select tests.clear_authentication();
select is(
  (select status from public.projects where id = current_setting('tests.p1')::uuid),
  'full',
  'accepting into the last seat sets the project status to full');

select isnt(
  (select formed_at from public.teams where project_id = current_setting('tests.p1')::uuid),
  null,
  'and records when the team formed');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_ok(
  format('select public.respond_to_join_request(%L, %L, %L)',
    current_setting('tests.cal_p1'), 'accepted', current_setting('tests.fe')),
  'P0001', 'This team is already full',
  'accepting into a full team is rejected');

select tests.clear_authentication();
select is(
  (select count(*)::int from public.team_members tm join public.teams t on t.id = tm.team_id
   where t.project_id = current_setting('tests.p1')::uuid),
  3,
  'and the roster stays at the target size');

select is(
  (select status from public.join_requests where id = current_setting('tests.cal_p1')::uuid),
  'pending',
  'and the refused request is left pending, not half-accepted');

-- Declining still works on a full team.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select is(
  (public.respond_to_join_request(current_setting('tests.cal_p1')::uuid, 'declined')).status,
  'declined',
  'the owner can decline a request');

-- --- Notifications -------------------------------------------------------
select tests.clear_authentication();
select results_eq(
  format($q$select kind from public.notifications where user_id = %L$q$, current_setting('tests.ana')),
  $$values ('request_accepted')$$,
  'an accepted requester gets exactly one notification (none for the auto-declined request)');

select results_eq(
  format($q$select kind from public.notifications where user_id = %L$q$, current_setting('tests.cal')),
  $$values ('request_declined')$$,
  'a declined requester gets exactly one notification');

select tests.authenticate_as(current_setting('tests.ben')::uuid);
select results_eq(
  'select n.user_id from public.notifications n',
  format($q$values (%L::uuid)$q$, current_setting('tests.ben')),
  'a student can only read their own notifications');

select * from finish();
rollback;
