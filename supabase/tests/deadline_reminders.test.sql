-- Automatic reminders before the formation deadline (issue #43):
-- 37_deadline_reminders.sql. The job runs with a fixed clock (p_now), so
-- every case is checked at an exact distance from the deadline.
begin;
select plan(29);

select set_config('tests.admin',  tests.sign_in_with_microsoft('dradmin@utrgv.edu', 'Admin Ada')::text, true);
select set_config('tests.full1',  tests.sign_in_with_microsoft('drfull1@utrgv.edu', 'Full Fay')::text, true);
select set_config('tests.full2',  tests.sign_in_with_microsoft('drfull2@utrgv.edu', 'Full Finn')::text, true);
select set_config('tests.open',   tests.sign_in_with_microsoft('dropen@utrgv.edu', 'Open Omar')::text, true);
select set_config('tests.loner',  tests.sign_in_with_microsoft('drloner@utrgv.edu', 'Loner Lia')::text, true);
select set_config('tests.late1',  tests.sign_in_with_microsoft('drlate1@utrgv.edu', 'Late Lou')::text, true);
select set_config('tests.late2',  tests.sign_in_with_microsoft('drlate2@utrgv.edu', 'Late Lin')::text, true);
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;

-- The deadline is 10 days out on the real clock, so the teams below can
-- still be formed (posting and requesting close at the deadline).
update public.milestones set is_formation_deadline = false where is_formation_deadline;
insert into public.milestones (name, due_at, is_formation_deadline)
values ('Team formation deadline', date_trunc('minute', now()) + interval '10 days', true);
select set_config('tests.deadline', public.formation_deadline()::text, true);

-- full1 and full2 fill a two-seat team. open posts a three-seat project and
-- is alone on it: on a team, but not a full one. loner, late1 and late2
-- are on no team.
select tests.create_full_team(current_setting('tests.full1')::uuid, current_setting('tests.full2')::uuid);
select tests.authenticate_as(current_setting('tests.open')::uuid);
select public.create_project('Open project', 'Three seats, two still open.', 3::smallint,
  (select id from public.roles where name = 'Backend Developer'), '[]'::jsonb);
select tests.clear_authentication();

-- A shorthand for "run the job at deadline + this offset".
create function pg_temp.run_at(p_offset interval) returns integer
language sql as $$
  select private.send_deadline_reminders(current_setting('tests.deadline')::timestamptz + p_offset)
$$;

-- --- Before the 3-day mark: nothing ----------------------------------------
select is(pg_temp.run_at(-interval '5 days'), 0, '5 days out, the job sends nothing');
select is(pg_temp.run_at(-interval '3 days' - interval '1 second'), 0,
  'a second before the 3-day mark, still nothing');
select is((select count(*)::int from public.notifications where kind = 'deadline_reminder'), 0,
  'no reminder notifications yet');

-- --- 3 days before ---------------------------------------------------------
select is(pg_temp.run_at(-interval '3 days'), 4, 'exactly 3 days before, the job sends 4 reminders');

select bag_eq(
  $$ select user_id from public.notifications where kind = 'deadline_reminder' $$,
  $$ values (current_setting('tests.open')::uuid), (current_setting('tests.loner')::uuid),
            (current_setting('tests.late1')::uuid), (current_setting('tests.late2')::uuid) $$,
  '3 days before: only the students not on a full team get one, each exactly once');

select is(
  (select count(*)::int from public.notifications
    where kind = 'deadline_reminder'
      and user_id in (current_setting('tests.full1')::uuid, current_setting('tests.full2')::uuid)),
  0, '3 days before: students on a full team get nothing');

select is(
  (select count(*)::int from public.notifications where user_id = current_setting('tests.admin')::uuid),
  0, 'admins get nothing');

select ok(
  (select bool_and(project_id is null and actor_id is null and not by_admin and read_at is null)
     from public.notifications where kind = 'deadline_reminder'),
  'a reminder is about no project, names nobody, and starts unread');

select bag_eq(
  $$ select user_id, deadline_at, days_before from private.deadline_reminders $$,
  $$ select u, current_setting('tests.deadline')::timestamptz, 3::smallint
       from unnest(array[current_setting('tests.open')::uuid, current_setting('tests.loner')::uuid,
                         current_setting('tests.late1')::uuid, current_setting('tests.late2')::uuid]) u $$,
  'each one is recorded as the 3-day reminder for this deadline');

-- --- Running again the same day: no duplicates -----------------------------
select is(pg_temp.run_at(-interval '3 days'), 0, 'running the job twice at the same moment sends nothing new');
select is(pg_temp.run_at(-interval '3 days' + interval '5 hours'), 0,
  'running it again later the same day sends nothing new');
select is(pg_temp.run_at(-interval '1 day' - interval '1 second'), 0,
  'nor does any run up to the 1-day mark');
select is((select count(*)::int from public.notifications where kind = 'deadline_reminder'), 4,
  'still one reminder per student');

-- --- A team fills between the two reminders --------------------------------
select tests.create_full_team(current_setting('tests.late1')::uuid, current_setting('tests.late2')::uuid);

-- --- 1 day before ------------------------------------------------------------
select is(pg_temp.run_at(-interval '1 day'), 2, 'exactly 1 day before, the job sends 2 reminders');

select bag_eq(
  $$ select user_id from private.deadline_reminders where days_before = 1 $$,
  $$ values (current_setting('tests.open')::uuid), (current_setting('tests.loner')::uuid) $$,
  '1 day before: only the students not on a full team get one');

select is(
  (select count(*)::int from public.notifications
    where kind = 'deadline_reminder'
      and user_id in (current_setting('tests.full1')::uuid, current_setting('tests.full2')::uuid,
                      current_setting('tests.late1')::uuid, current_setting('tests.late2')::uuid)),
  2, '1 day before: students on a full team get nothing, including a team that filled since the 3-day one');

select is(pg_temp.run_at(-interval '1 day'), 0, 'running the 1-day job twice sends nothing new');
select is(pg_temp.run_at(-interval '1 minute'), 0, 'nor does any run up to the deadline');

select bag_eq(
  $$ select user_id, count(*)::int from public.notifications
      where kind = 'deadline_reminder' group by user_id $$,
  $$ values (current_setting('tests.open')::uuid, 2), (current_setting('tests.loner')::uuid, 2),
            (current_setting('tests.late1')::uuid, 1), (current_setting('tests.late2')::uuid, 1) $$,
  'in all: two reminders for the students still unplaced, one for those placed in between');

-- --- A student sees their own, and can't run the job -----------------------
select tests.authenticate_as(current_setting('tests.loner')::uuid);
select is((select count(*)::int from public.notifications where kind = 'deadline_reminder'), 2,
  'a student reads their own two reminders, and no one else''s');
select throws_ok(
  $$ select private.send_deadline_reminders() $$,
  '42501', null,
  'a student can''t run the job themselves');
select throws_ok(
  $$ select * from private.deadline_reminders $$,
  '42501', null,
  'nor read what has been sent');
select tests.clear_authentication();

-- --- At or after the deadline: nothing ---------------------------------------
-- Everyone above already has both reminders on record, so they'd get nothing
-- here anyway. A student who signs up now has none, so only the deadline
-- check itself keeps them from being told the deadline is "coming up".
select set_config('tests.newcomer', tests.sign_in_with_microsoft('drnewcomer@utrgv.edu', 'Newcomer Nia')::text, true);
select is(pg_temp.run_at(interval '0'), 0, 'at the deadline, the job sends nothing, even to a student with no reminders yet');
select is(pg_temp.run_at(interval '1 day'), 0, 'after it, the job sends nothing');
select is(
  (select count(*)::int from public.notifications where user_id = current_setting('tests.newcomer')::uuid),
  0, 'a student who first becomes eligible after the deadline is never told it''s coming up');

-- --- The deadline moves: reminders for the new date --------------------------
update public.milestones set due_at = due_at + interval '7 days' where is_formation_deadline;
select set_config('tests.deadline', public.formation_deadline()::text, true);

select is(pg_temp.run_at(-interval '3 days'), 3,
  'when the deadline moves, the students still unplaced (now including the newcomer) are reminded of the new date');
select is(pg_temp.run_at(-interval '3 days'), 0, 'and only once');

-- --- No deadline: nothing ----------------------------------------------------
update public.milestones set is_formation_deadline = false where is_formation_deadline;
select is(private.send_deadline_reminders(now()), 0, 'with no formation deadline, the job sends nothing');

-- --- The schedule ------------------------------------------------------------
-- The harness has no pg_cron, so the file must have applied without it; the
-- job itself is checked in the Supabase dashboard before each demo.
-- cron.job is read through execute so this parses without pg_cron.
create function pg_temp.reminder_job_scheduled() returns boolean
language plpgsql as $$
declare
  v_found boolean;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return true;
  end if;
  execute $q$ select exists (select 1 from cron.job
                              where jobname = 'deadline-reminders' and schedule = '0 * * * *') $q$
    into v_found;
  return v_found;
end;
$$;
select ok(pg_temp.reminder_job_scheduled(),
  'the deadline-reminders job is scheduled hourly wherever pg_cron is enabled');

select * from finish();
rollback;
