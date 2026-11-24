-- Issue #60 — the areas an adviser advises in, and the cap on how many teams
-- they take. 48_adviser_expertise.sql.
--
-- Two of this file's cases are the ones the issue text would not have asked
-- for, and they are the reason the migration reads the way it does:
--
--   * **a pending invitation does not fill a spot**, so an adviser with one
--     spot left and two invitations can still accept either one. That is why
--     the cap is enforced on accepting and not on inviting, and it means
--     invite_adviser()'s check and respond_to_adviser_request()'s check are
--     not the same check in two places.
--   * **lowering the maximum below the teams already advised** is allowed and
--     retroactive to nothing. The accepted rows are still accepted after it,
--     which is the assertion that would fail if someone ever "tidied up" by
--     enforcing the cap over existing rows.
--
-- What is deliberately not re-tested here: that only faculty can be asked at
-- all (44_faculty_advisers.sql owns that, and faculty_directory.test.sql
-- covers it). One case repeats it, to pin the *order* of the refusals — a
-- student hearing about advising limits they could never have set would be a
-- worse answer than hearing they are not faculty.
begin;
select plan(61);

select set_config('tests.owner',     tests.sign_in_with_microsoft('owner60@utrgv.edu',   'Olivia Owner')::text, true);
select set_config('tests.owner_b',   tests.sign_in_with_microsoft('owner60b@utrgv.edu',  'Bea Builder')::text, true);
select set_config('tests.owner_c',   tests.sign_in_with_microsoft('owner60c@utrgv.edu',  'Carl Creator')::text, true);
select set_config('tests.owner_d',   tests.sign_in_with_microsoft('owner60d@utrgv.edu',  'Dina Dev')::text, true);
select set_config('tests.adviser',   tests.sign_in_with_microsoft('adviser60@utrgv.edu', 'Ada Adviser')::text, true);
select set_config('tests.adviser_b', tests.sign_in_with_microsoft('adviser60b@utrgv.edu','Zoe Zepeda')::text, true);
select set_config('tests.student',   tests.sign_in_with_microsoft('student60@utrgv.edu', 'Sam Student')::text, true);

select set_config('tests.r_pm', (select id from public.roles where name = 'Project Manager')::text, true);
select set_config('tests.s_react',  (select id from public.skills where name = 'React')::text, true);
select set_config('tests.s_python', (select id from public.skills where name = 'Python')::text, true);

-- Only accounts on the CS faculty directory can be asked to advise
-- (44_faculty_advisers.sql). Ada and Zoe are the faculty here; Sam Student is
-- deliberately left off it.
insert into public.faculty_directory (email) values
  ('adviser60@utrgv.edu'), ('adviser60b@utrgv.edu');

-- Four projects, four different owners, so each invitation is somebody's own
-- and nothing depends on one owner holding several.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select set_config('tests.project', (select (public.create_project(
  'Campus parking tracker',
  'Live lot occupancy estimated from existing camera feeds, with a map.',
  3::smallint, current_setting('tests.r_pm')::uuid, '[]'::jsonb)).id::text), true);

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select set_config('tests.project_b', (select (public.create_project(
  'Degree plan builder',
  'Constraint solver that generates a valid path to graduation from prerequisites.',
  3::smallint, current_setting('tests.r_pm')::uuid, '[]'::jsonb)).id::text), true);

select tests.authenticate_as(current_setting('tests.owner_c')::uuid);
select set_config('tests.project_c', (select (public.create_project(
  'Scam message checker',
  'Flags suspicious SMS and email using a model trained on reported scams.',
  3::smallint, current_setting('tests.r_pm')::uuid, '[]'::jsonb)).id::text), true);

select tests.authenticate_as(current_setting('tests.owner_d')::uuid);
select set_config('tests.project_d', (select (public.create_project(
  'Lab equipment booking',
  'Reserve shared lab hardware by the hour, with conflicts resolved up front.',
  3::smallint, current_setting('tests.r_pm')::uuid, '[]'::jsonb)).id::text), true);

-- --- the defaults, and my_advising() --------------------------------------
-- Available by default is the whole opt-out decision in one assertion: it is
-- what keeps every signed-in faculty account searchable, which is what
-- 44_faculty_advisers.sql already does on its own.

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select set_config('tests.mine', public.my_advising()::text, true);

select is(current_setting('tests.mine')::jsonb -> 'is_faculty', 'true'::jsonb,
  'my_advising() tells a faculty account that it is one — nothing else can, since faculty_directory is revoked from authenticated');
select is(current_setting('tests.mine')::jsonb -> 'available', 'true'::jsonb,
  'advising_available starts on, so a faculty account is offered as soon as it signs in');
select is(current_setting('tests.mine')::jsonb -> 'max_teams', 'null'::jsonb,
  'no maximum until they set one');
select is(current_setting('tests.mine')::jsonb -> 'advising', '0'::jsonb,
  'advising nothing yet');
select is(current_setting('tests.mine')::jsonb -> 'is_full', 'false'::jsonb,
  'and with no maximum set they are never full');
select is(current_setting('tests.mine')::jsonb -> 'expertise', '[]'::jsonb,
  'no expertise areas yet');

select tests.authenticate_as(current_setting('tests.student')::uuid);
select is(public.my_advising() -> 'is_faculty', 'false'::jsonb,
  'a student is told they are not faculty, which is what hides the advising card from them');
select is(public.my_advising() -> 'available', 'true'::jsonb,
  'the column still reads on for them — it is only ever consulted for faculty, and a student cannot be asked at all');

select tests.clear_authentication();
select throws_like($$ select public.my_advising() $$, '%Not signed in%',
  'my_advising() answers nobody who is not signed in');

-- --- expertise is own rows only -------------------------------------------

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select lives_ok($$
  insert into public.adviser_expertise (user_id, skill_id)
  values (current_setting('tests.adviser')::uuid, current_setting('tests.s_react')::uuid),
         (current_setting('tests.adviser')::uuid, current_setting('tests.s_python')::uuid)
$$, 'an adviser can list their own areas');

select is(
  (select jsonb_agg(x ->> 'name') from jsonb_array_elements(public.my_advising() -> 'expertise') x),
  '["Python", "React"]'::jsonb,
  'my_advising() returns them by category then name, so the Profile never reorders between reads');

select throws_ok($$
  insert into public.adviser_expertise (user_id, skill_id)
  values (current_setting('tests.adviser_b')::uuid, current_setting('tests.s_react')::uuid)
$$, '42501', null, 'and cannot list areas on somebody else''s behalf');

select tests.authenticate_as(current_setting('tests.adviser_b')::uuid);
select is((select count(*) from public.adviser_expertise), 0::bigint,
  'another adviser reads none of Ada''s rows through the table — search_advisers() is the only way anyone else sees them');
select is(public.my_advising() -> 'expertise', '[]'::jsonb,
  'and their own expertise is still empty');

-- --- the maximum is 1 to 20 -----------------------------------------------

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select lives_ok($$ update public.users set advising_max_teams = 1 where id = current_setting('tests.adviser')::uuid $$,
  '1 is a maximum');
select lives_ok($$ update public.users set advising_max_teams = 20 where id = current_setting('tests.adviser')::uuid $$,
  'so is 20');
select throws_ok($$ update public.users set advising_max_teams = 0 where id = current_setting('tests.adviser')::uuid $$,
  '23514', null, '0 is not — advising no teams is what the switch is for');
select throws_ok($$ update public.users set advising_max_teams = 21 where id = current_setting('tests.adviser')::uuid $$,
  '23514', null, 'and neither is 21');
select lives_ok($$ update public.users set advising_max_teams = null where id = current_setting('tests.adviser')::uuid $$,
  'null puts the limit back to none');

-- RLS answers this one by matching no rows rather than raising, which is why
-- the assertion is on the other row's value and not on an error.
select lives_ok($$ update public.users set advising_max_teams = 5, advising_available = false
                    where id = current_setting('tests.adviser_b')::uuid $$,
  'updating another account''s advising settings is not an error');
select tests.clear_authentication();
select is((select advising_max_teams from public.users where id = current_setting('tests.adviser_b')::uuid), null::integer,
  '... it simply changes nothing');
select is((select advising_available from public.users where id = current_setting('tests.adviser_b')::uuid), true,
  '... on either column');

-- --- a pending invitation does not fill a spot ----------------------------
-- Ada takes two teams. Three owners ask her before she answers any of them,
-- which is the case the cap has to get right: at the moment she accepts the
-- first, two more invitations are open and neither counts.

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select lives_ok($$ update public.users set advising_max_teams = 2 where id = current_setting('tests.adviser')::uuid $$,
  'Ada will take two teams');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select set_config('tests.invite', (select (public.invite_adviser(
  current_setting('tests.project')::uuid, current_setting('tests.adviser')::uuid)).id::text), true);
select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select set_config('tests.invite_b', (select (public.invite_adviser(
  current_setting('tests.project_b')::uuid, current_setting('tests.adviser')::uuid)).id::text), true);
select tests.authenticate_as(current_setting('tests.owner_c')::uuid);
select set_config('tests.invite_c', (select (public.invite_adviser(
  current_setting('tests.project_c')::uuid, current_setting('tests.adviser')::uuid)).id::text), true);

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select is(public.my_advising() -> 'advising', '0'::jsonb,
  'three invitations are open and she advises nothing: pending rows are not teams');
select is(public.my_advising() -> 'is_full', 'false'::jsonb,
  'so a maximum of two is not reached by three pending invitations');

select lives_ok($$ select public.respond_to_adviser_request(current_setting('tests.invite')::uuid, true) $$,
  'she accepts the first');
select is(public.my_advising() -> 'advising', '1'::jsonb, 'one team now');
select is(public.my_advising() -> 'is_full', 'false'::jsonb, 'one of two spots used');

select lives_ok($$ select public.respond_to_adviser_request(current_setting('tests.invite_b')::uuid, true) $$,
  'and the second');
select is(public.my_advising() -> 'advising', '2'::jsonb, 'two teams');
select is(public.my_advising() -> 'is_full', 'true'::jsonb, 'which is the maximum she set');

select throws_like($$ select public.respond_to_adviser_request(current_setting('tests.invite_c')::uuid, true) $$,
  '%as many teams as you said you would take on%',
  'the third invitation cannot be accepted, and the message says why and what to change');
select lives_ok($$ select public.respond_to_adviser_request(current_setting('tests.invite_c')::uuid, false) $$,
  'but it can still be declined — being full is a reason to say no, not a reason to be unable to answer');
select is(public.my_advising() -> 'advising', '2'::jsonb,
  'and declining it left the two teams she has alone');

-- --- inviting someone who is full ----------------------------------------

select tests.authenticate_as(current_setting('tests.owner_d')::uuid);
select throws_like($$ select public.invite_adviser(
  current_setting('tests.project_d')::uuid, current_setting('tests.adviser')::uuid) $$,
  '%already advising as many teams as they take on%',
  'an owner is told up front rather than after she has to refuse');

-- --- search shows expertise and spots left -------------------------------
-- Ada is full, Zoe is not, and 'Ada' sorts before 'Zoe'. If the ordering were
-- by name alone this would come back the other way round, which is the point
-- of asserting on both rows in order rather than on a set.

select set_config('tests.ada', (select to_jsonb(s) from public.search_advisers(
  current_setting('tests.project_d')::uuid, 'adviser60') s where s.name = 'Ada Adviser')::text, true);
select set_config('tests.zoe', (select to_jsonb(s) from public.search_advisers(
  current_setting('tests.project_d')::uuid, 'adviser60') s where s.name = 'Zoe Zepeda')::text, true);

select results_eq(
  $$ select s.name from public.search_advisers(current_setting('tests.project_d')::uuid, 'adviser60') s $$,
  $$ values ('Zoe Zepeda'::text), ('Ada Adviser'::text) $$,
  'an adviser with room comes before one who is full, name order notwithstanding');

select is(current_setting('tests.ada')::jsonb ->> 'name', 'Ada Adviser',
  'a full adviser is still returned — an owner who got nothing could not tell "no room" from "not faculty"');
select is(current_setting('tests.ada')::jsonb -> 'is_full', 'true'::jsonb, '... marked full');
select is(current_setting('tests.ada')::jsonb -> 'max_teams', '2'::jsonb, '... with the maximum she set');
select is(current_setting('tests.ada')::jsonb -> 'advising', '2'::jsonb, '... and the teams she holds, so the panel can say "2 of 2"');
select is(
  (select jsonb_agg(x ->> 'name')
     from jsonb_array_elements(current_setting('tests.ada')::jsonb -> 'expertise') x),
  '["Python", "React"]'::jsonb,
  '... and her areas, which is what the owner is choosing on');

select is(current_setting('tests.zoe')::jsonb -> 'max_teams', 'null'::jsonb,
  'an adviser who has set no maximum reports none rather than a number the panel would have to invent');
select is(current_setting('tests.zoe')::jsonb -> 'is_full', 'false'::jsonb, '... and is never full');
select is(current_setting('tests.zoe')::jsonb -> 'expertise', '[]'::jsonb, '... with no areas listed');

select is((select count(*) from public.search_advisers(current_setting('tests.project_d')::uuid, 'student60')),
  0::bigint, 'a student is not offered, whatever they have set');

-- --- lowering the maximum below the teams already held --------------------

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select lives_ok($$ update public.users set advising_max_teams = 1 where id = current_setting('tests.adviser')::uuid $$,
  'she can drop her maximum to one while advising two');
select is(public.my_advising() -> 'advising', '2'::jsonb,
  'the two teams stay — the cap is read when a new one is taken on, never over the ones already held');
select is(public.my_advising() -> 'is_full', 'true'::jsonb,
  'she is over it, which reads as full');
select tests.clear_authentication();
select is((select count(*) from public.adviser_requests
            where adviser_id = current_setting('tests.adviser')::uuid and status = 'accepted'),
  2::bigint, 'and nothing went back and tidied up the accepted rows');

-- --- turning availability off --------------------------------------------

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select lives_ok($$ update public.users set advising_available = false where id = current_setting('tests.adviser')::uuid $$,
  'she turns the switch off');
select is(public.my_advising() -> 'available', 'false'::jsonb, 'which my_advising() reports back');
select is(public.my_advising() -> 'advising', '2'::jsonb,
  'and it does not remove her from the teams she already advises (#60 criterion 6)');

select tests.authenticate_as(current_setting('tests.owner_d')::uuid);
select results_eq(
  $$ select s.name from public.search_advisers(current_setting('tests.project_d')::uuid, 'adviser60') s $$,
  $$ values ('Zoe Zepeda'::text) $$,
  'she is gone from search, leaving the adviser who is still taking requests');

select throws_like($$ select public.invite_adviser(
  current_setting('tests.project_d')::uuid, current_setting('tests.adviser')::uuid) $$,
  '%not taking advising requests right now%',
  'and a direct invitation is refused for that reason, not for the limit — the switch is checked first, since it is the one she chose');

-- --- a student still hears the faculty rule first -------------------------
-- The order of the refusals is the assertion. Sam is not faculty and has no
-- advising settings; an answer about limits would be nonsense to him.

select throws_like($$ select public.invite_adviser(
  current_setting('tests.project_d')::uuid, current_setting('tests.student')::uuid) $$,
  '%Only Computer Science faculty can advise a project%',
  'a student is told they are not faculty, which comes before anything about availability or limits');

-- --- nobody reads the counting functions through the API ------------------
-- `authenticated` has USAGE on private and functions are executable by PUBLIC
-- unless revoked: these would hand any signed-in student the number of teams
-- anybody advises.

select tests.authenticate_as(current_setting('tests.student')::uuid);
select throws_ok($$ select private.advising_accepted(current_setting('tests.adviser')::uuid) $$,
  '42501', null, 'signed-in users cannot count somebody''s accepted invitations');
select throws_ok($$ select private.advising_is_full(current_setting('tests.adviser')::uuid) $$,
  '42501', null, 'nor ask whether they are full');

-- --- removing an area ----------------------------------------------------

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select lives_ok($$ delete from public.adviser_expertise
                    where user_id = current_setting('tests.adviser')::uuid
                      and skill_id = current_setting('tests.s_react')::uuid $$,
  'an area can be taken off again');
select is(
  (select jsonb_agg(x ->> 'name') from jsonb_array_elements(public.my_advising() -> 'expertise') x),
  '["Python"]'::jsonb, 'leaving the rest');

select tests.authenticate_as(current_setting('tests.adviser_b')::uuid);
select lives_ok($$ delete from public.adviser_expertise
                    where user_id = current_setting('tests.adviser')::uuid $$,
  'deleting somebody else''s areas is not an error');
select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select is(
  (select jsonb_agg(x ->> 'name') from jsonb_array_elements(public.my_advising() -> 'expertise') x),
  '["Python"]'::jsonb, '... it deletes nothing');

select * from finish();
rollback;
