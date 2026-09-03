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
  components/      Shared pieces used by more than one page.
  pages/           One file per route.
  styles.css       All styling, organised by section.
```

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
- Auth is not wired up yet; the current user is hardcoded in
  `mockData.js` as `CURRENT_USER_ID`.
- "Add a skill" and "Import from resume" are not implemented.
