-- Announcements: 29_announcements.sql.
begin;
select plan(36);

select set_config('tests.admin',   tests.sign_in_with_microsoft('admin01@utrgv.edu', 'Professor Admin')::text, true);
select set_config('tests.student', tests.sign_in_with_microsoft('student01@utrgv.edu', 'Student')::text, true);
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;

-- --- Only admins post -----------------------------------------------------------
select tests.authenticate_as(current_setting('tests.student')::uuid);
select throws_ok(
  $$ select public.save_announcement(null, 'Hello class', 'Teams are due Friday.') $$,
  '42501', 'Admin access required',
  'a student can''t post an announcement');
select throws_ok(
  $$ insert into public.announcements (title, body) values ('Sneaky', 'Posted around the function.') $$,
  '42501', null,
  'a student can''t write the table directly either');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.a1', (public.save_announcement(null, '  Teams due Friday  ',
  E'  Every team should have\r\nall its members by Friday 5pm.  ')).id::text, true);
select tests.clear_authentication();

select is(
  (select title from public.announcements where id = current_setting('tests.a1')::uuid),
  'Teams due Friday',
  'an admin can post an announcement; the title is trimmed');
select is(
  (select body from public.announcements where id = current_setting('tests.a1')::uuid),
  E'Every team should have\nall its members by Friday 5pm.',
  'the message is trimmed, with Windows line endings made plain');
select is(
  (select author_id from public.announcements where id = current_setting('tests.a1')::uuid),
  current_setting('tests.admin')::uuid,
  'the admin who posted it is the author');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.save_announcement(current_setting('tests.a1')::uuid, 'Teams due Friday (updated)', 'Moved to 6pm.') $$,
  'an admin can edit an announcement');
select tests.clear_authentication();
select is(
  (select title || ' / ' || body from public.announcements where id = current_setting('tests.a1')::uuid),
  'Teams due Friday (updated) / Moved to 6pm.',
  'the edit is saved');

select tests.authenticate_as(current_setting('tests.student')::uuid);
select throws_ok(
  $$ select public.save_announcement(current_setting('tests.a1')::uuid, 'Hacked', 'By a student.') $$,
  '42501', 'Admin access required',
  'a student can''t edit one');
select throws_ok(
  $$ select public.delete_announcement(current_setting('tests.a1')::uuid) $$,
  '42501', 'Admin access required',
  'a student can''t delete one');
select tests.clear_authentication();

-- --- Who can read them -------------------------------------------------------------
select tests.authenticate_as(current_setting('tests.student')::uuid);
select is(jsonb_array_length(public.announcement_feed()), 1, 'a student reads the feed');
select is(public.announcement_feed()->0->>'author_name', 'Professor Admin',
  'with the author''s name, though students can''t read admin accounts directly');
select is((select count(*)::int from public.users where id = current_setting('tests.admin')::uuid), 0,
  'and the admin''s account stays hidden from them');
select tests.clear_authentication();

select set_config('role', 'anon', true);
select is((select count(*)::int from public.announcements), 0, 'a guest can''t read announcements');
select throws_ok($$ select public.announcement_feed() $$, '42501', null, 'or call the feed');
select tests.clear_authentication();

-- --- Garbage is refused -----------------------------------------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok($$ select public.save_announcement(null, '   ', 'Body text.') $$,
  'P0001', 'An announcement needs a title', 'a blank title is refused');
select throws_ok($$ select public.save_announcement(null, repeat('t', 121), 'Body text.') $$,
  'P0001', 'Keep the title to 120 characters or fewer', 'a title over 120 characters is refused');
select throws_ok($$ select public.save_announcement(null, '!!! ???', 'Body text.') $$,
  'P0001', 'The title has to include letters or numbers', 'a title of only punctuation is refused');
select throws_ok($$ select public.save_announcement(null, E'Two\nlines', 'Body text.') $$,
  'P0001', 'The title can''t contain line breaks, hidden or control characters', 'a line break in a title is refused');
select throws_ok($$ select public.save_announcement(null, U&'Hi\200B there', 'Body text.') $$,
  'P0001', 'The title can''t contain line breaks, hidden or control characters', 'a zero-width space in a title is refused');
select throws_ok($$ select public.save_announcement(null, 'Title', E' \n\t ') $$,
  'P0001', 'An announcement needs a message', 'a message of only whitespace is refused');
select throws_ok($$ select public.save_announcement(null, 'Title', repeat('b', 2001)) $$,
  'P0001', 'Keep the message to 2000 characters or fewer', 'a message over 2000 characters is refused');
select throws_ok($$ select public.save_announcement(null, 'Title', U&'\+01F389\+01F389 \2192\2192') $$,
  'P0001', 'The message has to include letters or numbers', 'a message of only emoji and arrows is refused');
select throws_ok($$ select public.save_announcement(null, 'Title', E'Bring\x1b[31m laptops') $$,
  'P0001', 'The message can''t contain hidden or control characters', 'a terminal escape is refused');
select throws_ok($$ select public.save_announcement(null, 'Title', U&'Due \202Efdp.lasoporp') $$,
  'P0001', 'The message can''t contain hidden or control characters', 'a right-to-left override is refused');
select throws_ok($$ select public.save_announcement(null, 'Title', E'One.\n \n\t\nTwo.') $$,
  'P0001', 'Leave at most one blank line in a row in the message', 'blank lines piled up are refused');
select lives_ok($$ select public.save_announcement(null, 'Longest', repeat('b', 2000)) $$,
  'a 2000-character message is fine');
select tests.clear_authentication();

select throws_ok(
  $$ update public.announcements set body = '...' where id = current_setting('tests.a1')::uuid $$,
  '23514', null, 'the table refuses a message with no letters or numbers');
select throws_ok(
  $$ update public.announcements set title = E'a\tb' where id = current_setting('tests.a1')::uuid $$,
  '23514', null, 'the table refuses control characters in a title');

-- --- Injection attempts are just text --------------------------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.inj', (public.save_announcement(null,
  $t$Robert'); DROP TABLE public.announcements; --$t$,
  $b$<script>alert(1)</script> 1'; DELETE FROM public.users; --$b$)).id::text, true);
select throws_ok($$ select public.delete_announcement($x$1' or '1'='1$x$) $$,
  '22P02', null, 'an id that isn''t a uuid is refused');
select tests.clear_authentication();
select is(
  (select title || ' | ' || body from public.announcements where id = current_setting('tests.inj')::uuid),
  $v$Robert'); DROP TABLE public.announcements; -- | <script>alert(1)</script> 1'; DELETE FROM public.users; --$v$,
  'SQL and HTML in an announcement are stored as plain text');
select has_table('public', 'announcements', 'and nothing was dropped');

-- --- The badge: what's new since the student last looked -------------------------
-- Everything in a pgTAP file is one transaction (one now()), so "last
-- seen" is set by hand around the rows rather than by waiting.
update public.users set announcements_seen_at = null where id = current_setting('tests.student')::uuid;
select tests.authenticate_as(current_setting('tests.student')::uuid);
select is(public.unseen_announcement_count(), 3, 'a student who never opened the page has every announcement as new');
select public.mark_announcements_seen();
select tests.clear_authentication();
select is(
  (select announcements_seen_at from public.users where id = current_setting('tests.student')::uuid),
  now(),
  'opening the page records when');

update public.users set announcements_seen_at = now() - interval '1 hour' where id = current_setting('tests.student')::uuid;
update public.announcements set updated_at = now() - interval '2 hours' where id <> current_setting('tests.a1')::uuid;
insert into public.milestones (name, due_at) values ('Demo day', now() + interval '30 days');
select tests.authenticate_as(current_setting('tests.student')::uuid);
select is(public.unseen_announcement_count(), 2,
  'afterwards only the edited announcement and the new milestone count');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select is(public.unseen_announcement_count(), 0, 'admins post them, so they get no badge');
select lives_ok($$ select public.delete_announcement(current_setting('tests.a1')::uuid) $$,
  'an admin can delete an announcement');
select tests.clear_authentication();

select * from finish();
rollback;
