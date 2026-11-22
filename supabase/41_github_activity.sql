-- Link our GitHub repo and show each member's activity (issue #58). Run
-- after 39_project_advisers.sql, which the select policy below now reads:
-- the adviser half of the issue's "team members and the adviser only" is
-- the one thing #58 could not state until #88 had merged, and it has.
-- Nothing here depends on 40 or above.
--
-- 42 RATHER THAN 41, which #93 (`41_check_ins.sql`) also claimed. Jose's
-- #91 review asked for one of the two to move; this is the one that was
-- blocked on conflicts, so this is the one that moves. A number is only an
-- ordering and gaps are already normal here — 25 and 38 are both absent
-- from Testing — so moving costs nothing, while waiting to agree costs a
-- round trip.
--
-- Three pieces:
--
--   1. `projects.github_repo` — the link itself, the owner's to set — and
--      `projects.github_forced_at`, the clock that puts a floor under how
--      often the refresh button may reach GitHub.
--   2. `public.repo_activity` — one row per project, holding what GitHub
--      last told us. A cache, not a record: it can be deleted at any time
--      and the next page view refills it.
--   3. Four functions: the owner writes the link, a member asks what to
--      refresh, a member claims a forced refresh, and the Edge Function
--      (and only it) writes the answer back.
--
-- WHO SEES WHAT, and why the two halves differ:
--
--   The *link* is as public as the project it belongs to. `projects` has
--   `projects_select_all` for anon and authenticated alike (02_rls_policies.sql:
--   "guests must be able to browse"), and a column on that table inherits
--   it. That is the right answer for a recruiting page — a repo link says
--   what the team is building — and it is also the honest one: a private
--   repository is protected by GitHub, not by hiding its name.
--
--   The *activity* is not. Who committed how much is the team's business,
--   so `repo_activity` gets its own policy and its own table. The issue is
--   explicit about this ("readable by team members and the adviser only"),
--   and both halves are written now: #88 brought `adviser_requests`, so the
--   policy below names the accepted adviser as well as the team. Reading is
--   not refreshing, though — see project_repo_for_refresh().
--
-- WHAT IS NOT HERE: no fetching. Postgres never talks to GitHub; the token
-- would have to live in the database to do it. supabase/functions/github-activity/
-- holds the call, exactly as fit-review holds the Gemini key, and this file
-- holds the rules about who may ask it to and what may come back.

begin;

-- --- the link -------------------------------------------------------------
-- Empty means "not linked", rather than null: the column is read on every
-- team page and `github_repo <> ''` is one less null to think about, the
-- same choice users.github_url made in the baseline schema.
--
-- The CHECK is the real boundary. frontend/src/lib/github.js does the
-- lenient reading of whatever somebody pasted and stores only the canonical
-- form; anyone signed in can call Supabase directly and skip that file, so
-- the pattern is restated here. Three clauses, all three mirrored by
-- isCanonicalRepoUrl() in that file and splitRepo() in the Edge Function:
--
--   - the shape: https, github.com, owner, repo, and nothing else;
--   - not a name that is only dots, which would make the Edge Function's
--     /repos/<owner>/<repo>/commits climb out of the repository it was given;
--   - not a name ending in .git, which GitHub itself refuses — one arriving
--     here means the suffix was not stripped, so the repository cannot exist.

alter table public.projects
  add column if not exists github_repo text not null default '';

alter table public.projects
  drop constraint if exists projects_github_repo_format_check;

alter table public.projects
  add constraint projects_github_repo_format_check
  check (
    github_repo = ''
    or (
      github_repo ~ '^https://github\.com/[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$'
      and github_repo !~ '/\.+$'
      and github_repo !~* '\.git$'
    )
  );

comment on column public.projects.github_repo is
  'The team''s repository, canonical form only: https://github.com/owner/repo. '
  'Empty when nothing is linked. As public as the rest of the project row.';

-- --- the floor under forced refreshes -------------------------------------
-- The refresh button passes `force`, which skips the 15-minute cache, and
-- until now nothing limited it. activity.js promised a touch_repo_activity()
-- that was never written, so the comment was the whole of the rule: any
-- member, or a script with their token, could spend up to six GitHub calls
-- per press against the 5,000-an-hour budget the entire course shares
-- through one token. Jose's #91 review, point 1.
--
-- WHY THE STAMP IS HERE AND NOT ON repo_activity. Two reasons, and the
-- second is the one that decided it:
--
--   * `repo_activity` is documented one screen below as safe to delete. A
--     limiter you can reset by clearing the cache is not a limiter.
--   * The slot has to be claimed BEFORE the GitHub requests are spent, not
--     after them. `repo_activity.fetched_at` is written by
--     save_repo_activity() once the fetch has come back, so a caller that
--     hangs up mid-fetch stamps nothing and may press again immediately —
--     which is precisely the path a loop would take. Stamping up front
--     needs a row that is already there, and a project that has never been
--     fetched has no `repo_activity` row at all. Inserting a stub one is
--     not available either: the client selects from that table directly and
--     reads "no row" as "never asked" (getRepoActivity in client.js), so a
--     stub would show an empty contributors table where the page should be
--     offering to fetch. `projects` always has a row, and
--     project_repo_for_refresh() has already proved the caller may use it.
--
-- Null means "never forced", which is why the first press is free.

alter table public.projects
  add column if not exists github_forced_at timestamptz;

comment on column public.projects.github_forced_at is
  'When a forced repository refresh was last let through, or null if never. '
  'Written only by touch_repo_activity(), which is also where the reason it '
  'is not on repo_activity is written down.';

-- --- the cache ------------------------------------------------------------
-- One row per project, replaced whole. Nothing here is a source of truth:
-- GitHub is, and this is what it said at `fetched_at`. That is why there is
-- no history and no per-contributor table — a row that cannot be trusted to
-- be current is not worth normalising.
--
-- `contributors` is a jsonb array of
--   { login, name, commits, pull_requests, last_commit_at }
-- exactly as summarize() in the Edge Function builds it. jsonb rather than a
-- child table because the page reads all of it at once, always, and writes
-- it all at once, always.
--
-- `error` records a refresh that failed while keeping whatever was last
-- known beside it, so a transient failure does not blank a working page.
-- `fetched_at` is stamped on failures too — that is what keeps a repository
-- which is 404ing from being asked about once per click.

create table if not exists public.repo_activity (
  project_id     uuid primary key references public.projects(id) on delete cascade,
  repo           text not null,
  contributors   jsonb not null default '[]'::jsonb,
  last_commit_at timestamptz,
  window_days    smallint not null default 14,
  fetched_at     timestamptz not null default now(),
  error          text,
  constraint repo_activity_contributors_is_array
    check (jsonb_typeof(contributors) = 'array'),
  constraint repo_activity_window_days_range
    check (window_days between 1 and 365),
  -- The reasons collectActivity() can return, and no others: a code the page
  -- has no sentence for would render as nothing at all. Mirrored by
  -- reasonForStatus() in supabase/functions/github-activity/activity.js.
  constraint repo_activity_error_known
    check (error is null or error in (
      'bad_repo', 'bad_token', 'forbidden', 'not_found',
      'rate_limited', 'unreachable', 'upstream_error'
    ))
);

comment on table public.repo_activity is
  'What GitHub last told us about a team''s repository. A cache: safe to '
  'delete, refilled by the github-activity Edge Function.';

-- --- who can read it ------------------------------------------------------
-- The team, and nobody else. No insert, update or delete policy on purpose:
-- the only way in is save_repo_activity() below, which only the Edge
-- Function may call, so a student cannot write themselves a hundred commits.
--
-- THE ADVISER IS IN IT NOW. The first version of this file left the clause
-- out for a concrete reason — `adviser_requests` did not exist on the
-- branch, and a policy naming a table that is not there fails every pgTAP
-- run from scratch — and that reason has expired: #53 (PR #88) merged into
-- Testing on 2026-11-20, so 39_project_advisers.sql runs before this file.
--
-- It is written here rather than in a migration of its own, which is what
-- the old comment promised. A select policy is replaced whole, so two files
-- both running `create policy repo_activity_select_team` would let merge
-- order decide which of the two rules the live database ends up with — the
-- trap 40_respond_to_adviser_request.sql documents at length. One file, one
-- policy, no ordering to get wrong.
--
-- `status = 'accepted'` and nothing else: an invitation still out is not an
-- adviser, and a declined or cancelled one never was. Accepting is #54's to
-- write and #54 is still open, which this does not wait for — the policy
-- reads a status column 39 already defines, and the pgTAP case sets it by
-- hand exactly as 39's own tests do.
--
-- Reading is not refreshing. An adviser sees the table; spending the shared
-- GitHub budget stays with the team. project_repo_for_refresh() says why.

alter table public.repo_activity enable row level security;

drop policy if exists repo_activity_select_team on public.repo_activity;
create policy repo_activity_select_team
  on public.repo_activity for select
  to authenticated
  using (
    exists (
      select 1
        from public.teams t
        join public.team_members tm on tm.team_id = t.id
       where t.project_id = repo_activity.project_id
         and tm.user_id = auth.uid()
    )
    or exists (
      select 1
        from public.adviser_requests ar
       where ar.project_id = repo_activity.project_id
         and ar.adviser_id = auth.uid()
         and ar.status = 'accepted'
    )
  );

-- --- set_project_repo -----------------------------------------------------
-- The owner links a repository, changes it, or passes '' to unlink.
--
-- Checks in order, every refusal before the write:
--   signed in → project exists → caller owns it → the URL is canonical.
--
-- Changing the link clears the cache. The old repository's commits are not
-- an approximation of the new one's, and leaving them would show a team
-- somebody else's work for up to fifteen minutes after they fixed a typo.
-- getActivity() in the Edge Function refuses a mismatched cached row for the
-- same reason; this makes it immediate rather than next-refresh.

create or replace function public.set_project_repo(p_project_id uuid, p_repo text)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_project public.projects;
  v_repo text := btrim(coalesce(p_repo, ''));
  v_row public.projects;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  if v_project.creator_id <> caller then
    raise exception 'Only the project creator can link a repository';
  end if;

  -- Restated rather than left to the CHECK so the message is a sentence
  -- somebody can act on. The CHECK still stands behind it: this function is
  -- SECURITY DEFINER, but a constraint applies to its owner too.
  if v_repo <> '' and not (
    v_repo ~ '^https://github\.com/[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$'
    and v_repo !~ '/\.+$'
    and v_repo !~* '\.git$'
  ) then
    raise exception 'Use the repository link, like https://github.com/owner/repo';
  end if;

  update public.projects
     set github_repo = v_repo
   where id = p_project_id
  returning * into v_row;

  if v_repo <> coalesce(v_project.github_repo, '') then
    delete from public.repo_activity where project_id = p_project_id;
  end if;

  return v_row;
end;
$$;

revoke all on function public.set_project_repo(uuid, text) from public, anon;
grant execute on function public.set_project_repo(uuid, text) to authenticated;

-- --- project_repo_for_refresh ---------------------------------------------
-- What the Edge Function asks, with the caller's own token, before it spends
-- a GitHub request: "am I allowed to refresh this, and what am I fetching?"
--
-- Keeping the answer here rather than in TypeScript is the point. The rule
-- is the same rule as the select policy above, it is tested in
-- supabase/tests/github_activity.test.sql, and the Edge Function cannot get
-- it subtly wrong because it does not know it.
--
-- Deliberately not the owner only: anyone on the team may refresh. A
-- stranger may not — GitHub's limit is 5,000 requests an hour for the whole
-- course, and an endpoint any signed-in student could spin would be the
-- easiest way to exhaust it.
--
-- NOR THE ADVISER, who the select policy above does let read. The two are
-- different questions: reading costs nothing, and refreshing spends a
-- budget shared by every team in the course. The issue asks for the adviser
-- to *see* the activity and says nothing about fetching it, an adviser can
-- advise several projects at once (#54), and whoever is actually pushing
-- commits is on the team and can press the button. If an advising dashboard
-- later wants its own refresh, that is its own decision to argue, with its
-- own test — not a side effect of this one.

create or replace function public.project_repo_for_refresh(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_repo text;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select p.github_repo into v_repo
    from public.projects p
   where p.id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  if not exists (
    select 1
      from public.teams t
      join public.team_members tm on tm.team_id = t.id
     where t.project_id = p_project_id
       and tm.user_id = caller
  ) then
    raise exception 'Only the team can refresh this repository';
  end if;

  if coalesce(v_repo, '') = '' then
    raise exception 'No repository is linked to this project';
  end if;

  return v_repo;
end;
$$;

revoke all on function public.project_repo_for_refresh(uuid) from public, anon;
grant execute on function public.project_repo_for_refresh(uuid) to authenticated;

-- --- touch_repo_activity --------------------------------------------------
-- "May I spend GitHub requests on this project right now?" Asked by the
-- Edge Function before a forced refresh, and by nothing else. The function
-- activity.js has been claiming exists since the first commit on this
-- branch; Jose's #91 review noticed it did not.
--
-- ONE STATEMENT, because the check and the claim have to be the same act.
-- An `if last < now() - gap then update` would let two presses arriving
-- together both read the same old stamp and both pass, which is the shape
-- of race this is meant to stop. The UPDATE's WHERE clause *is* the check,
-- and `found` is the answer to it.
--
-- Returns true when the caller may fetch, with the next sixty seconds now
-- claimed; false when it may not. False is not an error: index.ts serves
-- the cached row and reports `cached: true`, which is byte for byte what it
-- already does for an ordinary cache hit, so neither the client nor the
-- page needs to learn a new state for this.
--
-- A project id that matches no row also returns false. Unreachable in
-- practice — project_repo_for_refresh() has already raised 'Project not
-- found' by then — but "I could not claim the slot" is the right answer to
-- give when the row is not there, rather than the permissive one.
--
-- SIXTY SECONDS is Jose's suggested figure and it is the right order of
-- magnitude: long enough that leaning on the button costs one fetch instead
-- of twenty, short enough that "I just pushed, show me now" works on a
-- second try rather than feeling broken. It is written here as an interval
-- literal rather than a settable constant on purpose — a rate limit a
-- caller can pass in is a rate limit a caller can widen.
--
-- service_role only, like save_repo_activity() below. Authorization is
-- already settled by the time this is called: index.ts asks
-- project_repo_for_refresh() with the caller's own token first and only
-- gets here if that allowed it. Granting this to `authenticated` would also
-- hand any one member a way to burn the gap for the rest of their team by
-- calling it in a loop directly.

create or replace function public.touch_repo_activity(p_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.projects
     set github_forced_at = now()
   where id = p_project_id
     and (github_forced_at is null
          or github_forced_at < now() - interval '60 seconds');

  return found;
end;
$$;

revoke all on function public.touch_repo_activity(uuid) from public, anon, authenticated;
grant execute on function public.touch_repo_activity(uuid) to service_role;

-- --- save_repo_activity ---------------------------------------------------
-- The Edge Function writing back what GitHub said. Granted to service_role
-- and nothing else, which is the whole security story of this table: a
-- student with their own access token cannot call it, so the counts on the
-- page are GitHub's and not theirs.
--
-- It replaces the row whole. There is no merge, because a partial answer
-- about who contributed is worse than a stale one — a member missing from a
-- half-written row reads as "wrote nothing".
--
-- `error` is validated by the CHECK rather than here: the list is the
-- constraint, and an unknown code is a bug in the function above, not
-- something a caller should be told how to fix.
--
-- `p_window_days` is int, not the column's smallint, and cast on the way in.
-- A JSON number from PostgREST casts to either, but int2 has no implicit
-- cast from int4, so a smallint parameter makes every hand-written call site
-- (and every pgTAP line below) write `14::smallint` or fail function
-- resolution outright. The column keeps smallint; the door is wider.

create or replace function public.save_repo_activity(
  p_project_id     uuid,
  p_repo           text,
  p_contributors   jsonb,
  p_last_commit_at timestamptz,
  p_window_days    int,
  p_error          text
)
returns public.repo_activity
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.repo_activity;
  v_current text;
begin
  -- `for share`, held to the end of this transaction, is what makes the
  -- check below mean anything. Without it the link is read, then the row is
  -- written, and a set_project_repo() committing in between deletes the
  -- cache only for this insert to put the old repository's row straight back
  -- (#91 review, second round). set_project_repo() updates this projects row,
  -- which a share lock blocks, so the two now take turns: if it got there
  -- first, this waits and then reads the new link; if this got there first,
  -- it waits and its delete runs after the insert.
  --
  -- `for share` rather than `for key share`: changing github_repo is not a
  -- key update, so a key-share lock would not block it.
  select github_repo into v_current
    from public.projects
   where id = p_project_id
     for share;
  if not found then
    raise exception 'Project not found';
  end if;

  -- The link can change while a refresh is in flight. The owner fixes a
  -- typo in the URL, or unlinks altogether, and this call arrives a second
  -- later still carrying the old repository's counts — so the team is shown
  -- somebody else's commits, and set_project_repo() having cleared the row
  -- is quietly undone. Jose's #91 review, point 3.
  --
  -- Returning null rather than raising, because nothing went wrong: the
  -- Edge Function did everything right and the world moved under it. The
  -- call site in index.ts already ignores what comes back — write() logs a
  -- failure and hands the caller the answer either way — so this needs no
  -- change on that side and cannot turn a stale write into a failed
  -- request.
  --
  -- `is distinct from` rather than `<>` so that the unlinked case is caught
  -- too: github_repo is '' and never null, but p_repo arrives from JSON and
  -- a null there would make `<>` yield null and fall straight through.
  --
  -- Before the CHECK constraints rather than after, since a payload aimed
  -- at a repository nobody is looking at any more is not worth validating.
  if p_repo is distinct from v_current then
    return null;
  end if;

  insert into public.repo_activity
    (project_id, repo, contributors, last_commit_at, window_days, fetched_at, error)
  values
    (p_project_id, p_repo, coalesce(p_contributors, '[]'::jsonb), p_last_commit_at,
     coalesce(p_window_days, 14)::smallint, now(), p_error)
  on conflict (project_id) do update
     set repo           = excluded.repo,
         contributors   = excluded.contributors,
         last_commit_at = excluded.last_commit_at,
         window_days    = excluded.window_days,
         fetched_at     = excluded.fetched_at,
         error          = excluded.error
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.save_repo_activity(uuid, text, jsonb, timestamptz, int, text)
  from public, anon, authenticated;
grant execute on function public.save_repo_activity(uuid, text, jsonb, timestamptz, int, text)
  to service_role;

commit;
