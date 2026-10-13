-- Issue #37: counts, exact unplaced membership, details and server authorization.
begin;
select plan(33);

select set_config('tests.admin', tests.sign_in_with_microsoft('instructor01@utrgv.edu', 'Instructor')::text, true);
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.snapshot', public.admin_dashboard()::text, true);
select is(current_setting('tests.snapshot')::jsonb->'teams', '[]'::jsonb, 'no teams produces an empty list');
select is(current_setting('tests.snapshot')::jsonb->'unplaced_students', '[]'::jsonb, 'instructor is not an unplaced student');
select is(current_setting('tests.snapshot')::jsonb->'summary',
  '{"formed_teams":0,"open_teams":0,"unplaced_students":0}'::jsonb, 'empty dashboard has zero counts');

select tests.clear_authentication();
select set_config('tests.open_owner', tests.sign_in_with_microsoft('open01@utrgv.edu', 'Open Owner')::text, true);
select set_config('tests.full_owner', tests.sign_in_with_microsoft('full01@utrgv.edu', 'Full Owner')::text, true);
select set_config('tests.member', tests.sign_in_with_microsoft('member01@utrgv.edu', 'Member')::text, true);
select set_config('tests.applicant', tests.sign_in_with_microsoft('applicant01@utrgv.edu', 'Applicant')::text, true);
select set_config('tests.quiet', tests.sign_in_with_microsoft('quiet01@utrgv.edu', 'Quiet Student')::text, true);
select set_config('tests.pm', (select id from public.roles where name = 'Project Manager')::text, true);
select set_config('tests.be', (select id from public.roles where name = 'Backend Developer')::text, true);
insert into public.user_skills (user_id, skill_id, source)
select current_setting('tests.applicant')::uuid, id, 'manual' from public.skills where name = 'React';

select tests.authenticate_as(current_setting('tests.open_owner')::uuid);
select set_config('tests.open_project', (select (public.create_project(
  'Open project', 'A project still recruiting.', 3::smallint, current_setting('tests.pm')::uuid,
  jsonb_build_array(jsonb_build_object('role_id', current_setting('tests.be'), 'quantity_needed', 1))
)).id::text), true);
select set_config('tests.open_team', (select id::text from public.teams where project_id = current_setting('tests.open_project')::uuid), true);

select tests.authenticate_as(current_setting('tests.full_owner')::uuid);
select set_config('tests.full_project', (select (public.create_project(
  'Full project', 'A project with a completed roster.', 2::smallint, current_setting('tests.pm')::uuid,
  jsonb_build_array(jsonb_build_object('role_id', current_setting('tests.be'), 'quantity_needed', 1))
)).id::text), true);
select set_config('tests.full_team', (select id::text from public.teams where project_id = current_setting('tests.full_project')::uuid), true);

-- A declined request and an accepted request must not appear as pending.
select tests.authenticate_as(current_setting('tests.applicant')::uuid);
select set_config('tests.declined', (select (public.create_join_request(current_setting('tests.full_project')::uuid)).id::text), true);
select tests.authenticate_as(current_setting('tests.full_owner')::uuid);
select public.respond_to_join_request(current_setting('tests.declined')::uuid, 'declined');
select tests.authenticate_as(current_setting('tests.member')::uuid);
select set_config('tests.accepted', (select (public.create_join_request(current_setting('tests.full_project')::uuid)).id::text), true);
select tests.authenticate_as(current_setting('tests.full_owner')::uuid);
select public.respond_to_join_request(current_setting('tests.accepted')::uuid, 'accepted', current_setting('tests.be')::uuid);
select tests.authenticate_as(current_setting('tests.applicant')::uuid);
select set_config('tests.pending', (select (public.create_join_request(current_setting('tests.open_project')::uuid)).id::text), true);

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.snapshot', public.admin_dashboard()::text, true);
select is((current_setting('tests.snapshot')::jsonb#>>'{summary,formed_teams}')::int, 1, 'one team has formed');
select is((current_setting('tests.snapshot')::jsonb#>>'{summary,open_teams}')::int, 1, 'one team remains open');
select is((current_setting('tests.snapshot')::jsonb#>>'{summary,unplaced_students}')::int, 2, 'two students are unplaced');
select is(jsonb_array_length(current_setting('tests.snapshot')::jsonb->'teams'), 2, 'all teams are listed');
select is(
  (select array_agg(s->>'id' order by s->>'id') from jsonb_array_elements(current_setting('tests.snapshot')::jsonb->'unplaced_students') s),
  (select array_agg(id order by id) from unnest(array[current_setting('tests.applicant'), current_setting('tests.quiet')]) ids(id)),
  'unplaced contains exactly the non-admin users without any team_members row');

select set_config('tests.student', public.admin_student_details(current_setting('tests.applicant')::uuid)::text, true);
select is(current_setting('tests.student')::jsonb->>'name', 'Applicant', 'student details identify the selected student');
select is(current_setting('tests.student')::jsonb->'membership', 'null'::jsonb, 'an unplaced student has no membership');
select is(jsonb_array_length(current_setting('tests.student')::jsonb->'pending_requests'), 1, 'declined requests are omitted');
select is(current_setting('tests.student')::jsonb#>>'{pending_requests,0,id}', current_setting('tests.pending'), 'the pending request is preserved');
select is(current_setting('tests.student')::jsonb#>>'{pending_requests,0,team_id}', current_setting('tests.open_team'), 'pending request links to the correct team');
select is(current_setting('tests.student')::jsonb#>>'{skills,0,name}', 'React', 'student details include skills');
select is(public.admin_student_details(current_setting('tests.quiet')::uuid)->'pending_requests', '[]'::jsonb,
  'unplaced student without requests is retained with an empty request list');
select is(public.admin_student_details(current_setting('tests.member')::uuid)#>>'{membership,team_id}', current_setting('tests.full_team'),
  'a placed student can also be opened with their current team');

select set_config('tests.team', public.admin_team_details(current_setting('tests.full_team')::uuid)::text, true);
select is(current_setting('tests.team')::jsonb->>'status', 'full', 'formed team details show full status');
select is((current_setting('tests.team')::jsonb->>'member_count')::int, 2, 'filled seats match the roster');
select is(jsonb_array_length(current_setting('tests.team')::jsonb->'members'), 2, 'admin can see every team member');
select is(current_setting('tests.team')::jsonb#>>'{members,1,role_name}', 'Backend Developer', 'member roles are included');
select is(current_setting('tests.team')::jsonb->'pending_requests', '[]'::jsonb, 'accepted and declined requests are omitted from team pending list');
select is(public.admin_team_details(current_setting('tests.open_team')::uuid)#>>'{roles_needed,0,role_name}', 'Backend Developer', 'open roles are included');

select throws_ok($$ select public.admin_team_details('00000000-0000-0000-0000-000000000000') $$,
  'P0002', 'Team not found', 'missing team is reported');
select throws_ok($$ select public.admin_student_details(current_setting('tests.admin')::uuid) $$,
  'P0002', 'Student not found', 'an instructor is not exposed as a student');
select throws_ok($$ select public.admin_student_details('00000000-0000-0000-0000-000000000000') $$,
  'P0002', 'Student not found', 'missing student is reported');

select tests.authenticate_as(current_setting('tests.applicant')::uuid);
select throws_ok($$ select public.admin_dashboard() $$, '42501', 'Admin access required', 'student cannot fetch the dashboard');
select throws_ok($$ select public.admin_team_details(current_setting('tests.full_team')::uuid) $$,
  '42501', 'Admin access required', 'student cannot call the admin team view');
select throws_ok($$ select public.admin_student_details(current_setting('tests.quiet')::uuid) $$,
  '42501', 'Admin access required', 'student cannot call the admin student view');
select throws_ok($$ select private.admin_team_json(current_setting('tests.full_team')::uuid) $$,
  '42501', 'permission denied for function admin_team_json', 'student cannot bypass the guard through an internal builder');

-- Counts follow real membership changes instead of being hardcoded.
select tests.authenticate_as(current_setting('tests.member')::uuid);
select public.leave_team();
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select is(public.admin_dashboard()->'summary', '{"formed_teams":0,"open_teams":2,"unplaced_students":3}'::jsonb,
  'leaving a full team reopens it and updates all dashboard counts');

select tests.clear_authentication();
set local role anon;
select throws_ok($$ select public.admin_dashboard() $$, '42501', 'permission denied for function admin_dashboard', 'guest cannot execute the dashboard RPC');
select throws_ok($$ select public.admin_team_details(current_setting('tests.full_team')::uuid) $$,
  '42501', 'permission denied for function admin_team_details', 'guest cannot execute team details');
select throws_ok($$ select public.admin_student_details(current_setting('tests.quiet')::uuid) $$,
  '42501', 'permission denied for function admin_student_details', 'guest cannot execute student details');

reset role;
select * from finish();
rollback;
