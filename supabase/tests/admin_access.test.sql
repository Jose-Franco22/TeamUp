-- Issue #36: exercise real database permissions as API roles, never just UI flags.
begin;
select plan(31);

select set_config('tests.admin', tests.sign_in_with_microsoft('instructor01@utrgv.edu', 'Instructor')::text, true);
select set_config('tests.owner', tests.sign_in_with_microsoft('owner01@utrgv.edu', 'Owner')::text, true);
select set_config('tests.other', tests.sign_in_with_microsoft('other01@utrgv.edu', 'Other Owner')::text, true);
select set_config('tests.seeker', tests.sign_in_with_microsoft('seeker01@utrgv.edu', 'Seeker')::text, true);
select set_config('tests.role', (select id from public.roles where name = 'Project Manager')::text, true);

select is((select is_admin from public.users where id = current_setting('tests.owner')::uuid),
  false, 'newly provisioned accounts are students');
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;
insert into public.user_skills (user_id, skill_id, source)
select current_setting('tests.admin')::uuid, id, 'manual' from public.skills where name = 'React';
update auth.identities set identity_data = identity_data || '{"name":"Instructor Updated"}'::jsonb
where user_id = current_setting('tests.admin')::uuid;
select is((select is_admin from public.users where id = current_setting('tests.admin')::uuid),
  true, 'signing in again does not overwrite an instructor role');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select set_config('tests.project', (select (public.create_project(
  'First team', 'A student-owned project.', 2::smallint, current_setting('tests.role')::uuid, '[]'::jsonb
)).id::text), true);
select tests.authenticate_as(current_setting('tests.other')::uuid);
select set_config('tests.other_project', (select (public.create_project(
  'Second team', 'Another student-owned project.', 2::smallint, current_setting('tests.role')::uuid, '[]'::jsonb
)).id::text), true);
select tests.authenticate_as(current_setting('tests.seeker')::uuid);
select public.create_join_request(current_setting('tests.project')::uuid);

-- Admins read all teams, rosters and requests through RLS.
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok($$ select public.require_admin() $$, 'an admin passes the server guard');
select is((select count(*)::int from public.teams), 2, 'admin can read every team');
select is((select count(*)::int from public.team_members), 2, 'admin can read every roster');
select is((select count(*)::int from public.join_requests), 1, 'admin can read requests on other users projects');
select is((select count(*)::int from public.team_members where user_id = current_setting('tests.admin')::uuid),
  0, 'admin does not appear on student rosters');
select throws_ok($$ update public.users set is_admin = false where id = auth.uid() $$,
  '42501', 'Admin access can only be changed by a database administrator',
  'even an admin cannot change their role through the browser');
select throws_ok($$ select public.create_project(
  'Admin project', 'An admin must not be seated.', 2::smallint, current_setting('tests.role')::uuid, '[]'::jsonb
) $$, '42501', 'Admin accounts cannot create or join student teams', 'admin cannot create a student project');
select throws_ok($$ select public.create_join_request(current_setting('tests.project')::uuid) $$,
  '42501', 'Admin accounts cannot create or join student teams', 'admin cannot request a student seat');

-- Student participation and profile editing still work; privilege changes do not.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_ok($$ select public.require_admin() $$, '42501', 'Admin access required',
  'the admin-only RPC rejects a student');
select throws_ok($$ update public.users set is_admin = true where id = auth.uid() $$,
  '42501', 'Admin access can only be changed by a database administrator', 'student cannot promote themself');
select is((select is_admin from public.users where id = auth.uid()), false, 'failed promotion leaves the flag false');
select lives_ok($$ update public.users set bio = 'Updated profile' where id = auth.uid() $$,
  'regular profile updates are allowed');
select is((select count(*)::int from public.users where id = current_setting('tests.admin')::uuid),
  0, 'student Browse and matching queries cannot select instructor profiles');
select is((select count(*)::int from public.user_skills where user_id = current_setting('tests.admin')::uuid),
  0, 'student matching queries cannot read instructor skills');
select is((select count(*)::int from public.team_members), 1, 'student can read their own roster only');
select is((select count(*)::int from public.team_members tm join public.teams t on t.id = tm.team_id
  where t.project_id = current_setting('tests.other_project')::uuid), 0, 'other teams raw membership rows stay private');
select is((select count(*)::int from public.join_requests), 1, 'owner can still see incoming requests');
select is((select member_count from public.project_recruiting_stats(current_setting('tests.other_project')::uuid)),
  1, 'Browse still gets accurate counts for another team');

select tests.authenticate_as(current_setting('tests.other')::uuid);
select is((select count(*)::int from public.join_requests), 0, 'unrelated student cannot read another projects requests');
select tests.authenticate_as(current_setting('tests.seeker')::uuid);
select is((select count(*)::int from public.join_requests), 1, 'seeker still sees their own request');
select is((select count(*)::int from public.team_members), 0, 'unplaced seeker cannot dump all rosters');

-- The table triggers also protect writes by SECURITY DEFINER functions.
select tests.clear_authentication();
select throws_ok($$ insert into public.team_members (team_id, user_id, role_id)
  select id, current_setting('tests.admin')::uuid, current_setting('tests.role')::uuid from public.teams
   where project_id = current_setting('tests.project')::uuid $$,
  '42501', 'Admin accounts cannot create or join student teams', 'even privileged roster writes cannot seat an admin');
select throws_ok($$ update public.users set is_admin = true where id = current_setting('tests.owner')::uuid $$,
  '23514', 'Remove student memberships, projects and pending requests before granting admin access',
  'promotion cannot leave an admin owning a project or on a roster');
select throws_ok($$ update public.users set is_admin = true where id = current_setting('tests.seeker')::uuid $$,
  '23514', 'Remove student memberships, projects and pending requests before granting admin access',
  'promotion cannot leave an admin with an active join request');
set local role service_role;
select lives_ok($$ update public.users set is_admin = false where id = current_setting('tests.admin')::uuid $$,
  'the trusted service role can change admin access');
reset role;

-- Guests get public recruiting counts, not private data or admin RPC access.
set local role anon;
select throws_ok($$ select public.require_admin() $$, '42501', 'permission denied for function require_admin',
  'guest cannot execute admin functions');
select is((select count(*)::int from public.team_members), 0, 'guest cannot read rosters');
select is((select member_count from public.project_recruiting_stats(current_setting('tests.project')::uuid)),
  1, 'guest sees the public seat count');
select is((select avg_availability_hours from public.project_recruiting_stats(current_setting('tests.project')::uuid)),
  null::integer, 'guest gets no private availability data');

reset role;
select * from finish();
rollback;
