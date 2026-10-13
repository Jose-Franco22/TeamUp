-- Issue #23 — create_project() is the real boundary.
--
-- The form validates the same rules (frontend/src/lib/validation.js), but
-- that is a convenience: anyone signed in can call this function directly
-- with their session and skip the form entirely. Everything the form
-- refuses, this has to refuse too.
--
-- Runs as a signed-in student throughout, the same path supabase-js takes.
begin;
select plan(33);

select set_config('tests.owner', tests.sign_in_with_microsoft('builder01@utrgv.edu', 'Builder')::text, true);
select set_config('tests.other', tests.sign_in_with_microsoft('seeker01@utrgv.edu', 'Seeker')::text, true);
select set_config('tests.third', tests.sign_in_with_microsoft('third01@utrgv.edu', 'Third')::text, true);

select set_config('tests.fresh', tests.sign_in_with_microsoft('fresh01@utrgv.edu', 'Fresh')::text, true);
select set_config('tests.sneaky', tests.sign_in_with_microsoft('sneaky01@utrgv.edu', 'Sneaky')::text, true);
select set_config('tests.r_pm', (select id from public.roles where name = 'Project Manager')::text, true);
select set_config('tests.r_fe', (select id from public.roles where name = 'Frontend Developer')::text, true);
select set_config('tests.r_be', (select id from public.roles where name = 'Backend Developer')::text, true);
select set_config('tests.r_data', (select id from public.roles where name = 'Data / ML')::text, true);
select set_config('tests.s_react', (select id from public.skills where name = 'React')::text, true);
select set_config('tests.s_python', (select id from public.skills where name = 'Python')::text, true);

-- Builds the jsonb argument the client sends, so the tests read like calls.
create or replace function tests.role_rows(variadic p_rows jsonb[])
returns jsonb language sql as $$ select coalesce(jsonb_agg(r), '[]'::jsonb) from unnest(p_rows) r; $$;
grant execute on function tests.role_rows(jsonb[]) to authenticated;

create or replace function tests.role_row(p_role_id text, p_skill_id text, p_qty int)
returns jsonb language sql as $$
  select jsonb_build_object('role_id', p_role_id, 'skill_id', p_skill_id, 'quantity_needed', p_qty);
$$;
grant execute on function tests.role_row(text, text, int) to authenticated;

create or replace function tests.make(p_title text, p_description text default 'A description that is comfortably longer than twenty characters.')
returns void language plpgsql as $$
begin
  perform public.create_project(
    p_title, p_description, 4::smallint,
    current_setting('tests.r_pm')::uuid,
    '[]'::jsonb);
end;
$$;
grant execute on function tests.make(text, text) to authenticated;

create or replace function tests.make_sized(p_size int, p_roles jsonb default '[]'::jsonb)
returns void language plpgsql as $$
begin
  perform public.create_project(
    'A perfectly fine title',
    'A description that is comfortably longer than twenty characters.',
    p_size::smallint,
    current_setting('tests.r_pm')::uuid,
    p_roles);
end;
$$;
grant execute on function tests.make_sized(int, jsonb) to authenticated;

select set_config('tests.good_roles',
  tests.role_rows(tests.role_row(current_setting('tests.r_fe'), current_setting('tests.s_react'), 2))::text,
  true);

select tests.authenticate_as(current_setting('tests.owner')::uuid);

-- --- the happy path ------------------------------------------------------

select lives_ok(
  $$ select public.create_project(
       'Campus parking tracker',
       'Live lot occupancy estimated from existing camera feeds, with a map.',
       4::smallint,
       current_setting('tests.r_pm')::uuid,
       current_setting('tests.good_roles')::jsonb) $$,
  'a valid project is created');

select set_config('tests.project',
  (select id::text from public.projects where creator_id = current_setting('tests.owner')::uuid), true);

select isnt(current_setting('tests.project'), '', 'the project row exists');
select is(
  (select count(*)::int from public.teams where project_id = current_setting('tests.project')::uuid),
  1,
  'a team was created for it');
select is(
  (select tm.role_id from public.team_members tm
     join public.teams t on t.id = tm.team_id
    where t.project_id = current_setting('tests.project')::uuid),
  current_setting('tests.r_pm')::uuid,
  'and the creator is seated in the role they picked');
select is(
  (select quantity_needed from public.project_roles_needed
    where project_id = current_setting('tests.project')::uuid),
  2::smallint,
  'the roles they are recruiting for were recorded');

-- --- title and description ----------------------------------------------
-- These were not checked at all before 16_project_validation.sql: the form
-- was the only thing standing between a one-character title and the table.

select tests.authenticate_as(current_setting('tests.other')::uuid);

select throws_like($$ select tests.make('abcd') $$,
  '%Title must be between 5 and 100 characters%', 'a 4-character title is rejected');
select throws_like($$ select tests.make(repeat('x', 101)) $$,
  '%Title must be between 5 and 100 characters%', 'a 101-character title is rejected');
select throws_like($$ select tests.make('   ab   ') $$,
  '%Title must be between 5 and 100 characters%', 'a title is measured after trimming');
select throws_like($$ select tests.make('') $$,
  '%Title must be between 5 and 100 characters%', 'an empty title is rejected');
select throws_like($$ select tests.make(null) $$,
  '%Title must be between 5 and 100 characters%', 'a null title is rejected, not stored');

select throws_like($$ select tests.make('Valid title', repeat('x', 19)) $$,
  '%Description must be between 20 and 2000 characters%', 'a 19-character description is rejected');
select throws_like($$ select tests.make('Valid title', repeat('x', 2001)) $$,
  '%Description must be between 20 and 2000 characters%', 'a 2001-character description is rejected');
select throws_like($$ select tests.make('Valid title', '') $$,
  '%Description must be between 20 and 2000 characters%', 'an empty description is rejected');

select lives_ok($$ select tests.make(repeat('x', 5), repeat('y', 20)) $$,
  'the shortest allowed title and description are accepted');

-- That one succeeded, so this caller now has a team. Checked here because
-- it is also the next rule under test.
select throws_like($$ select tests.make('Another project') $$,
  '%already on a team%', 'a caller who is already on a team cannot create another');

-- --- the stored row is the trimmed one ----------------------------------

select tests.authenticate_as(current_setting('tests.third')::uuid);
select lives_ok(
  $$ select tests.make('   Spaced out title   ', '   A description padded with spaces on both sides.   ') $$,
  'padded text is accepted once trimmed');
select is(
  (select title from public.projects where creator_id = current_setting('tests.third')::uuid),
  'Spaced out title',
  'and what is stored is the trimmed title, not the padding');

-- --- team size -----------------------------------------------------------

select tests.authenticate_as(current_setting('tests.fresh')::uuid);

select throws_like($$ select tests.make_sized(1) $$,
  '%A team has to be between 2 and 4 people%', 'a team of 1 is rejected');
select throws_like($$ select tests.make_sized(5) $$,
  '%A team has to be between 2 and 4 people%', 'a team of 5 is rejected');
select throws_like($$ select tests.make_sized(0) $$,
  '%A team has to be between 2 and 4 people%', 'a team of 0 is rejected');

-- --- the roles listed ----------------------------------------------------

select throws_like(
  $$ select tests.make_sized(4, tests.role_rows(
       tests.role_row(current_setting('tests.r_fe'), null, 1),
       tests.role_row(current_setting('tests.r_fe'), null, 1))) $$,
  '%You listed the same role twice%', 'the same role twice is rejected');

select throws_like(
  $$ select tests.make_sized(4, tests.role_rows(
       tests.role_row(gen_random_uuid()::text, null, 1))) $$,
  '%Unknown role%', 'a role that does not exist is rejected');

select throws_like(
  $$ select tests.make_sized(4, tests.role_rows(
       tests.role_row(current_setting('tests.r_fe'), current_setting('tests.s_python'), 1))) $$,
  '%That skill does not fit the role you picked%',
  'a skill from the wrong category for the role is rejected');

select throws_like(
  $$ select tests.make_sized(4, tests.role_rows(
       tests.role_row(current_setting('tests.r_fe'), gen_random_uuid()::text, 1))) $$,
  '%Unknown skill%', 'a skill that does not exist is rejected');

select throws_like(
  $$ select tests.make_sized(4, tests.role_rows(
       tests.role_row(null, null, 1))) $$,
  '%needs a role selected%', 'a row with no role is rejected');

select throws_like(
  $$ select tests.make_sized(4, tests.role_rows(
       tests.role_row(current_setting('tests.r_fe'), null, 0))) $$,
  '%Each role needs between 1 and 3 people%', 'a quantity of 0 is rejected');

-- A team of 4 is the creator plus 3, so 4 listed people is one too many.
select throws_like(
  $$ select tests.make_sized(4, tests.role_rows(
       tests.role_row(current_setting('tests.r_fe'), null, 2),
       tests.role_row(current_setting('tests.r_be'), null, 2))) $$,
  '%has 3 open seats besides you, but you listed 4 people%',
  'more listed people than open seats is rejected, with the arithmetic');

select throws_like(
  $$ select tests.make_sized(2, tests.role_rows(
       tests.role_row(current_setting('tests.r_fe'), null, 2))) $$,
  '%has 1 open seat besides you%',
  'and the message says "1 open seat", not "1 open seats"');

-- --- creating declines the caller's other pending requests ---------------

select tests.authenticate_as(current_setting('tests.fresh')::uuid);
select set_config('tests.req',
  (select (public.create_join_request(current_setting('tests.project')::uuid)).id::text), true);
select is(
  (select status from public.join_requests where id = current_setting('tests.req')::uuid),
  'pending',
  'the caller has a request out before they create anything');

select lives_ok($$ select tests.make_sized(3) $$, 'they create their own project instead');
select is(
  (select status from public.join_requests where id = current_setting('tests.req')::uuid),
  'declined',
  'and their pending request is declined, since they are now on a team');

-- --- the function is the only way in -------------------------------------
-- RLS has no insert policy for projects on purpose: "only create_project()
-- may do this". A student calling the table directly must be refused, or
-- every rule above is optional.

select tests.authenticate_as(current_setting('tests.sneaky')::uuid);

select throws_ok(
  $$ insert into public.projects (creator_id, title, description, team_size_target)
     values (auth.uid(), 'Bypassing the function entirely', 'A description long enough to pass the check.', 4) $$,
  '42501', null,
  'inserting into projects directly is blocked by RLS');

select throws_ok(
  $$ insert into public.project_roles_needed (project_id, role_id, quantity_needed)
     values (current_setting('tests.project')::uuid, current_setting('tests.r_be')::uuid, 1) $$,
  '42501', null,
  'and so is adding a role to someone else''s project');

select * from finish();
rollback;
