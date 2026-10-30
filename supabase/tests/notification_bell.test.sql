-- The notification bell (issue #20): who can read, mark and write
-- notifications. 20_leave_team_rules.sql and 24_notification_bell.sql.
-- "A join request notifies the creator once" lives in
-- join_request_notifications.test.sql; this file relies on it for setup.
begin;
select plan(12);

select set_config('tests.owner', tests.sign_in_with_microsoft('owner01@utrgv.edu', 'Owner')::text, true);
select set_config('tests.owner2', tests.sign_in_with_microsoft('owner02@utrgv.edu', 'Owner Two')::text, true);
select set_config('tests.ana', tests.sign_in_with_microsoft('ana01@utrgv.edu', 'Ana')::text, true);
select set_config('tests.ben', tests.sign_in_with_microsoft('ben01@utrgv.edu', 'Ben')::text, true);
select set_config('tests.pm', (select id from public.roles where name = 'Project Manager')::text, true);

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select set_config('tests.p1',
  (public.create_project('Trail Finder', 'Find hiking trails near campus.', 3::smallint, current_setting('tests.pm')::uuid, '[]'::jsonb)).id::text, true);
select tests.authenticate_as(current_setting('tests.owner2')::uuid);
select set_config('tests.p2',
  (public.create_project('Study Buddy', 'Match classmates into study groups.', 4::smallint, current_setting('tests.pm')::uuid, '[]'::jsonb)).id::text, true);

-- The owner hears from Ana and Ben; owner2 hears from Ana.
select tests.authenticate_as(current_setting('tests.ana')::uuid);
select public.create_join_request(current_setting('tests.p1')::uuid);
select public.create_join_request(current_setting('tests.p2')::uuid);
select tests.authenticate_as(current_setting('tests.ben')::uuid);
select public.create_join_request(current_setting('tests.p1')::uuid);
select tests.clear_authentication();

select is((select count(*)::int from public.notifications), 3, 'setup: three notifications');
select set_config('tests.owner2_n',
  (select id::text from public.notifications where user_id = current_setting('tests.owner2')::uuid), true);
select set_config('tests.owner_n',
  (select id::text from public.notifications where user_id = current_setting('tests.owner')::uuid limit 1), true);

-- --- RLS: select only your own --------------------------------------------
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select is(
  (select count(*)::int from public.notifications where user_id = current_setting('tests.owner')::uuid),
  2, 'a user sees their own notifications');
select is(
  (select count(*)::int from public.notifications where user_id <> current_setting('tests.owner')::uuid),
  0, 'and none of anyone else''s');

-- --- Marking read: only your own ------------------------------------------
-- Passing someone else's id along with your own marks only your own.
select public.mark_notifications_read(array[current_setting('tests.owner_n')::uuid, current_setting('tests.owner2_n')::uuid]);
select tests.clear_authentication();
select isnt(
  (select read_at from public.notifications where id = current_setting('tests.owner_n')::uuid),
  null, 'mark_notifications_read() marks the caller''s own notification');
select is(
  (select read_at from public.notifications where id = current_setting('tests.owner2_n')::uuid),
  null, 'but not someone else''s, even when its id is passed');

-- There's no UPDATE policy, so a direct update changes nothing.
select tests.authenticate_as(current_setting('tests.owner2')::uuid);
update public.notifications set read_at = now();
select tests.clear_authentication();
select is(
  (select count(*)::int from public.notifications where read_at is not null),
  1, 'a direct UPDATE marks nothing read');

-- mark_all_notifications_read() clears the caller's unread and nobody else's.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select public.mark_all_notifications_read();
select tests.clear_authentication();
select is(
  (select count(*)::int from public.notifications
    where user_id = current_setting('tests.owner')::uuid and read_at is null),
  0, 'mark_all_notifications_read() marks all of the caller''s notifications read');
select is(
  (select read_at from public.notifications where id = current_setting('tests.owner2_n')::uuid),
  null, 'and leaves other users'' unread');

select tests.clear_authentication();
select throws_ok(
  'select public.mark_all_notifications_read()',
  'P0001', 'Not signed in',
  'mark_all_notifications_read() needs a signed-in user');

-- --- No direct inserts -----------------------------------------------------
select tests.authenticate_as(current_setting('tests.ana')::uuid);
select throws_ok(
  format($q$insert into public.notifications (user_id, kind, project_id, actor_id)
            values (%L, 'join_request', %L, %L)$q$,
         current_setting('tests.owner'), current_setting('tests.p1'), current_setting('tests.ana')),
  '42501', null,
  'a user can''t insert a notification for someone else');
select throws_ok(
  format($q$insert into public.notifications (user_id, kind) values (%L, 'member_left')$q$,
         current_setting('tests.ana')),
  '42501', null,
  'or for themselves');
select tests.clear_authentication();
select is((select count(*)::int from public.notifications), 3, 'no notifications were added');

select * from finish();
rollback;
