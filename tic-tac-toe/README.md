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
- `DATABASE_URL` - Postgres connection string. Railway's Postgres plugin
  sets this automatically when attached to this service; for local dev
  it defaults to the `docker-compose.yml` database.
