-- Deadlines and milestones (issue #38). Run after 25_demo_set_member_role.sql.
--
-- An admin keeps a list of dated milestones (proposal due, demo day, ...).
-- At most one of them is the team formation deadline, and that one is what
-- locks rosters. What this adds:
--
--   * public.milestones, readable by everyone, written only through the two
--     admin functions below;
--   * formation_deadline() now reads the flagged milestone. It was the one
--     way to read the deadline (20_leave_team_rules.sql), so leave_team()
--     and remove_member() pick this up without changing. app_settings had
--     no other use, so it's dropped once its date has been carried over;
--   * after the deadline, students can't post a project or send a request.
--     leave_team() and remove_member() already refuse them.
--
-- Admins are users.is_admin, checked with public.require_admin()
-- (18_admin_access.sql, issue #36).
begin;

-- --- milestones ----------------------------------------------------------
create table public.milestones (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null
    constraint milestones_name_length check (char_length(btrim(name)) between 1 and 80),
  due_at                timestamptz not null,
  is_formation_deadline boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index milestones_due_at_idx on public.milestones(due_at);

-- Only one milestone can be the formation deadline. save_milestone() moves
-- the flag rather than tripping this, but it also holds for anything that
-- writes the table some other way.
create unique index milestones_one_formation_deadline
  on public.milestones (is_formation_deadline) where is_formation_deadline;

alter table public.milestones enable row level security;

-- Students see the schedule, and guests can too: it's the class calendar,
-- nothing personal. There are no write policies — admins go through
-- save_milestone() and delete_milestone(), which check who's calling.
create policy "milestones_select_all"
  on public.milestones for select
  to anon, authenticated
  using (true);

-- Carry over a deadline set the old way, so upgrading doesn't unlock rosters.
insert into public.milestones (name, due_at, is_formation_deadline)
select 'Team formation deadline', formation_deadline, true
  from public.app_settings
 where formation_deadline is not null;

-- --- formation_deadline --------------------------------------------------
-- Same signature as 20_leave_team_rules.sql, so callers don't change. Null
-- means no milestone is flagged, and rosters never lock.
create or replace function public.formation_deadline()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select due_at from public.milestones where is_formation_deadline;
$$;

grant execute on function public.formation_deadline() to anon, authenticated;

drop table public.app_settings;

-- --- save_milestone ------------------------------------------------------
-- Creates a milestone (p_id null) or edits one. Flagging it as the
-- formation deadline takes the flag off whichever milestone had it, in the
-- same transaction. The advisory lock makes two admins flagging different
-- milestones at once take turns instead of one failing on the unique index.
create or replace function public.save_milestone(
  p_id uuid,
  p_name text,
  p_due_at timestamptz,
  p_is_formation_deadline boolean default false
)
returns public.milestones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_flag boolean := coalesce(p_is_formation_deadline, false);
  v_row public.milestones;
begin
  perform public.require_admin();

  if v_name = '' then
    raise exception 'A milestone needs a name';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Keep the milestone name to 80 characters or fewer';
  end if;
  if p_due_at is null then
    raise exception 'A milestone needs a due date';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.milestones'));

  if p_id is not null and not exists (select 1 from public.milestones where id = p_id) then
    raise exception 'Milestone not found';
  end if;

  if v_flag then
    update public.milestones
       set is_formation_deadline = false, updated_at = now()
     where is_formation_deadline and id is distinct from p_id;
  end if;

  if p_id is null then
    insert into public.milestones (name, due_at, is_formation_deadline)
    values (v_name, p_due_at, v_flag)
    returning * into v_row;
  else
    update public.milestones
       set name = v_name, due_at = p_due_at, is_formation_deadline = v_flag, updated_at = now()
     where id = p_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

-- --- delete_milestone ----------------------------------------------------
-- Deleting the formation deadline milestone means rosters no longer lock.
create or replace function public.delete_milestone(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  delete from public.milestones where id = p_id;
  if not found then
    raise exception 'Milestone not found';
  end if;
end;
$$;

revoke all on function public.save_milestone(uuid, text, timestamptz, boolean), public.delete_milestone(uuid)
from public, anon;
grant execute on function public.save_milestone(uuid, text, timestamptz, boolean), public.delete_milestone(uuid)
to authenticated;

-- --- After the deadline: no new projects or requests ---------------------
-- Checked where the rows are written, the same way 18_admin_access.sql
-- keeps admins off teams, so create_project(), create_join_request() and
-- the demo join_project() are all covered without copying their bodies.
-- Admins never write these rows (18_), so whoever trips this is a student.
-- Only browser callers are checked: the role GUC stays 'anon' or
-- 'authenticated' inside SECURITY DEFINER functions, while a database
-- administrator seeding data from the SQL editor isn't held to it.
create or replace function private.require_before_formation_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deadline timestamptz;
begin
  if coalesce(current_setting('role', true), '') not in ('anon', 'authenticated') then
    return new;
  end if;

  v_deadline := public.formation_deadline();
  if v_deadline is null or now() < v_deadline then
    return new;
  end if;

  if tg_table_name = 'projects' then
    raise exception 'The team formation deadline has passed — new projects can''t be posted';
  end if;
  raise exception 'The team formation deadline has passed — ask an admin to place you on a team';
end;
$$;

revoke all on function private.require_before_formation_deadline() from public, anon, authenticated;

create trigger projects_before_formation_deadline before insert on public.projects
for each row execute function private.require_before_formation_deadline();
create trigger join_requests_before_formation_deadline before insert on public.join_requests
for each row execute function private.require_before_formation_deadline();

commit;
