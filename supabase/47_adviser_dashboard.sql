-- The adviser dashboard (issue #56). Run after 46_export_rosters.sql; it
-- reads tables from 39_ (adviser_requests), 41_ (repo_activity), 42_
-- (check_ins) and 45_ (milestones.requires_deliverable,
-- deliverable_submissions).
--
-- One row per team the caller advises, with the facts the Advising page
-- draws on each card. Only facts: whether a team "needs attention", and the
-- order the cards go in, are decided by needsAttention() and
-- sortAdvisedTeams() in frontend/src/lib/adviserDashboard.js, so the rule
-- lives in one place and its tests don't need a database.
--
-- WHO IS AN ADVISER. The caller's accepted adviser_requests rows, as in
-- advised_project_ids() (40_). Pending, declined and cancelled rows are not
-- advising. Somebody who advises nothing gets no rows, not an error: the
-- page shows its empty state, and the header asks this same question to
-- decide whether to show the Advising link at all.
--
-- WHAT EACH FIGURE MEANS, since none of them is obvious from its name:
--
--   * check_ins_submitted / check_ins_expected — current members who have
--     posted for this Monday–Sunday Central week (check_in_week_start(),
--     42_), out of the current roster. Somebody who has left the team is in
--     neither number.
--   * open_blockers — current members whose most recent check-in names a
--     blocker. A blocker stays open until that member posts a check-in
--     without one, so a Friday blocker doesn't vanish when Monday starts a
--     new week, and a member who reported one and then went quiet still
--     shows it.
--   * last_check_in_at — the newest check-in from anyone on the project,
--     past members included: "days since anyone last checked in".
--   * next_milestone_* — the earliest milestone not yet past whose
--     deliverable, if it takes one, isn't already approved. Milestones are
--     class-wide, so without the second half every card would show the
--     same one; with it, a team that is done with the proposal shows what
--     comes after.
--   * next_deliverable_status — the newest version's status for that
--     milestone, 'not_submitted' when there is none, null when the milestone
--     takes no deliverable.
--   * overdue_deliverables — milestones that take a deliverable, are past
--     due, and have nothing submitted, counting only those due on or after
--     the team formed. Milestones are class-wide, so without that a team
--     formed last week would be flagged for every milestone that closed
--     before it existed. A team that has not formed has none.
--   * changes_requested — deliverables whose newest version the adviser sent
--     back. A resubmission starts at 'submitted' again (45_, decision 7), so
--     this clears itself once the team responds.
--   * last_commit_at — repo_activity's, from #58. Null when no repository is
--     linked or it has never been fetched.
--
-- Safe to run again: `create or replace` and restated grants only.
begin;

create or replace function public.adviser_dashboard()
returns table (
  project_id              uuid,
  title                   text,
  team_id                 uuid,
  formed_at               timestamptz,
  members                 jsonb,
  check_ins_submitted     integer,
  check_ins_expected      integer,
  open_blockers           integer,
  last_check_in_at        timestamptz,
  next_milestone_id       uuid,
  next_milestone_name     text,
  next_milestone_due_at   timestamptz,
  next_deliverable_status text,
  overdue_deliverables    integer,
  changes_requested       integer,
  last_commit_at          timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with advised as (
    select p.id as project_id, p.title, t.id as team_id, t.formed_at
      from public.adviser_requests ar
      join public.projects p on p.id = ar.project_id
      left join public.teams t on t.project_id = p.id
     where ar.adviser_id = auth.uid()
       and ar.status = 'accepted'
  ),
  -- The newest version of every deliverable on an advised project.
  latest as (
    select distinct on (s.project_id, s.milestone_id)
           s.project_id, s.milestone_id, s.status
      from public.deliverable_submissions s
     where s.project_id in (select a.project_id from advised a)
     order by s.project_id, s.milestone_id, s.version desc
  )
  select
    a.project_id,
    a.title,
    a.team_id,
    a.formed_at,
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', u.id, 'name', u.name) order by u.name, u.id)
        from public.team_members tm
        join public.users u on u.id = tm.user_id
       where tm.team_id = a.team_id
    ), '[]'::jsonb),
    (select count(*)::int
       from public.team_members tm
       join public.check_ins c
         on c.user_id = tm.user_id
        and c.project_id = a.project_id
        and c.week_start = public.check_in_week_start(now())
      where tm.team_id = a.team_id),
    (select count(*)::int from public.team_members tm where tm.team_id = a.team_id),
    (select count(*)::int
       from public.team_members tm
       cross join lateral (
         select c.blockers
           from public.check_ins c
          where c.user_id = tm.user_id
            and c.project_id = a.project_id
          order by c.week_start desc
          limit 1
       ) newest
      where tm.team_id = a.team_id
        and newest.blockers is not null
        and btrim(newest.blockers) <> ''),
    (select max(c.created_at) from public.check_ins c where c.project_id = a.project_id),
    nm.id,
    nm.name,
    nm.due_at,
    case when nm.requires_deliverable then coalesce(nm.status, 'not_submitted') end,
    (select count(*)::int
       from public.milestones m
      where m.requires_deliverable
        and m.due_at < now()
        and m.due_at >= a.formed_at
        and not exists (
          select 1 from public.deliverable_submissions s
           where s.project_id = a.project_id and s.milestone_id = m.id
        )),
    (select count(*)::int
       from latest l
      where l.project_id = a.project_id
        and l.status = 'changes_requested'),
    (select r.last_commit_at from public.repo_activity r where r.project_id = a.project_id)
  from advised a
  left join lateral (
    select m.id, m.name, m.due_at, m.requires_deliverable, l.status
      from public.milestones m
      left join latest l on l.project_id = a.project_id and l.milestone_id = m.id
     where m.due_at >= now()
       and not (m.requires_deliverable and l.status is not distinct from 'approved')
     order by m.due_at, m.name
     limit 1
  ) nm on true
  order by a.title, a.project_id;
$$;

revoke all on function public.adviser_dashboard() from public, anon;
grant execute on function public.adviser_dashboard() to authenticated;

comment on function public.adviser_dashboard() is
  'One row per team the caller is the accepted adviser of, with this week''s '
  'check-ins, open blockers, next milestone and deliverable status (#56). '
  'No rows, not an error, for someone who advises nothing.';

commit;
