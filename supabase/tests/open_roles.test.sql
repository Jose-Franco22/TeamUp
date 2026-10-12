-- Issue #31 — project_roles_needed tracks what is *still* open.
--
-- Before 15_release_filled_roles.sql it recorded the seats the creator asked
-- for and nothing ever touched it again, so a filled role kept being
-- advertised on Browse and the matching engine kept scoring students against
-- it. Everything below runs through the SECURITY DEFINER functions, which is
-- the only way the app ever writes these tables.
begin;
select plan(21);

select set_config('tests.owner', tests.sign_in_with_microsoft('owner01@utrgv.edu', 'Owner')::text, true);
select set_config('tests.alice', tests.sign_in_with_microsoft('alice01@utrgv.edu', 'Alice')::text, true);
select set_config('tests.bob',   tests.sign_in_with_microsoft('bob01@utrgv.edu',   'Bob')::text, true);

select set_config('tests.r_pm', (select id from public.roles where name = 'Project Manager')::text, true);
select set_config('tests.r_fe', (select id from public.roles where name = 'Frontend Developer')::text, true);
select set_config('tests.r_be', (select id from public.roles where name = 'Backend Developer')::text, true);
select set_config('tests.s_react', (select id from public.skills where name = 'React')::text, true);
select set_config('tests.s_pg', (select id from public.skills where name = 'PostgreSQL')::text, true);

-- A small helper so the assertions below read as what Browse would show.
-- Created before the first authenticate_as: the `authenticated` role has no
-- CREATE on the tests schema.
create or replace function tests.still_open(p_role_id uuid)
returns int language sql as $$
  select coalesce((select quantity_needed from public.project_roles_needed
                    where project_id = current_setting('tests.project')::uuid
                      and role_id = p_role_id), -1)::int;
$$;

grant execute on function tests.still_open(uuid) to authenticated;

-- A team of four: the owner as PM, recruiting two Frontend and one Backend.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select set_config(
  'tests.project',
  (select (public.create_project(
     'Campus parking tracker',
     'Live lot occupancy from camera feeds.',
     4::smallint,
     current_setting('tests.r_pm')::uuid,
     jsonb_build_array(
       jsonb_build_object('role_id', current_setting('tests.r_fe'), 'skill_id', current_setting('tests.s_react'), 'quantity_needed', 2),
       jsonb_build_object('role_id', current_setting('tests.r_be'), 'skill_id', current_setting('tests.s_pg'),    'quantity_needed', 1)
     )
   )).id::text),
  true);

select is(tests.still_open(current_setting('tests.r_fe')::uuid), 2, 'the project starts out wanting two Frontend Developers');
select is(tests.still_open(current_setting('tests.r_be')::uuid), 1, 'and one Backend Developer');

-- --- the creator's own seat is not one of the advertised ones -----------
select is(
  (select count(*)::int from public.team_members tm
     join public.teams t on t.id = tm.team_id
    where t.project_id = current_setting('tests.project')::uuid),
  1,
  'the creator is seated on their own team');
select is(tests.still_open(current_setting('tests.r_pm')::uuid), -1,
  'and their own role was never advertised, so nothing was decremented for it');

-- --- declining changes nothing ------------------------------------------

select tests.authenticate_as(current_setting('tests.alice')::uuid);
select set_config('tests.req_alice',
  (select (public.create_join_request(current_setting('tests.project')::uuid)).id::text), true);

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.respond_to_join_request(current_setting('tests.req_alice')::uuid, 'declined') $$,
  'a request can be declined');
select is(tests.still_open(current_setting('tests.r_fe')::uuid), 2,
  'declining leaves the open roles alone');

-- --- accepting fills one seat -------------------------------------------

select tests.authenticate_as(current_setting('tests.alice')::uuid);
select set_config('tests.req_alice2',
  (select (public.create_join_request(current_setting('tests.project')::uuid)).id::text), true);

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.respond_to_join_request(
       current_setting('tests.req_alice2')::uuid, 'accepted', current_setting('tests.r_fe')::uuid) $$,
  'the creator accepts Alice as a Frontend Developer');
select is(tests.still_open(current_setting('tests.r_fe')::uuid), 1,
  'one Frontend seat is taken, so one is still open');
select is(tests.still_open(current_setting('tests.r_be')::uuid), 1,
  'the Backend role is untouched');

-- --- the last seat in a role leaves the row at zero, not deleted --------
-- Deleting it would throw away skill_id, and a member leaving could then
-- only restore the role without the skill that was pinned to it.

select tests.authenticate_as(current_setting('tests.bob')::uuid);
select set_config('tests.req_bob',
  (select (public.create_join_request(current_setting('tests.project')::uuid)).id::text), true);

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.respond_to_join_request(
       current_setting('tests.req_bob')::uuid, 'accepted', current_setting('tests.r_fe')::uuid) $$,
  'the creator accepts Bob into the second Frontend seat');
select is(tests.still_open(current_setting('tests.r_fe')::uuid), 0,
  'no Frontend seats are left');
select is(
  (select skill_id from public.project_roles_needed
    where project_id = current_setting('tests.project')::uuid
      and role_id = current_setting('tests.r_fe')::uuid),
  current_setting('tests.s_react')::uuid,
  'and the skill pinned to the role survived, because the row was kept');

-- --- it never goes negative ---------------------------------------------
-- There is no third Frontend seat to take: team_size_target is 4 and the
-- team is full, so the guard is asserted directly on the helper.

select tests.clear_authentication();
select lives_ok(
  $$ select public.release_project_role(
       current_setting('tests.project')::uuid, current_setting('tests.r_fe')::uuid) $$,
  'releasing a role that is already empty does not error');
select is(tests.still_open(current_setting('tests.r_fe')::uuid), 0,
  'and it does not go negative');

-- --- removing a member reopens their seat -------------------------------

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.remove_member(current_setting('tests.bob')::uuid) $$,
  'the creator removes Bob');
select is(tests.still_open(current_setting('tests.r_fe')::uuid), 1,
  'his Frontend seat is open again');

-- --- leaving reopens it too ---------------------------------------------

select tests.authenticate_as(current_setting('tests.alice')::uuid);
select lives_ok($$ select public.leave_team() $$, 'Alice leaves the team');
select is(tests.still_open(current_setting('tests.r_fe')::uuid), 2,
  'both Frontend seats are open again');

-- --- a role nobody advertised is not invented ---------------------------
-- The creator holds Project Manager, which was never in project_roles_needed.
-- Restoring it must not add a row offering a role with no skill attached
-- that the creator never asked for.

select tests.clear_authentication();
select lives_ok(
  $$ select public.restore_project_role(
       current_setting('tests.project')::uuid, current_setting('tests.r_pm')::uuid) $$,
  'restoring a role the project never listed does not error');
select is(tests.still_open(current_setting('tests.r_pm')::uuid), -1,
  'and it does not invent one');

-- --- students cannot drive the counters by hand -------------------------
-- The helpers are internal: the functions above have already decided who is
-- allowed to do this.

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_ok(
  $$ select public.release_project_role(
       current_setting('tests.project')::uuid, current_setting('tests.r_be')::uuid) $$,
  '42501', null,
  'a signed-in student cannot release a role directly');

select * from finish();
rollback;
