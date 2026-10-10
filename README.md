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

## Testing

Every user story issue (label `user story`) lists the tests it needs under **Testing criteria**.
A story is done when those tests exist and pass in CI. All three suites run automatically on every
pull request (`.github/workflows/tests.yml`), and a pull request shouldn't merge while any fail.

| Suite | What it covers | Run it |
|---|---|---|
| Frontend | Validation logic, components and pages (Vitest + React Testing Library, mock API) | `cd frontend && npm test` |
| Resume parsing | The resume parser (`node --test`) | `cd resume-parsing && npm test` |
| Database | Constraints, RLS, triggers and RPC functions (pgTAP) | see below |

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
