-- Issue #54 — answering a request to advise, and what an adviser may and may
-- not do once they have accepted.
--
-- adviser_requests.test.sql (#53) covers the owner's half and sets 'accepted'
-- by hand, because nothing could write it yet. This file writes it through
-- respond_to_adviser_request(), so the seat-rule cases are worth repeating
-- here against a genuinely accepted adviser rather than a row somebody typed:
-- accepting is the exact moment a future change would be tempted to seat one.
--
-- The other half of this file is the boundary the issue asks for in words —
-- "I can view the team page and its members but can't edit the project,
-- accept join requests or manage members". None of that needed building: the
-- functions already check the creator. Which is precisely why it needs
-- testing, since nothing in #54's diff would break if it stopped being true.
begin;
select plan(67);

select set_config('tests.owner',   tests.sign_in_with_microsoft('owner54@utrgv.edu', 'Olivia Owner')::text, true);
select set_config('tests.member',  tests.sign_in_with_microsoft('member54@utrgv.edu', 'Mark Member')::text, true);
select set_config('tests.adviser', tests.sign_in_with_microsoft('adviser54@utrgv.edu', 'Ada Adviser')::text, true);
select set_config('tests.other',   tests.sign_in_with_microsoft('other54@utrgv.edu', 'Otto Other')::text, true);
select set_config('tests.owner_b', tests.sign_in_with_microsoft('owner54b@utrgv.edu', 'Bea Builder')::text, true);
select set_config('tests.seeker',  tests.sign_in_with_microsoft('seeker54@utrgv.edu', 'Sam Seeker')::text, true);

select set_config('tests.r_pm', (select id from public.roles where name = 'Project Manager')::text, true);
select set_config('tests.r_be', (select id from public.roles where name = 'Backend Developer')::text, true);

-- Only accounts on the CS faculty directory can be asked to advise
-- (44_faculty_advisers.sql, which merged alongside this file). These three
-- are the ones this file invites; everyone else stays a student.
insert into public.faculty_directory (email) values
  ('adviser54@utrgv.edu'), ('other54@utrgv.edu'), ('seeker54@utrgv.edu');

-- A three-seat project, owner plus one member, with an invitation out to Ada.
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

select set_config('tests.invite',
  (select (public.invite_adviser(current_setting('tests.project')::uuid,
                                 current_setting('tests.adviser')::uuid)).id::text), true);

-- A second project, so "I can advise more than one" has somewhere to happen.
select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select set_config('tests.project_b', (select (public.create_project(
  'Degree plan builder',
  'Constraint solver that generates a valid path to graduation from prerequisites.',
  3::smallint, current_setting('tests.r_pm')::uuid, '[]'::jsonb)).id::text), true);
select set_config('tests.invite_b',
  (select (public.invite_adviser(current_setting('tests.project_b')::uuid,
                                 current_setting('tests.adviser')::uuid)).id::text), true);

-- --- only the person asked may answer -------------------------------------

select tests.authenticate_as(current_setting('tests.other')::uuid);
select throws_like(
  $$ select public.respond_to_adviser_request(current_setting('tests.invite')::uuid, true) $$,
  '%Only the person who was asked can answer%',
  'a student who was not asked cannot answer the invitation');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_like(
  $$ select public.respond_to_adviser_request(current_setting('tests.invite')::uuid, true) $$,
  '%Only the person who was asked can answer%',
  'and neither can the owner who sent it, on their behalf');

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select throws_like(
  $$ select public.respond_to_adviser_request(gen_random_uuid(), true) $$,
  '%Adviser request not found%',
  'answering an invitation that does not exist is an error');
select throws_like(
  $$ select public.respond_to_adviser_request(current_setting('tests.invite')::uuid, null) $$,
  '%accept or decline%',
  'and so is answering without saying which');

select tests.clear_authentication();
select throws_like(
  $$ select public.respond_to_adviser_request(current_setting('tests.invite')::uuid, true) $$,
  '%Not signed in%',
  'an unauthenticated caller gets nowhere');

-- --- declining ------------------------------------------------------------
-- Project B first, so the decline path is exercised on its own before an
-- acceptance exists anywhere.

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select lives_ok(
  $$ select public.respond_to_adviser_request(current_setting('tests.invite_b')::uuid, false) $$,
  'the person asked declines');

select tests.clear_authentication();
select is((select status from public.adviser_requests where id = current_setting('tests.invite_b')::uuid),
  'declined', 'the invitation is declined');
select isnt((select responded_at from public.adviser_requests where id = current_setting('tests.invite_b')::uuid),
  null, 'and the time is recorded');
select is((select count(*)::int from public.notifications
            where user_id = current_setting('tests.owner_b')::uuid and kind = 'adviser_declined'), 1,
  'the owner who asked is told');
select is((select count(*)::int from public.notifications
            where user_id = current_setting('tests.owner_b')::uuid and kind = 'adviser_accepted'), 0,
  'and not told the opposite');

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select is((select count(*)::int from public.project_advisers(
            array[current_setting('tests.project_b')::uuid])), 0,
  'a declined project has no adviser');

-- The owner is free to ask somebody else, which is #53's rule seen from here.
select lives_ok(
  $$ select public.invite_adviser(current_setting('tests.project_b')::uuid,
                                  current_setting('tests.other')::uuid) $$,
  'and the owner can invite somebody else');

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select throws_like(
  $$ select public.respond_to_adviser_request(current_setting('tests.invite_b')::uuid, true) $$,
  '%already been answered%',
  'the declined invitation cannot be answered a second time');

-- --- accepting ------------------------------------------------------------

select lives_ok(
  $$ select public.respond_to_adviser_request(current_setting('tests.invite')::uuid, true) $$,
  'the person asked accepts the other one');

select tests.clear_authentication();
select is((select status from public.adviser_requests where id = current_setting('tests.invite')::uuid),
  'accepted', 'the invitation is accepted');
select is((select count(*)::int from public.notifications
            where user_id = current_setting('tests.owner')::uuid and kind = 'adviser_accepted'), 1,
  'and the owner is told');

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select throws_like(
  $$ select public.respond_to_adviser_request(current_setting('tests.invite')::uuid, false) $$,
  '%already been answered%',
  'and it cannot be changed afterwards by answering again');

-- An invitation the owner withdrew is not answerable either.
select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select public.cancel_adviser_request(current_setting('tests.project_b')::uuid);
select set_config('tests.invite_b2',
  (select id::text from public.adviser_requests
    where project_id = current_setting('tests.project_b')::uuid
      and adviser_id = current_setting('tests.other')::uuid), true);
select tests.authenticate_as(current_setting('tests.other')::uuid);
select throws_like(
  $$ select public.respond_to_adviser_request(current_setting('tests.invite_b2')::uuid, true) $$,
  '%already been answered%',
  'and an invitation the owner cancelled cannot be accepted out from under them');

-- --- advising more than one -----------------------------------------------

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select set_config('tests.invite_b3',
  (select (public.invite_adviser(current_setting('tests.project_b')::uuid,
                                 current_setting('tests.adviser')::uuid)).id::text), true);
select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select lives_ok(
  $$ select public.respond_to_adviser_request(current_setting('tests.invite_b3')::uuid, true) $$,
  'the same person accepts a second project');
select is((select count(*)::int from public.advised_project_ids()), 2,
  'and now advises two');

-- --- THE SEAT RULE, against a really accepted adviser ---------------------
-- Repeated from adviser_requests.test.sql on purpose. There the status was
-- set by hand because nothing could write it; here respond_to_adviser_request()
-- wrote it, which is the path that will actually run.

select tests.clear_authentication();
select is((select public.project_member_count(current_setting('tests.project')::uuid)), 2,
  'accepting does not change project_member_count');
select is((select status from public.projects where id = current_setting('tests.project')::uuid), 'open',
  'and does not fill the project');
select is((select count(*)::int from public.team_members
            where user_id = current_setting('tests.adviser')::uuid), 0,
  'the adviser is on no roster');

select public.sync_project_fill_state(current_setting('tests.project')::uuid);
select is((select status from public.projects where id = current_setting('tests.project')::uuid), 'open',
  'and recomputing the fill state still says open');
select is((select formed_at from public.teams
            where project_id = current_setting('tests.project')::uuid), null,
  'with the team still unformed');

-- REPLACES A CASE THAT ASSERTED THE OPPOSITE (#90 review). This block used to
-- seat the adviser on project_b, the very project they advise, and called it
-- allowed -- "invite_adviser() refuses somebody already on the team, but
-- joining afterwards is a different order of events and not one to police."
-- That was wrong. An adviser is the project's outside contact (#53: "so that
-- my team has a faculty contact attached to the project"), and nobody is
-- their own outside contact. The order it arrives in does not change what the
-- end state is. What was missing was the rule, not the test.
--
-- #54's "advising doesn't stop me from being on a team of my own" is still
-- true and still asserted -- further down, once this adviser has stepped down
-- from one of the two and there is a project they do not advise to join. A
-- team of their own is the point; the team they advise is not their own.
select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select throws_ok(
  $$ select public.create_join_request(current_setting('tests.project_b')::uuid) $$,
  '42501',
  null,
  'somebody who advises a project cannot ask for a seat on it');

select tests.clear_authentication();
select is((select count(*)::int from public.team_members
            where user_id = current_setting('tests.adviser')::uuid), 0,
  'so they are still on no roster');
select is((select count(*)::int from public.advised_project_ids()), 0,
  'advised_project_ids is per caller, and nobody is signed in here');

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select is((select count(*)::int from public.advised_project_ids()), 2,
  'while they still advise both');

-- --- what an adviser may not do -------------------------------------------
-- The issue's "can't edit the project, accept join requests or manage
-- members". None of this was built for #54 — the functions check the creator
-- already — which is exactly why it is asserted: nothing in this story's diff
-- would fail if it stopped being true.

select tests.authenticate_as(current_setting('tests.seeker')::uuid);
select set_config('tests.req_seeker',
  (select (public.create_join_request(current_setting('tests.project')::uuid)).id::text), true);

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select is((select count(*)::int from public.projects
            where id = current_setting('tests.project')::uuid), 1,
  'an adviser can read the project they advise');
select is((select count(*)::int from public.team_members tm
            join public.teams t on t.id = tm.team_id
           where t.project_id = current_setting('tests.project')::uuid), 2,
  'and its roster, which is what the team page shows them');

select throws_like(
  $$ select public.update_project(current_setting('tests.project')::uuid,
       'Renamed by the adviser', 'A description long enough to pass validation.',
       3::smallint, current_setting('tests.r_pm')::uuid, '[]'::jsonb) $$,
  '%Only the project creator can edit it%',
  'but cannot edit it');

select throws_like(
  $$ select public.respond_to_join_request(
       current_setting('tests.req_seeker')::uuid, 'accepted', current_setting('tests.r_be')::uuid) $$,
  '%Only the project creator can respond to this request%',
  'cannot answer a join request');

select throws_like(
  $$ select public.remove_member(current_setting('tests.member')::uuid) $$,
  '%Only the project creator can remove a member%',
  'cannot remove a member');

select throws_like(
  $$ select public.set_member_role(current_setting('tests.member')::uuid,
                                   current_setting('tests.r_pm')::uuid) $$,
  '%Only the project creator can change roles%',
  'cannot change anyone''s role');

select throws_like(
  $$ select public.delete_team((select id from public.teams
                                 where project_id = current_setting('tests.project')::uuid)) $$,
  '%Only the team owner can delete this team%',
  'and cannot delete the team');

select throws_like(
  $$ select public.invite_adviser(current_setting('tests.project')::uuid,
                                  current_setting('tests.other')::uuid) $$,
  '%Only the project creator can invite an adviser%',
  'nor hand the advising on to somebody else');

-- The functions are the readable refusal; RLS is the boundary. A direct
-- write finds no row it is allowed to touch, rather than raising.
update public.projects set title = 'Renamed directly'
 where id = current_setting('tests.project')::uuid;
select tests.clear_authentication();
select is((select title from public.projects where id = current_setting('tests.project')::uuid),
  'Campus parking tracker',
  'and a direct update of the project changes nothing, policy not politeness');

-- --- stepping down --------------------------------------------------------

select tests.authenticate_as(current_setting('tests.other')::uuid);
select throws_like(
  $$ select public.step_down_as_adviser(current_setting('tests.project')::uuid) $$,
  '%not the adviser for this project%',
  'somebody who is not the adviser cannot step down from it');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_like(
  $$ select public.step_down_as_adviser(current_setting('tests.project')::uuid) $$,
  '%not the adviser for this project%',
  'and neither can the owner, who has remove_adviser for that');

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select throws_like(
  $$ select public.step_down_as_adviser(gen_random_uuid()) $$,
  '%Project not found%',
  'stepping down from a project that does not exist is an error');

select set_config('tests.accepted_row',
  (select id::text from public.adviser_requests
    where project_id = current_setting('tests.project')::uuid and status = 'accepted'), true);
select lives_ok(
  $$ select public.step_down_as_adviser(current_setting('tests.project')::uuid) $$,
  'the adviser steps down');

select tests.clear_authentication();
select is((select status from public.adviser_requests
            where id = current_setting('tests.accepted_row')::uuid), 'cancelled',
  'the link is closed');
select is((select count(*)::int from public.adviser_requests
            where project_id = current_setting('tests.project')::uuid
              and status in ('pending', 'accepted')), 0,
  'and the project has no adviser');

-- Which way it went is in the notification, not the row: the owner is told
-- they were left, and the adviser is not told they were removed.
select is((select count(*)::int from public.notifications
            where user_id = current_setting('tests.owner')::uuid and kind = 'adviser_stepped_down'), 1,
  'the owner is told the adviser stepped down');
select is((select count(*)::int from public.notifications
            where user_id = current_setting('tests.adviser')::uuid and kind = 'adviser_removed'), 0,
  'and the adviser is not told they were removed, which is the other direction');

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select throws_like(
  $$ select public.step_down_as_adviser(current_setting('tests.project')::uuid) $$,
  '%not the adviser for this project%',
  'stepping down twice is an error, not a silent no-op');
select is((select count(*)::int from public.advised_project_ids()), 1,
  'and they are down to one project');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.invite_adviser(current_setting('tests.project')::uuid,
                                  current_setting('tests.other')::uuid) $$,
  'the project is free to invite somebody new');

-- --- what the Requests page lists -----------------------------------------

select tests.authenticate_as(current_setting('tests.other')::uuid);
select is((select count(*)::int from public.my_adviser_requests()), 1,
  'the person asked sees the invitation waiting for them');
select is((select project_title from public.my_adviser_requests()), 'Campus parking tracker',
  'with the project name');
select is((select owner_name from public.my_adviser_requests()), 'Olivia Owner',
  'and who is asking');
select is((select project_description from public.my_adviser_requests()),
  'Live lot occupancy estimated from existing camera feeds, with a map.',
  'and what it is building, so they can answer without going to look it up');

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select is((select count(*)::int from public.my_adviser_requests()), 0,
  'somebody with nothing waiting sees nothing — answered invitations are not waiting');

select tests.authenticate_as(current_setting('tests.seeker')::uuid);
select is((select count(*)::int from public.my_adviser_requests()), 0,
  'and neither does somebody who has never been asked');

-- Cancelling stops it being offered, rather than leaving it answerable.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select public.cancel_adviser_request(current_setting('tests.project')::uuid);
select tests.authenticate_as(current_setting('tests.other')::uuid);
select is((select count(*)::int from public.my_adviser_requests()), 0,
  'a withdrawn invitation stops being offered');

-- --- one person, not both (#90 review) ------------------------------------
-- 39 checks at invite time that the invitee is not on the team, and that was
-- the whole of the rule. It left both orders open: the adviser could ask to
-- join the project afterwards, and nothing re-checked when they accepted.
-- Each order gets a case here, and the table boundary gets one of its own.
--
-- tests.adviser advises tests.project_b at this point and nothing else.

-- The order that goes through the roster. Unauthenticated, so RLS is out of
-- the way and the trigger is the only thing left to answer -- which is the
-- point: eight statements across seven migrations insert into team_members,
-- and this asserts the rule where all eight of them land rather than at any
-- one of the callers.
select tests.clear_authentication();
select throws_ok(
  $$ insert into public.team_members (user_id, team_id, role_id)
     values (current_setting('tests.adviser')::uuid,
             (select id from public.teams
               where project_id = current_setting('tests.project_b')::uuid),
             current_setting('tests.r_be')::uuid) $$,
  '42501',
  null,
  'the adviser of a project cannot be seated on it, however the insert arrives');

-- Scoped to the project they advise, not to them. #54: "advising doesn't stop
-- me from being on a team of my own."
select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select lives_ok(
  $$ select public.create_join_request(current_setting('tests.project')::uuid) $$,
  'and they can still ask to join a project they do not advise');
select throws_ok(
  $$ select public.create_join_request(current_setting('tests.project_b')::uuid) $$,
  '42501',
  null,
  'but not the one they do -- asked where they ask, not left to the owner');

-- The other order: invited first, seated second, then answering. Getting into
-- that state needs the invitation to come before the seat, since 39 refuses to
-- invite somebody already on the team.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select set_config('tests.invite_seeker',
  (select (public.invite_adviser(current_setting('tests.project')::uuid,
                                 current_setting('tests.seeker')::uuid)).id::text), true);

-- tests.seeker's join request is the one made further up and never answered,
-- rather than a second one: create_join_request refuses a duplicate while the
-- first is still pending.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select public.respond_to_join_request(current_setting('tests.req_seeker')::uuid,
       'accepted', current_setting('tests.r_be')::uuid) $$,
  'a pending invitation is no bar to being seated -- nobody advises anything yet');

select tests.authenticate_as(current_setting('tests.seeker')::uuid);
select throws_like(
  $$ select public.respond_to_adviser_request(
       current_setting('tests.invite_seeker')::uuid, true) $$,
  '%cannot also advise it%',
  'but now on the team, they cannot accept the invitation they were holding');

-- Only accepting is refused. Declining is how they get out of it.
select lives_ok(
  $$ select public.respond_to_adviser_request(
       current_setting('tests.invite_seeker')::uuid, false) $$,
  'they can still decline it, which is the way out');
select is((select status from public.adviser_requests
            where id = current_setting('tests.invite_seeker')::uuid), 'declined',
  'and the invitation lands on declined like any other');

-- --- guests get none of it -------------------------------------------------

select tests.clear_authentication();
select set_config('role', 'anon', true);
select throws_ok(
  $$ select * from public.my_adviser_requests() $$,
  '42501', null, 'a guest cannot list adviser invitations');
select throws_ok(
  $$ select * from public.advised_project_ids() $$,
  '42501', null, 'nor the projects somebody advises');
select throws_ok(
  $$ select public.respond_to_adviser_request(gen_random_uuid(), true) $$,
  '42501', null, 'nor answer an invitation');
select throws_ok(
  $$ select public.step_down_as_adviser(gen_random_uuid()) $$,
  '42501', null, 'nor step down from one');
select tests.clear_authentication();

select * from finish();
rollback;
