# Tic-Tac-Toe

First-pass prototype for the board game rules engine, now with async
multiplayer: lobbies, per-slot invite links, and a WebSocket live
channel. See [`docs/architecture.md`](../docs/architecture.md) for the
design behind all of it.

## Running locally

Requires a reachable Postgres - the server persists lobby/game state
there and fails fast on startup if it can't connect (see `db.js`).

```
docker compose up -d   # starts a local Postgres on localhost:5432
npm install
npm start
```

Then open `http://localhost:3000`. `DATABASE_URL` defaults to
`postgres://postgres:postgres@localhost:5432/tictactoe` (matching
`docker-compose.yml`) if unset - only override it if you're pointing at
something else.

## Testing

```
docker compose up -d   # the test suite needs the same reachable Postgres
npm install             # first time only - also downloads Playwright's Chromium
npm test
```

Every `*.test.js` file spawns its own real server process against that
same database - there's no mocking of the HTTP layer or the DB.
`browser.test.js` goes one step further and drives an actual Chromium
instance via Playwright (a devDependency only - it never touches the
Dockerfile or the deployed image) to cover `client.js`'s rendering and
live-update behavior, which the other test files can't reach since they
only exercise the HTTP/WS API directly.

## Environment variables

- `PORT` - defaults to `3000`.
- `DATABASE_URL` - Postgres connection string. For local dev it defaults
  to the `docker-compose.yml` database; on Railway it must be set
  explicitly (see below).

## Railway setup: attaching Postgres

This is a **one-time step per Railway environment**, not something to
redo on every deploy - once `DATABASE_URL` is set on the service it
persists across every future push automatically. If it's ever missing
(a fresh environment, a recreated project), the server fails fast on
startup and shows up as a failed deployment in Railway's dashboard - it
can't silently ship broken, so there's no risk of not noticing.

Via the Railway dashboard:

1. Open the `board-game-engine` project and click **New** → **Database**
   → **Add PostgreSQL**. This provisions a Postgres service in the
   project.
2. Open the new Postgres service, go to its **Variables** (or
   **Connect**) tab, and copy its connection string (usually shown as
   `DATABASE_URL` or `DATABASE_PUBLIC_URL`).
3. Open the `tic-tac-toe` service's **Variables** tab, add a new
   variable named `DATABASE_URL`, and paste that connection string in
   (Railway may also offer a "reference another service's variable"
   option here instead of pasting a static value - either works).
4. Redeploy the `tic-tac-toe` service if it doesn't happen
   automatically after saving the variable.

Railway intentionally doesn't auto-provision billed infrastructure just
from a git push - attaching a database has to be a deliberate step you
take once in the dashboard.
