-- 44_faculty_advisers.sql — the CS faculty list and how it is refreshed.
-- Who may be invited and searched is covered in adviser_requests.test.sql;
-- this is the list itself: sync_faculty_directory() and who can touch it.
begin;
select plan(10);

select ok((select count(*) from public.faculty_directory) > 0,
  'the migration seeds the directory, so the rule works before the first sync');

-- --- syncing ---------------------------------------------------------------

select is(public.sync_faculty_directory(array[
            'Prof.One@UTRGV.edu', '  prof.two@utrgv.edu ', 'prof.two@utrgv.edu',
            'someone@gmail.com', 'not an email']), 2,
  'a sync keeps the valid @utrgv.edu emails, once each');

select is((select array_agg(email order by email) from public.faculty_directory),
          array['prof.one@utrgv.edu', 'prof.two@utrgv.edu'],
  'and replaces the list: lowercased, trimmed, and nobody from before left over');

select is(public.sync_faculty_directory(array['prof.one@utrgv.edu', 'prof.three@utrgv.edu']), 2,
  'a later sync adds and removes');
select is((select array_agg(email order by email) from public.faculty_directory),
          array['prof.one@utrgv.edu', 'prof.three@utrgv.edu'],
  'so prof.two is gone and prof.three is in');

select throws_like(
  $$ select public.sync_faculty_directory(array[]::text[]) $$,
  '%Refusing to empty the faculty directory%',
  'an empty list is refused, rather than leaving nobody able to advise');
select throws_like(
  $$ select public.sync_faculty_directory(array['someone@gmail.com']) $$,
  '%Refusing to empty the faculty directory%',
  'and so is a list with nothing valid in it');
select is((select count(*)::int from public.faculty_directory), 2,
  'and a refused sync leaves the list as it was');

-- --- who can touch it -------------------------------------------------------

select set_config('tests.student', tests.sign_in_with_microsoft('fdstudent@utrgv.edu', 'Fay Student')::text, true);
select tests.authenticate_as(current_setting('tests.student')::uuid);

select throws_ok(
  $$ select public.sync_faculty_directory(array['fdstudent@utrgv.edu']) $$,
  '42501', null,
  'a signed-in student cannot make themselves faculty');
select throws_ok(
  $$ select * from public.faculty_directory $$,
  '42501', null,
  'nor read the list directly');

select tests.clear_authentication();
select * from finish();
rollback;
