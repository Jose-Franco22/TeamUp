-- Telling a project's creator someone asked to join (issue #26):
-- 23_join_request_notifications.sql.
begin;
select plan(13);

select set_config('tests.owner', tests.sign_in_with_microsoft('owner01@utrgv.edu', 'Owner')::text, true);
select set_config('tests.owner2', tests.sign_in_with_microsoft('owner02@utrgv.edu', 'Owner Two')::text, true);
select set_config('tests.ana', tests.sign_in_with_microsoft('ana01@utrgv.edu', 'Ana Requester')::text, true);
select set_config('tests.ben', tests.sign_in_with_microsoft('ben01@utrgv.edu', 'Ben')::text, true);
select set_config('tests.pm', (select id from public.roles where name = 'Project Manager')::text, true);

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select set_config('tests.p1',
  (public.create_project('Trail Finder', 'Find hiking trails near campus.', 3::smallint, current_setting('tests.pm')::uuid, '[]'::jsonb)).id::text, true);
select tests.authenticate_as(current_setting('tests.owner2')::uuid);
select set_config('tests.p2',
  (public.create_project('Study Buddy', 'Match classmates into study groups.', 4::smallint, current_setting('tests.pm')::uuid, '[]'::jsonb)).id::text, true);
select tests.clear_authentication();

-- --- A request notifies the creator, once ---------------------------------
select is((select count(*)::int from public.notifications), 0, 'setup: no notifications yet');

select tests.authenticate_as(current_setting('tests.ana')::uuid);
select set_config('tests.ana_p1', (public.create_join_request(current_setting('tests.p1')::uuid)).id::text, true);
select tests.clear_authentication();

select results_eq(
  'select user_id, kind from public.notifications',
  format($q$values (%L::uuid, 'join_request')$q$, current_setting('tests.owner')),
  'create_join_request() creates exactly one notification, for the project''s creator');

select is(
  (select read_at from public.notifications where user_id = current_setting('tests.owner')::uuid),
  null,
  'it starts unread');

-- --- It names the requester and the project ------------------------------
-- The app names the requester from actor_id and opens /requests for the
-- 'join_request' kind (frontend/src/components/RequestAlerts.jsx).
select results_eq(
  format($q$select actor_id, project_id from public.notifications where user_id = %L$q$, current_setting('tests.owner')),
  format($q$values (%L::uuid, %L::uuid)$q$, current_setting('tests.ana'), current_setting('tests.p1')),
  'the notification records who asked and which project');

-- The same read client.js getNotifications() makes, as the creator.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select results_eq(
  $$select n.kind, a.name, p.title
      from public.notifications n
      join public.users a on a.id = n.actor_id
      join public.projects p on p.id = n.project_id$$,
  $$values ('join_request', 'Ana Requester', 'Trail Finder')$$,
  'the creator can read it, with the requester''s name and the project''s title');

select tests.authenticate_as(current_setting('tests.ana')::uuid);
select is(
  (select count(*)::int from public.notifications),
  0,
  'the requester can''t read the creator''s notification');

select tests.authenticate_as(current_setting('tests.owner2')::uuid);
select is(
  (select count(*)::int from public.notifications),
  0,
  'neither can another project''s creator');

-- --- Each project's creator hears about their own requests ----------------
select tests.authenticate_as(current_setting('tests.ana')::uuid);
select public.create_join_request(current_setting('tests.p2')::uuid);
select tests.clear_authentication();

select results_eq(
  format($q$select actor_id, project_id from public.notifications where user_id = %L$q$, current_setting('tests.owner2')),
  format($q$values (%L::uuid, %L::uuid)$q$, current_setting('tests.ana'), current_setting('tests.p2')),
  'a request to a second project notifies that project''s creator');

select is(
  (select count(*)::int from public.notifications where user_id = current_setting('tests.owner')::uuid),
  1,
  'and doesn''t notify the first creator again');

-- --- Rejected requests notify no one --------------------------------------
-- Ben joins the owner's team first, so there's someone already on a team to
-- try. Then snapshot the count and try every way a request is refused.
select tests.authenticate_as(current_setting('tests.ben')::uuid);
select set_config('tests.ben_p1', (public.create_join_request(current_setting('tests.p1')::uuid)).id::text, true);
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select public.respond_to_join_request(current_setting('tests.ben_p1')::uuid, 'accepted', current_setting('tests.pm')::uuid);
select tests.clear_authentication();
select set_config('tests.before', (select count(*)::text from public.notifications), true);

select tests.authenticate_as(current_setting('tests.ana')::uuid);
select throws_ok(
  format('select public.create_join_request(%L)', current_setting('tests.p1')),
  'P0001', 'You already have a pending request for this project',
  'a duplicate pending request is refused');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_ok(
  format('select public.create_join_request(%L)', current_setting('tests.p1')),
  'P0001', 'You cannot request to join your own project',
  'a request to your own project is refused');

select tests.authenticate_as(current_setting('tests.ben')::uuid);
select throws_ok(
  format('select public.create_join_request(%L)', current_setting('tests.p2')),
  'P0001', 'You are already on a team and cannot request to join another project',
  'a request from someone already on a team is refused');

select tests.clear_authentication();
select is(
  (select count(*)::int from public.notifications),
  current_setting('tests.before')::int,
  'refused requests create no notifications');

select * from finish();
rollback;
