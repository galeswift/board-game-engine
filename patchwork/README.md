# Patchwork

Second board-game-engine prototype. Backend plumbing (async lobbies,
per-slot invite links, a WebSocket live channel, Postgres persistence)
is now at parity with `tic-tac-toe/`'s — ported wholesale, see
[`docs/patchwork-next-steps.md`](../docs/patchwork-next-steps.md) for the
full status. Real Patchwork rules (asymmetric, time-track-driven turn
order, a per-player button economy, real scoring) are implemented in
`gameDefinition.js`, expressed against
[`packages/rules-engine-core`](../packages/rules-engine-core) - the
generic phases/command/event engine from
[`docs/architecture.md`](../docs/architecture.md) Section 12, which
Patchwork was picked as the second proof-of-concept to stress-test.

The frontend is a Vite/React app in [`web/`](web/) — a like-for-like
port of the old vanilla-JS client's behavior (create local/multiplayer
games, join by invite link, live board updates), not a Patchwork UI yet.
Kept as its own npm project so React/Vite dependencies never enter the
server's own `package.json` or its Dockerfile's production stage.

## Running locally

Requires a reachable Postgres - the server persists lobby/game state
there and fails fast on startup if it can't connect (see `db.js`).

```
docker compose up -d   # starts a local Postgres on localhost:5433
npm install
npm run build           # builds web/ into web/dist, which server.js serves
npm start
```

Then open `http://localhost:3000`. `DATABASE_URL` defaults to
`postgres://postgres:postgres@localhost:5433/patchwork` (matching
`docker-compose.yml` - host port `5433`, not tic-tac-toe's `5432`, so
both projects' local Postgres containers can run at the same time) if
unset - only override it if you're pointing at something else.

To iterate on the frontend with hot reload instead of a full rebuild,
run `npm --prefix web run dev` in a second terminal (Vite's dev server
proxies nothing on its own - point it at a running `npm start` backend,
or just rebuild with `npm run build` after each change for now).

## Testing

```
docker compose up -d   # the test suite needs the same reachable Postgres
npm install             # first time only - also downloads Playwright's Chromium
npm run build           # browser.test.js needs a real web/dist to serve
npm test
```

Every `*.test.js` file spawns its own real server process against that
same database - there's no mocking of the HTTP layer or the DB.
`browser.test.js` drives an actual Chromium instance via Playwright (a
devDependency only - it never touches the Dockerfile or the deployed
image) to cover the React client's rendering and live-update behavior,
which the other test files can't reach since they only exercise the
HTTP/WS API directly.

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

`patchwork` needs its **own** Postgres plugin, separate from
tic-tac-toe's - same reasoning as why each game folder is an
independent Railway service with its own lifecycle (see the root
`CLAUDE.md`).

Via the Railway dashboard:

1. Open the `board-game-engine` project and click **New** → **Database**
   → **Add PostgreSQL**. This provisions a *second* Postgres service in
   the project (tic-tac-toe's Postgres service should already exist from
   its own setup - don't reuse it here).
2. Open the new Postgres service, go to its **Variables** (or
   **Connect**) tab, and copy its connection string (usually shown as
   `DATABASE_URL` or `DATABASE_PUBLIC_URL`).
3. Open the `patchwork` service's **Variables** tab (create the service
   first via **New** → **GitHub Repo** if it doesn't exist yet), add a
   new variable named `DATABASE_URL`, and paste that connection string
   in (Railway may also offer a "reference another service's variable"
   option here instead of pasting a static value - either works).
4. Redeploy the `patchwork` service if it doesn't happen automatically
   after saving the variable.

### Root Directory / Dockerfile path

Since the `packages/rules-engine-core` retrofit
(`docs/patchwork-next-steps.md`), `Dockerfile`'s build context is the
**repo root**, not `patchwork/` - it needs to `COPY` files from
`packages/`, outside this folder. That means the service's Railway
settings need **both** of these (Root Directory alone isn't enough -
Railway's default Dockerfile discovery only looks at the top of Root
Directory, not subfolders):

1. **Settings → Root Directory**: `.` (the repo root) - this is what
   becomes the Docker build context.
2. **Settings → Build → Dockerfile Path**: `patchwork/Dockerfile` -
   tells Railway which file, inside that root-directory context, is
   the actual Dockerfile. This is a dedicated field in the Settings UI,
   not an environment variable.

Verify locally before changing these on a live service:
`docker build -f patchwork/Dockerfile -t patchwork-test .` from the
repo root.

Railway intentionally doesn't auto-provision billed infrastructure just
from a git push - attaching a database has to be a deliberate step you
take once in the dashboard.
