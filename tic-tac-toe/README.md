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
npm test
```

Every `*.test.js` file spawns its own real server process against that
same database - there's no mocking of the HTTP layer or the DB.

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

Using the [Railway CLI](https://docs.railway.com/guides/cli), from this
folder:

```
railway link                # select this project/service if not already linked
railway add --database postgres
railway variables --set DATABASE_URL='${{Postgres.DATABASE_URL}}' --service tic-tac-toe
```

This provisions a Postgres plugin in the project and points this
service's `DATABASE_URL` at it. Railway intentionally doesn't
auto-provision billed infrastructure just from a git push - this has to
be a deliberate step, but scripting it here means it's a copy-pasteable
command rather than a "remember which dashboard buttons to click" task.
