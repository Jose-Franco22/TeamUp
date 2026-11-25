-- The adviser dashboard (issue #56): 47_adviser_dashboard.sql, as replaced by 49_overdue_after_formed.sql.
--
-- Ana advises two formed teams, P1 and P2, and was declined on P3, where
-- Otto's invitation is still pending. The two teams are seeded to differ on
-- every figure the card shows:
--
--                      P1                              P2
--   this week          S1 posted, S2 didn't (1 of 2)   both posted (2 of 2)
--   newest check-ins   S2's (last week) has a blocker  S3 had one last week,
--                                                      cleared this week
--   past milestone     nothing submitted (overdue)     submitted
--   before forming     a milestone that closed before both teams formed:
--                      nothing submitted, and not counted as overdue
--   next milestone     v2 sent back (changes req.)     approved, so the next
--                                                      one after it is shown
--   repository         last commit recorded            none linked
--
-- The last section adds P4 (formed exactly when the proposal fell due, then
-- lost a member and refilled) and P5 (never formed), for the rule that
-- overdue work counts from first_formed_at (49_), not from formed_at.
--
-- Check-ins and submissions are written as the test's superuser: last
-- week's rows can't be written any other way, and how they're written is
-- 42_'s and 45_'s business, with tests of their own.
begin;
select plan(24);

select set_config('tests.adv',   tests.sign_in_with_microsoft('dashadv@utrgv.edu', 'Ana Adviser')::text, true);
select set_config('tests.other', tests.sign_in_with_microsoft('dashoth@utrgv.edu', 'Otto Other')::text, true);
select set_config('tests.s1',    tests.sign_in_with_microsoft('dashs1@utrgv.edu', 'Sam One')::text, true);
select set_config('tests.s2',    tests.sign_in_with_microsoft('dashs2@utrgv.edu', 'Sue Two')::text, true);
select set_config('tests.s3',    tests.sign_in_with_microsoft('dashs3@utrgv.edu', 'Sid Three')::text, true);
select set_config('tests.s4',    tests.sign_in_with_microsoft('dashs4@utrgv.edu', 'Sal Four')::text, true);
select set_config('tests.s5',    tests.sign_in_with_microsoft('dashs5@utrgv.edu', 'Sky Five')::text, true);
select set_config('tests.s6',    tests.sign_in_with_microsoft('dashs6@utrgv.edu', 'Sol Six')::text, true);
select set_config('tests.s7',    tests.sign_in_with_microsoft('dashs7@utrgv.edu', 'Sia Seven')::text, true);
select set_config('tests.s8',    tests.sign_in_with_microsoft('dashs8@utrgv.edu', 'Seb Eight')::text, true);
select set_config('tests.s9',    tests.sign_in_with_microsoft('dashs9@utrgv.edu', 'Sun Nine')::text, true);
select set_config('tests.s10',   tests.sign_in_with_microsoft('dashs10@utrgv.edu', 'Sky Ten')::text, true);

select set_config('tests.p1', tests.create_full_team(current_setting('tests.s1')::uuid, current_setting('tests.s2')::uuid)::text, true);
select set_config('tests.p2', tests.create_full_team(current_setting('tests.s3')::uuid, current_setting('tests.s4')::uuid)::text, true);
select set_config('tests.p3', tests.create_full_team(current_setting('tests.s5')::uuid, current_setting('tests.s6')::uuid)::text, true);
update public.projects set title = 'Alpha parking'  where id = current_setting('tests.p1')::uuid;
update public.projects set title = 'Beta scheduler' where id = current_setting('tests.p2')::uuid;
-- Formed a month ago, so the 10-days-ago proposal falls after formation and
-- the 40-days-ago kickoff before it.
update public.teams set formed_at = now() - interval '30 days', first_formed_at = now() - interval '30 days'
 where project_id in (current_setting('tests.p1')::uuid, current_setting('tests.p2')::uuid);

insert into public.adviser_requests (project_id, adviser_id, invited_by, status) values
  (current_setting('tests.p1')::uuid, current_setting('tests.adv')::uuid,   current_setting('tests.s1')::uuid, 'accepted'),
  (current_setting('tests.p2')::uuid, current_setting('tests.adv')::uuid,   current_setting('tests.s3')::uuid, 'accepted'),
  (current_setting('tests.p3')::uuid, current_setting('tests.adv')::uuid,   current_setting('tests.s5')::uuid, 'declined'),
  (current_setting('tests.p3')::uuid, current_setting('tests.other')::uuid, current_setting('tests.s5')::uuid, 'pending');

-- --- check-ins ---------------------------------------------------------------
select set_config('tests.week', public.check_in_week_start(now())::text, true);

insert into public.check_ins (project_id, user_id, week_start, did, doing_next, blockers, created_at) values
  -- P1: S1 this week, no blocker; S2 only last week, blocked.
  (current_setting('tests.p1')::uuid, current_setting('tests.s1')::uuid, current_setting('tests.week')::date,
   'Did a thing.', 'Next thing.', null, now()),
  (current_setting('tests.p1')::uuid, current_setting('tests.s2')::uuid, current_setting('tests.week')::date - 7,
   'Did a thing.', 'Next thing.', 'Waiting on lab access.', now() - interval '8 days'),
  -- P2: S3 blocked last week and clear this week; S4 this week.
  (current_setting('tests.p2')::uuid, current_setting('tests.s3')::uuid, current_setting('tests.week')::date - 7,
   'Did a thing.', 'Next thing.', 'No API key yet.', now() - interval '8 days'),
  (current_setting('tests.p2')::uuid, current_setting('tests.s3')::uuid, current_setting('tests.week')::date,
   'Did a thing.', 'Next thing.', null, now() - interval '1 hour'),
  (current_setting('tests.p2')::uuid, current_setting('tests.s4')::uuid, current_setting('tests.week')::date,
   'Did a thing.', 'Next thing.', null, now() - interval '2 hours');

-- --- milestones and deliverables ---------------------------------------------
-- Nothing else in this transaction is due, so these four are the schedule.
delete from public.milestones;
insert into public.milestones (id, name, due_at, requires_deliverable) values
  (gen_random_uuid(), 'Kickoff', now() - interval '40 days', true),
  (gen_random_uuid(), 'Proposal', now() - interval '10 days', true),
  (gen_random_uuid(), 'Design doc', now() + interval '5 days', true),
  (gen_random_uuid(), 'Demo day', now() + interval '20 days', false);
select set_config('tests.proposal', (select id from public.milestones where name = 'Proposal')::text, true);
select set_config('tests.design',   (select id from public.milestones where name = 'Design doc')::text, true);
select set_config('tests.demo',     (select id from public.milestones where name = 'Demo day')::text, true);

insert into public.deliverable_submissions (project_id, milestone_id, version, kind, link_url, is_late, status, submitted_by) values
  -- P1: no proposal; the design doc's newest version was sent back.
  (current_setting('tests.p1')::uuid, current_setting('tests.design')::uuid, 1, 'link', 'https://a.example.com/1', false, 'submitted', current_setting('tests.s1')::uuid),
  (current_setting('tests.p1')::uuid, current_setting('tests.design')::uuid, 2, 'link', 'https://a.example.com/2', false, 'changes_requested', current_setting('tests.s1')::uuid),
  -- P2: proposal handed in; design doc approved.
  (current_setting('tests.p2')::uuid, current_setting('tests.proposal')::uuid, 1, 'link', 'https://b.example.com/1', false, 'submitted', current_setting('tests.s3')::uuid),
  (current_setting('tests.p2')::uuid, current_setting('tests.design')::uuid, 1, 'link', 'https://b.example.com/2', false, 'approved', current_setting('tests.s3')::uuid);

insert into public.repo_activity (project_id, repo, last_commit_at)
values (current_setting('tests.p1')::uuid, 'https://github.com/example/alpha', '2026-11-18 22:14+00');

-- =========================================================================
-- WHOSE TEAMS
-- =========================================================================

select tests.authenticate_as(current_setting('tests.adv')::uuid);

select results_eq(
  $$ select project_id from public.adviser_dashboard() $$,
  $$ values (current_setting('tests.p1')::uuid), (current_setting('tests.p2')::uuid) $$,
  'an adviser sees the two teams they accepted, by title, and not the one they declined');

select tests.authenticate_as(current_setting('tests.other')::uuid);
select is((select count(*)::int from public.adviser_dashboard()), 0,
  'a pending invitation is not advising yet');

select tests.authenticate_as(current_setting('tests.s1')::uuid);
select lives_ok($$ select * from public.adviser_dashboard() $$,
  'somebody who advises nothing can still ask');
select is((select count(*)::int from public.adviser_dashboard()), 0,
  'and gets an empty result, not an error');

select tests.clear_authentication();
select is((select count(*)::int from public.adviser_dashboard()), 0,
  'with nobody signed in there is no caller, so no teams');

-- =========================================================================
-- P1: ONE OF TWO, A BLOCKER, OVERDUE AND SENT BACK
-- =========================================================================

select tests.authenticate_as(current_setting('tests.adv')::uuid);
create temp table dash on commit drop as select * from public.adviser_dashboard();
select tests.clear_authentication();

select is((select members from dash where project_id = current_setting('tests.p1')::uuid),
  jsonb_build_array(
    jsonb_build_object('user_id', current_setting('tests.s1')::uuid, 'name', 'Sam One'),
    jsonb_build_object('user_id', current_setting('tests.s2')::uuid, 'name', 'Sue Two')),
  'P1 lists its members by name');
select is((select (check_ins_submitted, check_ins_expected)::text from dash where project_id = current_setting('tests.p1')::uuid),
  '(1,2)', 'P1: 1 of 2 checked in this week');
select is((select open_blockers from dash where project_id = current_setting('tests.p1')::uuid), 1,
  'P1: S2''s newest check-in still names a blocker, though it was last week');
select is((select last_check_in_at from dash where project_id = current_setting('tests.p1')::uuid), now(),
  'P1: the last check-in is S1''s, this week');
select is((select overdue_deliverables from dash where project_id = current_setting('tests.p1')::uuid), 1,
  'P1: the proposal is past due with nothing submitted; the kickoff that closed before it formed is not counted');
select is((select changes_requested from dash where project_id = current_setting('tests.p1')::uuid), 1,
  'P1: the design doc''s newest version was sent back');
select is((select (next_milestone_id, next_deliverable_status)::text from dash where project_id = current_setting('tests.p1')::uuid),
  (current_setting('tests.design')::uuid, 'changes_requested')::text,
  'P1: next up is the design doc, with its newest version''s status');
select is((select last_commit_at from dash where project_id = current_setting('tests.p1')::uuid), '2026-11-18 22:14+00'::timestamptz,
  'P1: the last commit comes from repo_activity (#58)');

-- =========================================================================
-- P2: ALL IN, BLOCKER CLEARED, ON TRACK
-- =========================================================================

select is((select (check_ins_submitted, check_ins_expected)::text from dash where project_id = current_setting('tests.p2')::uuid),
  '(2,2)', 'P2: 2 of 2 checked in this week');
select is((select open_blockers from dash where project_id = current_setting('tests.p2')::uuid), 0,
  'P2: S3''s blocker closed when they checked in without one');
select is((select last_check_in_at from dash where project_id = current_setting('tests.p2')::uuid), now() - interval '1 hour',
  'P2: the last check-in is the newest of the two this week');
select is((select (overdue_deliverables, changes_requested)::text from dash where project_id = current_setting('tests.p2')::uuid),
  '(0,0)', 'P2: nothing overdue and nothing sent back, though it never handed in the kickoff that closed before it formed');
select is((select (next_milestone_id, next_deliverable_status)::text from dash where project_id = current_setting('tests.p2')::uuid),
  (current_setting('tests.demo')::uuid, null::text)::text,
  'P2: the approved design doc is done, so next up is demo day, which takes no deliverable');
select is((select last_commit_at from dash where project_id = current_setting('tests.p2')::uuid), null,
  'P2: no repository, no last commit');

-- =========================================================================
-- NOT ADVISING ANY MORE
-- =========================================================================

update public.adviser_requests set status = 'cancelled'
 where project_id = current_setting('tests.p2')::uuid and adviser_id = current_setting('tests.adv')::uuid;
select tests.authenticate_as(current_setting('tests.adv')::uuid);
select results_eq(
  $$ select project_id from public.adviser_dashboard() $$,
  $$ values (current_setting('tests.p1')::uuid) $$,
  'stepping down or being removed takes the team off the dashboard');
select tests.clear_authentication();

-- =========================================================================
-- OVERDUE COUNTS FROM THE FIRST TIME A TEAM FORMED
-- =========================================================================
-- The schedule here is Kickoff (40 days ago), Proposal (10 days ago, nothing
-- submitted by these teams), Design doc and Demo day (still to come).

select set_config('tests.p4', tests.create_full_team(current_setting('tests.s7')::uuid, current_setting('tests.s8')::uuid)::text, true);
select set_config('tests.p5', tests.create_full_team(current_setting('tests.s9')::uuid, current_setting('tests.s10')::uuid)::text, true);
insert into public.adviser_requests (project_id, adviser_id, invited_by, status) values
  (current_setting('tests.p4')::uuid, current_setting('tests.adv')::uuid, current_setting('tests.s7')::uuid, 'accepted'),
  (current_setting('tests.p5')::uuid, current_setting('tests.adv')::uuid, current_setting('tests.s9')::uuid, 'accepted');

-- P4 first formed at the very instant the proposal fell due. now() is fixed
-- within the transaction, so the two timestamps are equal, which pins down
-- that a milestone due exactly then is counted (>=, not >).
update public.teams set formed_at = now() - interval '10 days', first_formed_at = now() - interval '10 days'
 where project_id = current_setting('tests.p4')::uuid;

-- P5 never formed: the trigger in 49_ keeps first_formed_at once it is set,
-- so it is switched off to build a team that never had one.
alter table public.teams disable trigger teams_keep_first_formed_at;
update public.teams set formed_at = null, first_formed_at = null
 where project_id = current_setting('tests.p5')::uuid;
alter table public.teams enable trigger teams_keep_first_formed_at;

select tests.authenticate_as(current_setting('tests.adv')::uuid);
select is((select overdue_deliverables from public.adviser_dashboard() where project_id = current_setting('tests.p4')::uuid), 1,
  'P4: a milestone due exactly when the team first formed is counted; the kickoff before it is not');
select is((select overdue_deliverables from public.adviser_dashboard() where project_id = current_setting('tests.p5')::uuid), 0,
  'P5: an advised team that never formed has nothing overdue');
select tests.clear_authentication();

-- P4 loses a member: formed_at goes back to null, as in 05_membership.sql.
select tests.authenticate_as(current_setting('tests.s8')::uuid);
select public.leave_team();
select tests.authenticate_as(current_setting('tests.adv')::uuid);
select is((select overdue_deliverables from public.adviser_dashboard() where project_id = current_setting('tests.p4')::uuid), 1,
  'P4: while it recruits again it still owes the proposal it missed');
select tests.clear_authentication();

-- ... and refills, which stamps formed_at with today.
update public.teams set formed_at = now() where project_id = current_setting('tests.p4')::uuid;
select tests.authenticate_as(current_setting('tests.adv')::uuid);
select is((select overdue_deliverables from public.adviser_dashboard() where project_id = current_setting('tests.p4')::uuid), 1,
  'P4: once refilled, formed_at is today but the missed proposal is still counted');
select tests.clear_authentication();

select * from finish();
rollback;
