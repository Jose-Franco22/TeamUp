-- The creator changes a teammate's role: 31_set_member_role.sql.
begin;
select plan(17);

select set_config('tests.owner',    tests.sign_in_with_microsoft('owner01@utrgv.edu', 'Owner')::text, true);
select set_config('tests.member',   tests.sign_in_with_microsoft('member01@utrgv.edu', 'Member')::text, true);
select set_config('tests.outsider', tests.sign_in_with_microsoft('outsider01@utrgv.edu', 'Outsider')::text, true);
select set_config('tests.r_pm', (select id from public.roles where name = 'Project Manager')::text, true);
select set_config('tests.r_fe', (select id from public.roles where name = 'Frontend Developer')::text, true);
select set_config('tests.r_be', (select id from public.roles where name = 'Backend Developer')::text, true);
select set_config('tests.s_react', (select id from public.skills where name = 'React')::text, true);
select set_config('tests.s_pg', (select id from public.skills where name = 'PostgreSQL')::text, true);

-- Created before the first authenticate_as: the `authenticated` role has no
-- CREATE on the tests schema.
create or replace function tests.seats_open(p_role_id uuid)
returns int language sql security definer set search_path = '' as $$
  select coalesce((select quantity_needed from public.project_roles_needed
                    where project_id = current_setting('tests.project')::uuid
                      and role_id = p_role_id), -1)::int;
$$;
create or replace function tests.role_of(p_user_id uuid)
returns uuid language sql security definer set search_path = '' as $$
  select role_id from public.team_members where user_id = p_user_id;
$$;
grant execute on function tests.seats_open(uuid), tests.role_of(uuid) to authenticated, anon;

-- A team of four: the owner as Project Manager (not advertised), recruiting
-- two Frontend and one Backend. The member is accepted as Frontend.
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
select tests.authenticate_as(current_setting('tests.member')::uuid);
select set_config('tests.request',
  (public.create_join_request(current_setting('tests.project')::uuid)).id::text, true);
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select public.respond_to_join_request(current_setting('tests.request')::uuid, 'accepted', current_setting('tests.r_fe')::uuid);
select tests.clear_authentication();

select is(tests.seats_open(current_setting('tests.r_fe')::uuid), 1, 'setup: one Frontend seat left after the accept');

-- --- Who may change a role ---------------------------------------------------
select throws_ok(
  $$ select public.set_member_role(current_setting('tests.member')::uuid, current_setting('tests.r_be')::uuid) $$,
  'P0001', 'Not signed in',
  'a guest can''t change a role');

select tests.authenticate_as(current_setting('tests.outsider')::uuid);
select throws_ok(
  $$ select public.set_member_role(current_setting('tests.member')::uuid, current_setting('tests.r_be')::uuid) $$,
  'P0001', 'Only the project creator can change roles',
  'a student who isn''t on the team can''t change a role');

select tests.authenticate_as(current_setting('tests.member')::uuid);
select throws_ok(
  $$ select public.set_member_role(current_setting('tests.member')::uuid, current_setting('tests.r_be')::uuid) $$,
  'P0001', 'Only the project creator can change roles',
  'a member can''t change their own role');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_ok(
  $$ select public.set_member_role(current_setting('tests.member')::uuid, gen_random_uuid()) $$,
  'P0001', 'Pick a role',
  'an unknown role is refused');
select throws_ok(
  $$ select public.set_member_role(current_setting('tests.member')::uuid, null) $$,
  'P0001', 'Pick a role',
  'no role is refused');
select throws_ok(
  $$ select public.set_member_role(current_setting('tests.outsider')::uuid, current_setting('tests.r_be')::uuid) $$,
  'P0001', 'That student is not on a team',
  'a student on no team is refused');
select tests.clear_authentication();

select is(tests.role_of(current_setting('tests.member')::uuid), current_setting('tests.r_fe')::uuid,
  'the refused changes left the member''s role alone');

-- --- Between two listed roles, the open seats swap -------------------------
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.set_member_role(current_setting('tests.member')::uuid, current_setting('tests.r_be')::uuid) $$,
  'the creator moves a teammate from Frontend to Backend');
select tests.clear_authentication();

select is(tests.role_of(current_setting('tests.member')::uuid), current_setting('tests.r_be')::uuid,
  'the teammate is now Backend');
select is(tests.seats_open(current_setting('tests.r_fe')::uuid), 2, 'Frontend gets its seat back');
select is(tests.seats_open(current_setting('tests.r_be')::uuid), 0, 'and Backend''s seat is taken');

-- --- To a role with no seat open, nothing is given back --------------------
-- Otherwise the team would advertise a Backend seat it doesn't have.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.set_member_role(current_setting('tests.member')::uuid, current_setting('tests.r_pm')::uuid) $$,
  'the creator moves the teammate to a role the project doesn''t list');
select tests.clear_authentication();

select is(tests.seats_open(current_setting('tests.r_be')::uuid), 0,
  'Backend stays at 0: nothing was taken, so nothing is given back');
select is(tests.seats_open(current_setting('tests.r_fe')::uuid), 2, 'and Frontend is unchanged');

-- --- The creator's own role --------------------------------------------------
-- Project Manager was never advertised, so moving off it gives nothing back
-- and takes no Frontend seat.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.set_member_role(current_setting('tests.owner')::uuid, current_setting('tests.r_fe')::uuid) $$,
  'the creator can change their own role');
select tests.clear_authentication();

select is(tests.seats_open(current_setting('tests.r_fe')::uuid), 2,
  'moving from an unlisted role leaves Frontend''s open seats alone');

select * from finish();
rollback;
