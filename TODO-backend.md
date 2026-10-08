# Backend

> **Handoff — who does what.** The frontend is done and is not waiting on design decisions. Every
> feature below already works end to end against the mocks (`VITE_USE_MOCKS=true`), and
> `client.js` already contains the real Supabase call for each one. **What's left is the database
> side: a schema migration and six Postgres functions**, specified in full below.
>
> `supabase/` holds only what is already live (`01`–`03`). This document describes everything
> still missing — what each piece has to do and why, not how to write it. Start with
> [The original problems and what fixes them](#the-original-problems-and-what-fixes-them), then
> [What the backend still needs](#what-the-backend-still-needs) for the live-database state and
> the verification checklist.
>
> **The schema migration and the frontend deploy have to land together.** The migration drops
> `team_members.role` and changes `create_project`'s signature, so it breaks any frontend still
> running the pre-roles code — and the current frontend fails against the un-migrated database.
> Neither order is safe alone; pick a window and do both.
>
> Nothing in `frontend/` needs to change as part of that. If a signature below doesn't match what
> `client.js` sends, the SQL is what moves — `client.js` and `mockData.js` are the contract.

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

Those three are **already live**. Everything else this document describes still needs writing —
roughly a `04_roles_and_team_deletion.sql` and a `05_membership.sql`, plus a one-off seed for
`skills`. The numbering just has to keep them running after `03`.

Cutover: set `VITE_USE_MOCKS=false`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` in
`frontend/.env` (see `frontend/.env.example`). No frontend component changes are expected — they
only ever call `client.js`.

`frontend/.env` is currently on `VITE_USE_MOCKS=true` **on purpose**: the `roles` table and the
new functions don't exist yet, so real mode would fail immediately. Flip it to `false` once they
do.

## The original problems and what fixes them

Three problems started this work. They need very different amounts of backend help, so it's worth
being clear about which is which before reading the rest.

### 1. The project creator didn't appear on his own project — **no backend work**

Already fixed, entirely in the frontend. The database was never wrong: `create_project()` seated
the creator correctly, and `project_member_count()` on the affected project returned 1 the whole
time. The bug was `client.js` reading a one-to-one PostgREST embed as if it were an array, which
yields `undefined` silently — see
[the embed-shape gotcha](#gotcha-an-embedded-child-is-an-array-or-an-object). Nothing to do here;
it's listed so nobody goes looking for a schema cause.

### 2. Deleting a team — **a small amount of backend work, and there's a cheap option**

Rules: only the project's creator may delete, and only while nobody else is on the roster. Since
`create_project()` seats the creator on their own team, "no members" can only mean "nobody but the
owner" — any other reading makes a team undeletable forever.

Deleting should remove the **project**, not just the `teams` row. A team exists only to hold one
project's roster (`teams.project_id` is `UNIQUE`), so removing the team alone strands the project
with no way to accept anyone. Deleting the project cascades to `teams`, `team_members`,
`project_roles_needed` and `join_requests` through foreign keys that already exist.

There are two ways to allow it, and the cheap one may be enough:

- **A DELETE policy on `projects`.** Today `projects` has only a SELECT policy, and under RLS no
  policy for a command means denied — which is why the frontend can't delete anything at all. A
  single policy permitting DELETE where the caller is the creator *and* the roster count is at
  most one enforces both rules on its own, with no migration and nothing dropped. The frontend
  would then delete the row directly and let the cascade do the rest.
- **A `delete_team()` function**, matching how every other write in this app works. Slightly more
  code, but consistent with `create_join_request` / `respond_to_join_request`, and it can return a
  readable error instead of an RLS denial that looks like "row not found."

Either satisfies the requirement. The function is the better long-term fit; the policy is the
smaller ask if the priority is unblocking the frontend quickly.

### 3. A dropdown for roles as well as skills — **this is what drives the migration**

This one is the reason the rest of this document is long, so the tradeoff is worth stating plainly.

A role is *what a person does* on the team; a skill is *a technology they know*. Before this,
`project_roles_needed` identified a needed role by `skill_id`, while `team_members.role` was
unvalidated free text — the same concept stored two ways, with no reliable join between them. The
[Roles](#roles--resolved-one-roles-table) section covers the design.

Two ways to satisfy the original request:

- **The normalized version (what the frontend now expects).** A `roles` reference table that both
  `project_roles_needed.role_id` and `team_members.role_id` point at, with each role declaring the
  skill categories that may pair with it. This is what makes "we need a Project Manager"
  expressible, what stops "Frontend Developer · pandas", and what resolves the naming problem this
  document already flagged as a known issue. It requires the migration described below, including
  dropping `team_members.role`.
- **A frontend-only version, for contrast.** Roles could have been a hardcoded list feeding the
  two places a role is already stored as free text — the creator's own role, and the role picked
  when accepting someone. No schema change at all. But `project_roles_needed` has nowhere to put a
  role, so "roles needed" would stay keyed on skills: you could not advertise a role with no
  matching skill, and nothing would prevent a nonsensical role/skill pairing. The normalization
  problem would remain.

The normalized version was chosen deliberately. If the migration turns out to be too disruptive to
schedule, the frontend-only fallback is a real option — it would mean reverting the roles work in
`client.js`, `ProjectForm.jsx` and `mockData.js`, which is frontend effort, not backend.

### Everything else in this document

Editing a project, leaving a team, and removing a member came later and are not part of the
original three. They need backend work regardless of which path above is taken: `projects` and
`team_members` have no UPDATE or DELETE policies today, so the frontend cannot change or remove a
roster row by any route.

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
- **`team_members.role_id` and `project_roles_needed.role_id` both point at the `roles` table.**
  This resolves what used to be "Known issue: two ways of naming a role" — see "Roles" below.
  Getting here from the free-text column is a migration that still needs writing; the steps are
  spelled out under [What the backend still needs](#what-the-backend-still-needs).
- **`projects.team_size_target` should be checked `between 2 and 4`**, the product rule (a senior
  project team is 2–4 students), matching `MIN_TEAM_SIZE`/`MAX_TEAM_SIZE` in `client.js`. The live
  check is still `> 0` and needs tightening. Every existing project is already inside the range, so
  it will reject no rows.

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

create table roles (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  sort_order       smallint not null default 0,
  skill_categories text[] not null default '{}'   -- which skills.category values fit this role
);

create table project_roles_needed (
  project_id      uuid not null references projects(id) on delete cascade,
  role_id         uuid not null references roles(id),
  skill_id        uuid references skills(id),          -- nullable
  quantity_needed smallint not null check (quantity_needed > 0),
  primary key (project_id, role_id)
);
create index project_roles_needed_skill_id_idx on project_roles_needed(skill_id);

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
  role_id   uuid not null references roles(id),
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

Every function in `client.js` is written against Supabase already. This table is the full list of
what the database has to provide for each one — **if something here doesn't exist yet, that's the
work.** Sign-in is confirmed working end to end; the rest is written but not individually exercised
against the live project.

| `client.js` function | Real implementation | Defined in |
| --- | --- | --- |
| `getProjects` / `getProject` | `supabase.from('projects').select(...)` with embedded roles/team/members, gated by RLS | `02` (+ `roles` from `04`) |
| `getCurrentUser` / `updateCurrentUser` | `supabase.from('users')...eq('id', auth.uid())` | `02` |
| `getRequests` | Plain `select` on `join_requests` — RLS alone limits rows to "my outgoing + incoming to my projects," no manual filter needed | `02` |
| `getSkills` / `getRoles` | Plain `select` — no RPC needed. `getRoles` reads `id, name, sort_order, skill_categories` | `02` / **`04`** |
| `createJoinRequest` | `rpc('create_join_request')` | `03` |
| `respondToRequest` | `rpc('respond_to_join_request')` — takes `p_role_id uuid` | **`04`** (supersedes `03`) |
| `getMyTeam` | `team_members` lookup by `auth.uid()`, then the same project composition, enriched with teammates' skills/availability | `02` |
| `createProject` | `rpc('create_project')`, then reads the project back so both modes return the same composed shape | **`04`** |
| `updateProject` | `rpc('update_project')`, then reads the project back | **`04`** |
| `deleteTeam` | `rpc('delete_team')` | **`04`** |
| `leaveTeam` / `removeMember` | `rpc('leave_team')` / `rpc('remove_member')` | **`05`** |

Bold entries are the ones that don't exist in the live database yet.

`viewer_request_status` (null / `'pending'` / `'accepted'` / `'declined'`) is computed client-side
in `composeProject()` from one batched `join_requests` fetch, same semantics as the mock's
`viewerRequestStatus()`.

### Gotcha: an embedded child is an array *or* an object

PostgREST returns an embedded child as an **array** for a one-to-many relationship but as a single
**object** for a one-to-one — and it decides which by looking at whether the child's foreign key
column is unique. `teams.project_id` is `not null unique` (one team per project), so
`projects -> teams` is one-to-one and comes back as an object:

```
"teams": { "id": "...", "formed_at": null, "team_members": [ ... ] }   // not [ { ... } ]
```

This bit us: `composeProject()` read it as `row.teams[0]`, which silently yields `undefined`, so
every project in real mode composed with an empty roster, `member_count: 0` and `team_id: null` —
**a project creator appeared to be missing from their own project**, even though `create_project()`
had seated them correctly (`project_member_count()` on the same project returned 1). It also meant
guests never reached the `project_member_count()` call at all, since that branch is guarded on
`team` being non-null. `client.js` now normalizes both shapes through one `embeddedOne()` helper.

Worth re-checking whenever an embed is added. Everything else currently selected is unambiguous:
`creator`, `roles`, `skills` and `users` are many-to-one (objects, already handled);
`project_roles_needed`, `team_members` and `user_skills` are one-to-many (arrays) because their FK
columns aren't unique — `team_members.team_id` in particular is only indexed, since `user_id` is
the primary key.

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

- `projects`, `project_roles_needed`, `skills`, `roles`, and `teams` all have an `anon`-readable
  SELECT policy.
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

1. Insert a row into `team_members`, including `role_id` from the call (the project creator picks
   it at accept time; required — `team_members.role_id` is `not null`, and validated against
   `roles`). It also refuses outright if that student already holds a `team_members` row, so a
   stale request surfaces a readable error instead of a primary-key violation.
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

## Creating a project — `create_project()`

`frontend/src/pages/CreateProject.jsx` (a nav tab at `/projects/new`, behind the same
`ProtectedRoute` as Profile/Requests/Team) calls `createProject(...)` in `client.js`, which calls
`supabase.rpc('create_project', { p_title, p_description, p_team_size_target, p_creator_role_id,
p_roles_needed })`. In one transaction the function:

1. Inserts into `projects` (`creator_id = auth.uid()`, `status = 'open'`), rejecting a
   `p_team_size_target` outside 2–4.
2. Inserts one `teams` row for it (`formed_at = null`).
3. Inserts one `team_members` row for the caller with `role_id = p_creator_role_id`.
4. Inserts one `project_roles_needed` row per entry in `p_roles_needed`
   (`{ role_id, skill_id?, quantity_needed }[]`), validating each one — an unknown id, a
   duplicate `role_id`, or a quantity below 1 raises a readable error rather than letting a raw
   constraint violation reach the user.
5. **Checks that the roles listed fit the team.** The creator takes one seat, so a project has
   `team_size_target - 1` open seats — at most 3, since a team is at most 4. A single role can't
   exceed that (a `check (quantity_needed between 1 and 3)` column constraint), and the *sum*
   across roles can't either, which is checked in the function because a cross-row sum isn't
   expressible as a `CHECK`. Without this you could set a team of 3 and then advertise eight
   people. `CreateProject.jsx` shows a live "N of M open seats assigned" counter and blocks
   submit, but as always that's UX, not the boundary.
6. **Declines every `pending` join request the caller still has out.** Creating a project seats you
   on a team, and a student is only ever on one, so those requests are now unactionable — the same
   cascade, for the same reason, that `respond_to_join_request` does on accept. Without it they sit
   `pending` in someone else's incoming list and accepting one hits the `team_members` primary key.

And, matching `create_join_request`: **it rejects a caller who already holds any `team_members`
row.** `CreateProject.jsx` hides the form for such a user via `getMyTeam()`, but that's UX only.

`createProject()` reads the new project back with `getProject()` before returning. The RPC hands
back a bare `projects` row while mock mode returns the fully composed project; `mockData.js` +
`client.js` are the contract, so both modes have to return the same shape.

## Editing a project — `update_project()`

A project used to be write-once: a typo in the description, or a role you no longer needed, was
permanent. `update_project()` lets the **creator only** change the title, description,
`team_size_target`, their own `team_members.role_id`, and the whole roles-needed list.
`/projects/:id/edit` (`EditProject.jsx`), linked from the owner's view on `Team.jsx`.

`p_roles_needed` **replaces** the existing rows rather than being diffed — the form always submits
the complete set, so a replace is both simpler and exactly what the user sees. Nothing is lost:
`project_roles_needed` carries no timestamps and nothing references it.

Validation mirrors `create_project`, with one addition and one consequence:

- **The target can't drop below the people already seated.** What to do with a member who no longer
  fits is a question this function has no good answer to, so it refuses — remove them first, once
  removing a member is something the app can do at all — which `remove_member()` below provides,
  so this refusal is recoverable rather than a dead end.
- **Open seats are `team_size_target - member_count`**, not `- 1` as at creation, since by edit time
  other people may have joined. Raising the target on a project that had filled **reopens** it
  (`status` back to `'open'`, `formed_at` cleared); lowering it onto the current roster **closes**
  it. That's the same comparison `respond_to_join_request` makes when an accept fills a team.

`CreateProject.jsx` and `EditProject.jsx` share one `ProjectForm` component so the two screens
can't drift on any of these rules.

## Leaving and being removed — `leave_team()` / `remove_member()`

Until these existed, the only thing that removed a `team_members` row was deleting the whole
project. Since `team_members.user_id` is the primary key — one team at a time — a student who
joined the wrong team was locked out of the entire app, with no way out but asking the owner to
delete everything. Same class of trap as creating a project used to be.

- **`leave_team()`** — the caller removes themselves. A project's *creator* can't leave
  (`projects.creator_id` points at them, and a project with no creator isn't a state this schema
  has); for them the equivalent is `delete_team()`.
- **`remove_member(p_user_id)`** — the creator removes someone else. Removing yourself is refused
  for the same reason.

They cover disjoint cases: the owner is always on their own team, so "leave" is only ever a
non-owner acting on themselves and "remove" is only ever the owner acting on a non-owner. No rule
about who outranks whom is needed.

Both free the seat via `sync_project_fill_state()`, which recomputes `projects.status` and
`teams.formed_at` from the roster — the exact inverse of what `respond_to_join_request` does when
an accept fills a team. A project that had gone `'full'` reopens immediately, which is the real
remedy for losing someone: the owner can recruit a replacement the same day.

These also unblock two functions that previously had to refuse: `delete_team()` requires the owner
be alone, and `update_project()` won't shrink a team below its roster. Both are now reachable.

### Why leaving is not owner-approved

Deliberate. The person who wants to leave is usually on a team whose owner has stopped responding —
so an approval gate fails in exactly the case it exists for, while working fine for amicable
departures that don't need a gate. It would also hand one student unilateral control over another
student's semester, enforced by the database.

More fundamentally, software can't keep someone on a team. Blocking the exit produces a roster row
that lies about who's working on the project, and a seat the owner can't refill because a ghost
occupies it. The seat reopening immediately is what lets a team recover; the deliberate confirm
step on `Team.jsx` is what addresses someone leaving on a whim.

**Nothing tells the owner.** There is no notification system — a member leaving is visible only as
a changed roster on `Team.jsx` and a project that has gone back to `'open'`. Telling teammates is
left to the students, which the leave dialog says outright. If that turns out to be too quiet, an
in-app activity feed is the cheap version (one table, no infrastructure); real push or email would
need a service worker or a mail provider, neither of which this project has.

## Deleting a team — `delete_team()`

> This section assumes the function approach. A single DELETE policy on `projects` would also
> satisfy the requirement with less work — see
> [the original problems](#2-deleting-a-team--a-small-amount-of-backend-work-and-theres-a-cheap-option)
> for that comparison. The rules below apply either way.

`delete_team(p_team_id)` deletes **the project**, not just the `teams` row: a team exists only to
hold one project's roster (`teams.project_id` is `UNIQUE`), so removing the team alone would strand
the project with no way to ever accept anyone. The delete cascades to `teams`, `team_members`,
`project_roles_needed` and `join_requests` through their existing `ON DELETE CASCADE` FKs.

Two rules, enforced in the function and mirrored in the UI on `Team.jsx`:

1. **Only the project's creator may delete it.**
2. **The creator has to be the last member standing.** `create_project` seats the creator on their
   own team, so a team with literally zero members never exists — "no members" can only mean
   "nobody but the owner," and any other reading would make a team undeletable forever.

Pending join requests do *not* block deletion; they cascade away. An applicant's outgoing request
simply disappears from their "Sent by you" list, with nothing to say why. If that turns out to be
too quiet, the alternative is refusing to delete while any request is `pending` and making the
owner respond to them first.

This was the *first* way off a team, which is what made "a student is on one team at a time"
survivable at all: before it existed, creating a project locked the account out of ever creating or
joining anything else.

## Roles — resolved: one `roles` table

`project_roles_needed` used to identify a role by `skill_id`, while `team_members.role` was
unvalidated free text — the same role represented two ways, with no reliable join between the two
tables. Both now carry a `role_id` FK into `roles`, and `team_members.role` is gone
(Step 5 of the migration below; it seeds a `roles` row for every distinct free-text value first, so
the backfill is lossless).

**A role constrains which skills can be pinned to it.** `roles.skill_categories` lists the
`skills.category` values that belong to a role — Frontend Developer takes `{Frontend}`, Full-stack
takes `{Frontend,Backend}`, DevOps takes `{Backend,Tools}`. Without it the two dropdowns on a
roles-needed row were independent and "Frontend Developer · pandas" was storable. The rule lives on
the row rather than hardcoded in the frontend so `create_project`/`update_project` can enforce it
too, and so adding a role doesn't mean editing JS. The form filters the skill dropdown to the
chosen role and clears a skill that no longer fits when the role changes; pinning a skill stays
optional either way.

Ad-hoc roles the migration creates from old free-text values get all four categories — narrowing
something like "Algorithms" would be a guess that silently hides valid skills.

A role is *what a person does*; a skill is *a technology they know*. `project_roles_needed` is
keyed on `(project_id, role_id)` and its `skill_id` is **nullable** — a project asks for N of a
role and may optionally pin the key skill it wants for that role. That nullability is what makes
"we need a Project Manager" expressible; there is no PM entry in the skills taxonomy. Browse's
"Only show matches" filter reads that optional `skill_id`, so a role listed without one simply
doesn't participate in matching.

One consequence worth knowing about: the migration backfilled `project_roles_needed.role_id` from
each row's **skill category** (Frontend → Frontend Developer, Backend → Backend Developer, Data →
Data / ML, Tools → QA & Testing), because the old rows carried no role information at all. That's a
guess. Where two skills in one category collided on the new `(project_id, role_id)` key, the rows
were merged and their quantities summed. Existing project creators may want to correct their roles.

The accept dropdown in `Requests.jsx` offers **every** role, not only the ones a project listed —
what a project listed is a wishlist, not a constraint on who the creator may seat. "Roles needed"
is optional, so restricting the dropdown to it meant a project that listed none could never accept
anybody.

## What the backend still needs

Everything here is frontend-complete and verified against the mocks. The remaining work is all
database-side.

### Live database state, as probed on 2026-09-24

Verified against the project's REST endpoint with the anon key, so this is what's actually there —
not what anyone remembers doing:

| Object | State |
| --- | --- |
| `users`, `projects`, `teams`, `team_members`, `project_roles_needed`, `join_requests`, `skills` | exist |
| `skills` rows | **0 — the taxonomy was never seeded** (see below) |
| `projects` rows | 1 |
| `project_roles_needed` / `join_requests` rows | 0 |
| `roles` table | **missing** |
| `project_member_count`, `create_join_request`, `create_project` *(old `p_creator_role text`)* | live, from `03` |
| `create_project` *(new `p_creator_role_id uuid`)*, `update_project`, `delete_team`, `leave_team`, `remove_member` | **missing** |

Pointing `frontend/.env` at this database before the migration produces, on every page that loads
projects or roles:

```
Could not find a relationship between 'project_roles_needed' and 'roles' in the schema cache
```

That's `PROJECT_SELECT` in `client.js` asking for the `roles` embed. Expected, not a frontend bug —
the Landing page is unaffected because it fetches nothing.

**`skills` being empty is a separate problem** and easy to miss behind the error above: even once
the migration lands, the skill dropdown on the create/edit form will have nothing in it, and
Browse's "Only show matches" filter will match nothing. The taxonomy needs seeding — twelve rows
across the four categories, mirroring `frontend/src/api/mockData.js`, or whatever real set you
prefer. `user_skills` then needs populating per student before matching does anything useful.

### Already done against the live Supabase project

1. ~~Register an Entra ID app~~ — single-tenant, UTRGV only, via self-service registration.
2. ~~Enable the Azure provider in Supabase~~ — including the Azure Tenant URL and the `email`
   optional claim gotcha, both documented under [Auth](#auth) above.
3. ~~Run `01_auth_provisioning.sql`, `02_rls_policies.sql`, `03_functions.sql`~~.
4. ~~Fill in `frontend/.env`~~.
5. A real `@utrgv.edu` sign-in works end to end (Microsoft redirect → back into the app →
   `public.users` row provisioned correctly).

### 1. The roles migration — the risky part

**Back up the database first.** It rewrites two existing tables and **drops `team_members.role`**.
Read [Roles](#roles--resolved-one-roles-table) before starting.

**Step 1 — create and seed `roles`.** Columns are in [Schema](#schema). Seed the nine roles with
their `skill_categories`, which is what stops "Frontend Developer + pandas":

| Role | `sort_order` | `skill_categories` |
| --- | --- | --- |
| Project Manager | 10 | `{Tools}` |
| Frontend Developer | 20 | `{Frontend}` |
| Backend Developer | 30 | `{Backend}` |
| Full-stack Developer | 40 | `{Frontend,Backend}` |
| UI/UX Designer | 50 | `{Frontend}` |
| Data / ML | 60 | `{Data}` |
| QA & Testing | 70 | `{Tools}` |
| DevOps | 80 | `{Backend,Tools}` |
| Technical Writer | 90 | `{Tools}` |

Then seed one extra `roles` row per **distinct existing `team_members.role`** value that isn't one
of those nine, at `sort_order = 900` and with all four categories. Do this *before* Step 5 so that
backfill can never fail to find a match, and so no live data is lost. Add an `anon, authenticated`
SELECT policy, same as `skills`.

**Step 2 — add `project_roles_needed.role_id`, backfilled from skill category.** The old rows carry
no role information at all, so this is necessarily a guess: `Frontend → Frontend Developer`,
`Backend → Backend Developer`, `Data → Data / ML`, `Tools → QA & Testing`.

**Step 3 — collapse the collisions that backfill creates.** The old key was
`(project_id, skill_id)`; the new one is `(project_id, role_id)`. Two skills in one category (React
and Figma are both `Frontend`) now map to the same role and would violate the new key. Merge them:
keep one row per `(project_id, role_id)` and **sum** the quantities. Do this before adding the key.

**Step 4 — swap the key and loosen `skill_id`.** `role_id` becomes `NOT NULL`, `skill_id` becomes
nullable, primary key becomes `(project_id, role_id)`. Index `skill_id` separately — Browse's match
filter reads it.

**Step 5 — `team_members.role` (text) → `role_id` (FK).** Add the column, backfill by matching
`btrim(role)` against `roles.name` (total, thanks to Step 1), set `NOT NULL`, drop `role`. Guard
one edge: `role` is `NOT NULL` but could hold `''`, which Step 1 skips — park those on a default
role so `SET NOT NULL` can't fail.

**Step 6 — tighten the constraints.** `projects.team_size_target` from `> 0` to
`between 2 and 4`, and `project_roles_needed.quantity_needed` to `between 1 and 3` (a team is at
most 4 and the creator holds one seat, so no single role can need more than 3).

**After it runs, check two backfills by hand:**

- `project_roles_needed.role_id` — the Step 2 guess. Project creators can fix theirs in the edit
  form.
- The `sort_order = 900` roles from Step 1. They may want renaming or folding into the standard
  nine.

### 2. The functions

Six to write. All `SECURITY DEFINER` with `set search_path = public`, all granted to
`authenticated`, each body one transaction — the same shape as the existing
`respond_to_join_request`. Rules for each are in the sections linked below.

| Function | Notes |
| --- | --- |
| `create_project(p_title text, p_description text, p_team_size_target smallint, p_creator_role_id uuid, p_roles_needed jsonb) returns projects` | [spec](#creating-a-project--create_project). `p_roles_needed` elements are `{role_id, skill_id?, quantity_needed}` |
| `update_project(p_project_id uuid, p_title text, p_description text, p_team_size_target smallint, p_own_role_id uuid, p_roles_needed jsonb) returns projects` | [spec](#editing-a-project--update_project) |
| `delete_team(p_team_id uuid) returns void` | [spec](#deleting-a-team--delete_team) |
| `leave_team() returns void` | [spec](#leaving-and-being-removed--leave_team--remove_member) |
| `remove_member(p_user_id uuid) returns void` | same spec |
| `sync_project_fill_state(p_project_id uuid) returns void` | helper the last two call; recomputes `projects.status` and `teams.formed_at` from the roster |

Two existing functions also change signature, and the **old signatures must be dropped** —
PostgREST resolves overloads by argument name and will refuse an ambiguous call:

- `create_project` — `p_creator_role text` → `p_creator_role_id uuid`
- `respond_to_join_request` — `p_role text` → `p_role_id uuid`, plus an explicit "already on a
  team" check so a stale request raises a readable error instead of a `team_members` primary-key
  violation.

Validation every one of these owes the user: reject unknown ids, duplicate `role_id` in one
payload, a quantity below 1, a role/skill pair whose categories don't match, and a roles total that
exceeds the open seats. All of those are otherwise raw constraint violations in the user's face —
the frontend blocks them, but a client-side check is not a boundary.

### 3. Flip `frontend/.env` to `VITE_USE_MOCKS=false`

Then work through the checks below.

### 4. Verify, signed in

- Browse loads real projects, and **a creator appears on their own project's card.** That was a
  real bug — see [the embed-shape gotcha](#gotcha-an-embedded-child-is-an-array-or-an-object). It's
  fixed in `client.js`, but it's the fastest way to confirm the roster path works.
- Create a project → you're its first member, on `/team`, with your chosen role.
- Edit it → description, team size, your role, and roles-needed all round-trip.
- Request → accept → the applicant lands on the roster; the project flips to `full` at target.
- Leave / remove → the seat reopens and `status` goes back to `open`.
- Delete a team → refused while anyone else is aboard, works once the owner is alone.

### 5. Verify the security boundaries

- A **non**-`@utrgv.edu` account is actually rejected. Only the positive case has been tested.
- A signed-out/incognito Browse shows projects **without member names**. That's the RLS policy on
  `team_members`, not the UI hiding it — check the network response, not the screen.

### Notes

- **No RLS write policy was added for `projects`, and none is needed.** `create_project`,
  `update_project` and `delete_team` are `SECURITY DEFINER` and do their own authorization — the
  same template `respond_to_join_request` already uses.
- **`notifications` was considered and deliberately dropped.** Nothing tells an owner that a member
  left; see [Why leaving is not owner-approved](#why-leaving-is-not-owner-approved).
- **No way to remove yourself as owner** other than deleting the team, and no way to transfer
  ownership. Both are fine for now; flagged in case the scope grows.
