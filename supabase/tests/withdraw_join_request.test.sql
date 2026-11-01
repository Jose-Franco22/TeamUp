-- Withdrawing a join request (issue #33): 24_withdraw_join_request.sql.
begin;
select plan(17);

select set_config('tests.owner', tests.sign_in_with_microsoft('owner01@utrgv.edu', 'Owner')::text, true);
select set_config('tests.owner2', tests.sign_in_with_microsoft('owner02@utrgv.edu', 'Owner Two')::text, true);
select set_config('tests.ana', tests.sign_in_with_microsoft('ana01@utrgv.edu', 'Ana')::text, true);
select set_config('tests.ben', tests.sign_in_with_microsoft('ben01@utrgv.edu', 'Ben')::text, true);
select set_config('tests.cal', tests.sign_in_with_microsoft('cal01@utrgv.edu', 'Cal')::text, true);
select set_config('tests.pm', (select id from public.roles where name = 'Project Manager')::text, true);
select set_config('tests.fe', (select id from public.roles where name = 'Frontend Developer')::text, true);

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select set_config('tests.p1',
  (public.create_project('Trail Finder', 'Find hiking trails near campus.', 4::smallint, current_setting('tests.pm')::uuid, '[]'::jsonb)).id::text, true);
select tests.authenticate_as(current_setting('tests.owner2')::uuid);
select set_config('tests.p2',
  (public.create_project('Study Buddy', 'Match classmates into study groups.', 4::smallint, current_setting('tests.pm')::uuid, '[]'::jsonb)).id::text, true);

-- Ana and Ben ask to join the owner's project; Cal asks to join Owner Two's.
select tests.authenticate_as(current_setting('tests.ana')::uuid);
select set_config('tests.ana_p1', (public.create_join_request(current_setting('tests.p1')::uuid)).id::text, true);
select tests.authenticate_as(current_setting('tests.ben')::uuid);
select set_config('tests.ben_p1', (public.create_join_request(current_setting('tests.p1')::uuid)).id::text, true);
select tests.authenticate_as(current_setting('tests.cal')::uuid);
select set_config('tests.cal_p2', (public.create_join_request(current_setting('tests.p2')::uuid)).id::text, true);

-- --- Only the requester can withdraw ---------------------------------------
select tests.authenticate_as(current_setting('tests.ben')::uuid);
select throws_ok(
  format('select public.withdraw_join_request(%L)', current_setting('tests.ana_p1')),
  'P0001', 'Only the student who sent this request can withdraw it',
  'another student cannot withdraw someone else''s request');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_ok(
  format('select public.withdraw_join_request(%L)', current_setting('tests.ana_p1')),
  'P0001', 'Only the student who sent this request can withdraw it',
  'the project''s owner cannot withdraw a request sent to them');

select throws_ok(
  format('select public.withdraw_join_request(%L)', gen_random_uuid()),
  'P0001', 'Only the student who sent this request can withdraw it',
  'a request that doesn''t exist is refused the same way');

select tests.clear_authentication();
select is(
  (select status from public.join_requests where id = current_setting('tests.ana_p1')::uuid),
  'pending',
  'the refused attempts left the request pending');

-- --- The requester withdraws -----------------------------------------------
select tests.authenticate_as(current_setting('tests.ana')::uuid);
select is(
  (public.withdraw_join_request(current_setting('tests.ana_p1')::uuid)).status,
  'withdrawn',
  'withdraw_join_request() returns the request as withdrawn');

select tests.clear_authentication();
select is(
  (select status from public.join_requests where id = current_setting('tests.ana_p1')::uuid),
  'withdrawn',
  'the stored status is withdrawn');

-- The owner's Requests page reads pending rows through RLS
-- (frontend/src/api/client.js getRequests / getPendingRequestCount).
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select results_eq(
  'select id from public.join_requests where status = ''pending''',
  format('values (%L::uuid)', current_setting('tests.ben_p1')),
  'a withdrawn request is gone from the owner''s pending list');

select tests.authenticate_as(current_setting('tests.ana')::uuid);
select results_eq(
  'select id, status from public.join_requests',
  format($q$values (%L::uuid, 'withdrawn')$q$, current_setting('tests.ana_p1')),
  'the requester still sees their own request, as withdrawn');

select tests.clear_authentication();
select set_eq(
  format($q$select actor_id, read_at is not null from public.notifications
            where user_id = %L and kind = 'join_request'$q$,
         current_setting('tests.owner')),
  format('values (%L::uuid, true), (%L::uuid, false)', current_setting('tests.ana'), current_setting('tests.ben')),
  'the owner''s alert for the withdrawn request is marked read; others are untouched');

-- --- A withdrawn request is final -----------------------------------------
select tests.authenticate_as(current_setting('tests.ana')::uuid);
select throws_ok(
  format('select public.withdraw_join_request(%L)', current_setting('tests.ana_p1')),
  'P0001', 'Only a pending request can be withdrawn',
  'a withdrawn request cannot be withdrawn again');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_ok(
  format('select public.respond_to_join_request(%L, %L, %L)',
    current_setting('tests.ana_p1'), 'accepted', current_setting('tests.fe')),
  'P0001', 'This request has already been responded to',
  'the owner cannot accept a withdrawn request');

-- --- Accepted and declined requests can't be withdrawn --------------------
select public.respond_to_join_request(current_setting('tests.ben_p1')::uuid, 'accepted', current_setting('tests.fe')::uuid);
select tests.authenticate_as(current_setting('tests.ben')::uuid);
select throws_ok(
  format('select public.withdraw_join_request(%L)', current_setting('tests.ben_p1')),
  'P0001', 'Only a pending request can be withdrawn',
  'an accepted request cannot be withdrawn');

select tests.authenticate_as(current_setting('tests.owner2')::uuid);
select public.respond_to_join_request(current_setting('tests.cal_p2')::uuid, 'declined');
select tests.authenticate_as(current_setting('tests.cal')::uuid);
select throws_ok(
  format('select public.withdraw_join_request(%L)', current_setting('tests.cal_p2')),
  'P0001', 'Only a pending request can be withdrawn',
  'a declined request cannot be withdrawn');

select tests.clear_authentication();
select is(
  (select array_agg(status order by status) from public.join_requests
   where id in (current_setting('tests.ben_p1')::uuid, current_setting('tests.cal_p2')::uuid)),
  array['accepted', 'declined'],
  'the refused withdrawals left those requests as they were');

-- --- Asking again after withdrawing ---------------------------------------
select tests.authenticate_as(current_setting('tests.ana')::uuid);
select lives_ok(
  format('select set_config(''tests.ana_p1_again'', (public.create_join_request(%L)).id::text, true)',
    current_setting('tests.p1')),
  'the student can request the same project again after withdrawing');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select results_eq(
  'select id, user_id from public.join_requests where status = ''pending''',
  format('values (%L::uuid, %L::uuid)', current_setting('tests.ana_p1_again'), current_setting('tests.ana')),
  'the new request shows up in the owner''s pending list');

select tests.clear_authentication();
select results_eq(
  format('select status from public.join_requests where project_id = %L and user_id = %L order by status',
    current_setting('tests.p1'), current_setting('tests.ana')),
  $$values ('pending'::text), ('withdrawn'::text)$$,
  'the old withdrawn row stays alongside the new pending one');

select * from finish();
rollback;
