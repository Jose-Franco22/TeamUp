-- Weekly team check-ins (issue #55): 41_check_ins.sql.
--
-- "This week" is whatever week the transaction's now() falls in, which is
-- what the policies compare against. Last week's rows are written as the
-- test's own superuser role, the only way to have one, since a member can't.
-- The reminder job takes a fixed clock, placed inside the current week so it
-- agrees with the check-ins posted here.
begin;
select plan(36);

select set_config('tests.owner',    tests.sign_in_with_microsoft('owner55@utrgv.edu', 'Olga Owner')::text, true);
select set_config('tests.member',   tests.sign_in_with_microsoft('member55@utrgv.edu', 'Milo Member')::text, true);
select set_config('tests.adviser',  tests.sign_in_with_microsoft('adviser55@utrgv.edu', 'Ada Adviser')::text, true);
select set_config('tests.pending',  tests.sign_in_with_microsoft('pending55@utrgv.edu', 'Pat Pending')::text, true);
select set_config('tests.owner_b',  tests.sign_in_with_microsoft('ownerb55@utrgv.edu', 'Bea Builder')::text, true);
select set_config('tests.member_b', tests.sign_in_with_microsoft('memberb55@utrgv.edu', 'Ben Builder')::text, true);
select set_config('tests.forming',  tests.sign_in_with_microsoft('forming55@utrgv.edu', 'Fran Forming')::text, true);
select set_config('tests.loner',    tests.sign_in_with_microsoft('loner55@utrgv.edu', 'Lou Loner')::text, true);

-- Two formed two-seat teams, A and B. Ada advises A (accepted); Pat has been
-- asked to advise B and hasn't answered. Fran is alone on a three-seat
-- project that is still forming. Lou is on no team.
select set_config('tests.project',
  tests.create_full_team(current_setting('tests.owner')::uuid, current_setting('tests.member')::uuid)::text, true);
select set_config('tests.project_b',
  tests.create_full_team(current_setting('tests.owner_b')::uuid, current_setting('tests.member_b')::uuid)::text, true);

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select set_config('tests.invite',
  (select (public.invite_adviser(current_setting('tests.project')::uuid,
                                 current_setting('tests.adviser')::uuid)).id::text), true);
select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select public.respond_to_adviser_request(current_setting('tests.invite')::uuid, true);

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select public.invite_adviser(current_setting('tests.project_b')::uuid, current_setting('tests.pending')::uuid);

select tests.authenticate_as(current_setting('tests.forming')::uuid);
select set_config('tests.project_forming', (select (public.create_project(
  'Still forming project', 'Three seats and only one of them filled so far.', 3::smallint,
  (select id from public.roles where name = 'Backend Developer'), '[]'::jsonb)).id::text), true);
select tests.clear_authentication();

select set_config('tests.week', public.check_in_week_start()::text, true);

-- --- the week ---------------------------------------------------------------

select is(public.check_in_week_start('2026-11-18 12:00:00-06'), '2026-11-16'::date,
  'a Wednesday falls in the week starting that Monday');
select is(public.check_in_week_start('2026-11-23 05:59:00+00'), '2026-11-16'::date,
  'Sunday 11:59 PM Central is still the old week, though it is Monday in UTC');
select is(public.check_in_week_start('2026-11-23 06:00:00+00'), '2026-11-23'::date,
  'midnight Monday Central starts the new week');
select is(public.check_in_week_start('2026-11-02 05:30:00+00'), '2026-10-26'::date,
  'the night the clocks fall back, 11:30 PM CST Sunday is the old week');
select is(public.check_in_week_start('2026-11-02 06:00:00+00'), '2026-11-02'::date,
  'and midnight CST Monday after the change starts the new one');

-- --- the table ----------------------------------------------------------------

select has_table('public', 'check_ins', 'check_ins exists');
select col_is_unique('public', 'check_ins', array['user_id', 'project_id', 'week_start']::name[],
  'a member has at most one check-in per project per week');

-- --- posting ------------------------------------------------------------------

select tests.authenticate_as(current_setting('tests.member')::uuid);
select lives_ok(
  $$ insert into public.check_ins (project_id, did, doing_next, blockers)
     values (current_setting('tests.project')::uuid, 'Set up the repo', 'Wire up auth', '  ') $$,
  'a member of a formed team posts a check-in for this week');
select is(
  (select row(user_id, week_start, blockers)::text from public.check_ins
    where project_id = current_setting('tests.project')::uuid),
  row(current_setting('tests.member')::uuid, current_setting('tests.week')::date, null::text)::text,
  'it is theirs, for this week, and a blank blocker is stored as none');

select throws_ok(
  $$ insert into public.check_ins (project_id, did, doing_next)
     values (current_setting('tests.project')::uuid, 'Again', 'Again') $$,
  '23505', null, 'a second check-in for the same week is refused');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_ok(
  $$ insert into public.check_ins (project_id, user_id, did, doing_next)
     values (current_setting('tests.project')::uuid, current_setting('tests.member')::uuid, 'Forged', 'Forged') $$,
  '42501', null, 'a teammate cannot post a check-in as somebody else');
select throws_ok(
  $$ insert into public.check_ins (project_id, week_start, did, doing_next)
     values (current_setting('tests.project')::uuid, current_setting('tests.week')::date - 7, 'Late', 'Late') $$,
  '42501', null, 'nor post one for last week');
select throws_ok(
  $$ insert into public.check_ins (project_id, week_start, did, doing_next)
     values (current_setting('tests.project')::uuid, current_setting('tests.week')::date + 7, 'Early', 'Early') $$,
  '42501', null, 'nor for next week');
select throws_ok(
  $$ insert into public.check_ins (project_id, did, doing_next)
     values (current_setting('tests.project')::uuid, '   ', 'Something') $$,
  '23514', null, 'what I did is required');
select throws_ok(
  $$ insert into public.check_ins (project_id, did, doing_next)
     values (current_setting('tests.project')::uuid, 'Something', repeat('x', 501)) $$,
  '23514', null, 'and each field is at most 500 characters');
select lives_ok(
  $$ insert into public.check_ins (project_id, did, doing_next, blockers)
     values (current_setting('tests.project')::uuid, repeat('a', 500), 'Write the API', 'Waiting on DB access') $$,
  '500 characters is fine, and so is a blocker');

-- --- not on the team ----------------------------------------------------------

select tests.authenticate_as(current_setting('tests.member_b')::uuid);
select throws_ok(
  $$ insert into public.check_ins (project_id, did, doing_next)
     values (current_setting('tests.project')::uuid, 'Not my team', 'Still not') $$,
  '42501', null, 'a member of another team cannot post a check-in for this one');

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select throws_ok(
  $$ insert into public.check_ins (project_id, did, doing_next)
     values (current_setting('tests.project')::uuid, 'Advised', 'Advising') $$,
  '42501', null, 'nor can the adviser: they hold no seat');

select tests.authenticate_as(current_setting('tests.loner')::uuid);
select throws_ok(
  $$ insert into public.check_ins (project_id, did, doing_next)
     values (current_setting('tests.project')::uuid, 'Nope', 'Nope') $$,
  '42501', null, 'nor a student on no team');

select tests.authenticate_as(current_setting('tests.forming')::uuid);
select throws_ok(
  $$ insert into public.check_ins (project_id, did, doing_next)
     values (current_setting('tests.project_forming')::uuid, 'Too soon', 'Too soon') $$,
  '42501', null, 'a team that is still forming cannot check in yet');

-- --- editing ------------------------------------------------------------------

select tests.clear_authentication();
insert into public.check_ins (project_id, user_id, week_start, did, doing_next)
values (current_setting('tests.project')::uuid, current_setting('tests.member')::uuid,
        current_setting('tests.week')::date - 7, 'Last week', 'Last week next');

select tests.authenticate_as(current_setting('tests.member')::uuid);
update public.check_ins set blockers = 'Stuck on CI'
 where user_id = current_setting('tests.member')::uuid
   and week_start = current_setting('tests.week')::date;
select is(
  (select blockers from public.check_ins
    where user_id = current_setting('tests.member')::uuid and week_start = current_setting('tests.week')::date),
  'Stuck on CI', 'a member edits their own check-in this week');

update public.check_ins set did = 'Rewritten'
 where user_id = current_setting('tests.member')::uuid
   and week_start = current_setting('tests.week')::date - 7;
select is(
  (select did from public.check_ins
    where user_id = current_setting('tests.member')::uuid and week_start = current_setting('tests.week')::date - 7),
  'Last week', 'but last week''s is closed: the edit changes nothing');

select throws_ok(
  $$ update public.check_ins set week_start = week_start - 7
      where user_id = current_setting('tests.member')::uuid
        and week_start = current_setting('tests.week')::date $$,
  '42501', null, 'and a check-in cannot be moved to another week');

select tests.authenticate_as(current_setting('tests.owner')::uuid);
update public.check_ins set did = 'Hijacked'
 where user_id = current_setting('tests.member')::uuid;
select is(
  (select count(*)::int from public.check_ins where did = 'Hijacked'),
  0, 'a teammate cannot edit somebody else''s check-in');

select throws_ok(
  $$ delete from public.check_ins where project_id = current_setting('tests.project')::uuid $$,
  '42501', null, 'nobody can delete a check-in');
select tests.clear_authentication();
select is(
  (select count(*)::int from public.check_ins where project_id = current_setting('tests.project')::uuid),
  3, 'so all three are still there');

-- --- reading ------------------------------------------------------------------

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select is((select count(*)::int from public.check_ins), 3,
  'a teammate reads the team''s check-ins, this week and earlier');

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select is((select count(*)::int from public.check_ins), 3,
  'the accepted adviser reads them too');

select tests.authenticate_as(current_setting('tests.member_b')::uuid);
select is((select count(*)::int from public.check_ins), 0,
  'a member of another team reads none of them');

select tests.authenticate_as(current_setting('tests.pending')::uuid);
select is((select count(*)::int from public.check_ins), 0,
  'nor does somebody asked to advise who has not accepted');

select tests.authenticate_as(current_setting('tests.loner')::uuid);
select is((select count(*)::int from public.check_ins), 0,
  'nor a student on no team');

select tests.clear_authentication();
select set_config('role', 'anon', true);
select throws_ok($$ select * from public.check_ins $$, '42501', null, 'guests cannot read check-ins at all');
select tests.clear_authentication();

-- --- Friday reminders ---------------------------------------------------------
-- deadline = Friday 6 PM Central of the current week.
create function pg_temp.friday_plus(p_offset interval) returns integer
language sql as $$
  select private.send_check_in_reminders(
    ((current_setting('tests.week')::date + interval '4 days 18 hours') at time zone 'America/Chicago') + p_offset)
$$;

select is(pg_temp.friday_plus(-interval '1 minute'), 0, 'before Friday 6 PM Central, nobody is reminded');

-- Team A both checked in above. Team B: neither did. Fran's team isn't
-- formed, so isn't asked.
select is(pg_temp.friday_plus(interval '0'), 2, 'at Friday 6 PM, everyone on a formed team without a check-in is reminded');
select bag_eq(
  $$ select user_id, project_id from public.notifications where kind = 'check_in_reminder' $$,
  $$ values (current_setting('tests.owner_b')::uuid,  current_setting('tests.project_b')::uuid),
            (current_setting('tests.member_b')::uuid, current_setting('tests.project_b')::uuid) $$,
  'the reminders go to exactly those members, naming their project');
select is(pg_temp.friday_plus(interval '1 day'), 0, 'a later run the same week sends nothing new');

select * from finish();
rollback;
