-- Issue #61 — what closing a semester does to everything in it.
-- 50_semesters.sql.
--
-- One Fall 2026 with something of every kind in it — a formed team with an
-- adviser, a deliverable, a comment, a check-in, a ticked next step and a
-- linked repository; an open team with a pending join request and a pending
-- adviser invitation — closed by an admin, and then Spring 2027 started with
-- teams of its own. So every "current only" read below has an archived row
-- sitting there to leak, and a current row beside it as the positive
-- control: a read that returns nothing because there is nothing would pass
-- every one of these otherwise.
--
-- Fall 2026's people:
--   Olivia (owner_a) and Mo (member_a)  — team A, formed, advised by Ada
--   Bea (owner_b) and Pia (member_b)   — team B, open
--   Sam (student)                      — asked to join B; still pending at close
--   Oscar (outsider)                   — team E, alone on it
--   Ada (adviser_a)                    — faculty, advises A, will take one team
--   Fern (adviser_b)                   — faculty, invited to B, never answered
--
-- In Spring, Mo and Pia each hold an archived seat *and* a current one
-- without being the creator of either — the case that tells "their team"
-- apart from "a team they were ever on" in every roster function, since a
-- creator can't leave, be moved or be removed anyway.
begin;
select plan(159);

select set_config('tests.admin',     tests.sign_in_with_microsoft('admin61a@utrgv.edu', 'Ana Admin')::text, true);
select set_config('tests.owner_a',   tests.sign_in_with_microsoft('olivia61@utrgv.edu', 'Olivia Owner')::text, true);
select set_config('tests.member_a',  tests.sign_in_with_microsoft('mo61@utrgv.edu',     'Mo Member')::text, true);
select set_config('tests.owner_b',   tests.sign_in_with_microsoft('bea61@utrgv.edu',    'Bea Builder')::text, true);
select set_config('tests.member_b',  tests.sign_in_with_microsoft('pia61@utrgv.edu',    'Pia Partner')::text, true);
select set_config('tests.student',   tests.sign_in_with_microsoft('sam61@utrgv.edu',    'Sam Student')::text, true);
select set_config('tests.outsider',  tests.sign_in_with_microsoft('oscar61@utrgv.edu',  'Oscar Outsider')::text, true);
select set_config('tests.adviser_a', tests.sign_in_with_microsoft('ada61@utrgv.edu',    'Ada Adviser')::text, true);
select set_config('tests.adviser_b', tests.sign_in_with_microsoft('fern61@utrgv.edu',   'Fern Faculty')::text, true);
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;
-- Ada takes one team at a time (#60), so the capacity case below has an edge.
update public.users set advising_max_teams = 1 where id = current_setting('tests.adviser_a')::uuid;
insert into public.faculty_directory (email) values ('ada61@utrgv.edu'), ('fern61@utrgv.edu');

select set_config('tests.role', (select id from public.roles where name = 'Backend Developer')::text, true);
select set_config('tests.fall', (select id from public.semesters where name = 'Fall 2026')::text, true);
-- A moment inside one Monday–Sunday week, for the digest.
select set_config('tests.t', (now() + interval '2 days')::text, true);

create function pg_temp.row_counts()
returns jsonb
language plpgsql
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_table text;
  v_count bigint;
begin
  foreach v_table in array array[
    'users', 'semesters', 'projects', 'teams', 'team_members', 'project_roles_needed',
    'join_requests', 'adviser_requests', 'check_ins', 'deliverable_submissions',
    'deliverable_comments', 'repo_activity', 'next_step_completions',
    'notifications', 'admin_actions', 'milestones', 'announcements', 'next_steps',
    'adviser_digests']
  loop
    execute format('select count(*) from public.%I', v_table) into v_count;
    v_counts := v_counts || jsonb_build_object(v_table, v_count);
  end loop;
  return v_counts;
end;
$$;

-- =========================================================================
-- Fall 2026
-- =========================================================================

select set_config('tests.project_a', tests.create_full_team(
  current_setting('tests.owner_a')::uuid, current_setting('tests.member_a')::uuid)::text, true);
select set_config('tests.team_a', (select id from public.teams where project_id = current_setting('tests.project_a')::uuid)::text, true);

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select set_config('tests.project_b', (select (public.create_project(
  'Campus parking tracker', 'Live lot occupancy estimated from existing camera feeds, with a map.',
  3::smallint, current_setting('tests.role')::uuid, '[]'::jsonb)).id::text), true);
select set_config('tests.team_b', (select id from public.teams where project_id = current_setting('tests.project_b')::uuid)::text, true);

select tests.authenticate_as(current_setting('tests.member_b')::uuid);
select set_config('tests.request_pia', (public.create_join_request(current_setting('tests.project_b')::uuid, null)).id::text, true);
select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select public.respond_to_join_request(current_setting('tests.request_pia')::uuid, 'accepted', current_setting('tests.role')::uuid);

select tests.authenticate_as(current_setting('tests.outsider')::uuid);
select set_config('tests.project_e', (select (public.create_project(
  'Scam message checker', 'Flags suspicious SMS and email using a model trained on reported scams.',
  3::smallint, current_setting('tests.role')::uuid,
  jsonb_build_array(jsonb_build_object(
    'role_id', (select id from public.roles where name = 'Frontend Developer'), 'quantity_needed', 1)))).id::text), true);
select set_config('tests.team_e', (select id from public.teams where project_id = current_setting('tests.project_e')::uuid)::text, true);

select tests.authenticate_as(current_setting('tests.student')::uuid);
select public.create_join_request(current_setting('tests.project_b')::uuid, 'I can do the map.');

select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select set_config('tests.invite_a', (public.invite_adviser(
  current_setting('tests.project_a')::uuid, current_setting('tests.adviser_a')::uuid)).id::text, true);
select public.set_project_repo(current_setting('tests.project_a')::uuid, 'https://github.com/olivia/team-a');

select tests.authenticate_as(current_setting('tests.adviser_a')::uuid);
select public.respond_to_adviser_request(current_setting('tests.invite_a')::uuid, true);

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select public.invite_adviser(current_setting('tests.project_b')::uuid, current_setting('tests.adviser_b')::uuid);

select tests.authenticate_as(current_setting('tests.adviser_b')::uuid);
select is((select count(*) from public.my_adviser_requests()), 1::bigint,
  'before the close, Fern has an invitation waiting on her Requests page');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.proposal', (public.save_milestone(null, 'Proposal', now() + interval '10 days')).id::text, true);
select public.set_milestone_requires_deliverable(current_setting('tests.proposal')::uuid, true);
select public.save_milestone(null, 'Fall demo', current_setting('tests.t')::timestamptz);
select set_config('tests.fall_notice', (public.save_announcement(null, 'Fall notice', 'Rosters lock in two weeks.')).id::text, true);
select set_config('tests.fall_step', (public.save_next_step(null, 'Fall step')).id::text, true);

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select public.submit_deliverable(current_setting('tests.project_a')::uuid,
  current_setting('tests.proposal')::uuid, null, null, 'https://example.com/proposal');
insert into public.check_ins (project_id, did, doing_next, blockers)
values (current_setting('tests.project_a')::uuid, 'Wrote the proposal', 'Build the map', 'Waiting on lot data');
select public.set_next_step_done(current_setting('tests.team_a')::uuid, current_setting('tests.fall_step')::uuid, true);

select tests.authenticate_as(current_setting('tests.adviser_a')::uuid);
select public.post_deliverable_comment(current_setting('tests.project_a')::uuid,
  current_setting('tests.proposal')::uuid, 'Good start — cite the lot data source.');

select tests.clear_authentication();

-- =========================================================================
-- Closing it
-- =========================================================================

select set_config('tests.before_close', pg_temp.row_counts()::text, true);

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.close_semester(current_setting('tests.fall')::uuid, 'Fall 2026') $$,
  'an admin closes Fall 2026');
select tests.clear_authentication();

-- --- nothing is deleted ---------------------------------------------------------

select is(pg_temp.row_counts(), current_setting('tests.before_close')::jsonb,
  'every table has exactly as many rows after closing as before — nothing is deleted');
select is(
  (select count(*) from public.team_members where team_id = current_setting('tests.team_a')::uuid),
  2::bigint,
  'team A''s roster is intact');
select is(
  (select count(*) from public.deliverable_submissions where project_id = current_setting('tests.project_a')::uuid)
  + (select count(*) from public.deliverable_comments where project_id = current_setting('tests.project_a')::uuid)
  + (select count(*) from public.check_ins where project_id = current_setting('tests.project_a')::uuid),
  3::bigint,
  'and so is its work: the submission, the adviser''s comment and the check-in');

-- --- pending requests are cancelled ---------------------------------------------

select is(
  (select status from public.join_requests
    where user_id = current_setting('tests.student')::uuid and project_id = current_setting('tests.project_b')::uuid),
  'cancelled', 'the pending join request is cancelled, not deleted');
select is(
  (select status from public.adviser_requests
    where adviser_id = current_setting('tests.adviser_b')::uuid and project_id = current_setting('tests.project_b')::uuid),
  'cancelled', 'so is the pending adviser invitation');
select tests.authenticate_as(current_setting('tests.adviser_b')::uuid);
select is((select count(*) from public.my_adviser_requests()), 0::bigint,
  'so it is gone from Fern''s Requests page');
select tests.clear_authentication();
select is(
  (select count(*) from public.notifications
    where user_id = current_setting('tests.owner_b')::uuid and kind = 'join_request' and read_at is null),
  0::bigint,
  'and the "asked to join" alert that wanted Bea to answer it is marked read');
select is(
  (select count(*) from public.notifications
    where user_id = current_setting('tests.adviser_b')::uuid and kind = 'adviser_invited' and read_at is null),
  0::bigint,
  'as is Fern''s invitation alert');
select is(
  (select count(*) from public.notifications n
     join public.projects p on p.id = n.project_id
    where p.semester_id = current_setting('tests.fall')::uuid and n.read_at is null),
  0::bigint,
  'and no alert about a Fall project is left unread, whatever kind it was: they would link to teams that no longer load');

-- --- adviser links end ----------------------------------------------------------
-- The row still says Ada advised team A (decision 6); the link is over
-- because the semester is.

select is(
  (select status from public.adviser_requests where id = current_setting('tests.invite_a')::uuid),
  'accepted', 'the record that Ada advised team A is kept');

select tests.authenticate_as(current_setting('tests.adviser_a')::uuid);
select is((select count(*) from public.advised_project_ids()), 0::bigint,
  'but Ada advises nothing now');
select is(public.my_advising() -> 'advising', '0'::jsonb,
  'her count of teams is back to 0');
select is((select count(*) from public.adviser_dashboard()), 0::bigint,
  'and her dashboard is empty');
select throws_ok(
  $$ select public.review_deliverable(current_setting('tests.project_a')::uuid,
       current_setting('tests.proposal')::uuid, 1, 'approved', '') $$,
  'P0001', 'Only the project''s adviser can approve or request changes',
  'she can no longer review the team''s work');

-- --- archived teams are read-only ------------------------------------------------
-- Through every kind of write: the owner's, a member's, an admin's, and the
-- database superuser's own.

select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select throws_ok(
  $$ select public.update_project(current_setting('tests.project_a')::uuid, 'Renamed project',
       'A description that is long enough to pass the checks.', 2::smallint,
       current_setting('tests.role')::uuid, '[]'::jsonb) $$,
  'P0001', 'Fall 2026 has been closed — past semesters are read-only',
  'the owner cannot edit an archived project');
select throws_ok(
  $$ select public.set_project_repo(current_setting('tests.project_a')::uuid, '') $$,
  'P0001', 'Fall 2026 has been closed — past semesters are read-only',
  'or unlink its repository');
update public.projects set title = 'Sneaky rename' where id = current_setting('tests.project_a')::uuid;

select tests.authenticate_as(current_setting('tests.outsider')::uuid);
select throws_ok(
  $$ select public.delete_team(current_setting('tests.team_e')::uuid) $$,
  'P0001', 'Fall 2026 has been closed — past semesters are read-only',
  'an archived team cannot be deleted, even by its owner and even with nobody else on it');

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select throws_ok(
  $$ insert into public.check_ins (project_id, did, doing_next)
     values (current_setting('tests.project_a')::uuid, 'More', 'More') $$,
  'P0001', 'Fall 2026 has been closed — past semesters are read-only',
  'a member cannot post a check-in to it through the table');
select throws_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
       current_setting('tests.proposal')::uuid, null, null, 'https://example.com/v2') $$,
  'P0001', 'Fall 2026 has been closed — past semesters are read-only',
  'or submit to it');
select throws_ok(
  $$ select public.post_deliverable_comment(current_setting('tests.project_a')::uuid,
       current_setting('tests.proposal')::uuid, 'One more thing') $$,
  'P0001', 'Fall 2026 has been closed — past semesters are read-only',
  'or comment on it');
select throws_ok(
  $$ select public.set_next_step_done(current_setting('tests.team_a')::uuid,
       current_setting('tests.fall_step')::uuid, false) $$,
  'P0001', 'Fall 2026 has been closed — past semesters are read-only',
  'or untick its checklist');
select throws_ok(
  $$ delete from public.check_ins where project_id = current_setting('tests.project_a')::uuid $$,
  '42501', null,
  'and cannot delete its check-ins directly (42_ never granted that)');

select tests.authenticate_as(current_setting('tests.student')::uuid);
select throws_ok(
  $$ select public.create_join_request(current_setting('tests.project_b')::uuid, null) $$,
  'P0001', 'Fall 2026 has been closed — past semesters are read-only',
  'nobody can ask to join an archived team');
select throws_ok(
  $$ select public.create_join_request(current_setting('tests.project_a')::uuid, null) $$,
  'P0001', 'Fall 2026 has been closed — past semesters are read-only',
  'and for a full archived team that is what they hear, not "this project is full"');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.admin_assign_student(current_setting('tests.outsider')::uuid,
       current_setting('tests.team_b')::uuid, current_setting('tests.role')::uuid) $$,
  'P0001', 'Fall 2026 has been closed — past semesters are read-only',
  'an admin cannot place a student on one — and is told why, though Oscar is also on a Fall team already');
select throws_ok(
  $$ select public.save_milestone(current_setting('tests.proposal')::uuid, 'Proposal (edited)', now() + interval '9 days') $$,
  'P0001', 'Fall 2026 has been closed — past semesters are read-only',
  'or edit the semester''s milestones');
select throws_ok(
  $$ select public.save_announcement(current_setting('tests.fall_notice')::uuid, 'Edited', 'Edited body text.') $$,
  'P0001', 'Fall 2026 has been closed — past semesters are read-only',
  'or its announcements');

select tests.clear_authentication();
select throws_ok(
  $$ update public.projects set title = 'Superuser rename' where id = current_setting('tests.project_a')::uuid $$,
  'P0001', 'Fall 2026 has been closed — past semesters are read-only',
  'the guard holds for the database superuser too: it is on the table, not in the functions');
select throws_ok(
  $$ delete from public.team_members where team_id = current_setting('tests.team_a')::uuid $$,
  'P0001', 'Fall 2026 has been closed — past semesters are read-only',
  'including deletes');

select is((select title from public.projects where id = current_setting('tests.project_a')::uuid), 'Test project',
  'the owner''s direct UPDATE above matched no rows: the title is unchanged');
select is((select count(*) from public.check_ins where project_id = current_setting('tests.project_a')::uuid), 1::bigint,
  'and team A''s check-in is still there');

-- =========================================================================
-- Spring 2027
-- =========================================================================

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.spring', (public.start_semester(
  'Spring 2027', '2027-01-19', '2027-05-14', now() + interval '30 days') ->> 'id'), true);
select set_config('tests.kickoff', (public.save_milestone(null, 'Spring kickoff', current_setting('tests.t')::timestamptz)).id::text, true);
select public.set_milestone_requires_deliverable(current_setting('tests.kickoff')::uuid, true);
select public.save_announcement(null, 'Spring notice', 'Welcome back — teams form this month.');
select set_config('tests.spring_step', (public.save_next_step(null, 'Spring step')).id::text, true);

-- --- every student can join a team again ---------------------------------------
-- Through every door: starting a project, asking to join and being
-- accepted, and an admin placing and moving them.

select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select lives_ok(
  $$ select set_config('tests.project_c', (public.create_project('Degree plan builder',
       'Constraint solver that generates a valid path to graduation from prerequisites.',
       3::smallint, current_setting('tests.role')::uuid, '[]'::jsonb)).id::text, true) $$,
  'Olivia, who created an archived team, starts a project in Spring');
select set_config('tests.team_c', (select id from public.teams where project_id = current_setting('tests.project_c')::uuid)::text, true);

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select lives_ok(
  $$ select set_config('tests.request_c', (public.create_join_request(current_setting('tests.project_c')::uuid, null)).id::text, true) $$,
  'Mo, on an archived team, can ask to join one');
select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select lives_ok(
  $$ select public.respond_to_join_request(current_setting('tests.request_c')::uuid, 'accepted', current_setting('tests.role')::uuid) $$,
  'and can be accepted — his archived seat is not "already on a team"');

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select lives_ok(
  $$ select set_config('tests.project_d', (public.create_project('Lab equipment booking',
       'Reserve shared lab hardware by the hour, with conflicts resolved up front.',
       3::smallint, current_setting('tests.role')::uuid,
       jsonb_build_array(jsonb_build_object(
         'role_id', (select id from public.roles where name = 'Frontend Developer'), 'quantity_needed', 1)))).id::text, true) $$,
  'Bea, whose Fall team is archived, starts one too');
select set_config('tests.team_d', (select id from public.teams where project_id = current_setting('tests.project_d')::uuid)::text, true);

select tests.authenticate_as(current_setting('tests.student')::uuid);
select lives_ok(
  $$ select public.create_join_request(current_setting('tests.project_d')::uuid, null) $$,
  'Sam, whose Fall request was cancelled, can ask to join it');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.admin_assign_student(current_setting('tests.member_b')::uuid,
       current_setting('tests.team_d')::uuid, current_setting('tests.role')::uuid) $$,
  'an admin can place Pia, whose only seat is archived');
select lives_ok(
  $$ select public.admin_move_student(current_setting('tests.member_b')::uuid,
       current_setting('tests.team_c')::uuid, current_setting('tests.role')::uuid) $$,
  'and move her: the team she is moved off is this semester''s, not Fall''s');
select tests.clear_authentication();
select is(
  (select count(*) from public.team_members where user_id = current_setting('tests.member_b')::uuid),
  2::bigint,
  'Pia''s Fall seat is still there beside her Spring one');
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select is(
  public.admin_student_details(current_setting('tests.member_a')::uuid) -> 'membership' ->> 'project_title',
  'Degree plan builder',
  'the admin''s student page shows Mo''s team this semester, though he has had two');
select is(
  (select jsonb_agg(t ->> 'title' order by t ->> 'title') from jsonb_array_elements(public.admin_dashboard() -> 'teams') t),
  '["Degree plan builder", "Lab equipment booking"]'::jsonb,
  'the admin dashboard lists this semester''s teams only');
select is(
  (select jsonb_agg(u ->> 'name' order by u ->> 'name') from jsonb_array_elements(public.admin_dashboard() -> 'unplaced_students') u),
  '["Sam Student"]'::jsonb,
  'and counts as unplaced only Spring''s students with no team: not Ada and Fern (faculty), not Oscar (Fall only, hasn''t joined Spring)');

-- Decision 9: Oscar joins Spring himself, and from then on he is one of its
-- students — with no team, since his archived one doesn't place him.
select tests.authenticate_as(current_setting('tests.outsider')::uuid);
select is((public.current_semester() ->> 'needs_enrollment')::boolean, true,
  'Spring asks Oscar, who was only in Fall, whether he is taking it');
select lives_ok($$ select public.enroll_in_current_semester() $$, 'Oscar joins Spring');
select lives_ok($$ select public.enroll_in_current_semester() $$, 'and joining twice changes nothing');
select is((public.current_semester() ->> 'needs_enrollment')::boolean, false, 'and is not asked again');
select tests.authenticate_as(current_setting('tests.adviser_a')::uuid);
select is((public.current_semester() ->> 'needs_enrollment')::boolean, false, 'faculty are never asked');
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select is((public.current_semester() ->> 'needs_enrollment')::boolean, false, 'nor admins');
select throws_ok($$ select public.enroll_in_current_semester() $$,
  'Admins aren''t enrolled in a semester', 'and an admin cannot enroll');
select is(
  (select jsonb_agg(u ->> 'name' order by u ->> 'name') from jsonb_array_elements(public.admin_dashboard() -> 'unplaced_students') u),
  '["Oscar Outsider", "Sam Student"]'::jsonb,
  'once he has joined, Oscar counts as unplaced — his archived team doesn''t place him');
select is(
  (select t -> 'next_steps' ->> 'total' from jsonb_array_elements(public.admin_dashboard() -> 'teams') t
    where t ->> 'title' = 'Degree plan builder'),
  '1',
  'a Spring team''s checklist progress is out of Spring''s steps');

-- Mo's role changes on his Spring team only. The UPDATE that does it names
-- the team; by student alone it would reach his Fall seat and be refused.
select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select lives_ok(
  $$ select public.set_member_role(current_setting('tests.member_a')::uuid,
       (select id from public.roles where name = 'Frontend Developer')) $$,
  'the owner changes a member''s role on this semester''s team');
select tests.clear_authentication();
select is(
  (select r.name from public.team_members tm join public.roles r on r.id = tm.role_id
    where tm.user_id = current_setting('tests.member_a')::uuid and tm.team_id = current_setting('tests.team_a')::uuid),
  'Backend Developer',
  'and his archived seat keeps the role it had');

-- --- deliverables, uploads and the checklist stay in their own semester -------------

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select throws_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_c')::uuid,
       current_setting('tests.proposal')::uuid, null, null, 'https://example.com/borrowed') $$,
  'P0001', 'Milestone not found',
  'a Spring team cannot submit against a Fall milestone');
select lives_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_c')::uuid,
       current_setting('tests.kickoff')::uuid, null, null, 'https://example.com/kickoff') $$,
  'but can against a Spring one (the positive control)');
select throws_ok(
  $$ select tests.upload_to_storage('deliverables',
       current_setting('tests.project_a') || '/' || current_setting('tests.proposal') || '/'
         || gen_random_uuid() || '.pdf', 1000, 'application/pdf') $$,
  '42501', null,
  'a file cannot be uploaded to an archived team''s deliverables');
select lives_ok(
  $$ select tests.upload_to_storage('deliverables',
       current_setting('tests.project_c') || '/' || current_setting('tests.kickoff') || '/'
         || gen_random_uuid() || '.pdf', 1000, 'application/pdf') $$,
  'while one to this semester''s team uploads (the positive control)');
select throws_ok(
  $$ select tests.upload_to_storage('deliverables',
       current_setting('tests.project_c') || '/' || current_setting('tests.proposal') || '/'
         || gen_random_uuid() || '.pdf', 1000, 'application/pdf') $$,
  '42501', null,
  'and nor can one against a Fall milestone, even into this semester''s team');

-- Team C is full (Olivia, Mo, Pia), so its checklist is open.
select throws_ok(
  $$ select public.set_next_step_done(current_setting('tests.team_c')::uuid,
       current_setting('tests.fall_step')::uuid, true) $$,
  'P0001', 'Next step not found',
  'a Spring team cannot tick a Fall step');
select lives_ok(
  $$ select public.set_next_step_done(current_setting('tests.team_c')::uuid,
       current_setting('tests.spring_step')::uuid, true) $$,
  'only its own semester''s (the positive control)');

-- --- adviser capacity counts only this semester's teams ----------------------------
-- Ada takes one team and advised one in Fall. Counting Fall's would make her
-- full; this semester she has room.

select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select lives_ok(
  $$ select set_config('tests.invite_c', (public.invite_adviser(current_setting('tests.project_c')::uuid,
       current_setting('tests.adviser_a')::uuid)).id::text, true) $$,
  'Ada can be invited: last semester''s team does not fill her one spot');
select tests.authenticate_as(current_setting('tests.adviser_a')::uuid);
select lives_ok(
  $$ select public.respond_to_adviser_request(current_setting('tests.invite_c')::uuid, true) $$,
  'and can accept');
select is(public.my_advising() -> 'advising', '1'::jsonb, 'she advises one team: this semester''s');
select is(public.my_advising() -> 'is_full', 'true'::jsonb, 'which is now her limit');

-- =========================================================================
-- Reads default to the current semester
-- =========================================================================

-- --- Browse -------------------------------------------------------------------

select tests.authenticate_as(current_setting('tests.student')::uuid);
select is(
  (select array_agg(title order by title) from public.projects),
  array['Degree plan builder', 'Lab equipment booking'],
  'Browse lists this semester''s projects and no archived ones');
select is(
  (select count(*) from public.teams where project_id in
     (current_setting('tests.project_a')::uuid, current_setting('tests.project_b')::uuid)),
  0::bigint,
  'archived teams are not readable through the table');
select is(
  (select count(*) from public.teams where project_id = current_setting('tests.project_c')::uuid),
  1::bigint,
  'while this semester''s are (the positive control)');
select is(
  (select count(*) from public.project_roles_needed where project_id = current_setting('tests.project_e')::uuid),
  0::bigint,
  'an archived project''s open roles are not on the card either');
select is(
  (select count(*) from public.project_roles_needed where project_id = current_setting('tests.project_d')::uuid),
  1::bigint,
  'this semester''s are (the positive control)');

select tests.clear_authentication();
select set_config('role', 'anon', true);
select is(
  (select array_agg(title order by title) from public.projects),
  array['Degree plan builder', 'Lab equipment booking'],
  'a guest browsing sees the same two');
select tests.clear_authentication();

-- --- Requests ------------------------------------------------------------------

select tests.authenticate_as(current_setting('tests.student')::uuid);
select is(
  (select array_agg(row(project_id, status)::text) from public.join_requests),
  array[row(current_setting('tests.project_d')::uuid, 'pending')::text],
  'Sam''s Requests show this semester''s request, not the cancelled Fall one');
select is(
  (select count(*) from public.my_adviser_requests()), 0::bigint,
  'no adviser invitation of hers is waiting');

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select is(
  (select count(*) from public.join_requests where status = 'pending'), 1::bigint,
  'Bea''s incoming requests are her Spring project''s');

-- --- the team page --------------------------------------------------------------

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select is(
  (select array_agg(team_id) from public.team_members where user_id = current_setting('tests.member_a')::uuid),
  array[current_setting('tests.team_c')::uuid],
  'Mo''s team page finds one team: Spring''s');
select is(
  (select count(*) from public.check_ins where project_id = current_setting('tests.project_a')::uuid),
  0::bigint,
  'Fall''s check-ins are not on it');
select lives_ok(
  $$ insert into public.check_ins (project_id, did, doing_next)
     values (current_setting('tests.project_c')::uuid, 'Kicked off', 'Pick a stack') $$,
  'a check-in to this semester''s team still works');
select is(
  (select count(*) from public.check_ins where project_id = current_setting('tests.project_c')::uuid),
  1::bigint,
  'and reads back (the positive control)');
select is(
  (select count(*) from public.adviser_requests where project_id = current_setting('tests.project_a')::uuid),
  0::bigint,
  'Fall''s adviser record is not on Mo''s team page, though he was on that team');
select is(
  (select count(*) from public.adviser_requests where project_id = current_setting('tests.project_c')::uuid),
  1::bigint,
  'Spring''s is (the positive control)');

-- The adviser and the inviting owner reach those rows by their own ids, not
-- through the roster, so only the chain keeps Fall's out of their reads.
select tests.authenticate_as(current_setting('tests.adviser_a')::uuid);
select is(
  (select array_agg(project_id) from public.adviser_requests),
  array[current_setting('tests.project_c')::uuid],
  'Ada reads her Spring adviser row and not the Fall one she accepted');
select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select is(
  (select array_agg(project_id) from public.adviser_requests),
  array[current_setting('tests.project_c')::uuid],
  'Olivia reads the Spring invitation she sent and not the Fall one');
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select is(
  (select count(*) from public.next_step_completions where team_id = current_setting('tests.team_a')::uuid),
  0::bigint,
  'an admin reads no archived team''s ticked steps through the table either');
select is(
  (select count(*) from public.next_step_completions where team_id = current_setting('tests.team_c')::uuid),
  1::bigint,
  'only this semester''s (the positive control)');
select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select is(
  (select count(*) from public.next_step_completions where team_id = current_setting('tests.team_a')::uuid),
  0::bigint,
  'nor are the Fall team''s ticked steps');
select is(
  (select count(*) from public.next_step_completions where team_id = current_setting('tests.team_c')::uuid),
  1::bigint,
  'while the Spring team''s are (the positive control)');
select is(
  jsonb_array_length(public.team_checklist(current_setting('tests.team_c')::uuid)), 1,
  'the Spring team''s checklist is Spring''s one step');

-- --- milestones, announcements, next steps -----------------------------------------

select tests.authenticate_as(current_setting('tests.student')::uuid);
select is(
  (select array_agg(name order by name) from public.milestones),
  array['Spring kickoff', 'Team formation deadline'],
  'the milestones a student reads are this semester''s');
select is(
  (select array_agg(title) from public.announcements), array['Spring notice'],
  'so are the announcements');
select is(
  (select jsonb_agg(a -> 'title') from jsonb_array_elements(public.announcement_feed()) a),
  '["Spring notice"]'::jsonb,
  'and the announcement feed');
select is(public.unseen_announcement_count(), 3,
  'the unseen count is this semester''s announcement and two milestones');
select is((select array_agg(title) from public.next_steps), array['Spring step'],
  'and the next steps');
select is(public.formation_deadline(),
  (select due_at from public.milestones where is_formation_deadline),
  'formation_deadline() is Spring''s');

-- --- adviser_dashboard() -----------------------------------------------------------

select tests.authenticate_as(current_setting('tests.adviser_a')::uuid);
select is(
  (select array_agg(project_id) from public.adviser_dashboard()),
  array[current_setting('tests.project_c')::uuid],
  'Ada''s dashboard shows this semester''s team and not the one she advised in Fall');
select is(
  (select next_milestone_name from public.adviser_dashboard()), 'Spring kickoff',
  'and its next milestone is this semester''s, though Fall''s falls at the same moment');

-- --- export_rosters() ---------------------------------------------------------------

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.export', public.export_rosters()::text, true);
select is(
  (select jsonb_agg(t ->> 'team_name' order by t ->> 'team_name')
     from jsonb_array_elements(current_setting('tests.export')::jsonb -> 'teams') t),
  '["Degree plan builder", "Lab equipment booking"]'::jsonb,
  'the admin''s export has this semester''s teams only');
select is(
  (select jsonb_agg(m ->> 'name' order by m ->> 'name')
     from jsonb_array_elements(current_setting('tests.export')::jsonb -> 'members') m),
  '["Bea Builder", "Mo Member", "Olivia Owner", "Pia Partner"]'::jsonb,
  'and this semester''s members');
select is(
  (select jsonb_agg(u ->> 'name' order by u ->> 'name')
     from jsonb_array_elements(current_setting('tests.export')::jsonb -> 'unplaced_students') u),
  '["Oscar Outsider", "Sam Student"]'::jsonb,
  'unplaced means no team this semester — Oscar''s archived one doesn''t place him');

select tests.authenticate_as(current_setting('tests.adviser_a')::uuid);
select is(
  (select jsonb_agg(t ->> 'team_name')
     from jsonb_array_elements(public.export_rosters() -> 'teams') t),
  '["Degree plan builder"]'::jsonb,
  'an adviser''s export is the team she advises this semester');

select tests.authenticate_as(current_setting('tests.adviser_b')::uuid);
select throws_ok($$ select public.export_rosters() $$, '42501',
  'Only an admin or an adviser can export rosters',
  'and Fern, who advises nobody this semester, gets none');

-- --- the digest's data -----------------------------------------------------------------

select tests.clear_authentication();
select set_config('tests.digest', private.adviser_digest_data(
  current_setting('tests.adviser_a')::uuid, current_setting('tests.t')::timestamptz)::text, true);
select is(
  (select jsonb_agg(t ->> 'project_title') from jsonb_array_elements(current_setting('tests.digest')::jsonb -> 'teams') t),
  '["Degree plan builder"]'::jsonb,
  'Ada''s digest lists this semester''s team');
select is(
  (select jsonb_agg(m ->> 'name') from jsonb_array_elements(current_setting('tests.digest')::jsonb -> 'due_this_week') m),
  '["Spring kickoff"]'::jsonb,
  'and this semester''s milestone, not Fall''s due the same week');
select ok(
  current_setting('tests.adviser_a')::uuid in (select private.adviser_digest_recipients()),
  'Ada still gets a digest');
select ok(
  current_setting('tests.adviser_b')::uuid not in (select private.adviser_digest_recipients()),
  'Fern does not');

-- --- GitHub links ---------------------------------------------------------------------

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select throws_ok(
  $$ select public.project_repo_for_refresh(current_setting('tests.project_a')::uuid) $$,
  'P0001', 'Fall 2026 has been closed — past semesters are read-only',
  'an archived team''s repository is not refreshed from GitHub');
select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select public.set_project_repo(current_setting('tests.project_c')::uuid, 'https://github.com/mo/degree-plan');
select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select is(
  public.project_repo_for_refresh(current_setting('tests.project_c')::uuid),
  'https://github.com/mo/degree-plan',
  'this semester''s is (the positive control)');

-- =========================================================================
-- Past semesters
-- =========================================================================

-- --- the list ---------------------------------------------------------------------

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select set_config('tests.past', public.past_semesters()::text, true);
select is(jsonb_array_length(current_setting('tests.past')::jsonb), 1, 'Mo has one past semester');
select is(current_setting('tests.past')::jsonb -> 0 ->> 'name', 'Fall 2026', 'Fall 2026');
select is(
  (select jsonb_agg(t ->> 'title') from jsonb_array_elements(current_setting('tests.past')::jsonb -> 0 -> 'teams') t),
  '["Test project"]'::jsonb,
  'with his own team in it and nobody else''s');
select is(current_setting('tests.past')::jsonb -> 0 -> 'teams' -> 0 -> 'is_member', 'true'::jsonb,
  'marked as his');
select is(current_setting('tests.past')::jsonb -> 0 -> 'teams' -> 0 ->> 'adviser_name', 'Ada Adviser',
  'naming the adviser it had');

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select is(
  (select jsonb_agg(t ->> 'title') from jsonb_array_elements(public.past_semesters() -> 0 -> 'teams') t),
  '["Campus parking tracker"]'::jsonb,
  'Bea sees her own Fall team');

select tests.authenticate_as(current_setting('tests.student')::uuid);
select is(public.past_semesters(), '[]'::jsonb,
  'Sam, who was on no Fall team, has no past semesters to see');

select tests.authenticate_as(current_setting('tests.adviser_a')::uuid);
select set_config('tests.past', public.past_semesters()::text, true);
select is(
  (select jsonb_agg(t ->> 'title') from jsonb_array_elements(current_setting('tests.past')::jsonb -> 0 -> 'teams') t),
  '["Test project"]'::jsonb,
  'Ada sees the team she advised, and not the one she didn''t');
select is(current_setting('tests.past')::jsonb -> 0 -> 'teams' -> 0 -> 'is_adviser', 'true'::jsonb,
  'marked as one she advised');

select tests.authenticate_as(current_setting('tests.adviser_b')::uuid);
select is(public.past_semesters(), '[]'::jsonb,
  'Fern, whose invitation was never answered, advised nobody and sees nothing');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select is(
  (select jsonb_agg(t ->> 'title' order by t ->> 'title')
     from jsonb_array_elements(public.past_semesters() -> 0 -> 'teams') t),
  '["Campus parking tracker", "Scam message checker", "Test project"]'::jsonb,
  'an admin sees every team in the past semester');

select tests.clear_authentication();
select throws_ok($$ select public.past_semesters() $$, 'P0001', 'Not signed in',
  'past_semesters() answers nobody who is not signed in');

-- --- one past team ------------------------------------------------------------------

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select set_config('tests.past_a', public.past_team(current_setting('tests.project_a')::uuid)::text, true);
select is(current_setting('tests.past_a')::jsonb ->> 'title', 'Test project',
  'a student reads their own archived team');
select is(
  (select jsonb_agg(m ->> 'name' order by m ->> 'name') from jsonb_array_elements(current_setting('tests.past_a')::jsonb -> 'members') m),
  '["Mo Member", "Olivia Owner"]'::jsonb,
  'with its members');
select is(current_setting('tests.past_a')::jsonb -> 'adviser' ->> 'name', 'Ada Adviser', 'its adviser');
select is(
  jsonb_array_length(current_setting('tests.past_a')::jsonb -> 'deliverables' -> 0 -> 'versions'), 1,
  'its deliverable');
select is(
  current_setting('tests.past_a')::jsonb -> 'deliverables' -> 0 -> 'comments' -> 0 ->> 'body',
  'Good start — cite the lot data source.',
  'the adviser''s feedback on it');
select is(
  current_setting('tests.past_a')::jsonb -> 'check_ins' -> 0 ->> 'blockers', 'Waiting on lot data',
  'and its check-ins');
select is(current_setting('tests.past_a')::jsonb -> 'semester' ->> 'name', 'Fall 2026',
  'saying which semester it was');
select is(
  (select jsonb_agg(s -> 'title') from jsonb_array_elements(public.team_checklist(current_setting('tests.team_a')::uuid)) s
    where s ->> 'completed_at' is not null),
  '["Fall step"]'::jsonb,
  'its checklist is still Fall''s, with what they ticked');
select is(
  (select count(*) from public.projects where id = current_setting('tests.project_a')::uuid),
  0::bigint,
  'none of it through the tables, which are current-only: past_team() is the one door');

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select lives_ok(
  $$ select public.past_team(current_setting('tests.project_b')::uuid) $$,
  'Bea reads her own archived team (the positive control)');
select throws_ok(
  $$ select public.past_team(current_setting('tests.project_a')::uuid) $$,
  '42501', 'Only the team, its adviser and admins can see a past team',
  'but not another student''s');

select tests.authenticate_as(current_setting('tests.student')::uuid);
select throws_ok(
  $$ select public.past_team(current_setting('tests.project_b')::uuid) $$,
  '42501', 'Only the team, its adviser and admins can see a past team',
  'Sam asked to join team B but was never on it, so cannot read it');

select tests.authenticate_as(current_setting('tests.adviser_a')::uuid);
select is(
  public.past_team(current_setting('tests.project_a')::uuid) ->> 'title', 'Test project',
  'Ada reads the team she advised');
select is(
  jsonb_array_length(public.project_deliverables(current_setting('tests.project_a')::uuid)), 1,
  'including its deliverables — the files she reviewed stay hers to open');
select throws_ok(
  $$ select public.past_team(current_setting('tests.project_b')::uuid) $$,
  '42501', 'Only the team, its adviser and admins can see a past team',
  'but not a team she did not advise');

select tests.authenticate_as(current_setting('tests.adviser_b')::uuid);
select throws_ok(
  $$ select public.past_team(current_setting('tests.project_b')::uuid) $$,
  '42501', 'Only the team, its adviser and admins can see a past team',
  'an invitation never answered is not having advised');
select throws_ok(
  $$ select public.project_deliverables(current_setting('tests.project_a')::uuid) $$,
  'P0001', 'Only this team, its adviser and admins can see its deliverables',
  'nor does it open anyone''s deliverables');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.past_a', public.past_team(current_setting('tests.project_a')::uuid)::text, true);
select is(
  jsonb_array_length(current_setting('tests.past_a')::jsonb -> 'check_ins'), 1,
  'an admin opens any past team, check-ins included — which the check_ins table never let them read');
select is(
  jsonb_array_length(current_setting('tests.past_a')::jsonb -> 'deliverables'), 1,
  'and its deliverables');

select throws_ok(
  $$ select public.past_team(current_setting('tests.project_c')::uuid) $$,
  'P0001', 'That team is in the current semester',
  'a current team is not a past one');
select throws_ok(
  $$ select public.past_team(gen_random_uuid()) $$,
  'P0001', 'Team not found',
  'and one that does not exist is not found');

-- =========================================================================
-- Scheduled jobs, and the roster changes that are left
-- =========================================================================

-- --- check-in reminders go to this semester's teams only ---------------------------
-- A Saturday in Spring: team C is formed and nobody on it has checked in for
-- that week. Team A is formed too, and archived.

select tests.clear_authentication();
select private.send_check_in_reminders('2027-02-06 12:00:00-06');
select is(
  (select count(*) from private.check_in_reminders where project_id = current_setting('tests.project_a')::uuid),
  0::bigint,
  'nobody is reminded to check in to an archived team');
select is(
  (select count(*) from private.check_in_reminders where project_id = current_setting('tests.project_c')::uuid),
  3::bigint,
  'every member of this semester''s formed team is (the positive control)');

-- --- removing, leaving: the current seat only ---------------------------------------

select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select lives_ok($$ select public.remove_member(current_setting('tests.member_b')::uuid) $$,
  'the owner removes Pia from the Spring team');
select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select lives_ok($$ select public.leave_team() $$, 'Mo leaves it');
select tests.clear_authentication();
select is(
  (select array_agg(team_id) from public.team_members where user_id = current_setting('tests.member_b')::uuid),
  array[current_setting('tests.team_b')::uuid],
  'Pia keeps her Fall seat');
select is(
  (select array_agg(team_id) from public.team_members where user_id = current_setting('tests.member_a')::uuid),
  array[current_setting('tests.team_a')::uuid],
  'and so does Mo');

-- --- deadline reminders count only this semester's full teams -----------------------
-- Mo was on a full team in Fall and is on none now.

select private.send_deadline_reminders(public.formation_deadline() - interval '2 days');
select ok(
  current_setting('tests.member_a')::uuid in (select user_id from private.deadline_reminders),
  'Mo is reminded the formation deadline is coming: a full archived team does not count');
select ok(
  current_setting('tests.admin')::uuid not in (select user_id from private.deadline_reminders),
  'an admin is not (the control: it does not simply remind everyone)');
select ok(
  current_setting('tests.adviser_a')::uuid not in (select user_id from private.deadline_reminders)
  and current_setting('tests.adviser_b')::uuid not in (select user_id from private.deadline_reminders),
  'nor are Ada and Fern, who are faculty, not students without a team');

-- --- who an announcement is emailed to (decision 9) ------------------------------------
-- Una's account is made in Spring, so she is in Spring's class and not Fall's.

select set_config('tests.newcomer', tests.sign_in_with_microsoft('una61@utrgv.edu', 'Una Newcomer')::text, true);
select tests.clear_authentication();
select ok(
  exists (select 1 from public.semester_enrollments
           where user_id = current_setting('tests.newcomer')::uuid
             and semester_id = current_setting('tests.spring')::uuid)
  and not exists (select 1 from public.semester_enrollments
                   where user_id = current_setting('tests.newcomer')::uuid
                     and semester_id = current_setting('tests.fall')::uuid),
  'an account made while Spring is open is enrolled in Spring, and only Spring');
select set_config('tests.spring_recipients', (
  select jsonb_agg(email order by email)
    from public.announcement_recipients((select id from public.announcements where title = 'Spring notice'))
)::text, true);
select ok(
  current_setting('tests.spring_recipients')::jsonb @> '["una61@utrgv.edu", "oscar61@utrgv.edu", "ada61@utrgv.edu"]'::jsonb,
  'Spring''s notice goes to Spring''s students, Oscar who joined, and faculty');
select ok(
  not current_setting('tests.spring_recipients')::jsonb ? 'admin61a@utrgv.edu',
  'but not to the admin who posted it');
select ok(
  not exists (
    select 1 from public.announcement_recipients(current_setting('tests.fall_notice')::uuid)
     where email = 'una61@utrgv.edu'),
  'and Fall''s notice was never Una''s to get');
select is(
  (select count(*) from public.announcement_recipients(gen_random_uuid())), 0::bigint,
  'an announcement that doesn''t exist has nobody to send to');

-- --- admin access, this semester ------------------------------------------------------
-- 18_ refuses admin access to anyone on a team. Since nothing in a closed
-- semester can be deleted, "on a team" has to mean this semester, or a
-- former student could never become an instructor's assistant.

select lives_ok(
  $$ update public.users set is_admin = true where id = current_setting('tests.outsider')::uuid $$,
  'Oscar, whose only team is archived, can be made an admin');
select throws_ok(
  $$ update public.users set is_admin = true where id = current_setting('tests.owner_b')::uuid $$,
  '23514', null,
  'Bea, who owns a team this semester, still cannot');

-- --- deleting a user, closed semesters or not ----------------------------------------
-- The guard refuses a direct delete of an archived row, but a user's seats,
-- check-ins and requests go with them by foreign-key cascade, archived ones
-- included. Pia holds an archived seat on team B and a current one.

select ok(
  exists (select 1 from public.team_members tm
            join public.teams t on t.id = tm.team_id
            join public.projects p on p.id = t.project_id
           where tm.user_id = current_setting('tests.member_b')::uuid
             and p.semester_id = current_setting('tests.fall')::uuid),
  'Pia has a seat in a closed semester');
select lives_ok(
  $$ delete from public.users where id = current_setting('tests.member_b')::uuid $$,
  'deleting her account is not blocked by it');
select is(
  (select count(*) from public.team_members where user_id = current_setting('tests.member_b')::uuid),
  0::bigint,
  'and her seats, archived and current, went with her');

select * from finish();
rollback;
