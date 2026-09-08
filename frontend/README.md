# TeamUp — frontend

React + Vite web client for the TeamUp senior project.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

It runs against mock data out of the box, so you do not need the backend
to work on the UI.

## Switching to the real API

Copy `.env.example` to `.env` and set:

```
VITE_USE_MOCKS=false
```

Nothing else changes. Every component calls `src/api/client.js`, and that
file is the only place that knows whether data comes from mocks or from
the server. Vite proxies `/api` to `http://localhost:3000` in development,
so there is no CORS setup needed.

## Layout

```
src/
  api/
    client.js      All network calls. The mock/real switch lives here.
    mockData.js    Fixture data using the exact database column names.
  auth/            Session context and the protected-route wrapper.
  components/      Shared pieces used by more than one page.
  pages/           One file per route.
  styles.css       All styling, organised by section.
```

## Routes

| Path       | Access             | Notes                                   |
| ---------- | ------------------ | ---------------------------------------- |
| /          | Public             | Landing page                            |
| /login     | Public             | Mock sign-in (pick any seeded user)     |
| /browse    | Public             | Guests see projects/roles, not members  |
| /profile   | Signed in          | Redirects guests to /login              |
| /requests  | Signed in          | Redirects guests to /login              |
| /team      | Signed in          | Redirects guests to /login              |

## Endpoints the backend needs to provide

| Method | Path                        | Returns                        |
| ------ | --------------------------- | ------------------------------ |
| GET    | /api/projects               | Projects with roles and roster |
| GET    | /api/projects/:id           | One project                    |
| GET    | /api/me                     | Current user with skills       |
| PATCH  | /api/me                     | Updated user                   |
| GET    | /api/requests               | `{ incoming, outgoing }`       |
| POST   | /api/projects/:id/requests  | Created join request           |
| PATCH  | /api/requests/:id           | Updated join request           |
| GET    | /api/me/team                | Team with members, or null     |

The shapes are documented by the fixtures in `mockData.js` — matching
those exactly means the frontend needs no changes when the API lands.

## Notes

- Accepting a request must add the roster row, and flip the project to
  `full` plus set `teams.formed_at` when the roster reaches
  `team_size_target`. Do that in one transaction on the server.
- Auth is stubbed, not real: `src/auth/SessionContext.jsx` fakes a
  session by letting you pick any seeded user on `/login` and persisting
  that choice in `localStorage`. It's structured so a real provider
  (Supabase Auth) can replace it without changing any page — see the
  comments in that file and in `client.js`'s `setSessionUserId` /
  `setAuthHeaderProvider`.
- The public/guest split on `/browse` (member names, availability hidden
  from signed-out visitors) is UX only for now. The real API must not
  send that data to unauthenticated requests in the first place — see
  `TODO-backend.md`.
- "Add a skill" and "Import from resume" are not implemented.
