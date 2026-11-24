-- Issue #40 — who may export the rosters, and what each of them gets.
--
-- The spreadsheet itself is not here. 46_export_rosters.sql returns rows and
-- frontend/src/lib/rosterWorkbook.js turns them into the .xlsx, so what this
-- file tests is the part that would be a privacy bug rather than a layout
-- one: an export is a file that leaves the application and gets emailed
-- around, so the question "whose names are in it" has to be answered by the
-- database and not by whichever page called it.
--
-- Three scopes, and all three are here:
--
--   * an admin gets every team, every member and every unplaced student;
--   * an adviser gets the teams they actually advise, their members, and no
--     unplaced students at all;
--   * everybody else is refused, including somebody who has been *asked* to
--     advise and has not answered. A pending invitation is not advising.

begin;
select plan(39);

select set_config('tests.admin',     tests.sign_in_with_microsoft('instructor40@utrgv.edu', 'Instructor')::text, true);
select set_config('tests.owner_a',   tests.sign_in_with_microsoft('ownera40@utrgv.edu', 'Olivia Owner')::text, true);
select set_config('tests.member_a',  tests.sign_in_with_microsoft('membera40@utrgv.edu', 'Mark Member')::text, true);
select set_config('tests.owner_b',   tests.sign_in_with_microsoft('ownerb40@utrgv.edu', 'Bea Builder')::text, true);
select set_config('tests.owner_c',   tests.sign_in_with_microsoft('ownerc40@utrgv.edu', 'Caro Coder')::text, true);
-- An accent and an apostrophe, because the Vitest side checks these survive
-- into the cells and this is where they enter the system.
select set_config('tests.adviser',   tests.sign_in_with_microsoft('adviser40@utrgv.edu', 'Dr Ana Peña')::text, true);
select set_config('tests.asked',     tests.sign_in_with_microsoft('asked40@utrgv.edu', 'Dr Ivan O''Hare')::text, true);
select set_config('tests.unplaced_1', tests.sign_in_with_microsoft('unplaced40a@utrgv.edu', 'Uma Unplaced')::text, true);
select set_config('tests.unplaced_2', tests.sign_in_with_microsoft('unplaced40b@utrgv.edu', 'Walt Waiting')::text, true);

select set_config('tests.r_pm', (select id from public.roles where name = 'Project Manager')::text, true);
select set_config('tests.r_be', (select id from public.roles where name = 'Backend Developer')::text, true);

-- Done while unauthenticated: protect_admin_flag() in 18_admin_access.sql
-- refuses the `authenticated` role outright.
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;

-- Only CS faculty can be asked to advise (44_faculty_advisers.sql), and both
-- of these are asked through invite_adviser().
insert into public.faculty_directory (email) values
  ('adviser40@utrgv.edu'), ('asked40@utrgv.edu');

-- A skill on one unplaced student, so the Unplaced sheet has something in
-- its skills column and the other student proves an empty one is fine.
insert into public.user_skills (user_id, skill_id, source)
select current_setting('tests.unplaced_1')::uuid, s.id, 'manual'
  from public.skills s where s.name in ('React', 'PostgreSQL');

-- --- project A: two members, a repository, a real adviser ----------------

select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select set_config('tests.project_a', (select (public.create_project(
  'Campus parking tracker',
  'Live lot occupancy estimated from existing camera feeds, with a map.',
  4::smallint, current_setting('tests.r_pm')::uuid, '[]'::jsonb)).id::text), true);
select public.set_project_repo(current_setting('tests.project_a')::uuid,
                               'https://github.com/Jose-Franco22/TeamUp');
select public.invite_adviser(current_setting('tests.project_a')::uuid,
                             current_setting('tests.adviser')::uuid);

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select set_config('tests.req_a',
  (select (public.create_join_request(current_setting('tests.project_a')::uuid)).id::text), true);
select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select public.respond_to_join_request(
  current_setting('tests.req_a')::uuid, 'accepted', current_setting('tests.r_be')::uuid);

-- Accepting is #54's function and it is on Testing, but setting the status
-- directly is what adviser_requests.test.sql does and it keeps this file
-- independent of how an invitation gets answered.
select tests.clear_authentication();
update public.adviser_requests set status = 'accepted'
 where project_id = current_setting('tests.project_a')::uuid;

-- --- project B: no adviser, no repository --------------------------------

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select set_config('tests.project_b', (select (public.create_project(
  'Degree plan builder',
  'Constraint solver that generates a valid path to graduation from prerequisites.',
  3::smallint, current_setting('tests.r_pm')::uuid, '[]'::jsonb)).id::text), true);

-- --- project C: an invitation nobody has answered ------------------------

select tests.authenticate_as(current_setting('tests.owner_c')::uuid);
select set_config('tests.project_c', (select (public.create_project(
  'Scam text detector',
  'Classifier for fraudulent SMS with an explanation of which signals fired.',
  3::smallint, current_setting('tests.r_pm')::uuid, '[]'::jsonb)).id::text), true);
select public.invite_adviser(current_setting('tests.project_c')::uuid,
                             current_setting('tests.asked')::uuid);

-- One unplaced student has asked to join something and the other has not.
select tests.authenticate_as(current_setting('tests.unplaced_1')::uuid);
select public.create_join_request(current_setting('tests.project_b')::uuid);

-- --- what the admin gets --------------------------------------------------

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.admin_export', public.export_rosters()::text, true);

select is(current_setting('tests.admin_export')::jsonb ->> 'scope', 'admin',
  'the admin export says so');
select is(jsonb_array_length(current_setting('tests.admin_export')::jsonb -> 'teams'), 3,
  'and holds every team');
select is(jsonb_array_length(current_setting('tests.admin_export')::jsonb -> 'members'), 4,
  'every member of every team');
select is(jsonb_array_length(current_setting('tests.admin_export')::jsonb -> 'unplaced_students'), 2,
  'and every student who is not on one');

-- THE RULE THAT IS EASY TO LOSE: an instructor is not a student. 18_'s
-- trigger keeps admins off rosters, and admin_team_json() leaves them out of
-- its member lists; this sheet has to agree, or the instructor exports a
-- spreadsheet with their own name in the unplaced column.
select is((select count(*)::int
             from jsonb_array_elements(current_setting('tests.admin_export')::jsonb -> 'unplaced_students') s
            where s->>'email' = 'instructor40@utrgv.edu'), 0,
  'the admin is not an unplaced student');
select is((select count(*)::int
             from jsonb_array_elements(current_setting('tests.admin_export')::jsonb -> 'members') m
            where m->>'email' = 'instructor40@utrgv.edu'), 0,
  'nor a member of anything');

-- --- the Teams sheet's columns -------------------------------------------

select set_config('tests.team_a', (select t::text
    from jsonb_array_elements(current_setting('tests.admin_export')::jsonb -> 'teams') t
   where t->>'team_name' = 'Campus parking tracker'), true);
select set_config('tests.team_b', (select t::text
    from jsonb_array_elements(current_setting('tests.admin_export')::jsonb -> 'teams') t
   where t->>'team_name' = 'Degree plan builder'), true);
select set_config('tests.team_c', (select t::text
    from jsonb_array_elements(current_setting('tests.admin_export')::jsonb -> 'teams') t
   where t->>'team_name' = 'Scam text detector'), true);

select is(current_setting('tests.team_a')::jsonb ->> 'owner_email', 'ownera40@utrgv.edu',
  'a team row carries the owner''s email, which is what the export is for');
select is(current_setting('tests.team_a')::jsonb ->> 'member_count', '2',
  'and how many are on it');
select is(current_setting('tests.team_a')::jsonb ->> 'team_size_target', '4',
  'against how many it wants');
select is(current_setting('tests.team_a')::jsonb ->> 'github_repo',
  'https://github.com/Jose-Franco22/TeamUp', 'and the repository it linked');
select is(current_setting('tests.team_b')::jsonb ->> 'github_repo', '',
  'while a team that linked none has an empty one, not a null');

-- The three adviser states, which the workbook renders as a name, "Pending"
-- and "None". The status is returned rather than the word: one place
-- decides how a cell reads, and it is not this one.
select is(current_setting('tests.team_a')::jsonb ->> 'adviser_status', 'accepted',
  'a team with an adviser says accepted');
select is(current_setting('tests.team_a')::jsonb ->> 'adviser_name', 'Dr Ana Peña',
  'and names them, accent and all');
select is(current_setting('tests.team_a')::jsonb ->> 'adviser_email', 'adviser40@utrgv.edu',
  'with the address an instructor would write to');
select is(current_setting('tests.team_c')::jsonb ->> 'adviser_status', 'pending',
  'an unanswered invitation is pending');
select is(current_setting('tests.team_c')::jsonb ->> 'adviser_name', null,
  'and names nobody: who was asked is not who is advising');
select is(current_setting('tests.team_b')::jsonb ->> 'adviser_status', 'none',
  'and a team nobody was asked about has none');

-- --- the Members sheet's columns -----------------------------------------

select set_config('tests.row_owner', (select m::text
    from jsonb_array_elements(current_setting('tests.admin_export')::jsonb -> 'members') m
   where m->>'email' = 'ownera40@utrgv.edu'), true);
select set_config('tests.row_member', (select m::text
    from jsonb_array_elements(current_setting('tests.admin_export')::jsonb -> 'members') m
   where m->>'email' = 'membera40@utrgv.edu'), true);

select is(current_setting('tests.row_owner')::jsonb ->> 'team_name', 'Campus parking tracker',
  'a member row carries its team''s name, so the sheet survives being sorted');
select is(current_setting('tests.row_owner')::jsonb ->> 'is_owner', 'true',
  'the owner is marked as one');
select is(current_setting('tests.row_member')::jsonb ->> 'is_owner', 'false',
  'and somebody who joined is not');
select is(current_setting('tests.row_member')::jsonb ->> 'role_name', 'Backend Developer',
  'with the role they hold on the team');
select ok((current_setting('tests.row_member')::jsonb ->> 'joined_at') is not null,
  'and the date they joined');
select is(current_setting('tests.row_member')::jsonb ->> 'github_url', '',
  'github_url is empty rather than null when a profile has none');

-- --- the Unplaced sheet's columns ----------------------------------------

select set_config('tests.row_unplaced', (select s::text
    from jsonb_array_elements(current_setting('tests.admin_export')::jsonb -> 'unplaced_students') s
   where s->>'email' = 'unplaced40a@utrgv.edu'), true);

select is((select count(*)::int from jsonb_array_elements_text(
            current_setting('tests.row_unplaced')::jsonb -> 'skills')), 2,
  'an unplaced student brings their skills, which is how an admin places them');
select is(current_setting('tests.row_unplaced')::jsonb ->> 'has_pending_request', 'true',
  'and whether they have already asked to join something');
select is((select s->>'has_pending_request'
             from jsonb_array_elements(current_setting('tests.admin_export')::jsonb -> 'unplaced_students') s
            where s->>'email' = 'unplaced40b@utrgv.edu'), 'false',
  'while somebody who has not asked says so');

-- --- what the adviser gets ------------------------------------------------

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select set_config('tests.adviser_export', public.export_rosters()::text, true);

select is(current_setting('tests.adviser_export')::jsonb ->> 'scope', 'adviser',
  'the adviser export says so');
select is(jsonb_array_length(current_setting('tests.adviser_export')::jsonb -> 'teams'), 1,
  'and holds one team, not three');
select is((current_setting('tests.adviser_export')::jsonb -> 'teams' -> 0 ->> 'team_name'),
  'Campus parking tracker', 'the one they actually advise');
select is(jsonb_array_length(current_setting('tests.adviser_export')::jsonb -> 'members'), 2,
  'with that team''s members and nobody else''s');
select is((select count(*)::int
             from jsonb_array_elements(current_setting('tests.adviser_export')::jsonb -> 'members') m
            where m->>'email' = 'ownerb40@utrgv.edu'), 0,
  'another team''s owner is not in it');

-- THE RULE: a student with no team is nobody's advisee.
select is(jsonb_array_length(current_setting('tests.adviser_export')::jsonb -> 'unplaced_students'), 0,
  'an adviser gets no unplaced students at all');
select is(jsonb_typeof(current_setting('tests.adviser_export')::jsonb -> 'unplaced_students'), 'array',
  'and gets an empty list rather than a missing key, so one reader handles both');

-- --- everybody else -------------------------------------------------------

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select throws_ok(
  $$ select public.export_rosters() $$,
  '42501', null,
  'a student on a team cannot export the rosters');

select tests.authenticate_as(current_setting('tests.unplaced_2')::uuid);
select throws_ok(
  $$ select public.export_rosters() $$,
  '42501', null,
  'nor can a student on none');

select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select throws_ok(
  $$ select public.export_rosters() $$,
  '42501', null,
  'nor the owner of a team, who can already see their own');

-- Being asked is not advising. This is the case the scope check would fail
-- if it ever read adviser_requests without looking at the status.
select tests.authenticate_as(current_setting('tests.asked')::uuid);
select throws_ok(
  $$ select public.export_rosters() $$,
  '42501', null,
  'somebody holding an unanswered invitation cannot export anything');

select tests.clear_authentication();
update public.adviser_requests set status = 'declined'
 where project_id = current_setting('tests.project_c')::uuid;
select tests.authenticate_as(current_setting('tests.asked')::uuid);
select throws_ok(
  $$ select public.export_rosters() $$,
  '42501', null,
  'and neither can somebody who turned one down');

select tests.clear_authentication();
set local role anon;
select throws_ok(
  $$ select public.export_rosters() $$,
  '42501', null,
  'a guest cannot call it at all');
reset role;

select * from finish();
rollback;
