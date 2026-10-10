-- Issue #17 — profile validation is enforced by the database, not just the
-- form. Runs every check as a signed-in student through RLS, the same path
-- a direct supabase-js call would take.
begin;
select plan(20);

-- --- The rules cover existing rows too (14_validate_profile_rules.sql) ---
-- Otherwise an old invalid profile blocks that student's next sign-in,
-- since 13_ rewrites their row every time they sign in.
select ok(
  (select bool_and(convalidated) from pg_constraint
   where conrelid = 'public.users'::regclass
     and conname in ('users_availability_hours_range_check',
                     'users_bio_length_check',
                     'users_github_url_format_check')
   having count(*) = 3),
  'all three profile rules are validated against existing rows');

select set_config('tests.me',    tests.sign_in_with_microsoft('me01@utrgv.edu', 'Me')::text, true);
select set_config('tests.other', tests.sign_in_with_microsoft('other01@utrgv.edu', 'Other')::text, true);
select tests.authenticate_as(current_setting('tests.me')::uuid);

-- --- availability_hours: whole number 0–40 -------------------------------
select lives_ok(
  $$ update public.users set availability_hours = 0 where id = auth.uid() $$,
  'availability 0 is accepted');
select lives_ok(
  $$ update public.users set availability_hours = 40 where id = auth.uid() $$,
  'availability 40 is accepted');
select throws_like(
  $$ update public.users set availability_hours = 41 where id = auth.uid() $$,
  '%users_availability_hours_range_check%',
  'availability 41 is rejected');
select throws_like(
  $$ update public.users set availability_hours = 500 where id = auth.uid() $$,
  '%users_availability_hours_range_check%',
  'availability 500 is rejected');
select throws_ok(
  $$ update public.users set availability_hours = -1 where id = auth.uid() $$,
  '23514', null,
  'negative availability is rejected');

-- --- github_url: empty or a GitHub profile link --------------------------
select lives_ok(
  $$ update public.users set github_url = '' where id = auth.uid() $$,
  'an empty GitHub URL is accepted');
select lives_ok(
  $$ update public.users set github_url = 'https://github.com/jose-franco22' where id = auth.uid() $$,
  'a GitHub profile link is accepted');
select lives_ok(
  $$ update public.users set github_url = 'https://www.GitHub.com/Jose-Franco22/' where id = auth.uid() $$,
  'www., mixed case and a trailing slash are accepted');
select throws_like(
  $$ update public.users set github_url = 'github.com/x' where id = auth.uid() $$,
  '%users_github_url_format_check%',
  'a link without https:// is rejected');
select throws_like(
  $$ update public.users set github_url = 'https://gitlab.com/x' where id = auth.uid() $$,
  '%users_github_url_format_check%',
  'a non-GitHub link is rejected');
select throws_like(
  $$ update public.users set github_url = 'https://github.com/' where id = auth.uid() $$,
  '%users_github_url_format_check%',
  'a link with no username is rejected');
select throws_like(
  $$ update public.users set github_url = 'javascript:alert(1)' where id = auth.uid() $$,
  '%users_github_url_format_check%',
  'a javascript: URL is rejected');
select throws_like(
  $$ update public.users set github_url = 'https://github.com.evil.com/x' where id = auth.uid() $$,
  '%users_github_url_format_check%',
  'a look-alike GitHub domain is rejected');

-- --- bio: at most 500 characters ---------------------------------------
select lives_ok(
  $$ update public.users set bio = repeat('a', 500) where id = auth.uid() $$,
  'a 500-character bio is accepted');
select lives_ok(
  $$ update public.users set bio = repeat('🚀', 500) where id = auth.uid() $$,
  'a 500-emoji bio is accepted (counted as characters, not bytes)');
select throws_like(
  $$ update public.users set bio = repeat('a', 501) where id = auth.uid() $$,
  '%users_bio_length_check%',
  'a 501-character bio is rejected');

-- --- Only your own row ---------------------------------------------------
select lives_ok(
  $$ update public.users set bio = 'hacked' where id = current_setting('tests.other')::uuid $$,
  'updating someone else''s profile runs without error…');
select tests.clear_authentication();
select is(
  (select bio from public.users where id = current_setting('tests.other')::uuid),
  '',
  '…but RLS changes nothing on their row');
select is(
  (select availability_hours from public.users where id = current_setting('tests.me')::uuid),
  40::smallint,
  'rejected updates left the last valid value in place');

select * from finish();
rollback;
