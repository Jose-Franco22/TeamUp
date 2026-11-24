-- #60 — what an adviser advises in, and how many teams they will take.
--
-- Run after 44_faculty_advisers.sql (who may advise at all) and
-- 40_respond_to_adviser_request.sql (accepting), both of whose functions this
-- file replaces whole. Nothing here depends on file order beyond that.
--
-- Numbered 48 and not 47: #56's open PR (#103) claimed 47 first, for
-- 47_adviser_dashboard.sql. Two files with one number is nobody's problem
-- until it is everybody's — on the live database they are applied by hand, in
-- order, by a person reading the numbers. Against an open PR the number is
-- not settled, so this takes the first one above every claim rather than
-- arguing for 47. Nothing in the two files touches the other's functions, so
-- either order loads.
--
-- The story is a faculty member's: "I want to list the areas I advise in and
-- the most teams I'll take so that I get requests from projects I'm a good
-- fit for and don't get more than I can handle." It came from the faculty
-- adviser feedback of 12 Oct, which is also where #53, #54, #56 and #59 came
-- from.
--
-- --- Two things in the issue text no longer describe the app --------------
--
-- #60's first criterion says "**Any** user can turn on Available to advise".
-- It was written on 12 Oct, when an adviser was any TeamUp account. Adviser
-- identity has moved twice since: #92 untied it from users.is_admin (Jose
-- chose that option in writing on 11-20), and #99 made advising faculty-only
-- — invite_adviser() refuses anyone not on faculty_directory and
-- search_advisers() offers nobody else. A student who turned this switch on
-- would be invisible and uninvitable: a control that looks like it works and
-- does nothing. So the switch and its fields are **faculty only**, which is
-- what #53's own story asked for in the first place ("so that my team has a
-- faculty contact attached to the project").
--
-- #60 also contradicts itself about the default, and the rest of the issue
-- settles it against criterion 1's wording:
--
--   * criterion 1 says you "turn on" the switch     → default off
--   * criterion 2 says available advisers appear    → it is a *ranking*, so
--     "first", with their expertise and spots left    the others still appear
--   * criterion 6 says turning it off "hides me"    → nothing to hide unless
--     from adviser search                             it starts on
--
-- Two of the three describe opt-out, and #99 has already shipped opt-out:
-- every faculty account that has signed in is searchable today. Opt-in would
-- regress that, and it would empty adviser search on demo day, because no
-- faculty member has ever signed in to TeamUp. So: **available by default,
-- and the switch turns it off.**
--
-- --- What this adds ------------------------------------------------------
--
--   * users.advising_available, on by default, and users.advising_max_teams,
--     null meaning "no limit I have set". Both written straight from the
--     Profile page under users_update_own (02_rls_policies.sql), the way
--     email_notifications (36_) and adviser_digest (38_) already are.
--   * public.adviser_expertise — the areas someone advises in, as skill ids.
--   * private.advising_accepted() and private.advising_is_full(), so "full"
--     has one definition and its three callers cannot disagree.
--   * public.my_advising() — the Profile page's read.
--   * invite_adviser() and respond_to_adviser_request(), carrying the cap.
--   * search_advisers(), returning expertise and spots left.
--
-- --- Why my_advising() exists rather than another column -----------------
--
-- The browser cannot answer "am I faculty?" on its own, and it has to, to
-- show these fields to faculty and nobody else. faculty_directory revokes
-- everything from `authenticated` on purpose (44_), USER_SELECT carries no
-- such flag, and #99 only solved this in mock mode — `is_faculty` exists on
-- mock users and real mode never needed it, because both adviser functions
-- filter server-side. A `users.is_faculty` column would answer it, and would
-- be a second source of truth for who is faculty: stale between syncs, and
-- 44_'s header says outright that the directory is the only one. So this is
-- a function that reads the directory, not a copy of it.
--
-- --- Where the cap is actually enforced ----------------------------------
--
-- On **accepting**, not on inviting. Pending invitations do not fill a spot
-- (#60's own criterion), so two owners can both ask a faculty member with one
-- spot left and neither invitation is wrong when it is sent. Whichever they
-- accept first takes the spot and the other accept is refused.
-- invite_adviser()'s check is a courtesy — it stops an owner asking somebody
-- who is already full — and respond_to_adviser_request() is the boundary.
-- That is why the accept path locks the adviser's users row: the invitation
-- row is already locked, but the cap counts *other* invitations, so without
-- it two accepts read the same count and both pass.
--
-- Lowering the maximum below the number of teams already advised is allowed
-- and changes nothing retroactively (#60 criterion 5). The cap is read only
-- when a new team is about to be taken on, so teams already held stay held
-- and the next accept is refused.
begin;

-- --- the two settings ----------------------------------------------------
-- No new policy: users_update_own (02_rls_policies.sql) already lets someone
-- change their own row and nobody else's, and protect_admin_flag
-- (18_admin_access.sql) still stops them touching is_admin on the way past.
alter table public.users
  add column if not exists advising_available boolean not null default true;

alter table public.users
  add column if not exists advising_max_teams integer;

alter table public.users
  drop constraint if exists users_advising_max_teams_range_check;
alter table public.users
  add constraint users_advising_max_teams_range_check
    check (advising_max_teams is null or advising_max_teams between 1 and 20)
    not valid;

comment on column public.users.advising_available is
  'Whether this account is offered as an adviser (#60). On by default, so a '
  'faculty account is searchable as soon as it signs in, which is what '
  '44_faculty_advisers.sql already does on its own; turning it off hides '
  'them from search_advisers() and refuses new invitations, without touching '
  'the teams they already advise. Only ever read for faculty — nobody else '
  'can be asked to advise at all.';

comment on column public.users.advising_max_teams is
  'The most teams this adviser will advise at once (#60), 1-20, or null for '
  'no limit they have set. Counted against accepted adviser_requests only: '
  'a pending invitation does not fill a spot.';

-- --- the areas someone advises in ----------------------------------------
-- Its own table rather than more user_skills rows. user_skills is what the
-- matching engine scores a *student* on: it carries `source` ('manual' or
-- 'resume') and profile_evidence (months, projects) hangs off it, which is
-- evidence of having done the work personally. "Areas I advise in" is a
-- different claim, and resume import writes user_skills — an adviser's areas
-- should not change because somebody imported a CV. What is shared is the
-- skill *list*, which is all #60 means by "reusing the existing skill list":
-- the same public.skills rows and the same SkillPicker.
create table if not exists public.adviser_expertise (
  user_id    uuid not null references public.users(id) on delete cascade,
  skill_id   uuid not null references public.skills(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, skill_id)
);

comment on table public.adviser_expertise is
  'The areas an adviser advises in (#60), as public.skills ids. Own rows '
  'only; search_advisers() reads everyone''s as SECURITY DEFINER.';

alter table public.adviser_expertise enable row level security;

-- Own rows only. There is nothing to update — the row *is* the claim, so
-- changing your areas means adding and removing rows, exactly as
-- user_skills_manage_own (02_rls_policies.sql) handles skills.
drop policy if exists adviser_expertise_manage_own on public.adviser_expertise;
create policy adviser_expertise_manage_own
  on public.adviser_expertise
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.adviser_expertise from anon, authenticated;
grant select, insert, delete on public.adviser_expertise to authenticated;

-- --- how full an adviser is ----------------------------------------------
-- One definition, read by invite, accept and search, so the three cannot
-- disagree about who is full. Accepted rows only: a pending invitation does
-- not fill a spot (#60 criterion 4).
create or replace function private.advising_accepted(p_adviser uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.adviser_requests
   where adviser_id = p_adviser
     and status = 'accepted';
$$;

-- Null max_teams is "no limit I have set", so they are never full: `n >= null`
-- is null and the coalesce reads it as false. Returns null for an account
-- that does not exist, which every caller has already ruled out.
create or replace function private.advising_is_full(p_adviser uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(private.advising_accepted(p_adviser) >= u.advising_max_teams, false)
    from public.users u
   where u.id = p_adviser;
$$;

-- `authenticated` holds USAGE on `private` and Postgres grants EXECUTE to
-- PUBLIC by default, so without these a signed-in student could count
-- anybody's accepted invitations.
revoke all on function private.advising_accepted(uuid) from public, anon, authenticated;
revoke all on function private.advising_is_full(uuid) from public, anon, authenticated;

-- --- the Profile page's read ---------------------------------------------
-- Everything the Profile needs to draw the advising card, for the caller and
-- nobody else. `advising` is in here because adviser_requests' select policy
-- shows rows for projects you are on or were asked about, which is not the
-- same question as "how many teams do I advise".
create or replace function public.my_advising()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_user public.users;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select * into v_user from public.users where id = caller;
  if not found then
    raise exception 'Account not found';
  end if;

  return jsonb_build_object(
    'is_faculty', private.is_faculty_email(v_user.email),
    'available',  v_user.advising_available,
    'max_teams',  v_user.advising_max_teams,
    'advising',   private.advising_accepted(caller),
    'is_full',    coalesce(private.advising_is_full(caller), false),
    'expertise',  coalesce(
                    (select jsonb_agg(
                              jsonb_build_object(
                                'id', s.id, 'name', s.name, 'category', s.category)
                              order by s.category, s.name)
                       from public.adviser_expertise ae
                       join public.skills s on s.id = ae.skill_id
                      where ae.user_id = caller),
                    '[]'::jsonb)
  );
end;
$$;

revoke all on function public.my_advising() from public, anon;
grant execute on function public.my_advising() to authenticated;

-- --- invite_adviser ------------------------------------------------------
-- 44's function with two more checks. Order is now:
--   signed in → project exists → caller owns it → invitee exists → not
--   yourself → not on this team → on the faculty directory → taking
--   requests → not full → no open request.
--
-- The two new checks sit after the faculty one so a student still hears that
-- they are not faculty, which is the more useful answer, rather than
-- something about advising limits they could never have set.
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

  if not v_adviser.advising_available then
    raise exception 'They are not taking advising requests right now';
  end if;

  if private.advising_is_full(p_adviser_id) then
    raise exception 'They are already advising as many teams as they take on';
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

-- --- respond_to_adviser_request ------------------------------------------
-- 40's function with the cap on accepting. Everything else is unchanged,
-- including the roster check and its comment about the pair of locks.
create or replace function public.respond_to_adviser_request(
  p_request_id uuid,
  p_accept boolean
)
returns public.adviser_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_row public.adviser_requests;
  v_project public.projects;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  if p_accept is null then
    raise exception 'Answer the invitation with accept or decline';
  end if;

  -- Locked for the length of the transaction, so two answers to the same
  -- invitation cannot both pass the pending check.
  select * into v_row
    from public.adviser_requests
   where id = p_request_id
     for update;
  if not found then
    raise exception 'Adviser request not found';
  end if;

  if v_row.adviser_id <> caller then
    raise exception 'Only the person who was asked can answer this invitation';
  end if;

  -- Covers all three of the ways it stops being answerable: the owner
  -- cancelled it, they already answered, or they are already the adviser.
  if v_row.status <> 'pending' then
    raise exception 'That adviser request has already been answered';
  end if;

  -- 39 checks at invite time that the invitee is not on the team. That is one
  -- moment, and this is a later one: nothing stopped them from joining the
  -- same project in between, which would leave one person both a member and
  -- the adviser of one team. Only accepting is refused — someone on the team
  -- who somehow holds an open invitation can still decline it, and should.
  --
  -- The invitation row is already locked above, which is what makes this and
  -- the roster trigger below a pair rather than two hopeful checks: whichever
  -- of "accept" and "seat them" commits first, the other sees it and refuses.
  if p_accept and exists (
    select 1
      from public.teams t
      join public.team_members tm on tm.team_id = t.id
     where t.project_id = v_row.project_id
       and tm.user_id = caller
  ) then
    raise exception 'You are on this team, so you cannot also advise it';
  end if;

  -- The cap (#60). This is where it is enforced rather than at invite time,
  -- because pending invitations do not fill a spot, so two owners can each
  -- hold a legitimate invitation to an adviser with one left.
  --
  -- The lock is the other half of it. The invitation row above is locked, but
  -- the count reads *other* invitations, so two accepts of two different
  -- invitations would both read the old count and both pass. Locking the
  -- adviser's own users row serializes them: the second waits, then counts
  -- again and is refused. `for no key update` is the weakest lock that blocks
  -- another transaction taking the same one, and it does not block ordinary
  -- reads of that row.
  if p_accept then
    perform 1 from public.users where id = caller for no key update;

    if private.advising_is_full(caller) then
      raise exception 'You are already advising as many teams as you said you would take on. Raise your limit in your profile to accept more.';
    end if;
  end if;

  select * into v_project from public.projects where id = v_row.project_id;

  update public.adviser_requests
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where id = v_row.id
   returning * into v_row;

  insert into public.notifications (user_id, kind, project_id, actor_id)
  values (
    v_project.creator_id,
    case when p_accept then 'adviser_accepted' else 'adviser_declined' end,
    v_project.id,
    caller);

  return v_row;
end;
$$;

revoke all on function public.respond_to_adviser_request(uuid, boolean) from public, anon;
grant execute on function public.respond_to_adviser_request(uuid, boolean) to authenticated;

-- --- search_advisers -----------------------------------------------------
-- 44's function, now carrying what #60 asks it to show: each candidate's
-- expertise, their cap, how many teams they already advise, and whether that
-- makes them full.
--
-- Dropped and recreated rather than replaced, because the OUT columns change
-- and Postgres will not replace a function whose return type differs.
--
-- Who is offered:
--   * faculty only (44_), unchanged
--   * and taking requests. Turning the switch off hides you here, which is
--     #60 criterion 6, and is why no separate "hidden" state is returned:
--     there is nothing for the owner to see.
--
-- Full advisers are still returned, marked `is_full`, because criterion 3
-- asks for them to be shown as **Full** rather than vanish — an owner who
-- types a name and gets nothing cannot tell "not faculty" from "has no room".
-- They sort last so the ten rows this returns prefer people who can say yes.
--
-- The remaining ordering — expertise matching the project's roles first — is
-- the caller's, in frontend/src/lib/advising.js, because that comparison is
-- the matching engine's (lib/matching/fit.js) and a second copy of it here
-- would be the #31 mistake again: two implementations of "matches" that
-- drift apart. This orders by name so the ten are stable, and the client
-- reorders them.
--
-- `private.advising_is_full()` is called twice per row rather than inlined,
-- for a function that returns at most ten: a second expression for "full" is
-- how search starts offering somebody invite_adviser() then refuses.
drop function if exists public.search_advisers(uuid, text);

create or replace function public.search_advisers(p_project_id uuid, p_query text)
returns table (
  id uuid,
  name text,
  email text,
  max_teams integer,
  advising integer,
  is_full boolean,
  expertise jsonb
)
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
    select u.id,
           u.name,
           u.email,
           u.advising_max_teams,
           private.advising_accepted(u.id),
           coalesce(private.advising_is_full(u.id), false),
           coalesce(
             (select jsonb_agg(
                       jsonb_build_object(
                         'id', s.id, 'name', s.name, 'category', s.category)
                       order by s.category, s.name)
                from public.adviser_expertise ae
                join public.skills s on s.id = ae.skill_id
               where ae.user_id = u.id),
             '[]'::jsonb)
      from public.users u
      join public.faculty_directory f on f.email = lower(u.email)
     where u.id <> caller
       and u.advising_available
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
     order by coalesce(private.advising_is_full(u.id), false), u.name
     limit 10;
end;
$$;

revoke all on function public.search_advisers(uuid, text) from public, anon;
grant execute on function public.search_advisers(uuid, text) to authenticated;

commit;
