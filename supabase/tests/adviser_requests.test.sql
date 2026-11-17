-- Issue #53 — asking someone to advise a project, and the rule that an
-- adviser takes no seat.
--
-- The seat rule is why this file is long. supabase/39_project_advisers.sql
-- gets it by not touching the roster code at all, which is the right design
-- and also an invisible one: nothing in that migration says "and the member
-- count stays the same." The cases under THE SEAT RULE are where that gets
-- said, one per guard an adviser has to pass through untouched —
-- project_member_count(), sync_project_fill_state(), the team_members
-- primary key, and the "already on a team" checks in create_join_request()
-- and create_project().
--
-- Answering an invitation is #54, so nothing here writes 'accepted'. The
-- cases that need an accepted adviser set the status directly, while
-- unauthenticated, and say so. When #54 lands those lines become calls to
-- its function and these assertions should still pass unchanged.
begin;
select plan(84);

select set_config('tests.owner',   tests.sign_in_with_microsoft('owner53@utrgv.edu', 'Olivia Owner')::text, true);
select set_config('tests.member',  tests.sign_in_with_microsoft('member53@utrgv.edu', 'Mark Member')::text, true);
select set_config('tests.second',  tests.sign_in_with_microsoft('second53@utrgv.edu', 'Sam Second')::text, true);
select set_config('tests.adviser', tests.sign_in_with_microsoft('adviser53@utrgv.edu', 'Ada Adviser')::text, true);
select set_config('tests.other',   tests.sign_in_with_microsoft('other53@utrgv.edu', 'Otto Other')::text, true);
select set_config('tests.owner_b', tests.sign_in_with_microsoft('owner53b@utrgv.edu', 'Bea Builder')::text, true);
select set_config('tests.adviser_b', tests.sign_in_with_microsoft('adviser53b@utrgv.edu', 'Ben Backup')::text, true);
select set_config('tests.admin',   tests.sign_in_with_microsoft('instructor53@utrgv.edu', 'Instructor')::text, true);

select set_config('tests.r_pm', (select id from public.roles where name = 'Project Manager')::text, true);
select set_config('tests.r_be', (select id from public.roles where name = 'Backend Developer')::text, true);

-- An admin account, so the "advisers are students" rule has something to
-- refuse. Done while unauthenticated: protect_admin_flag() in
-- 18_admin_access.sql refuses the `authenticated` role outright.
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;

-- A three-seat project with the owner and one member on it, so it reads two
-- of three and still open. Every seat-rule assertion below is about an
-- adviser moving neither number.
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

-- A second project, owned by somebody else, with an adviser of its own.
-- It is here for the per-project cases: one project's adviser must not be
-- another's, and deleting it has to take its adviser history with it.
select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select set_config('tests.project_b', (select (public.create_project(
  'Degree plan builder',
  'Constraint solver that generates a valid path to graduation from prerequisites.',
  3::smallint, current_setting('tests.r_pm')::uuid, '[]'::jsonb)).id::text), true);
select public.invite_adviser(current_setting('tests.project_b')::uuid,
                             current_setting('tests.adviser_b')::uuid);

select tests.clear_authentication();
select is((select public.project_member_count(current_setting('tests.project')::uuid)), 2,
  'the project starts at two of three members');
select is((select status from public.projects where id = current_setting('tests.project')::uuid), 'open',
  'and is open');

-- --- the owner asks someone ----------------------------------------------

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.invite_adviser(current_setting('tests.project')::uuid,
                                  current_setting('tests.adviser')::uuid) $$,
  'the owner invites someone to advise');

select tests.clear_authentication();
select is((select count(*)::int from public.adviser_requests
            where project_id = current_setting('tests.project')::uuid), 1,
  'one request exists');
select is((select status from public.adviser_requests
            where project_id = current_setting('tests.project')::uuid), 'pending',
  'it is pending');
select is((select adviser_id from public.adviser_requests
            where project_id = current_setting('tests.project')::uuid),
  current_setting('tests.adviser')::uuid,
  'it names the person asked');
select is((select invited_by from public.adviser_requests
            where project_id = current_setting('tests.project')::uuid),
  current_setting('tests.owner')::uuid,
  'and who asked them');
select is((select responded_at from public.adviser_requests
            where project_id = current_setting('tests.project')::uuid), null,
  'and nothing has been answered yet');

-- An invitation nothing tells them about is no invitation.
select is((select count(*)::int from public.notifications
            where user_id = current_setting('tests.adviser')::uuid and kind = 'adviser_invited'), 1,
  'the person asked is told');
select is((select project_id from public.notifications
            where user_id = current_setting('tests.adviser')::uuid and kind = 'adviser_invited'),
  current_setting('tests.project')::uuid,
  'the notification points at the project');
select is((select actor_id from public.notifications
            where user_id = current_setting('tests.adviser')::uuid and kind = 'adviser_invited'),
  current_setting('tests.owner')::uuid,
  'and records who asked');

-- --- who may not ask, and who may not be asked ---------------------------

select tests.authenticate_as(current_setting('tests.member')::uuid);
select throws_like(
  $$ select public.invite_adviser(current_setting('tests.project')::uuid,
                                  current_setting('tests.other')::uuid) $$,
  '%Only the project creator can invite an adviser%',
  'a member of the team cannot invite an adviser');

select tests.authenticate_as(current_setting('tests.other')::uuid);
select throws_like(
  $$ select public.invite_adviser(current_setting('tests.project')::uuid,
                                  current_setting('tests.other')::uuid) $$,
  '%Only the project creator can invite an adviser%',
  'and neither can a student with nothing to do with it');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_like(
  $$ select public.invite_adviser(current_setting('tests.project')::uuid,
                                  current_setting('tests.owner')::uuid) $$,
  '%You cannot invite yourself%',
  'the owner cannot be their own adviser');

select throws_like(
  $$ select public.invite_adviser(current_setting('tests.project')::uuid, gen_random_uuid()) $$,
  '%That account does not exist%',
  'inviting an account that is not there is an error, not a dangling row');

select throws_like(
  $$ select public.invite_adviser(current_setting('tests.project')::uuid,
                                  current_setting('tests.admin')::uuid) $$,
  '%Admin accounts cannot advise%',
  'an admin account cannot advise — 18_admin_access.sql keeps them out of student teams');

select throws_like(
  $$ select public.invite_adviser(current_setting('tests.project')::uuid,
                                  current_setting('tests.member')::uuid) $$,
  '%already on this team%',
  'and neither can somebody already on the team');

select throws_like(
  $$ select public.invite_adviser(current_setting('tests.project')::uuid,
                                  current_setting('tests.other')::uuid) $$,
  '%already has a pending adviser request%',
  'a second invitation is refused while one is still unanswered');

select throws_like(
  $$ select public.invite_adviser(gen_random_uuid(), current_setting('tests.other')::uuid) $$,
  '%Project not found%',
  'inviting somebody to advise a project that does not exist is refused');

-- The function's check is the readable error; the index is the rule. Run
-- unauthenticated, so RLS is out of the way and the index is what answers.
select tests.clear_authentication();
select throws_ok(
  $$ insert into public.adviser_requests (project_id, adviser_id, invited_by)
     values (current_setting('tests.project')::uuid,
             current_setting('tests.other')::uuid,
             current_setting('tests.owner')::uuid) $$,
  '23505',
  'and the unique index refuses a second open row even on a direct insert');

-- Still nobody signed in, so this is the anonymous case.
select throws_like(
  $$ select public.invite_adviser(current_setting('tests.project')::uuid,
                                  current_setting('tests.other')::uuid) $$,
  '%Not signed in%',
  'an unauthenticated caller gets nowhere');

-- --- cancelling ----------------------------------------------------------

select tests.authenticate_as(current_setting('tests.other')::uuid);
select throws_like(
  $$ select public.cancel_adviser_request(current_setting('tests.project')::uuid) $$,
  '%Only the project creator can cancel an adviser request%',
  'somebody else cannot cancel the invitation');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.cancel_adviser_request(current_setting('tests.project')::uuid) $$,
  'the owner cancels it');

select tests.clear_authentication();
select is((select status from public.adviser_requests
            where project_id = current_setting('tests.project')::uuid), 'cancelled',
  'the request is cancelled, not deleted — the owner can still see what happened');
select isnt((select responded_at from public.adviser_requests
              where project_id = current_setting('tests.project')::uuid), null,
  'and when');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_like(
  $$ select public.cancel_adviser_request(current_setting('tests.project')::uuid) $$,
  '%no pending adviser request to cancel%',
  'cancelling twice is an error, not a silent no-op');

-- A cancelled invitation leaves the panel empty, rather than showing the
-- person the owner just dropped.
select is((select count(*)::int from public.project_adviser(current_setting('tests.project')::uuid)), 0,
  'and the project reads as having no adviser again');

-- No open row right now, so RLS is the only thing in the way of a direct
-- insert — there is no insert policy on the table at all, on purpose.
select throws_ok(
  $$ insert into public.adviser_requests (project_id, adviser_id, invited_by)
     values (current_setting('tests.project')::uuid,
             current_setting('tests.other')::uuid,
             current_setting('tests.owner')::uuid) $$,
  '42501',
  'even the owner cannot write a request straight at the table');

select lives_ok(
  $$ select public.invite_adviser(current_setting('tests.project')::uuid,
                                  current_setting('tests.adviser')::uuid) $$,
  'so somebody can be asked again after a cancellation');

-- --- the person asked cannot answer by writing to the table --------------
-- There is no update policy either, and RLS filters an UPDATE rather than
-- raising on it: the write silently matches no rows. #54's function is the
-- only way to accept.

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select is((select count(*)::int from public.adviser_requests
            where project_id = current_setting('tests.project')::uuid
              and adviser_id = current_setting('tests.adviser')::uuid
              and status = 'pending'), 1,
  'the person asked can read their own invitation');
update public.adviser_requests set status = 'accepted'
 where project_id = current_setting('tests.project')::uuid;

select tests.clear_authentication();
select is((select status from public.adviser_requests
            where project_id = current_setting('tests.project')::uuid
              and status in ('pending', 'accepted')), 'pending',
  'but cannot accept it themselves by updating the row');

-- --- a decline stays visible, and can be asked again ---------------------
-- Set directly: responding is #54.

update public.adviser_requests
   set status = 'declined', responded_at = now()
 where project_id = current_setting('tests.project')::uuid and status = 'pending';

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select is((select status from public.project_adviser(current_setting('tests.project')::uuid)), 'declined',
  'a declined invitation is still shown — the owner needs the answer, not an empty panel');

select lives_ok(
  $$ select public.invite_adviser(current_setting('tests.project')::uuid,
                                  current_setting('tests.adviser')::uuid) $$,
  'and the same person can be asked again, since a decline is an answer and not a ban');

select tests.clear_authentication();
select is((select count(*)::int from public.adviser_requests
            where project_id = current_setting('tests.project')::uuid), 3,
  'every invitation is kept: cancelled, declined, and the one now open');
select is((select count(*)::int from public.adviser_requests
            where project_id = current_setting('tests.project')::uuid
              and status in ('pending', 'accepted')), 1,
  'but only one of them is open');

-- --- THE SEAT RULE -------------------------------------------------------
-- The adviser accepts. Set directly (#54 owns the function); everything
-- below is an assertion that the roster code was left alone.

update public.adviser_requests
   set status = 'accepted', responded_at = now()
 where project_id = current_setting('tests.project')::uuid and status = 'pending';

select is((select public.project_member_count(current_setting('tests.project')::uuid)), 2,
  'an accepted adviser does not change project_member_count');
select is((select status from public.projects where id = current_setting('tests.project')::uuid), 'open',
  'and does not fill the project');
select is((select count(*)::int from public.team_members tm
            join public.teams t on t.id = tm.team_id
           where t.project_id = current_setting('tests.project')::uuid
             and tm.user_id = current_setting('tests.adviser')::uuid), 0,
  'the adviser is not on the roster');
select is((select count(*)::int from public.team_members
            where user_id = current_setting('tests.adviser')::uuid), 0,
  'and is on no roster at all, so advising has not used up their one team');

-- sync_project_fill_state() recomputes status from the roster. Called
-- explicitly: if an adviser ever started counting, this is where it shows.
select public.sync_project_fill_state(current_setting('tests.project')::uuid);
select is((select status from public.projects where id = current_setting('tests.project')::uuid), 'open',
  'recomputing the fill state with an adviser attached still says open');
select is((select formed_at from public.teams
            where project_id = current_setting('tests.project')::uuid), null,
  'and the team is still unformed');

-- Both "already on a team" guards, from an adviser's side.
select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select lives_ok(
  $$ select public.create_join_request(current_setting('tests.project_b')::uuid) $$,
  'advising one project does not stop the adviser asking to join another');

select set_config('tests.req_adviser',
  (select id::text from public.join_requests
    where user_id = current_setting('tests.adviser')::uuid
      and project_id = current_setting('tests.project_b')::uuid), true);

select tests.authenticate_as(current_setting('tests.adviser_b')::uuid);
select lives_ok(
  $$ select public.create_project('Lab equipment sign-out',
       'Reservation system for shared hardware with conflict detection and history.',
       2::smallint, current_setting('tests.r_pm')::uuid, '[]'::jsonb) $$,
  'and project B adviser can still start a project of their own');

-- team_members.user_id is the primary key — one team per student, ever.
-- Advising did not consume it: the adviser can still be seated properly.
select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select lives_ok(
  $$ select public.respond_to_join_request(
       current_setting('tests.req_adviser')::uuid, 'accepted', current_setting('tests.r_be')::uuid) $$,
  'the adviser can be accepted onto another team');

select tests.clear_authentication();
select is((select count(*)::int from public.team_members
            where user_id = current_setting('tests.adviser')::uuid), 1,
  'which gives them exactly one roster row');
select is((select status from public.adviser_requests
            where project_id = current_setting('tests.project')::uuid
              and status in ('pending', 'accepted')), 'accepted',
  'and they are still the adviser of the first project');
select is((select public.project_member_count(current_setting('tests.project')::uuid)), 2,
  'whose member count is still two');

-- --- the project fills up, and the adviser still is not in it ------------

select tests.authenticate_as(current_setting('tests.second')::uuid);
select set_config('tests.req_second',
  (select (public.create_join_request(current_setting('tests.project')::uuid)).id::text), true);
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.respond_to_join_request(
       current_setting('tests.req_second')::uuid, 'accepted', current_setting('tests.r_be')::uuid) $$,
  'a third student fills the last real seat');

select tests.clear_authentication();
select is((select public.project_member_count(current_setting('tests.project')::uuid)), 3,
  'the count is three of three, counting nobody but the roster');
select is((select status from public.projects where id = current_setting('tests.project')::uuid), 'full',
  'the project is full');
select isnt((select formed_at from public.teams
              where project_id = current_setting('tests.project')::uuid), null,
  'and the team is formed');

-- --- removing an adviser who had accepted --------------------------------

select tests.authenticate_as(current_setting('tests.other')::uuid);
select throws_like(
  $$ select public.remove_adviser(current_setting('tests.project')::uuid) $$,
  '%Only the project creator can remove the adviser%',
  'somebody else cannot remove the adviser');

select tests.authenticate_as(current_setting('tests.member')::uuid);
select throws_like(
  $$ select public.remove_adviser(current_setting('tests.project')::uuid) $$,
  '%Only the project creator can remove the adviser%',
  'and neither can a member of the team — they see the adviser but cannot change it');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.remove_adviser(current_setting('tests.project')::uuid) $$,
  'the owner removes the adviser');

select tests.clear_authentication();
select is((select count(*)::int from public.adviser_requests
            where project_id = current_setting('tests.project')::uuid
              and status in ('pending', 'accepted')), 0,
  'the project has no adviser any more');

-- Unlike a cancelled invitation, this one is told: they had said yes.
select is((select count(*)::int from public.notifications
            where user_id = current_setting('tests.adviser')::uuid and kind = 'adviser_removed'), 1,
  'and the adviser is told they were removed');
select is((select count(*)::int from public.notifications
            where user_id = current_setting('tests.adviser')::uuid and kind = 'adviser_invited'), 3,
  'while the three invitations they were sent are left as they were, not rewritten');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_like(
  $$ select public.remove_adviser(current_setting('tests.project')::uuid) $$,
  '%no adviser to remove%',
  'removing again is an error, not a silent no-op');

-- The project is full by now, which is the seat rule from the other side:
-- a full project can still take an adviser, because an adviser is not a seat.
select lives_ok(
  $$ select public.invite_adviser(current_setting('tests.project')::uuid,
                                  current_setting('tests.other')::uuid) $$,
  'and a full project can still invite somebody to advise it');

-- --- searching for somebody to ask ---------------------------------------

select tests.authenticate_as(current_setting('tests.other')::uuid);
select throws_like(
  $$ select * from public.search_advisers(current_setting('tests.project')::uuid, 'Ada') $$,
  '%Only the project creator can look for an adviser%',
  'only the owner can search');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select is((select count(*)::int from public.search_advisers(current_setting('tests.project')::uuid, 'A')), 0,
  'a one-character search returns nothing, rather than the whole student body');
select is((select count(*)::int from public.search_advisers(current_setting('tests.project')::uuid, '')), 0,
  'and so does an empty one');

select is((select count(*)::int from public.search_advisers(
            current_setting('tests.project')::uuid, 'Ada Adviser')), 1,
  'searching a name finds that student');
select is((select count(*)::int from public.search_advisers(
            current_setting('tests.project')::uuid, 'adviser53@utrgv.edu')), 1,
  'and so does searching their email');
select is((select count(*)::int from public.search_advisers(
            current_setting('tests.project')::uuid, 'ada adviser')), 1,
  'case does not matter');

select is((select count(*)::int from public.search_advisers(
            current_setting('tests.project')::uuid, 'Olivia Owner')), 0,
  'the owner is not offered as their own adviser');
select is((select count(*)::int from public.search_advisers(
            current_setting('tests.project')::uuid, 'Mark Member')), 0,
  'nor is anybody already on the team');
select is((select count(*)::int from public.search_advisers(
            current_setting('tests.project')::uuid, 'Instructor')), 0,
  'nor an admin account');
select is((select count(*)::int from public.search_advisers(
            current_setting('tests.project')::uuid, 'Otto Other')), 0,
  'nor whoever is already holding an open invitation');

-- Ada declined once and was removed as adviser once, so she holds no open
-- row. She is listed again, because asking again is allowed — and she is on
-- another team now, which is no bar to advising this one.
select is((select name from public.search_advisers(
            current_setting('tests.project')::uuid, 'Ada')), 'Ada Adviser',
  'somebody who declined before, and who has a team of their own, is still listed');

-- --- what the two screens read -------------------------------------------

select is((select status from public.project_adviser(current_setting('tests.project')::uuid)), 'pending',
  'project_adviser reports the open invitation');
select is((select adviser_email from public.project_adviser(current_setting('tests.project')::uuid)),
  'other53@utrgv.edu',
  'the owner sees the email, to contact them outside the app');

select tests.authenticate_as(current_setting('tests.member')::uuid);
select is((select adviser_name from public.project_adviser(current_setting('tests.project')::uuid)),
  'Otto Other',
  'a member of the team sees who the adviser is');
select is((select adviser_email from public.project_adviser(current_setting('tests.project')::uuid)), null,
  'but not their email — only the owner has a reason to hold it');

select throws_like(
  $$ select * from public.project_adviser(gen_random_uuid()) $$,
  '%Project not found%',
  'and asking about a project that does not exist is an error');

-- The Browse list's version: accepted only, many projects in one call.
select is((select count(*)::int from public.project_advisers(
            array[current_setting('tests.project')::uuid,
                  current_setting('tests.project_b')::uuid])), 0,
  'project_advisers ignores pending invitations — a card only names a settled adviser');

select tests.clear_authentication();
update public.adviser_requests
   set status = 'accepted', responded_at = now()
 where project_id = current_setting('tests.project')::uuid and status = 'pending';

select tests.authenticate_as(current_setting('tests.member')::uuid);
select is((select count(*)::int from public.project_advisers(
            array[current_setting('tests.project')::uuid,
                  current_setting('tests.project_b')::uuid])), 1,
  'and reports the accepted one');
select is((select adviser_name from public.project_advisers(
            array[current_setting('tests.project')::uuid])), 'Otto Other',
  'by name');

-- --- who can read the table ----------------------------------------------

select tests.authenticate_as(current_setting('tests.other')::uuid);
select is((select count(*)::int from public.adviser_requests
            where project_id = current_setting('tests.project')::uuid
              and adviser_id = current_setting('tests.other')::uuid), 1,
  'the adviser reads their own row');

-- Ben advises project B and has a team of his own. Neither gives him any
-- view of this project's adviser history.
select tests.authenticate_as(current_setting('tests.adviser_b')::uuid);
select is((select count(*)::int from public.adviser_requests
            where project_id = current_setting('tests.project')::uuid), 0,
  'an unrelated student reads none of another project adviser history');
select is((select count(*)::int from public.adviser_requests
            where project_id = current_setting('tests.project_b')::uuid), 1,
  'while still reading the invitation they were sent themselves');

select tests.authenticate_as(current_setting('tests.member')::uuid);
select is((select count(*)::int from public.adviser_requests
            where project_id = current_setting('tests.project')::uuid), 4,
  'and the team reads its own, all four invitations of it');

-- --- the project goes away ------------------------------------------------
-- Deleted directly rather than through delete_team(), which has rules of its
-- own about who is on the roster. What is under test is the cascade.

select tests.clear_authentication();
select is((select count(*)::int from public.adviser_requests
            where project_id = current_setting('tests.project_b')::uuid), 1,
  'project B has an adviser request before it is deleted');
delete from public.projects where id = current_setting('tests.project_b')::uuid;
select is((select count(*)::int from public.adviser_requests
            where project_id = current_setting('tests.project_b')::uuid), 0,
  'and its adviser history goes with it, rather than pointing at nothing');

select * from finish();
rollback;
