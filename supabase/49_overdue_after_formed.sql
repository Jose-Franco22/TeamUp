-- #56 — don't count milestones that closed before the team first formed as
-- overdue.
--
-- Run after 47_adviser_dashboard.sql, whose adviser_dashboard() this file
-- replaces whole. It is a new file, not an edit to 47_: 47_ has already been
-- applied by hand on the live database, and migrations here run once, in
-- order, so a change to 47_ would never reach it.
--
-- What changed: overdue_deliverables counted every class-wide milestone that
-- takes a deliverable, is past due and has no submission, so a team formed
-- last week was flagged for milestones that closed before it existed. It now
-- counts only milestones due on or after the team FIRST formed. A team that
-- has never filled (first_formed_at null) has none. Every other column is as
-- in 47_.
--
-- WHY A NEW COLUMN AND NOT formed_at. teams.formed_at is "the roster is full
-- right now": sync_project_fill_state() (05_) and update_project set it back
-- to null when a seat opens, and the refill stamps the refill time. Anchoring
-- on it would hide a milestone a team really missed: formed in September,
-- missed October's proposal, lost a member in November — overdue drops to 0
-- while it recruits, and after the refill formed_at is November, so October
-- stays hidden. teams.first_formed_at is set once, the first time the team
-- has a formed_at, and never cleared or moved later. A team that lost a
-- member keeps the overdue work it owes.
--
-- Teams already formed get first_formed_at = formed_at. A team that has
-- already gone through a leave and a refill gets the refill time, the best
-- the data allows; nothing earlier was recorded.
--
begin;

alter table public.teams add column if not exists first_formed_at timestamptz;

update public.teams
   set first_formed_at = formed_at
 where first_formed_at is null and formed_at is not null;

-- A trigger, not a change to every function that sets formed_at: seven of
-- them do (03_, 04_, 05_, 15_, 16_, 17_, 21_), and a new one would be one more
-- place to forget. Whatever is written, an existing first_formed_at is never
-- cleared (it falls back to the old value), and a missing one is filled the
-- first time formed_at has a value.
create or replace function public.keep_first_formed_at()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'UPDATE' then
    new.first_formed_at := coalesce(new.first_formed_at, old.first_formed_at, new.formed_at);
  else
    new.first_formed_at := coalesce(new.first_formed_at, new.formed_at);
  end if;
  return new;
end;
$fn$;

drop trigger if exists teams_keep_first_formed_at on public.teams;
create trigger teams_keep_first_formed_at
  before insert or update on public.teams
  for each row execute function public.keep_first_formed_at();

-- Safe to run again: add column if not exists, a backfill that skips rows
-- already set, `create or replace`, a dropped-and-recreated trigger and
-- restated grants.

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
    select p.id as project_id, p.title, t.id as team_id, t.formed_at, t.first_formed_at
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
        and m.due_at >= a.first_formed_at
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
