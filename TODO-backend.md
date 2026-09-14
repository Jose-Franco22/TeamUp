# Backend

The frontend (`frontend/`) is built against a mock API in `frontend/src/api/mockData.js` and
`frontend/src/api/client.js`. Those two files **are the contract** — `mockData.js` uses the exact
Postgres column names (snake_case) the real tables have, and `client.js` has a real (non-mock)
branch for every function already written against Supabase directly.

**Architecture: there is no separate backend server.** The frontend talks to Supabase directly via
`@supabase/supabase-js` (`frontend/src/lib/supabaseClient.js`). Access control is enforced by
Postgres Row Level Security policies, and the couple of operations that need to happen atomically
(creating a join request, accepting/declining one) are Postgres functions called via
`supabase.rpc(...)` instead of REST endpoints. See `supabase/` at the repo root:

- `supabase/01_auth_provisioning.sql` — trigger that creates a `public.users` row on first
  Microsoft sign-in, enforcing `@utrgv.edu`.
- `supabase/02_rls_policies.sql` — who can read/write which rows.
- `supabase/03_functions.sql` — `create_join_request`, `respond_to_join_request`,
  `project_member_count`, called from `client.js`.

Cutover: set `VITE_USE_MOCKS=false`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` in
`frontend/.env` (see `frontend/.env.example`). No frontend component changes are expected — they
only ever call `client.js`.

## Schema

Postgres DDL for the tables `mockData.js` mirrors — **these tables already exist** in the Supabase
project; this is documentation of what's live, not a script to (re-)run. Column names match the
mocks exactly; a few things don't show up in JS fixtures and are called out below.

- **IDs are `uuid`, not the `u-adan` / `p-parking` slugs in the mocks.** Those slugs exist only so
  the fixtures are readable — the frontend treats every id as an opaque string, so this doesn't
  touch any component.
- **`users.id` is set equal to the Supabase `auth.users.id`** (i.e. `auth.uid()`) by the
  provisioning trigger in `01_auth_provisioning.sql`, rather than being independently random. This
  is what lets every RLS policy just compare `auth.uid() = <fk column>` instead of joining through
  `auth.identities` on every check.
- **`users.email` is constrained to `@utrgv.edu`** — the enforcement point for "UTRGV students
  only," backed up by the provisioning trigger, which is the primary gate (see Auth below).
- **`microsoft_oid`** stores the Entra `oid` claim (Microsoft's stable per-tenant account id) —
  kept for reference/debugging, not used for RLS (see previous point).
- **`team_members.user_id` is the primary key**, not `(team_id, user_id)`. The "a student is on
  one team at a time" invariant is enforced by the schema itself this way, not just by the checks
  in `create_join_request`/`respond_to_join_request` — a second insert for the same `user_id`
  fails at the DB level regardless of which code path tries it.
- **`join_requests` has a partial unique index** on `(project_id, user_id) WHERE status = 'pending'`
  — the same backstop for "no duplicate pending request," enforced under concurrent requests
  rather than only checked-then-inserted in application code.
- `team_members.role` stays free text, matching the mocks — see "Known issue: two ways of naming a
  role" below. Not resolved here on purpose; it's a separate decision.

```sql
create extension if not exists pgcrypto; -- gen_random_uuid()

create table users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null unique
                       check (email ~* '^[^@]+@utrgv\.edu$'),
  microsoft_oid      text not null unique, -- Entra ID object id from the OIDC token
  name               text not null,
  bio                text not null default '',
  availability_hours smallint not null default 0 check (availability_hours >= 0),
  github_url         text not null default '',
  created_at         timestamptz not null default now()
);

create table skills (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique,
  category text not null check (category in ('Frontend', 'Backend', 'Data', 'Tools'))
);

create table user_skills (
  user_id  uuid not null references users(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  source   text not null check (source in ('manual', 'resume')),
  primary key (user_id, skill_id)
);

create table projects (
  id               uuid primary key default gen_random_uuid(),
  creator_id       uuid not null references users(id),
  title            text not null,
  description      text not null default '',
  team_size_target smallint not null check (team_size_target > 0),
  status           text not null default 'open' check (status in ('open', 'full')),
  created_at       timestamptz not null default now()
);
create index projects_status_idx on projects(status);

create table project_roles_needed (
  project_id      uuid not null references projects(id) on delete cascade,
  skill_id        uuid not null references skills(id),
  quantity_needed smallint not null check (quantity_needed > 0),
  primary key (project_id, skill_id)
);

-- One team per project, created alongside it.
create table teams (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects(id) on delete cascade,
  formed_at  timestamptz
);

-- user_id as the primary key enforces "one team per student, ever" at the DB level.
create table team_members (
  user_id   uuid primary key references users(id) on delete cascade,
  team_id   uuid not null references teams(id) on delete cascade,
  role      text not null,
  joined_at timestamptz not null default now()
);
create index team_members_team_id_idx on team_members(team_id);

create table join_requests (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now()
);
create unique index join_requests_one_pending_idx
  on join_requests(project_id, user_id) where status = 'pending';
create index join_requests_user_id_idx on join_requests(user_id);
```

## How the frontend gets its data — implemented

`client.js`'s real branch (status: sign-in confirmed working end to end against the live project —
see Status below; the data-fetching functions in the table are written but not yet individually
exercised) replaces every function that used to describe a REST endpoint:

| `client.js` function      | Real implementation                                              |
| -------------------------- | ------------------------------------------------------------------ |
| `getProjects` / `getProject` | `supabase.from('projects').select(...)` with embedded roles/team/members, gated by RLS |
| `getCurrentUser` / `updateCurrentUser` | `supabase.from('users')...eq('id', auth.uid())` |
| `getRequests`             | Plain `select` on `join_requests` — RLS alone limits rows to "my outgoing + incoming to my projects," no manual filter needed |
| `createJoinRequest`       | `supabase.rpc('create_join_request', ...)` |
| `respondToRequest`        | `supabase.rpc('respond_to_join_request', ...)` |
| `getMyTeam`                | `team_members` lookup by `auth.uid()`, then the same project composition, enriched with teammates' skills/availability |

`viewer_request_status` (null / `'pending'` / `'accepted'` / `'declined'`) is computed client-side
in `composeProject()` from one batched `join_requests` fetch, same semantics as the mock's
`viewerRequestStatus()`.

## Auth

Real sign-in (`frontend/src/auth/SessionContext.jsx`, `signInWithMicrosoft()`) calls
`supabase.auth.signInWithOAuth({ provider: 'azure' })`. Two layers enforce "UTRGV students only":

1. **Primary gate — Azure app registration.** Signing into portal.azure.com with a UTRGV account
   turned out to offer self-service app registration inside UTRGV's own Entra tenant (no IT
   ticket needed) — "Single tenant only - The University of Texas-Rio Grande Valley" under
   Supported account types. That's what's actually deployed: only accounts inside UTRGV's tenant
   can attempt sign-in at all, enforced by Azure itself, not just by our own check. (If that
   self-service option isn't available for a given account, the fallback is a personal/multitenant
   app registration plus the database check below as the *primary* gate instead of a backstop —
   see the git history on this file for that version of the instructions.)
2. **Backstop — the database.** `supabase/01_auth_provisioning.sql`'s trigger rejects any
   `@utrgv.edu`-mismatched email outright (and `users.email`'s `CHECK` constraint would catch it
   even if the trigger didn't), so a misconfigured app registration can't silently let a non-UTRGV
   account get an app account.

Supabase's Azure provider settings needs the **Azure Tenant URL** field set to
`https://login.microsoftonline.com/<directory-tenant-id>` (the GUID from the app's Overview page)
— leaving it blank points at the generic `common` endpoint, which a single-tenant app rejects.

**Gotcha that will bite again on a fresh setup:** Azure does not include the `email` claim in the
ID token by default, even when the `email` scope is requested — Supabase's Azure sign-in fails
with `Error getting user email from external provider` until you go to the app registration →
**Token configuration** → **Add optional claim** → token type **ID** → check **email** → accept
the prompt to also add the Microsoft Graph `email` permission. Not needed for `openid`/`profile`,
only `email`.

No manual `Authorization` header handling is needed anywhere — `supabase-js` attaches the session
JWT to every request itself, and every table/function decision below is keyed off `auth.uid()`.

## Public vs. authenticated data — enforced via RLS, not application code

Projects and their roles-needed are public recruiting info; who is actually on a team is not.
Guests (no session) can still browse — this is `supabase/02_rls_policies.sql`, not a check in
`client.js`:

- `projects`, `project_roles_needed`, `skills`, and `teams` all have an `anon`-readable SELECT
  policy.
- `team_members` has **no** `anon` policy at all — a guest's query returns zero rows, so no names,
  no `user_id`s, ever reach the client. `composeProject()` in `client.js` only returns a populated
  `members` array when there's a signed-in viewer.
- The public `member_count` a guest still needs comes from `project_member_count()`, a
  `SECURITY DEFINER` function that returns only a count (see `03_functions.sql`) — the one
  sanctioned way past the `team_members` restriction, because a count alone doesn't identify
  anyone.

The frontend already hides member names from guests in the UI (`MemberStrip.jsx`), but **that was
always a UX nicety, not the security boundary** — the boundary is the RLS policy above, which
holds even if a component had a bug.

## Rejecting invalid join requests — enforced in `create_join_request()`

`supabase/03_functions.sql`'s `create_join_request` rejects, in one transaction, with no side
effects:

- The project's creator requesting to join their own project.
- A user who already holds **any** `team_members` row, on any project — a student is on one senior
  project team at a time, full stop, not just barred from double-joining the same one. (This one
  check covers "already on this team" too, since `team_members.user_id` is globally unique.)
- A user who already has a `pending` request for that project (duplicate).

The frontend already disables the "Request to join" button and shows "Your project" / "You're on
this team" / "Already on a team" / "Request pending" for these cases using `viewer_request_status`
and the project's own `creator_id` / `members`, but **that's UX only** — a stale page, a modified
request, or a second tab still goes through `create_join_request`, which re-checks everything
server-side regardless of what the client believes.

## Accepting a join request — one transaction, `respond_to_join_request()`

`respond_to_join_request` in `03_functions.sql` is the one piece of business logic worth
over-explaining. On accept, in a single Postgres function call (which is one transaction — it
either fully commits or fully rolls back on the raised exception):

1. Insert a row into `team_members`, including `role` from the call (the project creator picks it
   at accept time; required — `team_members.role` is `not null`).
2. If that insert brings the roster count up to `team_size_target`, also update `projects.status`
   to `'full'` **and** set `teams.formed_at` to now.
3. Update the `join_requests` row's `status` to `'accepted'`.
4. **Also in the same transaction:** decline every other `pending` `join_requests` row for that
   `user_id`. Since a student can only be on one team, accepting them here makes any other pending
   request they have out unactionable — the creator on the other end can no longer accept it (the
   "already on a team" rejection above would fire), so leaving it `pending` forever would be
   misleading in that creator's incoming list. We cascade at accept time (write the other rows to
   `'declined'` immediately) rather than filter them out at read time, because a cascade fixes the
   data once, permanently, while a read-time filter would need to be re-applied by every future
   query that reads `join_requests`.

`for update` row locks on the request and team rows guard against two accepts racing each other
and overfilling a team.

### Known issue: two ways of naming a role

`project_roles_needed` identifies a role by `skill_id` (a foreign key into `skills`).
`team_members.role` is free text — whatever string got passed as `role` at accept time (today,
always a `skill_name` chosen from that project's `roles_needed`, but the column doesn't enforce
that). So the same role ends up represented two different ways: a normalized `skill_id` on one
table, an unvalidated string on the other. That's fine for display, but it means `team_members`
can't be reliably joined back to `skills`/`project_roles_needed` — a renamed skill, a typo, or a
future path that writes `role` from somewhere other than the accept flow will silently break that
link. Flag this before it corrupts any skill-coverage or team-composition metrics; we may want to
normalize `team_members.role` to a `skill_id` (or at least a `category`) reference instead of free
text.

## Status

Done, against the live project:

1. ~~Register an Entra ID app~~ — single-tenant, UTRGV only, via self-service registration.
2. ~~Enable the Azure provider in Supabase~~ — including the Azure Tenant URL and the `email`
   optional claim gotcha, both documented under Auth above.
3. ~~Run the three SQL files~~ (`01_auth_provisioning.sql`, `02_rls_policies.sql`,
   `03_functions.sql`) against the project.
4. ~~Fill in `frontend/.env`~~ and set `VITE_USE_MOCKS=false`.
5. A real `@utrgv.edu` sign-in has been confirmed working end to end (Microsoft redirect → back
   into the app → `public.users` row provisioned correctly).

Still open:

- Confirm a **non**-`@utrgv.edu` account is actually rejected (only the positive case has been
  tested so far).
- Exercise the rest of real-mode `client.js` while signed in — Browse loading real projects,
  Profile save/reload, sign out — and confirm a signed-out/incognito view of Browse shows projects
  without member names (the RLS boundary, not just a UI nicety).
- Project creation (`POST` a new project) still has no `client.js` function, RLS write policy, or
  UI — it's out of scope until that feature exists. `projects_select_all` is currently the only
  policy on that table.
