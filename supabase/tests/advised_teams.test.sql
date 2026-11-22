-- Issues #59 / #54 — who advises which team: 43_advised_teams.sql.
--
-- adviser_digest.test.sql swaps private.advised_teams() for a table of its
-- own, so it tests everything built on the function but not the function.
-- This tests the real body: only accepted adviser requests count, and the
-- digest's send list follows from them.
begin;
select plan(9);

select set_config('tests.adv',   tests.sign_in_with_microsoft('atadv@utrgv.edu', 'Adviser Ana')::text, true);
select set_config('tests.other', tests.sign_in_with_microsoft('atoth@utrgv.edu', 'Adviser Other')::text, true);
select set_config('tests.s1',    tests.sign_in_with_microsoft('ats1@utrgv.edu', 'Student One')::text, true);
select set_config('tests.s2',    tests.sign_in_with_microsoft('ats2@utrgv.edu', 'Student Two')::text, true);
select set_config('tests.s3',    tests.sign_in_with_microsoft('ats3@utrgv.edu', 'Student Three')::text, true);
select set_config('tests.s4',    tests.sign_in_with_microsoft('ats4@utrgv.edu', 'Student Four')::text, true);
select set_config('tests.s5',    tests.sign_in_with_microsoft('ats5@utrgv.edu', 'Student Five')::text, true);
select set_config('tests.s6',    tests.sign_in_with_microsoft('ats6@utrgv.edu', 'Student Six')::text, true);

select set_config('tests.p1', tests.create_full_team(current_setting('tests.s1')::uuid, current_setting('tests.s2')::uuid)::text, true);
select set_config('tests.p2', tests.create_full_team(current_setting('tests.s3')::uuid, current_setting('tests.s4')::uuid)::text, true);
select set_config('tests.p3', tests.create_full_team(current_setting('tests.s5')::uuid, current_setting('tests.s6')::uuid)::text, true);
select set_config('tests.t1', (select id from public.teams where project_id = current_setting('tests.p1')::uuid)::text, true);
select set_config('tests.t2', (select id from public.teams where project_id = current_setting('tests.p2')::uuid)::text, true);

select is((select count(*)::int from private.advised_teams(current_setting('tests.adv')::uuid)), 0,
  'nobody advises anything before an invitation is accepted');

-- adv: accepted on p1 and p2, declined on p3. other: pending on p3.
-- 'accepted' is written directly here; respond_to_adviser_request() (#54) is
-- what writes it for real, and has tests of its own.
insert into public.adviser_requests (project_id, adviser_id, invited_by, status) values
  (current_setting('tests.p1')::uuid, current_setting('tests.adv')::uuid,   current_setting('tests.s1')::uuid, 'accepted'),
  (current_setting('tests.p2')::uuid, current_setting('tests.adv')::uuid,   current_setting('tests.s3')::uuid, 'accepted'),
  (current_setting('tests.p3')::uuid, current_setting('tests.adv')::uuid,   current_setting('tests.s5')::uuid, 'declined'),
  (current_setting('tests.p3')::uuid, current_setting('tests.other')::uuid, current_setting('tests.s5')::uuid, 'pending');

select set_eq(
  $$ select * from private.advised_teams(current_setting('tests.adv')::uuid) $$,
  $$ values (current_setting('tests.t1')::uuid), (current_setting('tests.t2')::uuid) $$,
  'an adviser advises the teams of the projects where they accepted, and not where they declined');

select is((select count(*)::int from private.advised_teams(current_setting('tests.other')::uuid)), 0,
  'a pending invitation is not advising yet');

select set_eq(
  $$ select * from private.adviser_digest_recipients() $$,
  $$ values (current_setting('tests.adv')::uuid) $$,
  'so the digest goes to the adviser who accepted, and not to the one still invited');

select is(jsonb_array_length(private.adviser_digest_data(current_setting('tests.adv')::uuid, '2026-11-16 14:00+00') -> 'teams'), 2,
  'and their digest lists both teams they advise');

-- Stepping down and being removed both land on 'cancelled' (40_).
update public.adviser_requests set status = 'cancelled'
 where project_id = current_setting('tests.p2')::uuid and adviser_id = current_setting('tests.adv')::uuid;

select set_eq(
  $$ select * from private.advised_teams(current_setting('tests.adv')::uuid) $$,
  $$ values (current_setting('tests.t1')::uuid) $$,
  'a cancelled link (stepped down or removed) stops counting');

select is(private.send_adviser_digests('2026-11-16 14:00+00'), 1,
  'the Monday job queues one digest, for the one adviser on the send list');

update public.users set adviser_digest = false where id = current_setting('tests.adv')::uuid;
select is((select count(*)::int from private.adviser_digest_recipients()), 0,
  'an adviser who turned the digest off is not on the send list');

select tests.authenticate_as(current_setting('tests.adv')::uuid);
select throws_ok($$ select * from private.advised_teams(current_setting('tests.adv')::uuid) $$, '42501', null,
  'signed-in users still cannot ask who advises what');
select tests.clear_authentication();

select * from finish();
rollback;
