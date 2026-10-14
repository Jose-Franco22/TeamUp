# TeamUp

A skill-based team formation platform for CSCI 4390 senior projects. TeamUp helps students find and form senior project teams based on skills, interests, and availability — instead of the current ad-hoc process of GroupMe messages and word-of-mouth.

## Team

- Adan Barrera
- Nicolas Guerra
- Jose Franco Garza
- Alexis Covarrubias

Faculty Adviser: Erik Enriquez

## Project Overview

Students currently have no structured way to find senior project teammates whose skills, interests, and availability complement their own. TeamUp solves this with:

1. **Student profiles** — skill tags, interests, and availability, populated manually or via resume parsing
2. **Project postings** — students with an idea can list needed roles and team size
3. **Matching engine** — recommends projects to people and people to projects based on skill-gap coverage and interest overlap
4. **Team formation workflow** — join requests, accept/decline, and a roster that locks once a team hits target size

See `/docs` for the full project proposal.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (Vite) |
| Backend | Supabase — no separate server; access control is Postgres Row Level Security, and the few operations that must be atomic (join requests) are Postgres functions called via `supabase.rpc(...)` |
| Database | PostgreSQL (via Supabase) |
| Resume parsing | LLM-based extraction (Google Gemini API, free tier) |
| Auth | Supabase Auth — Microsoft/Entra ID sign-in, restricted to UTRGV's tenant so only `@utrgv.edu` accounts can sign in |
| Hosting | Vercel (frontend), Supabase (database/auth/backend logic) |

## Repo Structure

```
/frontend         React app (Vite)
/supabase         RLS policies, auth-provisioning trigger, and RPC functions (SQL)
TODO-backend.md   Schema reference and Supabase implementation notes
README.md
```

## Getting Started

### Prerequisites
- Node.js (LTS version)
- npm or yarn
- Git

### Setup

```bash
# Clone the repo
git clone https://github.com/<org-or-user>/teamup-csci4390.git
cd teamup-csci4390

# Install frontend dependencies
cd frontend
npm install
```

### Environment Variables

Copy `frontend/.env.example` to `frontend/.env`. The defaults (`VITE_USE_MOCKS=true`) run the app
against fixture data with no further setup — good enough for UI work. To run against the real
Supabase project instead, set `VITE_USE_MOCKS=false` and fill in `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` (Supabase project settings → API) — see `TODO-backend.md` for the full
Supabase setup (schema, RLS policies, Microsoft/Entra sign-in). Never commit `.env` — it's already
covered in `.gitignore`.

## Admin access (#36)

Apply `supabase/18_admin_access.sql` after the earlier numbered SQL files, followed
by `supabase/19_admin_dashboard.sql`, before running this frontend against Supabase.
The first adds `users.is_admin` (false for every existing/new account), protects
role changes, and installs the admin RLS policies.

An instructor first signs in with their UTRGV Microsoft account. A database
administrator can then grant access through the Supabase SQL editor:

```sql
-- Replace with the instructor's actual email, then confirm the returned row.
update public.users
set is_admin = true
where email = 'instructor@utrgv.edu'
returning id, email, is_admin;
```

Sign out and back in to load the role. Admins land on `/admin`, with admin
navigation and no student onboarding or team participation. Admin access cannot
be changed through a profile form or browser API, including by an admin. Remove
any existing student membership, owned project and pending join requests before
promoting a student account. #36 supplies the protected navigation and server
guard (`require_admin()`); #37 adds the dashboard and read-only detail views.

Public project listings and team existence remain recruiting information. Any
signed-in student can read team rosters, so they can see who is on a team before
asking to join; admin accounts are never included. Guests get seat counts only,
for every project in one `project_member_counts(uuid[])` call.
Requests remain visible to their requester, the project owner, and admins.
Instructor profiles and skills are excluded from student queries/matching.

For local mock testing, use `VITE_USE_MOCKS=true` and choose **Course Instructor**
under **Administrators** on the sign-in screen. Existing student fixtures keep
their student roles. No production account is promoted by the migration.

## Admin dashboard (#37)

`/admin` lists every team with its members, roles, seats filled and status, plus
every non-admin student with no team membership and their pending requests.
Summary counts show formed teams (`status = full`), open teams and unplaced
students. Students with no requests still appear in the unplaced list.

Click a team or a request's project name to open `/admin/teams/:teamId`. Click
any student's name to open `/admin/students/:studentId`, including students
already on a team. These views show project/roster details or student profile,
skills, current team and pending requests. They do not change student data.
Use **Refresh** on the dashboard to reload formation progress.

`supabase/19_admin_dashboard.sql` supplies `admin_dashboard()`,
`admin_team_details(uuid)` and `admin_student_details(uuid)`. Each RPC checks
`require_admin()` before reading data; students and guests cannot access the
admin views through direct API calls. Apply it after `18_admin_access.sql`.

In mock mode, **Course Instructor** starts with 1 formed team, 3 open teams,
and 6 unplaced students. Dashboard, detail and permission tests run with
`cd frontend && npm test`; the database suite automatically includes
`supabase/tests/admin_dashboard.test.sql`.

## Join request notifications (#26)

Apply `supabase/23_join_request_notifications.sql` after `22`. When someone asks to join a
project, its creator gets an in-app notice naming them, with a link to `/requests`, and the
Requests tab shows how many requests are waiting. Email copies need a one-time Edge Function and
webhook setup — see [Email notifications in TODO-backend.md](TODO-backend.md#email-notifications).

## Withdrawing a join request (#33)

Apply `supabase/24_withdraw_join_request.sql` after `23`. Each pending request under **Sent by
you** on the Requests page has a Withdraw button. A withdrawn request shows as withdrawn to the
student, drops out of the creator's list (and their unread alert for it is cleared), and the
student can ask to join the same project again later.

## Deadlines, milestones and admin placement (#38, #39)

Apply `supabase/26_milestones.sql`, `supabase/27_admin_placement.sql`, then
`supabase/28_milestone_messages.sql`, after `24`. Each milestone can carry an optional message
explaining what's expected. Admins add
milestones on the **Milestones** tab (`/admin/milestones`), and can mark one as the team formation deadline. After it, students can't
post projects, send requests, leave or remove members. Students see what's coming up in a banner at
the top of every page. On a student's admin page, an admin can assign them to a team with an open
seat, move them to another team, or remove them, even after the deadline. Each change notifies the
people affected and is listed under **Recent admin changes** on `/admin`. TODO-backend.md has the
details, next to the leaving and removing rules.

## Testing

Every user story issue (label `user story`) lists the tests it needs under **Testing criteria**.
A story is done when those tests exist and pass in CI. All four suites run automatically on every
pull request (`.github/workflows/tests.yml`), and a pull request shouldn't merge while any fail.

| Suite | What it covers | Run it |
|---|---|---|
| Frontend | Validation logic, components and pages (Vitest + React Testing Library, mock API) | `cd frontend && npm test` |
| Resume parsing | The resume parser (`node --test`) | `cd resume-parsing && npm test` (run `npm install` in `frontend/` first, since it shares code from there) |
| Database | Constraints, RLS, triggers and RPC functions (pgTAP) | see below |
| Edge Functions | What the `notify-email` function sends (`node --test`) | `node --test supabase/functions/*/*.test.js` |

Use `npm run test:watch` in `frontend/` to re-run tests as you edit.

### Database tests

`supabase/tests/run.sh` builds a throwaway database on plain Postgres: a small stand-in for
Supabase's `auth` schema, the original tables, then **every `supabase/NN_*.sql` file in order**,
exactly as the live project got them. It then runs each `supabase/tests/*.test.sql` file. It never
touches the real Supabase project. A new numbered SQL file is picked up automatically, so if it
doesn't apply cleanly on top of the others, CI fails.

The easiest way to run it locally is Docker, with no Postgres install needed (run from the repo root):

```bash
docker run -d --name teamup-pg -e POSTGRES_PASSWORD=postgres -v "$PWD:/repo" postgres:16
docker exec teamup-pg sh -c 'apt-get update -qq && apt-get install -y -qq postgresql-16-pgtap'
docker exec -e PGUSER=postgres teamup-pg /repo/supabase/tests/run.sh          # all tests
docker exec -e PGUSER=postgres teamup-pg /repo/supabase/tests/run.sh profile  # files matching "profile"
```

(The first two lines are one-time setup. Afterwards, `docker start teamup-pg` and run the last line.)

### Writing a test for a story

- Start the file with the issue it covers, e.g. `// Issue #17 — …`, and name each test after the
  behavior from the issue's testing criteria.
- **Frontend:** put `Thing.test.jsx` next to `Thing.jsx`. Tests run against the mock API by default.
  See `src/auth/SessionContext.test.jsx` for testing real (Supabase) mode with a fake client.
- **Database:** add `supabase/tests/<topic>.test.sql`, wrapped in `begin; select plan(N); … select * from finish(); rollback;`.
  `tests.sign_in_with_microsoft(email)` creates a student, and `tests.authenticate_as(id)` runs the
  rest of the test as them through RLS (see `supabase/tests/harness/02_helpers.sql`).
- A validation rule lives in two places: `frontend/src/lib/validation.js` and a CHECK constraint in
  SQL. Change both, and test both.

## Workflow

- Work happens on feature branches, merged into `main` via pull request (at least one teammate reviews before merging)
- Weekly sprints tracked on the GitHub Projects board
- Two weekly check-ins: a short blocker sync and a longer working session

## License

Coursework project for CSCI 4390 — not currently licensed for outside use.
