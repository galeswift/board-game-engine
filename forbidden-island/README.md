# Forbidden Island (bootstrap)

Third prototype: eventually a Forbidden Island implementation used to
stress-test the rules engine's handling of asymmetric player roles,
always-legal interrupt actions, and cooperative win/loss conditions (see
the root [docs/architecture.md](../docs/architecture.md), Section 12).

Right now this folder bootstraps the phase structure on top of
`packages/rules-engine-core` — `lobby` → `setup` → `mainLoop` →
`victory`/`defeat` — plus a **fabricated playthrough** of `mainLoop`'s
turn structure: 3 placeholder actions, then draw 2 (fake) treasure
cards, then draw (fake) flood cards, then the next player's turn. Water
level, treasures found, and whether the island collapses on a given
turn are just numbers pushed around by the seeded RNG — there's no
island, no tiles, no roles, no real decks. It exists to exercise the
turn/RNG/win-loss-transition shape of the real game before any of that
real state is built. No lobby/multiplayer join flow yet either; state
lives in memory and resets on every restart (or via the "New Game"
button).

The frontend is a Vite/React app under `web/` (same split as
`patchwork/web/` - kept as its own npm project so React/Vite deps never
enter the server's production Dockerfile stage); `server.js` serves its
built output from `web/dist`.

## Running locally

Backend:

```
cd forbidden-island
npm install
npm start
```

Frontend, in a second terminal (proxies `/api` to `http://localhost:3000`,
so the backend above must already be running):

```
cd forbidden-island/web
npm install
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`), click
"Start Game," and play through a fabricated game: take up to 3 actions
per turn, draw treasure cards (may raise the water level or find a
treasure), draw flood cards (may end the game), repeat until "victory"
(4 treasures found) or "defeat" (the island collapses).

To run it as it deploys - one server, no separate dev proxy - build the
frontend first: `npm run build` (from `forbidden-island/`) then
`npm start`, and open `http://localhost:3000` directly.

### Local Postgres (for upcoming persistence work)

```
cd forbidden-island
docker compose up -d
```

Same pattern as `tic-tac-toe/`'s and `patchwork/`'s `docker-compose.yml`:
this stands up a local Postgres only, not the app itself - `npm start`
still runs the Node process directly on `http://localhost:3000`, same as
above. Nothing in forbidden-island reads or writes this database yet
(no `db.js`, no schema) - it's provisioned ahead of that work so the
port collides with nothing else (tic-tac-toe uses `5432`, patchwork
`5433`, this uses `5434`) and the app can pick it up ready-configured
once persistence lands. `docker compose down` stops and removes it.

To build/run the production Docker image itself (frontend build +
server, no dev proxy, no Postgres) instead of using `npm start`:

```
docker build -f forbidden-island/Dockerfile -t forbidden-island .
docker run -p 3000:3000 forbidden-island
```
(run from the repo root, not from inside `forbidden-island/` - see the
Railway section below for why).

## Tests

```
npm test
```

## Railway setup: Root Directory / Dockerfile Path

`Dockerfile`'s build context is the **repo root**, not `forbidden-island/`
- it needs to `COPY` files from `packages/`, outside this folder. That
means the service's Railway settings need **both** of these (Root
Directory alone isn't enough - Railway's default Dockerfile discovery
only looks at the top of Root Directory, not subfolders):

1. **Settings → Root Directory**: `.` (the repo root) - this is what
   becomes the Docker build context.
2. **Settings → Build → Dockerfile Path**: `forbidden-island/Dockerfile`
   - tells Railway which file, inside that root-directory context, is
   the actual Dockerfile. This is a dedicated field in the Settings UI,
   not an environment variable.

Verify locally before changing these on a live service:
`docker build -f forbidden-island/Dockerfile -t forbidden-island-test .`
from the repo root.

No database plugin is needed - this bootstrap has no persistence yet.
