-- Automatic reminders before the team formation deadline (issue #43). Run
-- after 35_join_request_message.sql. 36 is taken by #21's open pull request
-- (36_email_preferences.sql); nothing here depends on it.
--
-- Every student who isn't on a full team gets a 'deadline_reminder'
-- notification 3 days before the formation deadline, and again 1 day before.
-- It lands in the bell like every other kind, and the notify-email webhook
-- emails it (functions/notify-email; #21 makes 'deadline_reminder' an
-- essential email, sent even to students who turned emails off).
--
-- What this adds:
--
--   * 'deadline_reminder' in notifications_kind_check. The row has no
--     project or actor: the bell and the email read the deadline itself
--     from formation_deadline() / milestones;
--   * private.deadline_reminders, one row per (student, deadline, 3 or 1)
--     reminder already sent. Its primary key is what makes a second run of
--     the job a no-op, even two runs at the same moment;
--   * private.send_deadline_reminders(p_now), the job. p_now defaults to
--     now(); the tests pass a fixed clock;
--   * a pg_cron job running it at the top of every hour.
--
-- When a reminder is due. With d the formation deadline:
--
--   now < d - 3 days            nothing yet
--   d - 3 days <= now < d - 1   the 3-day reminder
--   d - 1 day  <= now < d       the 1-day reminder
--   now >= d, or no deadline    nothing
--
-- So a run that's late, or a deadline set less than 3 days out, still sends
-- whichever reminder applies now, and never one that no longer makes sense
-- (no "3 days left" the night before). Run hourly, each reminder goes out
-- within the hour after its moment.
--
-- "Not on a full team": every non-admin user who isn't a member of a team
-- whose project has status 'full'. That covers students on no team and
-- students on a team with seats still open. Someone whose team fills
-- between the two reminders gets only the first.
--
-- Reminders are keyed on the deadline's date, not the milestone's id: if an
-- admin moves the deadline, the reminders for the new date go out again,
-- since the date the students were told about is no longer right.
begin;

-- --- the new kind ---------------------------------------------------------
-- Rewritten in full, as every migration since 21_ has done. The list is
-- 34_next_steps.sql's plus 'deadline_reminder'.
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('deadline_reminder', 'join_request', 'member_added', 'member_assigned',
                  'member_left', 'member_removed', 'project_removed', 'request_accepted',
                  'request_declined', 'team_complete'));

-- --- what's been sent -----------------------------------------------------
-- Private: nobody reads it but the job. A student's rows go with their
-- account.
create table if not exists private.deadline_reminders (
  user_id     uuid not null references public.users(id) on delete cascade,
  deadline_at timestamptz not null,
  days_before smallint not null
    constraint deadline_reminders_days_before check (days_before in (1, 3)),
  sent_at     timestamptz not null default now(),
  primary key (user_id, deadline_at, days_before)
);

revoke all on table private.deadline_reminders from public, anon, authenticated;

-- --- the job ---------------------------------------------------------------
-- Returns how many reminders it sent. Recording the reminder and writing
-- the notification happen in one statement: only students whose ledger row
-- is new this run (on conflict do nothing ... returning) get a
-- notification. A second run at the same time waits on the first's rows,
-- then skips them.
create or replace function private.send_deadline_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deadline timestamptz := public.formation_deadline();
  v_days smallint;
  v_sent integer;
begin
  if v_deadline is null or p_now is null or p_now >= v_deadline then
    return 0;
  end if;

  v_days := case
    when p_now >= v_deadline - interval '1 day'  then 1
    when p_now >= v_deadline - interval '3 days' then 3
  end;
  if v_days is null then
    return 0;
  end if;

  with sent as (
    insert into private.deadline_reminders (user_id, deadline_at, days_before)
    select u.id, v_deadline, v_days
      from public.users u
     where not u.is_admin
       and not exists (
         select 1
           from public.team_members tm
           join public.teams t on t.id = tm.team_id
           join public.projects p on p.id = t.project_id
          where tm.user_id = u.id and p.status = 'full'
       )
    on conflict do nothing
    returning user_id
  )
  insert into public.notifications (user_id, kind)
  select user_id, 'deadline_reminder' from sent;

  get diagnostics v_sent = row_count;
  return v_sent;
end;
$$;

-- Only the scheduler (and whoever runs SQL as the database owner) runs it:
-- the private schema is visible to signed-in users (18_admin_access.sql),
-- so take away the default execute grant.
revoke all on function private.send_deadline_reminders(timestamptz) from public, anon, authenticated;

-- --- the schedule ----------------------------------------------------------
-- pg_cron is enabled on the Supabase project (Database → Extensions) but
-- isn't in the test harness's plain Postgres, so only schedule where it's
-- installed. Enabling it is left to the dashboard: it has to be preloaded
-- by the server, which a migration can't do. cron.schedule() with a name
-- replaces a job of that name, so running this file again doesn't add a
-- second one.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cmd$
      select cron.schedule(
        'deadline-reminders',
        '0 * * * *',
        'select private.send_deadline_reminders()'
      )
    $cmd$;
  else
    raise notice 'pg_cron is not enabled, so the deadline-reminders job was not scheduled';
  end if;
end;
$$;

commit;
