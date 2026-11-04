-- The next-steps checklist teams see once they're complete (issue #42).
-- Run after 30_notification_bell.sql. 31 and 32 are taken by open pull
-- requests (31_set_member_role.sql, 32_notify_on_project_delete.sql).
--
-- An admin keeps one ordered list of steps for the semester (confirm the
-- roster, create the repo and add the adviser, ...), each with an optional
-- due date. Every team works through the same list. What this adds:
--
--   * public.next_steps, the list, readable by anyone signed in and written
--     only through save_next_step(), delete_next_step() and
--     reorder_next_steps(), which check the caller is an admin;
--   * public.next_step_completions, one row per (team, step) a team has
--     checked off, with who did it and when. This file only creates it and
--     lets members and admins read it; checking items off, and the "team
--     complete" notification, are issue #30;
--   * admin_dashboard() and admin_team_details() report each team's
--     progress as next_steps: { done, total }.
--
-- sort_order is the order teams see. It's unique, and the constraint is
-- checked at the end of each statement rather than row by row, so
-- reorder_next_steps() can renumber every row in one UPDATE.
--
-- Admins are users.is_admin, checked with public.require_admin()
-- (18_admin_access.sql, issue #36).
begin;

-- --- next_steps ----------------------------------------------------------
-- The title follows the milestone name rules (28_milestone_messages.sql):
-- one line, something other than spaces and punctuation, no control or
-- invisible characters. lib/validation.js mirrors them for the form.
create table public.next_steps (
  id         uuid primary key default gen_random_uuid(),
  title      text not null
    constraint next_steps_title_length check (char_length(title) between 1 and 120)
    constraint next_steps_title_trimmed check (title = btrim(title))
    constraint next_steps_title_text check (
      title ~ '[^[:space:][:punct:]\u2000-\u2BFF\u2E00-\u2E7F\u3000-\u303F\uFE00-\uFE0F\U0001F000-\U0001FAFF]'
      and title !~ '[[:cntrl:]]'
      and title !~ '[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]'
    ),
  due_at     timestamptz
    constraint next_steps_due_at_range check (
      due_at >= '2000-01-01 00:00+00' and due_at < '2100-01-01 00:00+00'
    ),
  sort_order integer not null
    constraint next_steps_sort_order_positive check (sort_order > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint next_steps_sort_order_unique unique (sort_order) deferrable initially immediate
);

alter table public.next_steps enable row level security;

-- Every student needs the list once their team is full (#30), so anyone
-- signed in reads it. It isn't shown to guests. No write policies.
create policy "next_steps_select_signed_in"
  on public.next_steps for select
  to authenticated
  using (true);

-- --- next_step_completions -----------------------------------------------
-- Deleting a step or a team takes its completions with it, so progress
-- only ever counts steps that still exist. completed_by goes null if that
-- student's account is deleted; the completion still stands.
create table public.next_step_completions (
  team_id      uuid not null references public.teams(id) on delete cascade,
  step_id      uuid not null references public.next_steps(id) on delete cascade,
  completed_by uuid references public.users(id) on delete set null,
  completed_at timestamptz not null default now(),
  primary key (team_id, step_id)
);
create index next_step_completions_step_id_idx on public.next_step_completions(step_id);

alter table public.next_step_completions enable row level security;

-- A team's members see their own team's progress; admins see everyone's.
-- Writes come in #30, through a function that checks membership.
create policy "next_step_completions_select_member_or_admin"
  on public.next_step_completions for select
  to authenticated
  using (
    private.is_admin()
    or exists (
      select 1 from public.team_members tm
       where tm.team_id = next_step_completions.team_id and tm.user_id = auth.uid()
    )
  );

-- --- save_next_step ------------------------------------------------------
-- Adds a step at the end of the list (p_id null) or edits one in place.
-- The advisory lock makes two admins adding at once take turns instead of
-- both picking the same place.
create or replace function public.save_next_step(
  p_id uuid,
  p_title text,
  p_due_at timestamptz default null
)
returns public.next_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_row public.next_steps;
begin
  perform public.require_admin();

  if v_title = '' then
    raise exception 'A next step needs some text';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'Keep the step to 120 characters or fewer';
  end if;
  if v_title ~ '[[:cntrl:]]' or v_title ~ '[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]' then
    raise exception 'The step can''t contain line breaks, hidden or control characters';
  end if;
  if v_title !~ '[^[:space:][:punct:]\u2000-\u2BFF\u2E00-\u2E7F\u3000-\u303F\uFE00-\uFE0F\U0001F000-\U0001FAFF]' then
    raise exception 'The step has to include letters or numbers';
  end if;
  if p_due_at is not null and (p_due_at < '2000-01-01 00:00+00' or p_due_at >= '2100-01-01 00:00+00') then
    raise exception 'Pick a due date between 2000 and 2099';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.next_steps'));

  if p_id is null then
    insert into public.next_steps (title, due_at, sort_order)
    values (v_title, p_due_at, coalesce((select max(sort_order) from public.next_steps), 0) + 1)
    returning * into v_row;
  else
    update public.next_steps
       set title = v_title, due_at = p_due_at, updated_at = now()
     where id = p_id
    returning * into v_row;
    if not found then
      raise exception 'Next step not found';
    end if;
  end if;

  return v_row;
end;
$$;

-- --- delete_next_step ----------------------------------------------------
-- Closes the gap it leaves, so sort_order stays 1..n. Teams' completions of
-- the step go with it (on delete cascade).
create or replace function public.delete_next_step(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  perform pg_advisory_xact_lock(hashtext('public.next_steps'));

  delete from public.next_steps where id = p_id;
  if not found then
    raise exception 'Next step not found';
  end if;

  update public.next_steps s
     set sort_order = n.rn, updated_at = now()
    from (select id, row_number() over (order by sort_order) as rn from public.next_steps) n
   where s.id = n.id and s.sort_order <> n.rn;
end;
$$;

-- --- reorder_next_steps --------------------------------------------------
-- p_ids is every step's id in the new order. Anything else — a step left
-- out, one listed twice, an id that isn't a step — is refused rather than
-- guessed at, so an admin working from a stale list gets an error instead
-- of a scrambled order. One UPDATE renumbers every row; the unique
-- sort_order constraint is checked once it's done.
create or replace function public.reorder_next_steps(p_ids uuid[])
returns setof public.next_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := coalesce(p_ids, '{}');
begin
  perform public.require_admin();
  perform pg_advisory_xact_lock(hashtext('public.next_steps'));

  if array_position(v_ids, null) is not null
     or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) as x)
     or cardinality(v_ids) <> (select count(*) from public.next_steps)
     or exists (select 1 from unnest(v_ids) as x where not exists (select 1 from public.next_steps where id = x)) then
    raise exception 'The list has changed since it was loaded — reload and try again';
  end if;

  update public.next_steps s
     set sort_order = o.ord, updated_at = now()
    from unnest(v_ids) with ordinality as o(id, ord)
   where s.id = o.id and s.sort_order <> o.ord;

  return query select * from public.next_steps order by sort_order;
end;
$$;

revoke all on function public.save_next_step(uuid, text, timestamptz), public.delete_next_step(uuid),
  public.reorder_next_steps(uuid[])
from public, anon;
grant execute on function public.save_next_step(uuid, text, timestamptz), public.delete_next_step(uuid),
  public.reorder_next_steps(uuid[])
to authenticated;

-- --- Progress on the dashboard -------------------------------------------
-- { done, total } for one team. done counts only steps that still exist,
-- which the cascade guarantees. Same shape as the rest of
-- private.admin_team_json() (19_admin_dashboard.sql).
--
-- admin_dashboard() calls this once per team, so the `total` count repeats
-- for every row. Kept per-team on purpose: the whole dashboard is built from
-- per-team functions, and one query that grouped completions by team_id
-- would be the only one that isn't. A section has a handful of teams and
-- next_steps has a handful of rows, so the repeat is a few index scans.
create or replace function private.admin_team_next_steps(p_team_id uuid)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'next_steps', jsonb_build_object(
      'done', (select count(*) from public.next_step_completions c where c.team_id = p_team_id),
      'total', (select count(*) from public.next_steps)
    )
  );
$$;

revoke all on function private.admin_team_next_steps(uuid) from public, anon, authenticated, service_role;

-- Same as 19_admin_dashboard.sql, with each team's progress merged in
-- (marked NEW).
create or replace function public.admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  team_list jsonb;
  unplaced_list jsonb;
begin
  perform public.require_admin();

  -- NEW: || private.admin_team_next_steps(t.id)
  select coalesce(jsonb_agg(private.admin_team_json(t.id) || private.admin_team_next_steps(t.id)
                            order by p.title, t.id), '[]'::jsonb)
    into team_list
    from public.teams t join public.projects p on p.id = t.project_id;

  select coalesce(jsonb_agg(private.admin_student_json(u.id) order by u.name, u.id), '[]'::jsonb)
    into unplaced_list
    from public.users u
   where not u.is_admin
     and not exists (select 1 from public.team_members tm where tm.user_id = u.id);

  return jsonb_build_object(
    'teams', team_list, 'unplaced_students', unplaced_list,
    'summary', jsonb_build_object(
      'formed_teams', (select count(*) from jsonb_array_elements(team_list) as team where team->>'status' = 'full'),
      'open_teams', (select count(*) from jsonb_array_elements(team_list) as team where team->>'status' = 'open'),
      'unplaced_students', jsonb_array_length(unplaced_list)
    )
  );
end;
$$;

-- Same as 19_admin_dashboard.sql, with the team's progress merged in
-- (marked NEW), so a team reports the same { done, total } whether it is read
-- from the dashboard or on its own. No frontend reads this field yet — the
-- progress column on the dashboard is fed by admin_dashboard() — but
-- next_steps.test.sql pins the two to the same answer, so the team page can
-- show progress without a migration.
--
-- This replaces the definition in 19_admin_dashboard.sql rather than adding
-- to it, so a later change there has to be copied here or it is silently
-- undone. Same hazard as the admin_dashboard() redefinition above.
create or replace function public.admin_team_details(p_team_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  details jsonb;
begin
  perform public.require_admin();
  details := private.admin_team_json(p_team_id);
  if details is null then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;
  return details || private.admin_team_next_steps(p_team_id); -- NEW
end;
$$;

commit;
