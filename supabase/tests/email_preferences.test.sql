-- Email preferences (issue #21, 36_email_preferences.sql).
begin;
select plan(6);

select set_config('tests.me',    tests.sign_in_with_microsoft('mail01@utrgv.edu', 'Me')::text, true);
select set_config('tests.other', tests.sign_in_with_microsoft('mail02@utrgv.edu', 'Other')::text, true);

select has_column('public', 'users', 'email_notifications', 'users has an email_notifications column');
select col_not_null('public', 'users', 'email_notifications', 'email_notifications is never null');

select is(
  (select email_notifications from public.users where id = current_setting('tests.me')::uuid),
  true,
  'a new student gets emails by default');

select tests.authenticate_as(current_setting('tests.me')::uuid);
update public.users set email_notifications = false where id = auth.uid();
update public.users set email_notifications = false where id = current_setting('tests.other')::uuid;
select tests.clear_authentication();

select is(
  (select email_notifications from public.users where id = current_setting('tests.me')::uuid),
  false,
  'a student can turn their own emails off');

select is(
  (select email_notifications from public.users where id = current_setting('tests.other')::uuid),
  true,
  'a student cannot turn off someone else''s emails');

select tests.authenticate_as(current_setting('tests.me')::uuid);
update public.users set email_notifications = true where id = auth.uid();
select tests.clear_authentication();

select is(
  (select email_notifications from public.users where id = current_setting('tests.me')::uuid),
  true,
  'and back on again');

select * from finish();
rollback;
