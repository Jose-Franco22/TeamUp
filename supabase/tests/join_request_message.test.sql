-- Join requests with a message, and every reason one is refused (issue #32):
-- 24_join_request_message.sql.
begin;
select plan(13);

select set_config('tests.owner', tests.sign_in_with_microsoft('owner01@utrgv.edu', 'Owner')::text, true);
select set_config('tests.full_owner', tests.sign_in_with_microsoft('owner02@utrgv.edu', 'Full Owner')::text, true);
select set_config('tests.full_member', tests.sign_in_with_microsoft('member02@utrgv.edu', 'Full Member')::text, true);
select set_config('tests.ana', tests.sign_in_with_microsoft('ana01@utrgv.edu', 'Ana')::text, true);
select set_config('tests.ben', tests.sign_in_with_microsoft('ben01@utrgv.edu', 'Ben')::text, true);
select set_config('tests.cal', tests.sign_in_with_microsoft('cal01@utrgv.edu', 'Cal')::text, true);
select set_config('tests.pm', (select id from public.roles where name = 'Project Manager')::text, true);

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select set_config('tests.p1',
  (public.create_project('Trail Finder', 'Find hiking trails near campus.', 4::smallint, current_setting('tests.pm')::uuid, '[]'::jsonb)).id::text, true);
select tests.clear_authentication();

-- A two-seat project with both seats taken.
select set_config('tests.full',
  tests.create_full_team(current_setting('tests.full_owner')::uuid, current_setting('tests.full_member')::uuid)::text, true);

-- --- The message is stored -------------------------------------------------
select tests.authenticate_as(current_setting('tests.ana')::uuid);
select set_config('tests.ana_req',
  (public.create_join_request(current_setting('tests.p1')::uuid, '  I built the campus map app last spring.  ')).id::text, true);
select tests.clear_authentication();

select is(
  (select message from public.join_requests where id = current_setting('tests.ana_req')::uuid),
  'I built the campus map app last spring.',
  'create_join_request() stores the message, trimmed');

-- The message is optional: no argument, and blank, both store null.
select tests.authenticate_as(current_setting('tests.ben')::uuid);
select set_config('tests.ben_req', (public.create_join_request(current_setting('tests.p1')::uuid)).id::text, true);
select tests.clear_authentication();
select is(
  (select message from public.join_requests where id = current_setting('tests.ben_req')::uuid),
  null,
  'a request without a message stores null');

select tests.authenticate_as(current_setting('tests.cal')::uuid);
select set_config('tests.cal_req', (public.create_join_request(current_setting('tests.p1')::uuid, '   ')).id::text, true);
select tests.clear_authentication();
select is(
  (select message from public.join_requests where id = current_setting('tests.cal_req')::uuid),
  null,
  'a blank message stores null');

-- The creator can read it, the way getRequests() does.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select is(
  (select message from public.join_requests where id = current_setting('tests.ana_req')::uuid),
  'I built the campus map app last spring.',
  'the project''s creator can read the message');
select tests.clear_authentication();

-- --- Refusals --------------------------------------------------------------
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_ok(
  format('select public.create_join_request(%L)', current_setting('tests.p1')),
  'P0001', 'You cannot request to join your own project',
  'a request to your own project is refused');

select tests.authenticate_as(current_setting('tests.full_member')::uuid);
select throws_ok(
  format('select public.create_join_request(%L)', current_setting('tests.p1')),
  'P0001', 'You are already on a team and cannot request to join another project',
  'a request from someone already on a team is refused');

select tests.authenticate_as(current_setting('tests.ana')::uuid);
select throws_ok(
  format('select public.create_join_request(%L, %L)', current_setting('tests.p1'), 'Asking again'),
  'P0001', 'You already have a pending request for this project',
  'a second pending request for the same project is refused');

select throws_ok(
  format('select public.create_join_request(%L)', current_setting('tests.full')),
  'P0001', 'This project is full and isn''t taking requests',
  'a request to a full project is refused');

-- 300 characters is fine (on a fresh project, so nothing else refuses it);
-- 301 is not. Emoji count as one character each, as in the frontend.
select set_config('tests.dee', tests.sign_in_with_microsoft('dee01@utrgv.edu', 'Dee')::text, true);
select set_config('tests.eve', tests.sign_in_with_microsoft('eve01@utrgv.edu', 'Eve')::text, true);

select tests.authenticate_as(current_setting('tests.dee')::uuid);
select throws_ok(
  format('select public.create_join_request(%L, %L)', current_setting('tests.p1'), repeat('a', 301)),
  'P0001', 'Your message can be at most 300 characters',
  'a message over 300 characters is refused');

select lives_ok(
  format('select public.create_join_request(%L, %L)', current_setting('tests.p1'), repeat('😀', 300)),
  'a message of exactly 300 characters is accepted');

-- The constraint holds even for a write that skips the function.
select tests.clear_authentication();
select throws_ok(
  format($q$insert into public.join_requests (project_id, user_id, message) values (%L, %L, %L)$q$,
    current_setting('tests.p1'), current_setting('tests.eve'), repeat('a', 301)),
  '23514', null,
  'join_requests_message_length_check refuses a 301-character message');

-- --- After the formation deadline -----------------------------------------
update public.app_settings set formation_deadline = now() - interval '1 day';

select tests.authenticate_as(current_setting('tests.eve')::uuid);
select throws_ok(
  format('select public.create_join_request(%L)', current_setting('tests.p1')),
  'P0001', 'The team formation deadline has passed, so new join requests are closed',
  'a request after the formation deadline is refused');
select tests.clear_authentication();

update public.app_settings set formation_deadline = now() + interval '1 day';
select tests.authenticate_as(current_setting('tests.eve')::uuid);
select lives_ok(
  format('select public.create_join_request(%L)', current_setting('tests.p1')),
  'a request before the deadline still goes through');
select tests.clear_authentication();

select * from finish();
rollback;
