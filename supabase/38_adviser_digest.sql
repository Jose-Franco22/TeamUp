-- Weekly email digest for advisers (issue #59). Run after
-- 37_deadline_reminders.sql.
--
-- Every Monday at 8:00 AM Central, each adviser who advises at least one
-- team gets one email summarizing last week (Monday to Sunday, Central) for
-- every team they advise. An adviser is whoever private.advised_teams()
-- says advises a team: an accepted adviser_requests row (39_project_advisers.sql,
-- #53/#54). Nothing here reads users.is_admin — advising isn't tied to the
-- flag (decision 1 in 39's header, settled in PR #92).
--
-- THIS IS THE SHELL. The digest reports on things other stories add, none of
-- which exist yet:
--
--   * which teams an adviser advises        #53 / #54 (43_advised_teams.sql)
--   * weekly check-ins and blockers         #55
--   * the "flagged team" rules              #56
--   * deliverables waiting for review       #57
--   * last commit date                      #58
--
-- Until they land, private.advised_teams() returns no teams, so nobody gets
-- a digest (which is also the rule for advisers who advise nothing), and
-- adviser_digest_data() reports those figures as null / empty. Each of those
-- stories fills in its part here, in a later migration, without changing the
-- shape of the data or anything that reads it. What already works for real:
-- the on/off setting, who's on the send list, the week the digest covers,
-- what's due this week (milestones), and the schedule.
--
-- How it's sent. The job writes one public.adviser_digests row per adviser
-- per week, holding that adviser's digest data. A database webhook on that
-- table calls the notify-email Edge Function, which renders the email from
-- the row (functions/notify-email/digest.js) — the same pattern as
-- announcements. The row's primary key (adviser, week) is what makes a
-- second run of the job, or a second hour in the schedule, a no-op.
--
-- What this adds:
--
--   * users.adviser_digest, on by default, set from the Profile page;
--   * private.advised_teams(adviser), a stub here; 43_advised_teams.sql
--     gives it the real body from accepted adviser_requests rows. It is a
--     separate, later file because adviser_requests only exists from 39_,
--     and on the live database merge order, not file number, decides which
--     body wins;
--   * private.adviser_digest_data(adviser, now), one adviser's digest;
--   * private.adviser_digest_recipients(), the send list;
--   * public.adviser_digests, what's been sent;
--   * private.send_adviser_digests(now), the job, and its pg_cron schedule.
begin;

-- --- the setting ------------------------------------------------------------
-- users_update_own (02_rls_policies.sql) already lets someone change their
-- own row and nobody else's, as with email_notifications (36_).
alter table public.users
  add column if not exists adviser_digest boolean not null default true;

comment on column public.users.adviser_digest is
  'Whether an adviser gets the Monday email digest of the teams they advise '
  '(issue #59). Only read for advisers. Set from the Profile page.';

-- --- which teams an adviser advises (stub) ----------------------------------
-- 43_advised_teams.sql replaces this body with the real one (accepted
-- adviser_requests rows, #53/#54). Everything below reads the adviser-to-team
-- link only through this function, so that's the one place that changes.
create or replace function private.advised_teams(p_adviser uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select null::uuid where false;
$$;

-- --- the week ----------------------------------------------------------------
-- The digest sent on a Monday covers the Monday to Sunday before it, in the
-- class's time zone. date_trunc('week') starts weeks on Monday.
create or replace function private.digest_this_monday(p_now timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('week', p_now at time zone 'America/Chicago')::date;
$$;

-- --- one adviser's digest ---------------------------------------------------
-- Returns:
--
--   {
--     "adviser_is_admin": false,         which links the email uses: admins
--                                        have /admin/teams/:id, students /team
--     "week_start": "2026-11-09",        last week's Monday
--     "week_end":   "2026-11-15",        last week's Sunday
--     "due_this_week": [ { "name": ..., "due_at": ... } ],
--     "teams": [ {
--       "team_id": ..., "project_title": ...,
--       "flagged": false,                  #56
--       "checkins_submitted": null,        #55, e.g. 3
--       "checkins_expected": null,         #55, e.g. 4
--       "blockers": [],                    #55, the open blockers' text
--       "deliverables_to_review": null,    #57, a count
--       "last_commit_at": null             #58
--     } ]
--   }
--
-- null means "not tracked yet", which the email leaves out, rather than 0.
-- Milestones are class-wide, so what's due this week is listed once rather
-- than under every team.
create or replace function private.adviser_digest_data(p_adviser uuid, p_now timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with week as (
    select private.digest_this_monday(p_now) as this_monday
  )
  select jsonb_build_object(
    'adviser_is_admin', coalesce((select u.is_admin from public.users u where u.id = p_adviser), false),
    'week_start', (w.this_monday - 7),
    'week_end',   (w.this_monday - 1),
    'due_this_week', coalesce((
      select jsonb_agg(jsonb_build_object('name', m.name, 'due_at', m.due_at) order by m.due_at, m.name)
        from public.milestones m
       where m.due_at >= (w.this_monday::timestamp at time zone 'America/Chicago')
         and m.due_at <  ((w.this_monday + 7)::timestamp at time zone 'America/Chicago')
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'team_id', t.id,
               'project_title', p.title,
               'flagged', false,
               'checkins_submitted', null,
               'checkins_expected', null,
               'blockers', '[]'::jsonb,
               'deliverables_to_review', null,
               'last_commit_at', null
             ) order by p.title, t.id)
        from private.advised_teams(p_adviser) a(team_id)
        join public.teams t on t.id = a.team_id
        join public.projects p on p.id = t.project_id
    ), '[]'::jsonb)
  )
  from week w;
$$;

-- --- the send list -----------------------------------------------------------
-- Advisers with the digest on who advise at least one team. Students and
-- admins alike: who advises is advised_teams()'s answer alone.
create or replace function private.adviser_digest_recipients()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
    from public.users u
   where u.adviser_digest
     and exists (select 1 from private.advised_teams(u.id))
   order by u.id;
$$;

-- --- what's been sent --------------------------------------------------------
-- Public only so a Supabase database webhook can watch it (TODO-backend.md,
-- "Email notifications"). Nobody reads it through the API: RLS is on with
-- no policies, and the grants are taken away. An adviser's rows go with
-- their account.
create table if not exists public.adviser_digests (
  id          uuid not null default gen_random_uuid() unique,
  adviser_id  uuid not null references public.users(id) on delete cascade,
  week_start  date not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (adviser_id, week_start)
);

alter table public.adviser_digests enable row level security;
revoke all on table public.adviser_digests from anon, authenticated;

-- --- the job -------------------------------------------------------------------
-- Returns how many digests it queued. Only does anything at 8 AM Central on a
-- Monday: pg_cron runs in UTC, and 8 AM Central is 13:00 UTC in daylight
-- time and 14:00 UTC in standard time, so the schedule below fires at both
-- and this lets through only the one that's 8 AM locally.
--
-- The two hours are not a retry: only one of them is ever 8 AM Central, so if
-- the database is down at that hour, that week's digest is skipped rather
-- than sent late. The cron string is pinned by digest.test.js.
create or replace function private.send_adviser_digests(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'America/Chicago';
  v_week_start date;
  v_sent integer;
begin
  if p_now is null or extract(isodow from v_local) <> 1 or extract(hour from v_local) <> 8 then
    return 0;
  end if;

  v_week_start := private.digest_this_monday(p_now) - 7;

  insert into public.adviser_digests (adviser_id, week_start, data)
  select r.id, v_week_start, private.adviser_digest_data(r.id, p_now)
    from private.adviser_digest_recipients() r(id)
  on conflict do nothing;

  get diagnostics v_sent = row_count;
  return v_sent;
end;
$$;

-- The private schema is visible to signed-in users (18_admin_access.sql), so
-- take away the default execute grants.
revoke all on function private.advised_teams(uuid) from public, anon, authenticated;
revoke all on function private.digest_this_monday(timestamptz) from public, anon, authenticated;
revoke all on function private.adviser_digest_data(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.adviser_digest_recipients() from public, anon, authenticated;
revoke all on function private.send_adviser_digests(timestamptz) from public, anon, authenticated;

-- --- the schedule ----------------------------------------------------------
-- As in 37_deadline_reminders.sql: only where pg_cron is installed (it isn't
-- in the test harness), and scheduling by name replaces an existing job.
-- Mondays at 13:00 and 14:00 UTC; the job keeps the one that's 8 AM Central.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cmd$
      select cron.schedule(
        'adviser-digest',
        '0 13,14 * * 1',
        'select private.send_adviser_digests()'
      )
    $cmd$;
  else
    raise notice 'pg_cron is not enabled, so the adviser-digest job was not scheduled';
  end if;
end;
$$;

commit;
