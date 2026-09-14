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

## Workflow

- Work happens on feature branches, merged into `main` via pull request (at least one teammate reviews before merging)
- Weekly sprints tracked on the GitHub Projects board
- Two weekly check-ins: a short blocker sync and a longer working session

## License

Coursework project for CSCI 4390 — not currently licensed for outside use.
