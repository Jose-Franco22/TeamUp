-- Link our GitHub repo and show each member's activity (issue #58). Run
-- after 37_deadline_reminders.sql. Nothing here depends on 38, 39 or 40,
-- and 41 is taken rather than 38 so it stays clear of the three migrations
-- open in PRs #87, #88 and #90 at the time of writing.
--
-- Three pieces:
--
--   1. `projects.github_repo` — the link itself, the owner's to set.
--   2. `public.repo_activity` — one row per project, holding what GitHub
--      last told us. A cache, not a record: it can be deleted at any time
--      and the next page view refills it.
--   3. Three functions, one per direction: the owner writes the link, a
--      member asks what to refresh, and the Edge Function (and only it)
--      writes the answer back.
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
--   and the adviser half of that sentence is the one thing in #58 that
--   cannot be written yet — see the policy below.
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
-- THE ADVISER IS MISSING FROM THIS POLICY, and that is deliberate rather
-- than forgotten. The issue asks for "team members and the adviser only",
-- but `adviser_requests` does not exist on this branch — it arrives with
-- #53 (PR #88) and #54 (PR #90), both open. A policy naming a table that is
-- not there would fail every pgTAP run from scratch, and guarding it with
-- a to_regclass() check would hide a rule the whole point of which is to be
-- readable. It follows in its own migration once #88 has merged, which is
-- also when there is an adviser to test it with.

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
begin
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found';
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
