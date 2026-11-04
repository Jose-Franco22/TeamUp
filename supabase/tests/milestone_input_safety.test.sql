-- Everything an admin can type or send for issues #38 and #39 — milestone
-- name, due date and message, and the placement RPCs' arguments — against
-- garbage, injection attempts and out-of-range values.
-- 26_milestones.sql, 27_admin_placement.sql, 28_milestone_messages.sql.
begin;
select plan(30);

select set_config('tests.admin',   tests.sign_in_with_microsoft('admin01@utrgv.edu', 'Admin')::text, true);
select set_config('tests.student', tests.sign_in_with_microsoft('student01@utrgv.edu', 'Student')::text, true);
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;
select set_config('tests.users', (select count(*)::text from public.users), true);

-- --- Milestone name -----------------------------------------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.save_milestone(null, '... --- !!!', now()) $$,
  'P0001', 'The milestone name has to include letters or numbers',
  'a name of only punctuation is refused');
select throws_ok(
  $$ select public.save_milestone(null, U&'\+01F389\+01F389 \2192\2192', now()) $$,
  'P0001', 'The milestone name has to include letters or numbers',
  'a name of only emoji and arrows is refused');
select throws_ok(
  $$ select public.save_milestone(null, E'Proposal\ndue', now()) $$,
  'P0001', 'The milestone name can''t contain line breaks, hidden or control characters',
  'a line break in a name is refused');
select throws_ok(
  $$ select public.save_milestone(null, E'Proposal\x07 due', now()) $$,
  'P0001', 'The milestone name can''t contain line breaks, hidden or control characters',
  'a control character in a name is refused');
select throws_ok(
  $$ select public.save_milestone(null, U&'Proposal\200B due', now()) $$,
  'P0001', 'The milestone name can''t contain line breaks, hidden or control characters',
  'a zero-width space in a name is refused');
select throws_ok(
  $$ select public.save_milestone(null, U&'Due \202Eeud lasoporP', now()) $$,
  'P0001', 'The milestone name can''t contain line breaks, hidden or control characters',
  'a right-to-left override in a name is refused');
select lives_ok(
  $$ select public.save_milestone(null, 'Entrega de la propuesta — 提交', now()) $$,
  'a name in another language or script is fine');
select lives_ok(
  $$ select public.save_milestone(null, U&'Demo day \+01F389', now()) $$,
  'a name with words and an emoji is fine');

-- --- Due date -------------------------------------------------------------------
select throws_ok(
  $$ select public.save_milestone(null, 'Ancient', '0001-01-01 00:00+00') $$,
  'P0001', 'Pick a due date between 2000 and 2099',
  'a due date in year 1 is refused');
select throws_ok(
  $$ select public.save_milestone(null, 'Last century', '1999-12-31 23:59+00') $$,
  'P0001', 'Pick a due date between 2000 and 2099',
  'a due date before 2000 is refused');
select throws_ok(
  $$ select public.save_milestone(null, 'Far future', '2100-01-01 00:00+00') $$,
  'P0001', 'Pick a due date between 2000 and 2099',
  'a due date in 2100 or later is refused');
select throws_ok(
  $$ select public.save_milestone(null, 'Infinite', 'infinity') $$,
  'P0001', 'Pick a due date between 2000 and 2099',
  'an infinite due date is refused');
select throws_ok(
  $$ select public.save_milestone(null, 'Not a date', 'next tuesday-ish') $$,
  '22007', null,
  'text that isn''t a date never reaches the function');
select lives_ok(
  $$ select public.save_milestone(null, 'Turn of the century', '2000-01-01 00:00+00') $$,
  'the first moment of 2000 is fine');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.milestones),
  3,
  'only the three good milestones were saved');

-- --- The table holds the same line --------------------------------------------
select set_config('tests.ms', (select id::text from public.milestones limit 1), true);
select throws_ok(
  $$ update public.milestones set name = '!!!' where id = current_setting('tests.ms')::uuid $$,
  '23514', null,
  'the table refuses a name with no letters or numbers');
select throws_ok(
  $$ update public.milestones set name = E'Two\nlines' where id = current_setting('tests.ms')::uuid $$,
  '23514', null,
  'the table refuses a line break in a name');
select throws_ok(
  $$ update public.milestones set due_at = '1990-01-01 00:00+00' where id = current_setting('tests.ms')::uuid $$,
  '23514', null,
  'the table refuses an out-of-range due date');

-- --- Injection attempts are just text ------------------------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.inject', (public.save_milestone(
  null,
  $n$Robert'); DROP TABLE public.milestones; --$n$,
  now(),
  false,
  $m$1'; DELETE FROM public.users; -- <script>alert('x')</script> <img src=x onerror=alert(1)>$m$
)).id::text, true);
select tests.clear_authentication();

select is(
  (select name from public.milestones where id = current_setting('tests.inject')::uuid),
  $n$Robert'); DROP TABLE public.milestones; --$n$,
  'SQL typed into a name is stored as plain text');
select is(
  (select message from public.milestones where id = current_setting('tests.inject')::uuid),
  $m$1'; DELETE FROM public.users; -- <script>alert('x')</script> <img src=x onerror=alert(1)>$m$,
  'SQL and HTML typed into a message are stored as plain text');
select has_table('public', 'milestones', 'and the table it tried to drop is still there');
select is(
  (select count(*)::text from public.users),
  current_setting('tests.users'),
  'and the users it tried to delete are still there');

-- Ids are typed uuid, so a string with SQL in it is refused before any
-- function body runs.
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.delete_milestone($x$1' or '1'='1$x$) $$,
  '22P02', null,
  'delete_milestone() refuses an id that isn''t a uuid');
select throws_ok(
  $$ select public.admin_assign_student($x$x'; drop table public.users; --$x$, gen_random_uuid(), gen_random_uuid()) $$,
  '22P02', null,
  'admin_assign_student() refuses a student id that isn''t a uuid');
select throws_ok(
  $$ select public.admin_move_student(gen_random_uuid(), $x$1; delete from public.team_members$x$, gen_random_uuid()) $$,
  '22P02', null,
  'admin_move_student() refuses a team id that isn''t a uuid');
select throws_ok(
  $$ select public.admin_assign_student(gen_random_uuid(), gen_random_uuid(), gen_random_uuid()) $$,
  'P0001', 'Pick a role',
  'a well-formed but made-up role id is refused');
select throws_ok(
  $$ select public.admin_assign_student(current_setting('tests.student')::uuid, gen_random_uuid(),
       (select id from public.roles limit 1)) $$,
  'P0001', 'Team not found',
  'a well-formed but made-up team id is refused');

-- The history's page size can't be pushed to extremes.
select is(jsonb_typeof(public.admin_recent_actions(-5)), 'array', 'a negative page size is clamped, not an error');
select is(jsonb_typeof(public.admin_recent_actions(2147483647)), 'array', 'a huge page size is clamped too');
select throws_ok(
  $$ select public.admin_recent_actions($x$20; drop table public.admin_actions$x$) $$,
  '22P02', null,
  'a page size that isn''t a number is refused');
select tests.clear_authentication();

select * from finish();
rollback;
