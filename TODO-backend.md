# Backend TODO

The frontend (`frontend/`) is built against a mock API in `frontend/src/api/mockData.js` and
`frontend/src/api/client.js`. Those two files **are the contract** — `mockData.js` uses the
exact Postgres column names (snake_case) the real tables should have, and every function in
`client.js` documents the endpoint it expects (method, path, request/response shape) in a
comment directly above it. Read those before this file; this file calls out the parts that
aren't obvious from the mock code alone.

Cutover: set `VITE_USE_MOCKS=false` and `VITE_API_BASE` in `frontend/.env` once the API below
exists. No frontend component changes are expected — they only ever call `client.js`.

## Endpoints to implement

From `frontend/src/api/client.js`:

- `GET /api/projects`
- `GET /api/projects/:id`
- `GET /api/me`
- `PATCH /api/me`
- `GET /api/requests` → `{ incoming, outgoing }`
- `POST /api/projects/:id/requests`
- `PATCH /api/requests/:id` → body `{ status: 'accepted' | 'declined', role? }`
- `GET /api/me/team`

Response shapes should match what `buildProject()` and the other composition helpers at the
bottom of `mockData.js` return — those helpers exist specifically to document the joins each
endpoint needs to perform. That includes `viewer_request_status` (null / `'pending'` /
`'accepted'` / `'declined'`), computed from the *authenticated caller's own* `join_requests` rows
for that project — null for an unauthenticated caller. It drives the "Request to join" button
state on Browse (creator / already a member / pending request already exists), so it needs to be
present on both `GET /api/projects` and `GET /api/projects/:id`.

Each entry in `GET /api/requests`'s `incoming` array must also carry that project's
`roles_needed` (same shape as `buildProject()` produces it) — see the comment above
`projectRolesNeeded` in `mockData.js`. The creator picks a role from that list when accepting, so
the client needs it without a second fetch.

## Auth

The frontend currently uses a stub session (`frontend/src/auth/SessionContext.jsx`) that fakes
sign-in by picking a mock user and storing their id in `localStorage`. It's structured so
Supabase Auth (or whatever we land on) can replace it without touching any page component:

- Real requests should carry a `Authorization: Bearer <token>` header (the stub already sends
  `Bearer stub-<user_id>` — see `setAuthHeaderProvider` in `client.js`).
- The backend must verify that token server-side and derive the user id from it. **Never trust
  a client-supplied user id** for anything that mutates data or returns another user's private
  info.
- `/api/me`, `PATCH /api/me`, `/api/requests`, `POST .../requests`, `PATCH /api/requests/:id`,
  and `/api/me/team` all require a valid session → `401` otherwise.

## Public vs. authenticated data — enforce this server-side

Projects and their roles-needed are public recruiting info; who is actually on a team is not.
Guests (no auth token) should still be able to browse:

- `GET /api/projects` and `GET /api/projects/:id` must work **without** authentication.
- For an unauthenticated request, **omit member identities** from the response — no names, no
  `user_id`s, no `availability_hours` per member. Only return aggregate fields: `member_count`,
  `team_size_target`, and the full `roles_needed` list (roles/skills needed are meant to be
  public).
- For an authenticated request, return the full `members` array as `buildProject()` does today.

The frontend already hides member names from guests in the UI (`MemberStrip.jsx`), but **that is
a UX nicety, not a security boundary** — it only works if the API never sends the names down in
the first place. Don't rely on the client to redact anything.

## Rejecting invalid join requests

`POST /api/projects/:id/requests` must reject, with a `4xx` and no side effects:

- The project's creator requesting to join their own project.
- A user who is already on the project's roster (`team_members`) requesting again.
- A user who already holds **any** `team_members` row, on any project — a student is on one
  senior project team at a time, full stop, not just barred from double-joining the same one.
- A user who already has a `pending` request for that project (duplicate).

The mock version of `createJoinRequest` in `client.js` checks all four before creating the row —
match that order and those cases. The frontend already disables the "Request to join" button and
shows "Your project" / "You're on this team" / "Already on a team" / "Request pending" for these
cases using `viewer_request_status` and the project's own `creator_id` / `members`, but **that's
UX only**. The server must not trust it — a stale page, a modified request, or a second tab can
still send a request that the UI would have blocked, so the same checks have to be enforced
independently on the server using the authenticated caller's id, not anything the client sends.

## Accepting a join request must be one transaction

This is the one piece of business logic worth over-explaining. `respondToRequest` in
`client.js` (mock version) shows the expected behavior: when a request is accepted —

1. Insert a row into `team_members`, including `role` from the request body (the project creator
   picks it at accept time — see `PATCH /api/requests/:id` above).
2. If that insert brings the roster count up to `team_size_target`, also update
   `projects.status` to `'full'` **and** set `teams.formed_at` to now.
3. Update the `join_requests` row's `status` to `'accepted'`.

All three of these (roster insert with role, project status flip, `formed_at` timestamp) must
commit or roll back **together**, in a single DB transaction. A partial write — e.g. the roster
row lands but `projects.status` doesn't flip — would let a project silently accept more members
than its `team_size_target`, or leave a "full" team without a `formed_at` timestamp that other
parts of the UI (`Team.jsx`) rely on to show the team as locked in.

**Also in that same transaction:** decline every other `pending` `join_requests` row for that
`user_id`. Since a student can only be on one team, accepting them here makes any other pending
request they have out unactionable — the creator on the other end can no longer accept it (the
"already on a team" rejection above would fire), so leaving it `pending` forever would be
misleading in that creator's incoming list. We chose to **cascade at accept time** (write the
other rows to `'declined'` immediately) rather than filter them out at read time, because a
cascade fixes the data once, permanently, while a read-time filter would need to be re-applied by
every future endpoint that reads `join_requests` and would leave the stored `status` permanently
wrong. See the same cascade in the mock `respondToRequest` in `client.js`.

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
