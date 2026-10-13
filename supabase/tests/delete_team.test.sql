-- Issue #25 — delete_team() removes a project, and only in the one case
-- where that is safe.
--
-- Deleting is irreversible and takes the project, its team, its open roles
-- and every request anyone sent it. The UI asks for confirmation, but the UI
-- is not the boundary: anyone signed in can call this function directly.
begin;
select plan(22);

select set_config('tests.owner',    tests.sign_in_with_microsoft('owner25@utrgv.edu', 'Owner')::text, true);
select set_config('tests.joiner',   tests.sign_in_with_microsoft('joiner25@utrgv.edu', 'Joiner')::text, true);
select set_config('tests.asker',    tests.sign_in_with_microsoft('asker25@utrgv.edu', 'Asker')::text, true);
select set_config('tests.stranger', tests.sign_in_with_microsoft('stranger25@utrgv.edu', 'Stranger')::text, true);

select set_config('tests.r_pm', (select id from public.roles where name = 'Project Manager')::text, true);
select set_config('tests.r_fe', (select id from public.roles where name = 'Frontend Developer')::text, true);
select set_config('tests.s_react', (select id from public.skills where name = 'React')::text, true);

create or replace function tests.make_project()
returns uuid language plpgsql as $$
declare v public.projects;
begin
  v := public.create_project(
    'Campus parking tracker',
    'Live lot occupancy estimated from existing camera feeds, with a map.',
    4::smallint,
    current_setting('tests.r_pm')::uuid,
    jsonb_build_array(jsonb_build_object(
      'role_id', current_setting('tests.r_fe'),
      'skill_id', current_setting('tests.s_react'),
      'quantity_needed', 2)));
  return v.id;
end;
$$;
grant execute on function tests.make_project() to authenticated;

create or replace function tests.team_of(p_project uuid)
returns uuid language sql as $$
  select id from public.teams where project_id = p_project;
$$;
grant execute on function tests.team_of(uuid) to authenticated;

-- --- the creator, alone, can delete --------------------------------------

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select set_config('tests.project', tests.make_project()::text, true);
select set_config('tests.team', tests.team_of(current_setting('tests.project')::uuid)::text, true);

-- Someone asks to join, so the cascade has a request to take with it.
select tests.authenticate_as(current_setting('tests.asker')::uuid);
select set_config('tests.req',
  (select (public.create_join_request(current_setting('tests.project')::uuid)).id::text), true);

select tests.clear_authentication();
select is((select count(*)::int from public.projects where id = current_setting('tests.project')::uuid), 1,
  'the project exists before the delete');
select is((select count(*)::int from public.teams where id = current_setting('tests.team')::uuid), 1,
  'and so does its team');
select is((select count(*)::int from public.project_roles_needed
            where project_id = current_setting('tests.project')::uuid), 1,
  'and the role it is recruiting for');
select is((select count(*)::int from public.join_requests where id = current_setting('tests.req')::uuid), 1,
  'and the request someone sent it');
select is((select count(*)::int from public.team_members
            where team_id = current_setting('tests.team')::uuid), 1,
  'with only the creator seated');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.delete_team(current_setting('tests.team')::uuid) $$,
  'the creator deletes their own team while they are the only member');

-- --- everything hanging off the project goes with it ---------------------

select tests.clear_authentication();
select is((select count(*)::int from public.projects where id = current_setting('tests.project')::uuid), 0,
  'the project is gone');
select is((select count(*)::int from public.teams where id = current_setting('tests.team')::uuid), 0,
  'the team is gone');
select is((select count(*)::int from public.project_roles_needed
            where project_id = current_setting('tests.project')::uuid), 0,
  'the open roles are gone');
select is((select count(*)::int from public.join_requests where id = current_setting('tests.req')::uuid), 0,
  'the pending request is gone, so nobody is left waiting on a project that does not exist');
select is((select count(*)::int from public.team_members
            where team_id = current_setting('tests.team')::uuid), 0,
  'the roster is gone');

-- The people are not: deleting a project must not delete its members.
select is((select count(*)::int from public.users where id = current_setting('tests.owner')::uuid), 1,
  'the creator still exists');
select is((select count(*)::int from public.users where id = current_setting('tests.asker')::uuid), 1,
  'and so does the student who had asked to join');

-- --- the creator is free afterwards --------------------------------------

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok($$ select tests.make_project() $$,
  'and the creator can start a new project, since they are no longer on a team');
select set_config('tests.project', (select id::text from public.projects
  where creator_id = current_setting('tests.owner')::uuid), true);
select set_config('tests.team', tests.team_of(current_setting('tests.project')::uuid)::text, true);

-- --- nobody else may delete it -------------------------------------------

select tests.authenticate_as(current_setting('tests.stranger')::uuid);
select throws_like(
  $$ select public.delete_team(current_setting('tests.team')::uuid) $$,
  '%Only the team owner can delete this team%',
  'a student with nothing to do with the project cannot delete it');
select is((select count(*)::int from public.projects where id = current_setting('tests.project')::uuid), 1,
  'and the project is still there');

-- --- not once somebody else has joined -----------------------------------

select tests.authenticate_as(current_setting('tests.joiner')::uuid);
select set_config('tests.req2',
  (select (public.create_join_request(current_setting('tests.project')::uuid)).id::text), true);
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.respond_to_join_request(
       current_setting('tests.req2')::uuid, 'accepted', current_setting('tests.r_fe')::uuid) $$,
  'the creator accepts someone onto the team');

select throws_like(
  $$ select public.delete_team(current_setting('tests.team')::uuid) $$,
  '%Remove everyone else from the team before deleting it%',
  'the creator cannot delete it while another member is on it');

-- A member of the team is still not the owner.
select tests.authenticate_as(current_setting('tests.joiner')::uuid);
select throws_like(
  $$ select public.delete_team(current_setting('tests.team')::uuid) $$,
  '%Only the team owner can delete this team%',
  'and the member who joined cannot delete it either');

-- --- removing them makes it deletable again ------------------------------

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.remove_member(current_setting('tests.joiner')::uuid) $$,
  'the creator removes the other member');
select lives_ok(
  $$ select public.delete_team(current_setting('tests.team')::uuid) $$,
  'and can now delete the team');

-- --- a team that is not there --------------------------------------------

select throws_like(
  $$ select public.delete_team(gen_random_uuid()) $$,
  '%Team not found%',
  'deleting a team that does not exist is an error, not a silent no-op');

select * from finish();
rollback;
