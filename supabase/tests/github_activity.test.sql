-- Issue #58 — linking a repository, and who may read or write the activity
-- that comes back from it.
--
-- Two rules carry most of this file, and neither is visible in the migration
-- that enforces them:
--
--   1. THE COUNTS ARE GITHUB'S, NOT A STUDENT'S. `repo_activity` has a
--      select policy and no insert, update or delete policy, and
--      save_repo_activity() is granted to service_role alone. So the way a
--      student writes themselves a hundred commits is: they can't. The
--      cases under "writing it" are that sentence, one per door — the
--      function, a direct insert, a direct update, a direct delete.
--
--   2. THE LINK IS VALIDATED IN THREE PLACES AND MUST AGREE. The browser
--      reads what was pasted (frontend/src/lib/github.js), this file's CHECK
--      is the boundary, and the Edge Function splits the stored value
--      strictly (functions/github-activity/activity.js). The refusals below
--      are the same list the other two test, including the two that are
--      security properties rather than typos: a host that merely contains
--      github.com, and a name of dots that would walk the API path.
--
-- The adviser is absent on purpose. #58 asks for "team members and the
-- adviser only", and `adviser_requests` is not on this branch — it arrives
-- with PR #88. supabase/41_github_activity.sql says so where the policy is,
-- and the adviser clause and its cases follow in their own migration.
begin;
select plan(61);

select set_config('tests.owner',    tests.sign_in_with_microsoft('owner58@utrgv.edu', 'Olivia Owner')::text, true);
select set_config('tests.member',   tests.sign_in_with_microsoft('member58@utrgv.edu', 'Mark Member')::text, true);
select set_config('tests.outsider', tests.sign_in_with_microsoft('outsider58@utrgv.edu', 'Otto Outside')::text, true);
select set_config('tests.owner_b',  tests.sign_in_with_microsoft('owner58b@utrgv.edu', 'Bea Builder')::text, true);
select set_config('tests.admin',    tests.sign_in_with_microsoft('instructor58@utrgv.edu', 'Instructor')::text, true);

select set_config('tests.r_pm', (select id from public.roles where name = 'Project Manager')::text, true);
select set_config('tests.r_be', (select id from public.roles where name = 'Backend Developer')::text, true);

-- Done while unauthenticated: protect_admin_flag() in 18_admin_access.sql
-- refuses the `authenticated` role outright.
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;

-- The project under test, with the owner and one member on it.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select set_config('tests.project', (select (public.create_project(
  'Campus parking tracker',
  'Live lot occupancy estimated from existing camera feeds, with a map.',
  3::smallint, current_setting('tests.r_pm')::uuid, '[]'::jsonb)).id::text), true);

select tests.authenticate_as(current_setting('tests.member')::uuid);
select set_config('tests.req_member',
  (select (public.create_join_request(current_setting('tests.project')::uuid)).id::text), true);
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select public.respond_to_join_request(
  current_setting('tests.req_member')::uuid, 'accepted', current_setting('tests.r_be')::uuid);

-- A second project with nothing linked, owned by somebody else. It needs a
-- different owner because team_members.user_id is the primary key — one team
-- per student, so the owner above cannot create a second one.
select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select set_config('tests.project_b', (select (public.create_project(
  'Degree plan builder',
  'Constraint solver that generates a valid path to graduation from prerequisites.',
  2::smallint, current_setting('tests.r_pm')::uuid, '[]'::jsonb)).id::text), true);

select tests.clear_authentication();
select is((select github_repo from public.projects where id = current_setting('tests.project')::uuid),
  '', 'a new project has nothing linked');

-- --- linking it -----------------------------------------------------------

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid,
                                    'https://github.com/Jose-Franco22/TeamUp') $$,
  'the owner links the repository');

select tests.clear_authentication();
select is((select github_repo from public.projects where id = current_setting('tests.project')::uuid),
  'https://github.com/Jose-Franco22/TeamUp',
  'and it is stored exactly as given');

-- Nobody but the owner, including the people closest to being allowed: a
-- member of the same team, and an admin.
select tests.authenticate_as(current_setting('tests.member')::uuid);
select throws_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid,
                                    'https://github.com/someone/else') $$,
  'P0001', 'Only the project creator can link a repository',
  'a team member cannot link a repository');

select tests.authenticate_as(current_setting('tests.outsider')::uuid);
select throws_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid,
                                    'https://github.com/someone/else') $$,
  'P0001', 'Only the project creator can link a repository',
  'nor can a student with nothing to do with the project');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid,
                                    'https://github.com/someone/else') $$,
  'P0001', 'Only the project creator can link a repository',
  'nor an admin, who is not the creator either');

select tests.clear_authentication();
set local role anon;
select throws_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid,
                                    'https://github.com/someone/else') $$,
  '42501', null,
  'and a guest cannot call the function at all');
reset role;

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_ok(
  $$ select public.set_project_repo(gen_random_uuid(),
                                    'https://github.com/Jose-Franco22/TeamUp') $$,
  'P0001', 'Project not found',
  'a project that does not exist is not found, rather than created');

select tests.clear_authentication();
select is((select github_repo from public.projects where id = current_setting('tests.project')::uuid),
  'https://github.com/Jose-Franco22/TeamUp',
  'and none of those refusals changed the link');

-- --- what counts as a repository link -------------------------------------
-- The same list frontend/src/lib/github.js and the Edge Function refuse.

select tests.authenticate_as(current_setting('tests.owner')::uuid);

select throws_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid,
                                    'https://github.com/GoldNicolas') $$,
  'P0001', 'Use the repository link, like https://github.com/owner/repo',
  'a profile link is not a repository');

select throws_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid,
                                    'https://github.com/a/b/tree/main') $$,
  'P0001', 'Use the repository link, like https://github.com/owner/repo',
  'nor is a page inside one');

select throws_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid,
                                    'https://gitlab.com/group/project') $$,
  'P0001', 'Use the repository link, like https://github.com/owner/repo',
  'nor another host');

-- THE SECURITY ONE: a substring check on "github.com" accepts this, and
-- would point the Edge Function's token at somebody else's server.
select throws_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid,
                                    'https://github.com.evil.example/a/b') $$,
  'P0001', 'Use the repository link, like https://github.com/owner/repo',
  'nor a host that only looks like GitHub');

select throws_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid,
                                    'http://github.com/a/b') $$,
  'P0001', 'Use the repository link, like https://github.com/owner/repo',
  'nor plain http');

-- THE OTHER SECURITY ONE: /repos/a/../commits is a different endpoint.
select throws_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid,
                                    'https://github.com/a/..') $$,
  'P0001', 'Use the repository link, like https://github.com/owner/repo',
  'nor a name that is only dots, which would walk the API path');

-- GitHub refuses a repository name ending in .git, so one arriving here
-- means the browser did not strip the suffix.
select throws_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid,
                                    'https://github.com/a/b.git') $$,
  'P0001', 'Use the repository link, like https://github.com/owner/repo',
  'nor a name ending in .git');

select throws_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid,
                                    'https://github.com/a b/c d') $$,
  'P0001', 'Use the repository link, like https://github.com/owner/repo',
  'nor anything with a space in it');

-- A dot inside the name is legal, and a common one: foo.github.io.
select lives_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid,
                                    'https://github.com/utrgv/senior.project_2026-v2') $$,
  'dots, underscores and hyphens are all legal in a repository name');

-- The CHECK constraint, not the function: it is what stops a write that
-- comes in some other way, and it has to refuse the same things.
select tests.clear_authentication();
select throws_ok(
  $$ update public.projects set github_repo = 'nope'
      where id = current_setting('tests.project')::uuid $$,
  '23514', null,
  'and the constraint refuses a bad link even to a superuser');

select throws_ok(
  $$ update public.projects set github_repo = 'https://github.com/a/..'
      where id = current_setting('tests.project')::uuid $$,
  '23514', null,
  'dots included');

-- --- unlinking ------------------------------------------------------------

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid, '') $$,
  'the owner can unlink by passing nothing');

select tests.clear_authentication();
select is((select github_repo from public.projects where id = current_setting('tests.project')::uuid),
  '', 'and the project is back to having no repository');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid,
                                    'https://github.com/Jose-Franco22/TeamUp') $$,
  'and can link it again afterwards');

-- Whitespace around a pasted link is trimmed rather than refused.
select lives_ok(
  $$ select public.set_project_repo(current_setting('tests.project')::uuid,
                                    '  https://github.com/Jose-Franco22/TeamUp  ') $$,
  'a link pasted with whitespace around it is trimmed, not refused');
select tests.clear_authentication();
select is((select github_repo from public.projects where id = current_setting('tests.project')::uuid),
  'https://github.com/Jose-Franco22/TeamUp', 'and stored without it');

-- --- writing the activity -------------------------------------------------
-- Only the Edge Function, which calls as service_role.

set local role service_role;
select lives_ok(
  $$ select public.save_repo_activity(
       current_setting('tests.project')::uuid,
       'https://github.com/Jose-Franco22/TeamUp',
       '[{"login":"GoldNicolas","name":null,"commits":7,"pull_requests":2,
          "last_commit_at":"2026-11-18T10:00:00Z"}]'::jsonb,
       '2026-11-18T10:00:00Z'::timestamptz, 14, null) $$,
  'the Edge Function writes what GitHub said');
reset role;

select tests.clear_authentication();
select is((select jsonb_array_length(contributors) from public.repo_activity
            where project_id = current_setting('tests.project')::uuid), 1,
  'and the row holds the contributors it was given');
select is((select contributors -> 0 ->> 'commits' from public.repo_activity
            where project_id = current_setting('tests.project')::uuid), '7',
  'with their counts');

-- Replaced whole, never merged: a half-written row would show a member as
-- having contributed nothing.
set local role service_role;
select public.save_repo_activity(
  current_setting('tests.project')::uuid,
  'https://github.com/Jose-Franco22/TeamUp',
  '[{"login":"Jose-Franco22","commits":3,"pull_requests":1,"last_commit_at":null}]'::jsonb,
  null, 14, null);
reset role;

select tests.clear_authentication();
select is((select count(*)::int from public.repo_activity
            where project_id = current_setting('tests.project')::uuid), 1,
  'a second refresh replaces the row rather than adding one');
select is((select contributors -> 0 ->> 'login' from public.repo_activity
            where project_id = current_setting('tests.project')::uuid), 'Jose-Franco22',
  'and holds only the newer answer');

-- THE RULE: a student cannot write their own numbers. Not through the
-- function, and not past it.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_ok(
  $$ select public.save_repo_activity(current_setting('tests.project')::uuid,
       'https://github.com/Jose-Franco22/TeamUp', '[]'::jsonb, null, 14, null) $$,
  '42501', null,
  'the owner cannot call save_repo_activity');

select tests.authenticate_as(current_setting('tests.member')::uuid);
select throws_ok(
  $$ select public.save_repo_activity(current_setting('tests.project')::uuid,
       'https://github.com/Jose-Franco22/TeamUp', '[]'::jsonb, null, 14, null) $$,
  '42501', null,
  'nor can a member');

select tests.clear_authentication();
set local role anon;
select throws_ok(
  $$ select public.save_repo_activity(current_setting('tests.project')::uuid,
       'https://github.com/Jose-Franco22/TeamUp', '[]'::jsonb, null, 14, null) $$,
  '42501', null,
  'nor a guest');
reset role;

-- Past the function: there is no insert policy, so the row is refused
-- outright; there is no update or delete policy, so those find no row to
-- act on and change nothing. Both are checked, because they fail
-- differently and only one of them raises.
select tests.authenticate_as(current_setting('tests.member')::uuid);
select throws_ok(
  $$ insert into public.repo_activity (project_id, repo, contributors)
     values (current_setting('tests.project_b')::uuid,
             'https://github.com/made/up', '[]'::jsonb) $$,
  '42501', null,
  'and a direct insert is refused by the policy');

select lives_ok(
  $$ update public.repo_activity
        set contributors = '[{"login":"Mark","commits":999,"pull_requests":0}]'::jsonb
      where project_id = current_setting('tests.project')::uuid $$,
  'a direct update raises nothing...');
select tests.clear_authentication();
select is((select contributors -> 0 ->> 'login' from public.repo_activity
            where project_id = current_setting('tests.project')::uuid), 'Jose-Franco22',
  '...because it changed nothing: there is no update policy to pass');

select tests.authenticate_as(current_setting('tests.member')::uuid);
select lives_ok(
  $$ delete from public.repo_activity
      where project_id = current_setting('tests.project')::uuid $$,
  'a direct delete raises nothing either...');
select tests.clear_authentication();
select is((select count(*)::int from public.repo_activity
            where project_id = current_setting('tests.project')::uuid), 1,
  '...and the row is still there');

-- What the function itself refuses, as the constraints state it.
set local role service_role;
select throws_ok(
  $$ select public.save_repo_activity(gen_random_uuid(),
       'https://github.com/a/b', '[]'::jsonb, null, 14, null) $$,
  'P0001', 'Project not found',
  'activity for a project that does not exist is refused');

select throws_ok(
  $$ select public.save_repo_activity(current_setting('tests.project')::uuid,
       'https://github.com/a/b', '{"login":"not a list"}'::jsonb, null, 14, null) $$,
  '23514', null,
  'contributors has to be an array');

-- A code the page has no sentence for would render as nothing at all.
select throws_ok(
  $$ select public.save_repo_activity(current_setting('tests.project')::uuid,
       'https://github.com/a/b', '[]'::jsonb, null, 14, 'something new') $$,
  '23514', null,
  'and an error code the page cannot explain is refused');

select lives_ok(
  $$ select public.save_repo_activity(current_setting('tests.project')::uuid,
       'https://github.com/Jose-Franco22/TeamUp', '[]'::jsonb, null, 14, 'not_found') $$,
  'while a known one is recorded');
reset role;

select tests.clear_authentication();
select is((select error from public.repo_activity
            where project_id = current_setting('tests.project')::uuid), 'not_found',
  'so the page can explain how to grant access');

-- --- who can read it ------------------------------------------------------

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select is((select count(*)::int from public.repo_activity
            where project_id = current_setting('tests.project')::uuid), 1,
  'the owner reads their team''s activity');

select tests.authenticate_as(current_setting('tests.member')::uuid);
select is((select count(*)::int from public.repo_activity
            where project_id = current_setting('tests.project')::uuid), 1,
  'and so does a member');

-- Who committed how much is the team's business.
select tests.authenticate_as(current_setting('tests.outsider')::uuid);
select is((select count(*)::int from public.repo_activity
            where project_id = current_setting('tests.project')::uuid), 0,
  'a student not on the team sees nothing');

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select is((select count(*)::int from public.repo_activity
            where project_id = current_setting('tests.project')::uuid), 0,
  'nor does somebody on a different team');

select tests.clear_authentication();
set local role anon;
select is((select count(*)::int from public.repo_activity
            where project_id = current_setting('tests.project')::uuid), 0,
  'and a guest sees nothing, though the link itself is public');
reset role;

-- The link is public on purpose: it is a column on `projects`, which guests
-- browse. Asserted rather than left implied, so a future reader knows the
-- asymmetry was a decision.
set local role anon;
select is((select github_repo from public.projects where id = current_setting('tests.project')::uuid),
  'https://github.com/Jose-Franco22/TeamUp',
  'a guest can see which repository a team linked');
reset role;

-- --- what the Edge Function asks before spending a request ---------------

select tests.authenticate_as(current_setting('tests.member')::uuid);
select is((select public.project_repo_for_refresh(current_setting('tests.project')::uuid)),
  'https://github.com/Jose-Franco22/TeamUp',
  'a member may refresh, and is told what to fetch');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select is((select public.project_repo_for_refresh(current_setting('tests.project')::uuid)),
  'https://github.com/Jose-Franco22/TeamUp',
  'so may the owner');

-- GitHub allows the whole course 5,000 requests an hour. An endpoint any
-- signed-in student could spin is the easiest way to spend them.
select tests.authenticate_as(current_setting('tests.outsider')::uuid);
select throws_ok(
  $$ select public.project_repo_for_refresh(current_setting('tests.project')::uuid) $$,
  'P0001', 'Only the team can refresh this repository',
  'a student not on the team may not spend a GitHub request on it');

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select throws_ok(
  $$ select public.project_repo_for_refresh(current_setting('tests.project_b')::uuid) $$,
  'P0001', 'No repository is linked to this project',
  'and a team with nothing linked is told that, rather than fetching nothing');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_ok(
  $$ select public.project_repo_for_refresh(gen_random_uuid()) $$,
  'P0001', 'Project not found',
  'a project that does not exist is not found');

select tests.clear_authentication();
set local role anon;
select throws_ok(
  $$ select public.project_repo_for_refresh(current_setting('tests.project')::uuid) $$,
  '42501', null,
  'and a guest cannot call it at all');
reset role;

-- --- after rosters lock ---------------------------------------------------
-- #58 exists because of faculty feedback asking for TeamUp to be useful
-- *after* a team forms, so the formation deadline must not reach this.
--
-- It doesn't, and the reason is one word in 26_milestones.sql: that trigger
-- is `before insert on public.projects`, not before update. Nothing in
-- migration 41 would fail if someone widened it, which is exactly why this
-- case is here. Done on project B, so the main project's link is undisturbed.

select tests.clear_authentication();
update public.milestones set is_formation_deadline = false where is_formation_deadline;
insert into public.milestones (name, due_at, is_formation_deadline)
values ('Teams lock', now() - interval '1 day', true);

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select lives_ok(
  $$ select public.set_project_repo(current_setting('tests.project_b')::uuid,
                                    'https://github.com/utrgv/degree-plan') $$,
  'a repository can still be linked after rosters lock — that is the point of #58');

select tests.clear_authentication();
select is((select github_repo from public.projects where id = current_setting('tests.project_b')::uuid),
  'https://github.com/utrgv/degree-plan', 'and it is stored');

-- --- changing the link throws the old answer away -------------------------
-- Otherwise a team that has just fixed a typo spends up to fifteen minutes
-- looking at somebody else's commits.

select tests.clear_authentication();
select is((select count(*)::int from public.repo_activity
            where project_id = current_setting('tests.project')::uuid), 1,
  'there is a cached answer before the link changes');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select public.set_project_repo(current_setting('tests.project')::uuid,
                               'https://github.com/utrgv/parking-tracker');
select tests.clear_authentication();
select is((select count(*)::int from public.repo_activity
            where project_id = current_setting('tests.project')::uuid), 0,
  'and it is gone once the project points somewhere else');

-- Re-saving the same link is not a change, and must not throw away an
-- answer that is still about the right repository.
set local role service_role;
select public.save_repo_activity(current_setting('tests.project')::uuid,
  'https://github.com/utrgv/parking-tracker', '[]'::jsonb, null, 14, null);
reset role;
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select public.set_project_repo(current_setting('tests.project')::uuid,
                               'https://github.com/utrgv/parking-tracker');
select tests.clear_authentication();
select is((select count(*)::int from public.repo_activity
            where project_id = current_setting('tests.project')::uuid), 1,
  'while setting the same link again keeps it');

-- --- the project goes away ------------------------------------------------
-- Deleted directly rather than through delete_team(), which has rules of
-- its own about the roster. What is under test is the cascade.

delete from public.projects where id = current_setting('tests.project')::uuid;
select is((select count(*)::int from public.repo_activity
            where project_id = current_setting('tests.project')::uuid), 0,
  'deleting the project takes its cached activity with it');

select * from finish();
rollback;
