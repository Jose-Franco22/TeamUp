-- Milestone messages, and keeping garbage out of them (issue #38):
-- 28_milestone_messages.sql.
begin;
select plan(26);

select set_config('tests.admin',   tests.sign_in_with_microsoft('admin01@utrgv.edu', 'Admin')::text, true);
select set_config('tests.student', tests.sign_in_with_microsoft('student01@utrgv.edu', 'Student')::text, true);
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;

select has_function('public', 'save_milestone', array['uuid', 'text', 'timestamp with time zone', 'boolean', 'text'],
  'save_milestone() takes a message');
select hasnt_function('public', 'save_milestone', array['uuid', 'text', 'timestamp with time zone', 'boolean'],
  'the old form without a message is gone, so nothing can skip its checks');

-- --- Good messages are saved, tidied -----------------------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.ms', (public.save_milestone(null, 'Proposal due', now() + interval '7 days', false,
  E'  Upload the proposal PDF to Blackboard.\r\nOne per team.  ')).id::text, true);
select tests.clear_authentication();

select is(
  (select message from public.milestones where id = current_setting('tests.ms')::uuid),
  E'Upload the proposal PDF to Blackboard.\nOne per team.',
  'a message is saved trimmed, with Windows line endings made plain');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.save_milestone(null, 'Two paragraphs', now(), false, E'First paragraph.\n\nSecond paragraph.') $$,
  'one blank line between paragraphs is fine');
select lives_ok(
  $$ select public.save_milestone(null, 'Tabs', now(), false, E'Bring:\n\t- laptop\n\t- charger') $$,
  'tabs are fine');
select lives_ok(
  $$ select public.save_milestone(null, 'Bilingual', now(), false, 'Entreguen la propuesta — 提交提案') $$,
  'a message in another language or script is fine');
select lives_ok(
  $$ select public.save_milestone(null, 'Longest', now(), false, repeat('a', 1000)) $$,
  'a 1000-character message is fine');
select set_config('tests.blank', (public.save_milestone(null, 'No message', now(), false, E'  \n\t ')).id::text, true);
select tests.clear_authentication();

select is(
  (select message from public.milestones where id = current_setting('tests.blank')::uuid),
  '',
  'a message of only spaces is saved as no message');

-- --- Garbage is refused --------------------------------------------------------
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.save_milestone(null, 'Too long', now(), false, repeat('a', 1001)) $$,
  'P0001', 'Keep the message to 1000 characters or fewer',
  'a message over 1000 characters is refused');
select throws_ok(
  $$ select public.save_milestone(null, 'Punctuation', now(), false, '... !!! --- ???') $$,
  'P0001', 'The message has to include letters or numbers',
  'a message of only punctuation is refused');
select throws_ok(
  $$ select public.save_milestone(null, 'Symbols', now(), false, U&'\2192\2192\2192 \+01F389\+01F389 \2605') $$,
  'P0001', 'The message has to include letters or numbers',
  'a message of only arrows, emoji and symbols is refused');
select throws_ok(
  $$ select public.save_milestone(null, 'Control', now(), false, E'Bring\x07 laptops') $$,
  'P0001', 'The message can''t contain hidden or control characters',
  'a control character is refused');
select throws_ok(
  $$ select public.save_milestone(null, 'Null-ish', now(), false, E'Bring\x1b[31m laptops') $$,
  'P0001', 'The message can''t contain hidden or control characters',
  'a terminal escape sequence is refused');
select throws_ok(
  $$ select public.save_milestone(null, 'Zero width', now(), false, U&'Bring\200B laptops') $$,
  'P0001', 'The message can''t contain hidden or control characters',
  'a zero-width space is refused');
select throws_ok(
  $$ select public.save_milestone(null, 'Bidi', now(), false, U&'Due \202Efdp.lasoporp') $$,
  'P0001', 'The message can''t contain hidden or control characters',
  'a right-to-left override is refused');
select throws_ok(
  $$ select public.save_milestone(null, 'BOM', now(), false, U&'\FEFFBring laptops') $$,
  'P0001', 'The message can''t contain hidden or control characters',
  'a byte-order mark is refused');
select throws_ok(
  $$ select public.save_milestone(null, 'Blank lines', now(), false, E'One.\n\n\nTwo.') $$,
  'P0001', 'Leave at most one blank line in a row in the message',
  'two blank lines in a row are refused');
select throws_ok(
  $$ select public.save_milestone(null, 'Sneaky blank lines', now(), false, E'One.\n \n\t\nTwo.') $$,
  'P0001', 'Leave at most one blank line in a row in the message',
  'blank lines hiding spaces or tabs are refused too');
select throws_ok(
  $$ select public.save_milestone(current_setting('tests.ms')::uuid, 'Proposal due', now(), false, '!!!!!!') $$,
  'P0001', 'The message has to include letters or numbers',
  'an edit is held to the same rules');
select tests.clear_authentication();

select is(
  (select message from public.milestones where id = current_setting('tests.ms')::uuid),
  E'Upload the proposal PDF to Blackboard.\nOne per team.',
  'a refused edit leaves the message alone');
select is(
  (select count(*)::int from public.milestones),
  6,
  'none of the refused messages were saved');

-- --- The table refuses garbage written any other way ---------------------------
select throws_ok(
  $$ update public.milestones set message = '...' where id = current_setting('tests.ms')::uuid $$,
  '23514', null,
  'the table refuses a message with no letters or numbers');
select throws_ok(
  $$ update public.milestones set message = U&'Bring\200B laptops' where id = current_setting('tests.ms')::uuid $$,
  '23514', null,
  'the table refuses invisible characters');
select throws_ok(
  $$ update public.milestones set message = '  padded  ' where id = current_setting('tests.ms')::uuid $$,
  '23514', null,
  'the table refuses an untrimmed message');

-- --- Who can write and read it ------------------------------------------------
select tests.authenticate_as(current_setting('tests.student')::uuid);
select throws_ok(
  $$ select public.save_milestone(null, 'Student', now(), false, 'Hello') $$,
  '42501', 'Admin access required',
  'a student can''t save a milestone message');
select is(
  (select message from public.milestones where id = current_setting('tests.ms')::uuid),
  E'Upload the proposal PDF to Blackboard.\nOne per team.',
  'a student can read the message');
select tests.clear_authentication();

select * from finish();
rollback;
