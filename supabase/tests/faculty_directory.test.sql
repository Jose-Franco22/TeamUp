-- 44_faculty_advisers.sql — the CS faculty list and how it is refreshed.
-- Who may be invited and searched is covered in adviser_requests.test.sql;
-- this is the list itself: sync_faculty_directory() and who can touch it.
begin;
select plan(17);

select ok((select count(*) from public.faculty_directory) > 0,
  'the migration seeds the directory, so the rule works before the first sync');

-- --- syncing ---------------------------------------------------------------

select throws_like(
  $$ select public.sync_faculty_directory(array['prof.one@utrgv.edu', 'prof.two@utrgv.edu']) $$,
  '%Refusing to shrink the faculty directory%',
  'replacing the 37 seeded emails with 2 is refused: it looks like a partial answer');

-- Past this point the tests work on a small list of their own, so the first
-- replacement says it means to shrink it.
select is(public.sync_faculty_directory(array[
            'Prof.One@UTRGV.edu', '  prof.two@utrgv.edu ', 'prof.two@utrgv.edu',
            'someone@gmail.com', 'not an email'], p_allow_shrink => true), 2,
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

-- --- a sharp drop is refused ------------------------------------------------

select is(public.sync_faculty_directory(array[
            'prof.one@utrgv.edu', 'prof.three@utrgv.edu', 'prof.four@utrgv.edu', 'prof.five@utrgv.edu']), 4,
  'growing the list is always fine');
select throws_like(
  $$ select public.sync_faculty_directory(array['prof.one@utrgv.edu']) $$,
  '%Refusing to shrink the faculty directory from 4 to 1 emails%',
  'a list under half the current size is refused, so a partial answer cannot wipe the department');
select is((select count(*)::int from public.faculty_directory), 4,
  'and the list is left as it was');
select is(public.sync_faculty_directory(array['prof.one@utrgv.edu'], p_allow_shrink => true), 1,
  'a real shrink goes through when asked for by hand');

-- --- leaving the list ends unanswered invitations -----------------------------
-- Two faculty, each asked by a different project. One accepts (set by hand:
-- accepting is 40_respond_to_adviser_request.sql's, not on every branch);
-- the other hasn't answered. Then a sync drops them both.

select set_config('tests.fac_a', tests.sign_in_with_microsoft('fdprof.a@utrgv.edu', 'Fac Alpha')::text, true);
select set_config('tests.fac_b', tests.sign_in_with_microsoft('fdprof.b@utrgv.edu', 'Fac Beta')::text, true);
select set_config('tests.own_a', tests.sign_in_with_microsoft('fdowner.a@utrgv.edu', 'Owen Alpha')::text, true);
select set_config('tests.own_b', tests.sign_in_with_microsoft('fdowner.b@utrgv.edu', 'Owen Beta')::text, true);
select set_config('tests.r_pm', (select id from public.roles where name = 'Project Manager')::text, true);

select public.sync_faculty_directory(array['prof.one@utrgv.edu', 'fdprof.a@utrgv.edu', 'fdprof.b@utrgv.edu']);

select tests.authenticate_as(current_setting('tests.own_a')::uuid);
select set_config('tests.proj_a', (select (public.create_project(
  'Faculty sync project alpha', 'A project that asks Fac Alpha to advise it.',
  3::smallint, current_setting('tests.r_pm')::uuid, '[]'::jsonb)).id::text), true);
select set_config('tests.req_a', (select (public.invite_adviser(
  current_setting('tests.proj_a')::uuid, current_setting('tests.fac_a')::uuid)).id::text), true);

select tests.authenticate_as(current_setting('tests.own_b')::uuid);
select set_config('tests.proj_b', (select (public.create_project(
  'Faculty sync project beta', 'A project that asks Fac Beta to advise it.',
  3::smallint, current_setting('tests.r_pm')::uuid, '[]'::jsonb)).id::text), true);
select set_config('tests.req_b', (select (public.invite_adviser(
  current_setting('tests.proj_b')::uuid, current_setting('tests.fac_b')::uuid)).id::text), true);

select tests.clear_authentication();
update public.adviser_requests set status = 'accepted', responded_at = now()
 where id = current_setting('tests.req_b')::uuid;

select public.sync_faculty_directory(array['prof.one@utrgv.edu', 'prof.six@utrgv.edu']);

select is((select status from public.adviser_requests where id = current_setting('tests.req_a')::uuid), 'cancelled',
  'an invitation to someone the sync removed is cancelled, so they cannot accept it afterwards');
select is((select status from public.adviser_requests where id = current_setting('tests.req_b')::uuid), 'accepted',
  'but an adviser who already accepted keeps their team');

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
