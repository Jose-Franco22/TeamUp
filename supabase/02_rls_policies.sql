-- Row Level Security policies. Run after 01_auth_provisioning.sql.
--
-- General shape used throughout: guests (the `anon` role) can read public
-- recruiting info (projects, roles needed, skill taxonomy, team existence);
-- anything that would identify a specific person (names on a roster, a
-- user's own profile fields) requires the `authenticated` role. Writes to
-- projects/join_requests/team_members that involve multi-step business
-- logic are NOT exposed as direct table INSERT/UPDATE policies — they only
-- happen through the SECURITY DEFINER functions in 03_functions.sql, which
-- do their own authorization checks internally. No policy for a given
-- command on a given role means that command is denied by default under
-- RLS, so leaving INSERT/UPDATE off a table here is a deliberate "only the
-- function may do this," not an oversight.

-- --- users ---------------------------------------------------------------
alter table public.users enable row level security;

create policy "users_select_authenticated"
  on public.users for select
  to authenticated
  using (true);

create policy "users_update_own"
  on public.users for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- --- skills ----------------------------------------------------------------
-- Reference taxonomy, not sensitive — readable by everyone.
alter table public.skills enable row level security;

create policy "skills_select_all"
  on public.skills for select
  to anon, authenticated
  using (true);

-- --- user_skills -----------------------------------------------------------
alter table public.user_skills enable row level security;

create policy "user_skills_select_authenticated"
  on public.user_skills for select
  to authenticated
  using (true);

create policy "user_skills_manage_own"
  on public.user_skills for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- --- projects ----------------------------------------------------------------
-- Public recruiting info per TODO-backend.md: guests must be able to browse.
-- No direct insert/update policy: project creation goes through the
-- SECURITY DEFINER create_project() function in 03_functions.sql, same
-- pattern as join_requests/team_members below.
alter table public.projects enable row level security;

create policy "projects_select_all"
  on public.projects for select
  to anon, authenticated
  using (true);

-- --- project_roles_needed ---------------------------------------------------
-- Roles/skills needed are public recruiting info too.
alter table public.project_roles_needed enable row level security;

create policy "project_roles_needed_select_all"
  on public.project_roles_needed for select
  to anon, authenticated
  using (true);

-- --- teams -------------------------------------------------------------------
-- formed_at/existence is public (drives the "full" state on a public
-- project card); who's actually on the team is not — that's team_members.
alter table public.teams enable row level security;

create policy "teams_select_all"
  on public.teams for select
  to anon, authenticated
  using (true);

-- --- team_members --------------------------------------------------------------
-- The actual privacy boundary: no policy for `anon` at all, so a guest
-- querying this table gets zero rows — no names, no user_ids. The public
-- member_count aggregate is served separately via a SECURITY DEFINER
-- function (project_member_count in 03_functions.sql) that bypasses this
-- on purpose, since a count alone isn't identifying.
alter table public.team_members enable row level security;

create policy "team_members_select_authenticated"
  on public.team_members for select
  to authenticated
  using (true);

-- --- join_requests --------------------------------------------------------------
-- A user sees their own outgoing requests, and incoming requests to
-- projects they created — covers both halves of GET /api/requests in one
-- policy. All writes go through create_join_request/respond_to_join_request.
alter table public.join_requests enable row level security;

create policy "join_requests_select_own_or_incoming"
  on public.join_requests for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.projects p
      where p.id = join_requests.project_id
        and p.creator_id = auth.uid()
    )
  );
