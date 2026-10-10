-- First-sign-in walkthrough and re-provisioning on sign-in
-- (12_onboarding.sql, 13_reprovision_on_sign_in.sql).
begin;
select plan(9);

select set_config('tests.me',    tests.sign_in_with_microsoft('me01@utrgv.edu', 'Me')::text, true);
select set_config('tests.other', tests.sign_in_with_microsoft('other01@utrgv.edu', 'Other')::text, true);

-- --- onboarded_at --------------------------------------------------------
select has_column('public', 'users', 'onboarded_at', 'users has an onboarded_at column');

select is(
  (select onboarded_at from public.users where id = current_setting('tests.me')::uuid),
  null,
  'a new student has not seen the walkthrough yet');

select tests.authenticate_as(current_setting('tests.me')::uuid);
update public.users set onboarded_at = now() where id = auth.uid();
update public.users set onboarded_at = now() where id = current_setting('tests.other')::uuid;
select tests.clear_authentication();

select isnt(
  (select onboarded_at from public.users where id = current_setting('tests.me')::uuid),
  null,
  'a student can mark their own walkthrough as done');

select is(
  (select onboarded_at from public.users where id = current_setting('tests.other')::uuid),
  null,
  'a student cannot mark someone else''s walkthrough as done');

-- --- Signing in again re-provisions --------------------------------------
-- Later sign-ins update the existing auth.identities row instead of
-- inserting one; 13_ makes the provisioning trigger fire on that too.
update auth.identities
set identity_data = identity_data || '{"name": "Me Renamed"}'
where user_id = current_setting('tests.me')::uuid;

select is(
  (select name from public.users where id = current_setting('tests.me')::uuid),
  'Me Renamed',
  'signing in again refreshes the name from Microsoft');

select isnt(
  (select onboarded_at from public.users where id = current_setting('tests.me')::uuid),
  null,
  'signing in again keeps onboarded_at, so the walkthrough does not come back');

delete from public.users where id = current_setting('tests.other')::uuid;
update auth.identities
set identity_data = identity_data
where user_id = current_setting('tests.other')::uuid;

select is(
  (select count(*)::int from public.users where id = current_setting('tests.other')::uuid),
  1,
  'signing in again recreates a deleted profile instead of leaving the account stuck');

select is(
  (select onboarded_at from public.users where id = current_setting('tests.other')::uuid),
  null,
  'a recreated profile starts with the walkthrough not done');

select throws_ok(
  $$ update auth.identities
     set identity_data = identity_data || '{"email": "me@gmail.com"}'
     where user_id = current_setting('tests.me')::uuid $$,
  'P0001', 'Only @utrgv.edu accounts may sign in to TeamUp',
  'a later sign-in is still held to the @utrgv.edu rule');

select * from finish();
rollback;
