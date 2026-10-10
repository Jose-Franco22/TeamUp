-- Issue #18 — sign in with a UTRGV Microsoft account.
-- Tests the provisioning trigger in 01_auth_provisioning.sql by writing the
-- same auth rows Supabase writes after a Microsoft sign-in.
begin;
select plan(17);

-- --- A UTRGV account gets a profile -----------------------------------
select set_config('tests.jane', tests.sign_in_with_microsoft('jane.doe01@utrgv.edu', 'Jane Doe', 'oid-jane')::text, true);

select is(
  (select count(*)::int from public.users where id = current_setting('tests.jane')::uuid),
  1,
  'UTRGV sign-in creates a public.users row with the same id as auth.users');

select results_eq(
  $$ select email, name, microsoft_oid from public.users where id = current_setting('tests.jane')::uuid $$,
  $$ values ('jane.doe01@utrgv.edu'::text, 'Jane Doe'::text, 'oid-jane'::text) $$,
  'the profile takes email, name and the Entra oid from the Microsoft claims');

select results_eq(
  $$ select bio, availability_hours, github_url from public.users where id = current_setting('tests.jane')::uuid $$,
  $$ values (''::text, 0::smallint, ''::text) $$,
  'a new profile starts empty');

select lives_ok(
  $$ select tests.sign_in_with_microsoft('UPPER.CASE01@UTRGV.EDU') $$,
  'an uppercase @UTRGV.EDU address is accepted');

-- --- Anyone else is rejected ------------------------------------------
select throws_ok(
  $$ select tests.sign_in_with_microsoft('someone@gmail.com') $$,
  'P0001', 'Only @utrgv.edu accounts may sign in to TeamUp',
  'a non-UTRGV account is rejected with a clear message');

select throws_ok(
  $$ select tests.sign_in_with_microsoft('x@utrgv.edu.evil.com') $$,
  'P0001', 'Only @utrgv.edu accounts may sign in to TeamUp',
  'a look-alike domain ending in .evil.com is rejected');

select throws_ok(
  $$ select tests.sign_in_with_microsoft('x@notutrgv.edu') $$,
  'P0001', 'Only @utrgv.edu accounts may sign in to TeamUp',
  'a look-alike domain containing utrgv is rejected');

select throws_ok(
  $$ select tests.sign_in_with_microsoft('x@students.utrgv.edu') $$,
  'P0001', 'Only @utrgv.edu accounts may sign in to TeamUp',
  'a subdomain address is rejected');

select is(
  (select count(*)::int from public.users where email not ilike '%@utrgv.edu'),
  0,
  'no rejected sign-in left a profile behind');

-- --- Bad or unrelated identities --------------------------------------
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'no.oid01@utrgv.edu');
select throws_ok(
  $$ insert into auth.identities (user_id, provider, provider_id, identity_data)
     values ('00000000-0000-0000-0000-0000000000a1', 'azure', 'pid-a1',
             '{"email": "no.oid01@utrgv.edu", "name": "No Oid"}') $$,
  'P0001', 'Microsoft did not return an account identifier',
  'an identity with no oid or sub claim is rejected');

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a2', 'no.email01@utrgv.edu');
select throws_ok(
  $$ insert into auth.identities (user_id, provider, provider_id, identity_data)
     values ('00000000-0000-0000-0000-0000000000a2', 'azure', 'pid-a2', '{"oid": "oid-a2"}') $$,
  'P0001', 'Only @utrgv.edu accounts may sign in to TeamUp',
  'an identity with no email claim is rejected');

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a3', 'gh01@utrgv.edu');
insert into auth.identities (user_id, provider, provider_id, identity_data)
values ('00000000-0000-0000-0000-0000000000a3', 'github', 'gh-1', '{"email": "gh01@utrgv.edu"}');
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-0000000000a3'),
  0,
  'a non-Microsoft provider does not create a profile');

-- --- Signing in again --------------------------------------------------
insert into auth.identities (user_id, provider, provider_id, identity_data)
values (current_setting('tests.jane')::uuid, 'azure', 'oid-jane-2',
        '{"email": "jane.doe01@utrgv.edu", "name": "Jane D. Doe", "oid": "oid-jane-2"}');

select is(
  (select count(*)::int from public.users where email = 'jane.doe01@utrgv.edu'),
  1,
  'signing in again does not create a second profile');

select is(
  (select name from public.users where id = current_setting('tests.jane')::uuid),
  'Jane D. Doe',
  'signing in again refreshes the name from Microsoft');

-- --- The table itself refuses non-UTRGV emails --------------------------
select throws_like(
  $$ insert into public.users (id, email, microsoft_oid, name)
     values (gen_random_uuid(), 'direct@gmail.com', 'oid-direct', 'Direct Insert') $$,
  '%users_email_check%',
  'a direct insert of a non-UTRGV email fails the users.email CHECK constraint');

-- --- Who can read profiles ---------------------------------------------
set local role anon;
select is(
  (select count(*)::int from public.users),
  0,
  'a guest (anon) cannot read any profile');
reset role;

select tests.authenticate_as(current_setting('tests.jane')::uuid);
select ok(
  (select count(*) from public.users) >= 2,
  'a signed-in student can read profiles');
select tests.clear_authentication();

select * from finish();
rollback;
