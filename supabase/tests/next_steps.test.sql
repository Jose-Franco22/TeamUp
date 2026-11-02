-- Next steps once a team is complete (issue #30): 34_next_steps.sql.
begin;
select plan(29);

select set_config('tests.admin',    tests.sign_in_with_microsoft('nsadmin@utrgv.edu', 'Admin')::text, true);
select set_config('tests.owner',    tests.sign_in_with_microsoft('nsowner@utrgv.edu', 'Owner Olivia')::text, true);
select set_config('tests.m1',       tests.sign_in_with_microsoft('nsmember1@utrgv.edu', 'Member Marco')::text, true);
select set_config('tests.m2',       tests.sign_in_with_microsoft('nsmember2@utrgv.edu', 'Member Mia')::text, true);
select set_config('tests.outsider', tests.sign_in_with_microsoft('nsoutsider@utrgv.edu', 'Outsider Omar')::text, true);
select set_config('tests.placed',   tests.sign_in_with_microsoft('nsplaced@utrgv.edu', 'Placed Pat')::text, true);
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;
select set_config('tests.role', (select id::text from public.roles where name = 'Backend Developer'), true);

-- A three-seat team: the owner, then two accepted requests.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select set_config('tests.project',
  (public.create_project('Checklist project', 'Three seats, filled one at a time.', 3::smallint,
     current_setting('tests.role')::uuid, '[]'::jsonb)).id::text, true);
select tests.authenticate_as(current_setting('tests.m1')::uuid);
select set_config('tests.r1', (public.create_join_request(current_setting('tests.project')::uuid)).id::text, true);
select tests.authenticate_as(current_setting('tests.m2')::uuid);
select set_config('tests.r2', (public.create_join_request(current_setting('tests.project')::uuid)).id::text, true);
select tests.clear_authentication();
select set_config('tests.team',
  (select id::text from public.teams where project_id = current_setting('tests.project')::uuid), true);

-- --- When the last seat fills, every member is notified --------------------
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select public.respond_to_join_request(current_setting('tests.r1')::uuid, 'accepted', current_setting('tests.role')::uuid);
select tests.clear_authentication();

select is(
  (select count(*)::int from public.notifications
    where kind = 'team_complete' and project_id = current_setting('tests.project')::uuid),
  0,
  'no "team complete" notification while a seat is still open');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select public.respond_to_join_request(current_setting('tests.r2')::uuid, 'accepted', current_setting('tests.role')::uuid);
select tests.clear_authentication();

select bag_eq(
  $$ select user_id from public.notifications
      where kind = 'team_complete' and project_id = current_setting('tests.project')::uuid $$,
  $$ values (current_setting('tests.owner')::uuid), (current_setting('tests.m1')::uuid),
            (current_setting('tests.m2')::uuid) $$,
  'when the last seat fills, every member gets one "team complete" notification');

select ok(
  (select bool_and(actor_id = current_setting('tests.owner')::uuid and not by_admin and read_at is null)
     from public.notifications
    where kind = 'team_complete' and project_id = current_setting('tests.project')::uuid),
  'it names the owner who filled the last seat, and starts unread');

select tests.authenticate_as(current_setting('tests.m2')::uuid);
select is(
  (select count(*)::int from public.notifications where kind = 'team_complete'),
  1,
  'each member reads only their own copy');
select tests.clear_authentication();

select public.sync_project_fill_state(current_setting('tests.project')::uuid);
select is(
  (select count(*)::int from public.notifications
    where kind = 'team_complete' and project_id = current_setting('tests.project')::uuid),
  3,
  'settling a team that is already full doesn''t notify again');

-- --- The checklist comes from the admin-managed next_steps table -----------
select ok(
  (select count(*) from public.next_steps where title = 'Confirm your roster') = 1
  and (select count(*) from public.next_steps where title = 'Submit your project proposal') = 1,
  'the starting list is seeded');

select tests.authenticate_as(current_setting('tests.m1')::uuid);
select is(
  (select array_agg(e->>'id' order by e->>'id')
     from jsonb_array_elements(public.team_checklist(current_setting('tests.team')::uuid)) e),
  (select array_agg(id::text order by id::text) from public.next_steps),
  'a member''s checklist is exactly the next_steps list');

select throws_ok(
  $$ select public.save_next_step(null, 'Sneaky step') $$,
  '42501', 'Admin access required',
  'a student can''t add a next step');
select throws_ok(
  $$ insert into public.next_steps (title) values ('Sneaky step') $$,
  '42501', null,
  'or write the table directly');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.demo',
  (public.save_next_step(null, '  Book a demo slot  ', timestamptz '2098-05-01 17:00:00+00')).id::text, true);
select throws_ok(
  $$ select public.save_next_step(null, '   ') $$,
  'P0001', 'A next step needs a title',
  'a blank title is refused');
select throws_ok(
  $$ select public.save_next_step(null, 'Far future', timestamptz '2100-01-01 00:00:00+00') $$,
  'P0001', 'Pick a due date between 2000 and 2099',
  'a due date out of range is refused');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('tests.m1')::uuid);
select is(
  (select e->>'due_at' from jsonb_array_elements(public.team_checklist(current_setting('tests.team')::uuid)) e
    where e->>'id' = current_setting('tests.demo')),
  (select to_jsonb(due_at) #>> '{}' from public.next_steps where id = current_setting('tests.demo')::uuid),
  'an item an admin adds shows on the checklist, with its due date');
select is(
  (select e->>'title' from jsonb_array_elements(public.team_checklist(current_setting('tests.team')::uuid)) e
    where e->>'id' = current_setting('tests.demo')),
  'Book a demo slot',
  'and its title trimmed');
select is(
  public.team_checklist(current_setting('tests.team')::uuid)->0->>'id',
  current_setting('tests.demo'),
  'dated items come before undated ones');
select tests.clear_authentication();

-- --- Any member can check an item off; non-members can't ---------------------
select tests.authenticate_as(current_setting('tests.m1')::uuid);
select lives_ok(
  $$ select public.set_next_step_done(current_setting('tests.team')::uuid, current_setting('tests.demo')::uuid, true) $$,
  'a member who isn''t the owner can check an item off');
select tests.clear_authentication();

-- --- Completing an item records who did it and when -------------------------
select is(
  (select completed_by from public.team_next_steps
    where team_id = current_setting('tests.team')::uuid and next_step_id = current_setting('tests.demo')::uuid),
  current_setting('tests.m1')::uuid,
  'completing an item records who did it');
select ok(
  (select completed_at between now() - interval '1 minute' and now() + interval '1 minute'
     from public.team_next_steps
    where team_id = current_setting('tests.team')::uuid and next_step_id = current_setting('tests.demo')::uuid),
  'and when');

select tests.authenticate_as(current_setting('tests.m2')::uuid);
select is(
  (select e->>'completed_by_name'
     from jsonb_array_elements(public.team_checklist(current_setting('tests.team')::uuid)) e
    where e->>'id' = current_setting('tests.demo')),
  'Member Marco',
  'the rest of the team sees who completed it');
select public.set_next_step_done(current_setting('tests.team')::uuid, current_setting('tests.demo')::uuid, true);
select is(
  (select completed_by from public.team_next_steps
    where team_id = current_setting('tests.team')::uuid and next_step_id = current_setting('tests.demo')::uuid),
  current_setting('tests.m1')::uuid,
  'checking off an item that''s already done keeps the first record');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('tests.outsider')::uuid);
select throws_ok(
  $$ select public.set_next_step_done(current_setting('tests.team')::uuid,
       (select id from public.next_steps where title = 'Confirm your roster'), true) $$,
  'P0001', 'Only members of this team can check off its next steps',
  'a student on no team can''t check off another team''s item');
select throws_ok(
  $$ insert into public.team_next_steps (team_id, next_step_id, completed_by)
     values (current_setting('tests.team')::uuid,
             (select id from public.next_steps where title = 'Confirm your roster'),
             current_setting('tests.outsider')::uuid) $$,
  '42501', null,
  'or write the table directly');
select is(
  (select count(*)::int from public.team_next_steps where team_id = current_setting('tests.team')::uuid),
  0,
  'and can''t read the team''s progress');
select throws_ok(
  $$ select public.team_checklist(current_setting('tests.team')::uuid) $$,
  'P0001', 'Only members of this team can see its checklist',
  'or its checklist');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.set_next_step_done(current_setting('tests.team')::uuid, current_setting('tests.demo')::uuid, false) $$,
  'P0001', 'Only members of this team can check off its next steps',
  'an admin can''t tick items for a team');
select lives_ok(
  $$ select public.team_checklist(current_setting('tests.team')::uuid) $$,
  'but can see its checklist');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select public.set_next_step_done(current_setting('tests.team')::uuid, current_setting('tests.demo')::uuid, false);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.team_next_steps where team_id = current_setting('tests.team')::uuid),
  0,
  'any member can undo a checked item');

-- A team still forming has no checklist yet.
select tests.authenticate_as(current_setting('tests.outsider')::uuid);
select set_config('tests.open_project',
  (public.create_project('Still forming', 'One of two seats taken.', 2::smallint,
     current_setting('tests.role')::uuid, '[]'::jsonb)).id::text, true);
select tests.clear_authentication();
select tests.authenticate_as(current_setting('tests.outsider')::uuid);
select throws_ok(
  format($$ select public.set_next_step_done(%L::uuid, %L::uuid, true) $$,
    (select id from public.teams where project_id = current_setting('tests.open_project')::uuid),
    current_setting('tests.demo')),
  'P0001', 'The checklist opens once the team is full',
  'a team that isn''t full can''t check items off yet');
select tests.clear_authentication();

-- --- Every way a team fills notifies -------------------------------------------
select tests.authenticate_as(current_setting('tests.m2')::uuid);
select public.leave_team();
select tests.clear_authentication();
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select public.admin_assign_student(current_setting('tests.placed')::uuid, current_setting('tests.team')::uuid,
  current_setting('tests.role')::uuid);
select tests.clear_authentication();

select bag_eq(
  $$ select user_id from public.notifications
      where kind = 'team_complete' and project_id = current_setting('tests.project')::uuid and by_admin $$,
  $$ values (current_setting('tests.owner')::uuid), (current_setting('tests.m1')::uuid),
            (current_setting('tests.placed')::uuid) $$,
  'an admin filling the last seat notifies the new roster, marked by_admin');

-- --- Deleting an item takes it off the checklist -----------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select public.delete_next_step(current_setting('tests.demo')::uuid);
select tests.clear_authentication();
select tests.authenticate_as(current_setting('tests.m1')::uuid);
select ok(
  not exists (
    select 1 from jsonb_array_elements(public.team_checklist(current_setting('tests.team')::uuid)) e
     where e->>'id' = current_setting('tests.demo')),
  'an item an admin deletes is gone from every checklist');
select tests.clear_authentication();

select * from finish();
rollback;
