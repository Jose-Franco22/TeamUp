-- Reviewing a requester before deciding (issue #27):
-- 24_join_request_message.sql, and the RLS the Requests page relies on.
begin;
select plan(10);

select set_config('tests.owner', tests.sign_in_with_microsoft('owner01@utrgv.edu', 'Owner')::text, true);
select set_config('tests.owner2', tests.sign_in_with_microsoft('owner02@utrgv.edu', 'Owner Two')::text, true);
select set_config('tests.ana', tests.sign_in_with_microsoft('ana01@utrgv.edu', 'Ana Requester')::text, true);
select set_config('tests.ben', tests.sign_in_with_microsoft('ben01@utrgv.edu', 'Ben')::text, true);
select set_config('tests.pm', (select id from public.roles where name = 'Project Manager')::text, true);

-- Ana has a profile worth reviewing: hours, a GitHub link and one skill.
update public.users
   set availability_hours = 12, github_url = 'https://github.com/ana-requester'
 where id = current_setting('tests.ana')::uuid;
insert into public.user_skills (user_id, skill_id, source)
select current_setting('tests.ana')::uuid, id, 'manual' from public.skills where name = 'React';

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select set_config('tests.p1',
  (public.create_project('Trail Finder', 'Find hiking trails near campus.', 3::smallint, current_setting('tests.pm')::uuid, '[]'::jsonb)).id::text, true);
select tests.authenticate_as(current_setting('tests.owner2')::uuid);
select set_config('tests.p2',
  (public.create_project('Study Buddy', 'Match classmates into study groups.', 4::smallint, current_setting('tests.pm')::uuid, '[]'::jsonb)).id::text, true);

-- Ana asks to join both, with a message to the first; Ben asks to join the
-- first without one.
select tests.authenticate_as(current_setting('tests.ana')::uuid);
select public.create_join_request(current_setting('tests.p1')::uuid, '  I built a trail map app last spring.  ');
select public.create_join_request(current_setting('tests.p2')::uuid);
select tests.authenticate_as(current_setting('tests.ben')::uuid);
select public.create_join_request(current_setting('tests.p1')::uuid);
select tests.clear_authentication();

-- --- The message ----------------------------------------------------------
select is(
  (select message from public.join_requests
    where user_id = current_setting('tests.ana')::uuid and project_id = current_setting('tests.p1')::uuid),
  'I built a trail map app last spring.',
  'the message is stored, trimmed');

select is(
  (select message from public.join_requests where user_id = current_setting('tests.ben')::uuid),
  '',
  'a request without a message stores an empty one');

select tests.authenticate_as(current_setting('tests.ben')::uuid);
select throws_ok(
  format('select public.create_join_request(%L, %L)', current_setting('tests.p2'), repeat('x', 501)),
  'P0001', 'Keep your message to 500 characters or fewer',
  'a message over 500 characters is refused');
select tests.clear_authentication();

-- --- The owner can read the requester's profile ---------------------------
-- The same embed client.js getRequests() selects, as the project's owner.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select results_eq(
  format($q$select u.name, u.availability_hours::int, u.github_url, jr.message
      from public.join_requests jr
      join public.users u on u.id = jr.user_id
     where jr.project_id = %L and jr.user_id = %L$q$,
    current_setting('tests.p1'), current_setting('tests.ana')),
  $$values ('Ana Requester'::text, 12, 'https://github.com/ana-requester'::text, 'I built a trail map app last spring.'::text)$$,
  'the owner can read the requester''s name, availability, GitHub link and message');

select results_eq(
  format($q$select s.name
      from public.join_requests jr
      join public.user_skills us on us.user_id = jr.user_id
      join public.skills s on s.id = us.skill_id
     where jr.project_id = %L and jr.user_id = %L$q$,
    current_setting('tests.p1'), current_setting('tests.ana')),
  $$values ('React'::text)$$,
  'the owner can read the requester''s skills');

select results_eq(
  format($q$select u.name from public.join_requests jr join public.users u on u.id = jr.user_id
     where jr.project_id = %L order by jr.created_at, u.name$q$, current_setting('tests.p1')),
  $$values ('Ana Requester'::text), ('Ben'::text)$$,
  'the owner sees every pending request on their project');

-- --- Nobody else can read requests on a project they don't own -----------
select is(
  (select count(*)::int from public.join_requests where project_id = current_setting('tests.p2')::uuid),
  0,
  'the owner can''t read requests on someone else''s project');

select tests.authenticate_as(current_setting('tests.owner2')::uuid);
select is(
  (select count(*)::int from public.join_requests where project_id = current_setting('tests.p1')::uuid),
  0,
  'another project''s owner can''t read them either');

select tests.authenticate_as(current_setting('tests.ben')::uuid);
select results_eq(
  'select user_id from public.join_requests',
  format($q$values (%L::uuid)$q$, current_setting('tests.ben')),
  'a requester sees only their own request, not others'' on the same project');

select tests.authenticate_as(current_setting('tests.ana')::uuid);
select is(
  (select count(*)::int from public.join_requests where user_id = current_setting('tests.ana')::uuid),
  2,
  'and a requester still sees all of their own requests');

select * from finish();
rollback;
