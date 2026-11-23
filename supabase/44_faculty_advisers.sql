-- Advisers are CS faculty. Run after 39_project_advisers.sql; nothing here
-- depends on 40-43.
--
-- 39 let a project owner ask any account to advise. The rule now is narrower
-- and has one source of truth: the Computer Science faculty directory,
--
--   https://www.utrgv.edu/cecs/departments/csci/faculty/index.htm
--
-- If your @utrgv.edu address is listed there, you are faculty and can be asked
-- to advise. If it is not, you cannot. That page has no emails in its HTML: it
-- loads the department's records from a public JSON endpoint and prints each
-- one as `<username>@utrgv.edu`, so that is exactly what is stored here.
--
-- Keeping the list current is the `sync-faculty` Edge Function's job (setup in
-- TODO-backend.md, "Faculty directory"). It reads the same endpoint and hands
-- the whole list to sync_faculty_directory() below. The seed at the bottom of
-- this file is the list as of 2026-11-23, so the rule works the moment this
-- runs, before the function is deployed.
--
-- What changes, and what deliberately does not:
--
--   * invite_adviser() refuses anyone whose email is not in the directory.
--     The check runs after the self/team checks, so those keep their more
--     specific messages.
--   * search_advisers() only offers faculty. It no longer hides admin
--     accounts: an admin on the faculty list has their name and email on a
--     public university page already, so listing them leaks nothing, and an
--     instructor is the most likely adviser there is. (39's admin filter was
--     about not exposing names `users_select_students_or_admin` hides; for a
--     faculty member that reason is gone.) An admin who is NOT faculty is not
--     listed, same as any other non-faculty account.
--   * Existing adviser_requests rows are left alone. Someone who leaves the
--     directory keeps the teams they already advise; they just cannot be
--     asked again. Dropping an accepted adviser behind the owner's back would
--     be a surprise nobody asked for.
--   * Faculty must still have signed in to TeamUp once before they can be
--     found or asked, because an invitation points at a users row.
begin;

-- --- the list -------------------------------------------------------------
-- Emails only, lowercased, so a lookup is one equality on the primary key.
-- Nobody but the functions in this file reads it: RLS on, no policies, and
-- the grants Supabase hands out by default taken back.

create table if not exists public.faculty_directory (
  email     text primary key
              constraint faculty_directory_email_check
              check (email = lower(email) and email ~ '^[a-z0-9._-]+@utrgv\.edu$'),
  synced_at timestamptz not null default now()
);

comment on table public.faculty_directory is
  'CS faculty emails, from the department faculty directory. Only these '
  'accounts can be asked to advise a project. Refreshed by the sync-faculty '
  'Edge Function through sync_faculty_directory().';

alter table public.faculty_directory enable row level security;
revoke all on public.faculty_directory from anon, authenticated;

create or replace function private.is_faculty_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.faculty_directory f
     where f.email = lower(btrim(coalesce(p_email, '')))
  );
$$;

revoke all on function private.is_faculty_email(text) from public, anon, authenticated;

-- --- sync_faculty_directory -----------------------------------------------
-- Replaces the list with the one given, in one transaction: new emails are
-- added, missing ones removed, and everyone still listed gets a fresh
-- synced_at. Returns how many are listed afterwards.
--
-- An empty list is refused rather than applied. The directory endpoint
-- answering with nothing (an outage, a renamed department) would otherwise
-- quietly make every project unable to find an adviser; a failed sync leaves
-- last week's list in place instead, which is the better way to be wrong.
--
-- service_role only: this is what the Edge Function calls, and nobody signed
-- in has any business rewriting who counts as faculty.

create or replace function public.sync_faculty_directory(p_emails text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emails text[];
begin
  select coalesce(array_agg(distinct e), '{}')
    into v_emails
    from (select lower(btrim(x)) as e from unnest(coalesce(p_emails, '{}')) x) s
   where e ~ '^[a-z0-9._-]+@utrgv\.edu$';

  if cardinality(v_emails) = 0 then
    raise exception 'Refusing to empty the faculty directory: no valid @utrgv.edu emails were given';
  end if;

  delete from public.faculty_directory where email <> all (v_emails);

  insert into public.faculty_directory (email, synced_at)
  select e, now() from unnest(v_emails) e
  on conflict (email) do update set synced_at = excluded.synced_at;

  return cardinality(v_emails);
end;
$$;

revoke all on function public.sync_faculty_directory(text[]) from public, anon, authenticated;
grant execute on function public.sync_faculty_directory(text[]) to service_role;

-- --- invite_adviser -------------------------------------------------------
-- 39's function with one more check. Order is now:
--   signed in → project exists → caller owns it → invitee exists → not
--   yourself → not on this team → on the faculty directory → no open request.

create or replace function public.invite_adviser(p_project_id uuid, p_adviser_id uuid)
returns public.adviser_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_adviser public.users;
  v_open public.adviser_requests;
  v_row public.adviser_requests;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  if v_project.creator_id <> caller then
    raise exception 'Only the project creator can invite an adviser';
  end if;

  select * into v_adviser from public.users where id = p_adviser_id;
  if not found then
    raise exception 'That account does not exist';
  end if;

  if p_adviser_id = caller then
    raise exception 'You cannot invite yourself to advise your own project';
  end if;

  if exists (
    select 1
      from public.teams t
      join public.team_members tm on tm.team_id = t.id
     where t.project_id = p_project_id and tm.user_id = p_adviser_id
  ) then
    raise exception 'They are already on this team, so they cannot advise it';
  end if;

  if not private.is_faculty_email(v_adviser.email) then
    raise exception 'Only Computer Science faculty can advise a project';
  end if;

  select * into v_open
    from public.adviser_requests
   where project_id = p_project_id and status in ('pending', 'accepted')
   limit 1;
  if found then
    if v_open.status = 'accepted' then
      raise exception 'This project already has an adviser';
    else
      raise exception 'This project already has a pending adviser request';
    end if;
  end if;

  insert into public.adviser_requests (project_id, adviser_id, invited_by)
  values (p_project_id, p_adviser_id, caller)
  returning * into v_row;

  insert into public.notifications (user_id, kind, project_id, actor_id)
  values (p_adviser_id, 'adviser_invited', p_project_id, caller);

  return v_row;
end;
$$;

revoke all on function public.invite_adviser(uuid, uuid) from public, anon;
grant execute on function public.invite_adviser(uuid, uuid) to authenticated;

-- --- search_advisers ------------------------------------------------------
-- 39's function, offering faculty only. The admin filter is replaced by the
-- faculty one; see the header for why that is not a leak.

create or replace function public.search_advisers(p_project_id uuid, p_query text)
returns table (id uuid, name text, email text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_query text := btrim(coalesce(p_query, ''));
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  -- `p.id`, `u.name`, `u.email`: qualified because the OUT columns share
  -- those names (see 39).
  select * into v_project from public.projects p where p.id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  if v_project.creator_id <> caller then
    raise exception 'Only the project creator can look for an adviser';
  end if;

  if char_length(v_query) < 2 then
    return;
  end if;

  return query
    select u.id, u.name, u.email
      from public.users u
      join public.faculty_directory f on f.email = lower(u.email)
     where u.id <> caller
       and (u.name ilike '%' || v_query || '%' or u.email ilike '%' || v_query || '%')
       and not exists (
         select 1
           from public.teams t
           join public.team_members tm on tm.team_id = t.id
          where t.project_id = p_project_id and tm.user_id = u.id
       )
       and not exists (
         select 1
           from public.adviser_requests ar
          where ar.project_id = p_project_id
            and ar.adviser_id = u.id
            and ar.status in ('pending', 'accepted')
       )
     order by u.name
     limit 10;
end;
$$;

revoke all on function public.search_advisers(uuid, text) from public, anon;
grant execute on function public.search_advisers(uuid, text) to authenticated;

-- --- the list as of 2026-11-23 --------------------------------------------
-- From the directory endpoint, Department of Computer Science, 37 records.
-- `do nothing` so re-running this file never undoes a newer sync.

insert into public.faculty_directory (email) values
  ('alfredo.ramos02@utrgv.edu'),
  ('andres.figueroa@utrgv.edu'),
  ('austin.luchsinger@utrgv.edu'),
  ('bin.fu@utrgv.edu'),
  ('carlos.janonesfigueira01@utrgv.edu'),
  ('carlos.penacaballero01@utrgv.edu'),
  ('david.egle@utrgv.edu'),
  ('david.torres@utrgv.edu'),
  ('divya.bajaj@utrgv.edu'),
  ('dongchul.kim@utrgv.edu'),
  ('emmett.tomai@utrgv.edu'),
  ('eric.m.martinez02@utrgv.edu'),
  ('erik.enriquez01@utrgv.edu'),
  ('gustavo.dietrich@utrgv.edu'),
  ('haoteng.tang@utrgv.edu'),
  ('jennifer.pedraza02@utrgv.edu'),
  ('jonatan.reyes01@utrgv.edu'),
  ('jose.r.espinoza01@utrgv.edu'),
  ('joselito.guardado01@utrgv.edu'),
  ('juan.l.garza01@utrgv.edu'),
  ('li.zhang@utrgv.edu'),
  ('marzieh.ayati@utrgv.edu'),
  ('michael.aguillon01@utrgv.edu'),
  ('pedro.fonseca01@utrgv.edu'),
  ('pengfei.gu01@utrgv.edu'),
  ('pu.jiao@utrgv.edu'),
  ('qi.lu@utrgv.edu'),
  ('rene.barrera02@utrgv.edu'),
  ('robert.schweller@utrgv.edu'),
  ('roberto.jimenez01@utrgv.edu'),
  ('ryan.knobel01@utrgv.edu'),
  ('satzhan.sitmukhambetov01@utrgv.edu'),
  ('sergei.chuprov@utrgv.edu'),
  ('sonya.cirlos01@utrgv.edu'),
  ('timothy.wylie@utrgv.edu'),
  ('yifeng.gao@utrgv.edu'),
  ('zhixiang.chen@utrgv.edu')
on conflict (email) do nothing;

commit;
