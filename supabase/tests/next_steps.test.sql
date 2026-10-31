-- The next-steps checklist (issue #42): 33_next_steps.sql.
begin;
select plan(41);

select set_config('tests.admin',   tests.sign_in_with_microsoft('admin01@utrgv.edu', 'Admin')::text, true);
select set_config('tests.student', tests.sign_in_with_microsoft('student01@utrgv.edu', 'Student')::text, true);
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;

-- --- Only admins write the checklist --------------------------------------------
select tests.authenticate_as(current_setting('tests.student')::uuid);
select throws_ok(
  $$ select public.save_next_step(null, 'Confirm the roster') $$,
  '42501', 'Admin access required',
  'a student can''t add a step');
select throws_ok(
  $$ insert into public.next_steps (title, sort_order) values ('Sneaky', 1) $$,
  '42501', null,
  'a student can''t write the table directly either');
select tests.clear_authentication();

-- --- Adding ------------------------------------------------------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.roster', (public.save_next_step(null, '  Confirm the roster  ')).id::text, true);
select set_config('tests.repo',
  (public.save_next_step(null, 'Create the repo and add the adviser', '2026-11-07 23:59+00')).id::text, true);
select set_config('tests.meeting', (public.save_next_step(null, 'Schedule the first adviser meeting')).id::text, true);
select tests.clear_authentication();

select is(
  (select array_agg(title order by sort_order) from public.next_steps),
  array['Confirm the roster', 'Create the repo and add the adviser', 'Schedule the first adviser meeting'],
  'an admin can add steps; each goes at the end, and the text is trimmed');
select is(
  (select array_agg(sort_order order by sort_order) from public.next_steps),
  array[1, 2, 3],
  'new steps are numbered 1..n');
select is(
  (select due_at from public.next_steps where id = current_setting('tests.repo')::uuid),
  '2026-11-07 23:59+00'::timestamptz,
  'a step can have a due date');
select is(
  (select due_at from public.next_steps where id = current_setting('tests.roster')::uuid),
  null,
  'the due date is optional');

-- --- Editing -----------------------------------------------------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.save_next_step(current_setting('tests.roster')::uuid, 'Confirm the roster with the instructor',
       '2026-11-01 12:00+00') $$,
  'an admin can edit a step');
select tests.clear_authentication();

select is(
  (select (title, due_at, sort_order)::text from public.next_steps where id = current_setting('tests.roster')::uuid),
  ('Confirm the roster with the instructor', '2026-11-01 12:00+00'::timestamptz, 1)::text,
  'the edit is saved and the step keeps its place');

select tests.authenticate_as(current_setting('tests.student')::uuid);
select throws_ok(
  $$ select public.save_next_step(current_setting('tests.roster')::uuid, 'Renamed') $$,
  '42501', 'Admin access required',
  'a student can''t edit a step');
-- No UPDATE policy, so RLS filters every row out rather than raising.
update public.next_steps set title = 'Renamed';
select tests.clear_authentication();
select is(
  (select count(*)::int from public.next_steps where title = 'Renamed'), 0,
  'and a direct UPDATE changes nothing');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.save_next_step(gen_random_uuid(), 'Nowhere') $$,
  'P0001', 'Next step not found',
  'editing a step that doesn''t exist is refused');
select tests.clear_authentication();

-- --- The text is required, and has to read like a step ----------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.save_next_step(null, '   ') $$,
  'P0001', 'A next step needs some text',
  'empty text is refused');
select throws_ok(
  $$ select public.save_next_step(null, null) $$,
  'P0001', 'A next step needs some text',
  'so is no text at all');
select throws_ok(
  $$ select public.save_next_step(null, '!!! ???') $$,
  'P0001', 'The step has to include letters or numbers',
  'punctuation alone is refused');
select throws_ok(
  $$ select public.save_next_step(null, E'Two\nlines') $$,
  'P0001', 'The step can''t contain line breaks, hidden or control characters',
  'a line break is refused');
select throws_ok(
  $$ select public.save_next_step(null, 'Hidden' || chr(8203) || 'text') $$,
  'P0001', 'The step can''t contain line breaks, hidden or control characters',
  'a zero-width character is refused');
select throws_ok(
  $$ select public.save_next_step(null, repeat('x', 121)) $$,
  'P0001', 'Keep the step to 120 characters or fewer',
  'text over 120 characters is refused');
select throws_ok(
  $$ select public.save_next_step(null, 'Far future', '2100-01-01 00:00+00') $$,
  'P0001', 'Pick a due date between 2000 and 2099',
  'a due date outside 2000-2099 is refused');
select tests.clear_authentication();

select throws_ok(
  $$ insert into public.next_steps (title, sort_order) values ('', 99) $$,
  '23514', null,
  'the table itself refuses empty text, however the row is written');
select is((select count(*)::int from public.next_steps), 3, 'nothing refused was saved');

-- --- Reordering --------------------------------------------------------------------
select tests.authenticate_as(current_setting('tests.student')::uuid);
select throws_ok(
  format($$ select public.reorder_next_steps(array[%L, %L, %L]::uuid[]) $$,
    current_setting('tests.meeting'), current_setting('tests.roster'), current_setting('tests.repo')),
  '42501', 'Admin access required',
  'a student can''t reorder the steps');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select is(
  (select array_agg(title order by sort_order) from public.reorder_next_steps(array[
     current_setting('tests.meeting'), current_setting('tests.roster'), current_setting('tests.repo')]::uuid[])),
  array['Schedule the first adviser meeting', 'Confirm the roster with the instructor',
        'Create the repo and add the adviser'],
  'an admin can reorder the steps, and gets the new order back');
select tests.clear_authentication();

select is(
  (select array_agg(id::text order by sort_order) from public.next_steps),
  array[current_setting('tests.meeting'), current_setting('tests.roster'), current_setting('tests.repo')],
  'the new order is saved');
select is(
  (select array_agg(sort_order order by sort_order) from public.next_steps),
  array[1, 2, 3],
  'and still numbered 1..n');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  format($$ select public.reorder_next_steps(array[%L, %L]::uuid[]) $$,
    current_setting('tests.roster'), current_setting('tests.repo')),
  'P0001', 'The list has changed since it was loaded — reload and try again',
  'a reorder that leaves a step out is refused');
select throws_ok(
  format($$ select public.reorder_next_steps(array[%L, %L, %L]::uuid[]) $$,
    current_setting('tests.roster'), current_setting('tests.roster'), current_setting('tests.repo')),
  'P0001', 'The list has changed since it was loaded — reload and try again',
  'one that lists a step twice is refused');
select throws_ok(
  format($$ select public.reorder_next_steps(array[%L, %L, gen_random_uuid()]::uuid[]) $$,
    current_setting('tests.roster'), current_setting('tests.repo')),
  'P0001', 'The list has changed since it was loaded — reload and try again',
  'one with an id that isn''t a step is refused');
select tests.clear_authentication();

select is(
  (select array_agg(id::text order by sort_order) from public.next_steps),
  array[current_setting('tests.meeting'), current_setting('tests.roster'), current_setting('tests.repo')],
  'a refused reorder changes nothing');

-- --- Who can read what -------------------------------------------------------------
select tests.authenticate_as(current_setting('tests.student')::uuid);
select is((select count(*)::int from public.next_steps), 3, 'a signed-in student can read the checklist');
select tests.clear_authentication();
select set_config('role', 'anon', true);
select is((select count(*)::int from public.next_steps), 0, 'a guest can''t');
select tests.clear_authentication();

-- --- Each team's progress on the dashboard -----------------------------------------
select set_config('tests.ownerA',  tests.sign_in_with_microsoft('owner0a@utrgv.edu', 'Owner A')::text, true);
select set_config('tests.memberA', tests.sign_in_with_microsoft('member0a@utrgv.edu', 'Member A')::text, true);
select set_config('tests.ownerB',  tests.sign_in_with_microsoft('owner0b@utrgv.edu', 'Owner B')::text, true);
select set_config('tests.memberB', tests.sign_in_with_microsoft('member0b@utrgv.edu', 'Member B')::text, true);
-- Built first and looked up after: inside the WHERE below, create_full_team()
-- would only run once per existing team row, and there are none yet.
select set_config('tests.projectA',
  tests.create_full_team(current_setting('tests.ownerA')::uuid, current_setting('tests.memberA')::uuid)::text, true);
select set_config('tests.projectB',
  tests.create_full_team(current_setting('tests.ownerB')::uuid, current_setting('tests.memberB')::uuid)::text, true);
select set_config('tests.teamA',
  (select id::text from public.teams where project_id = current_setting('tests.projectA')::uuid), true);
select set_config('tests.teamB',
  (select id::text from public.teams where project_id = current_setting('tests.projectB')::uuid), true);

-- Checking items off is #30's function; the rows it will write are put in
-- directly here.
insert into public.next_step_completions (team_id, step_id, completed_by)
values (current_setting('tests.teamA')::uuid, current_setting('tests.roster')::uuid, current_setting('tests.memberA')::uuid),
       (current_setting('tests.teamA')::uuid, current_setting('tests.repo')::uuid, current_setting('tests.ownerA')::uuid),
       (current_setting('tests.teamB')::uuid, current_setting('tests.meeting')::uuid, current_setting('tests.ownerB')::uuid);

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.snapshot', public.admin_dashboard()::text, true);
select is(
  (select team->'next_steps' from jsonb_array_elements(current_setting('tests.snapshot')::jsonb->'teams') team
    where team->>'id' = current_setting('tests.teamA')),
  '{"done": 2, "total": 3}'::jsonb,
  'the dashboard shows team A has done 2 of 3 steps');
select is(
  (select team->'next_steps' from jsonb_array_elements(current_setting('tests.snapshot')::jsonb->'teams') team
    where team->>'id' = current_setting('tests.teamB')),
  '{"done": 1, "total": 3}'::jsonb,
  'and team B 1 of 3, counted separately');
select is(
  public.admin_team_details(current_setting('tests.teamA')::uuid)->'next_steps',
  '{"done": 2, "total": 3}'::jsonb,
  'the team page reports the same progress');
select tests.clear_authentication();

-- Members see their own team's completions; nobody else's.
select tests.authenticate_as(current_setting('tests.memberA')::uuid);
select is((select count(*)::int from public.next_step_completions), 2, 'a member sees only their own team''s completions');
select throws_ok(
  format($$ insert into public.next_step_completions (team_id, step_id) values (%L, %L) $$,
    current_setting('tests.teamA'), current_setting('tests.meeting')),
  '42501', null,
  'and can''t write them directly (that''s #30''s function)');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('tests.student')::uuid);
select is((select count(*)::int from public.next_step_completions), 0, 'a student on no team sees none');
select tests.clear_authentication();

-- --- Deleting ----------------------------------------------------------------------
select tests.authenticate_as(current_setting('tests.student')::uuid);
select throws_ok(
  format($$ select public.delete_next_step(%L) $$, current_setting('tests.roster')),
  '42501', 'Admin access required',
  'a student can''t delete a step');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  format($$ select public.delete_next_step(%L) $$, current_setting('tests.roster')),
  'an admin can delete a step');
select is(
  (select array_agg(sort_order order by sort_order) from public.next_steps),
  array[1, 2],
  'deleting closes the gap in the order');
select is(
  (select team->'next_steps' from jsonb_array_elements(public.admin_dashboard()->'teams') team
    where team->>'id' = current_setting('tests.teamA')),
  '{"done": 1, "total": 2}'::jsonb,
  'a deleted step no longer counts toward a team''s progress');
select throws_ok(
  format($$ select public.delete_next_step(%L) $$, current_setting('tests.roster')),
  'P0001', 'Next step not found',
  'deleting a step twice is refused');
select tests.clear_authentication();

select * from finish();
rollback;
