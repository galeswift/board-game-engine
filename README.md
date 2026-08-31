# board-game-engine

Prototypes for a board game rules engine, one folder per game:

- **`tic-tac-toe/`** — deployable now, and the most advanced of the
  three: a mobile-friendly web UI plus async multiplayer (lobbies,
  per-slot invite links, a WebSocket live channel) with state persisted
  in Postgres. See [`tic-tac-toe/README.md`](tic-tac-toe/README.md) for
  local setup.
- **`patchwork/`** — deployable now, backend at parity with
  tic-tac-toe's (async multiplayer, WebSocket live channel, Postgres
  persistence) and a Vite/React frontend, but still running
  tic-tac-toe's *rules* underneath — real Patchwork rules aren't built
  yet. See [`patchwork/README.md`](patchwork/README.md) for local setup.
- **`forbidden-island/`** — not yet implemented.

Each folder is self-contained and deployable independently — no shared
package, no shared build step across folders. `tic-tac-toe/` and
`patchwork/` each carry their own `ws`/`pg` dependencies and their own
Postgres requirement, never shared between them; `forbidden-island/`
remains zero-dependency until it has a reason not to be.

## Project docs

- **[`docs/architecture.md`](docs/architecture.md)** — the full design
  plan: command/event execution model, deterministic replay, phases,
  player state, and why ECS was dropped in favor of plain state objects.
- **[`CLAUDE.md`](CLAUDE.md)** — short project brief that Claude Code
  reads automatically for context. Point any Claude Code on the web task
  at this repo and it'll pick this up on its own.

## Running locally

```
cd tic-tac-toe
docker compose up -d   # local Postgres - see tic-tac-toe/README.md
npm install
npm start
```

Then open `http://localhost:3000`.

## Deploying to Railway

Same pattern as other Railway-connected repos: connect the GitHub repo,
Railway auto-detects the `Dockerfile` and redeploys on every push. No
extra Railway config files are needed.

Because this repo has multiple game folders, you tell Railway which one
this particular service should build:

1. Push this repo to GitHub (see below if it isn't there yet).
2. In Railway: **New Project → Deploy from GitHub repo** → select
   `board-game-engine`.
3. Once the service is created, open its **Settings** tab and set
   **Root Directory** to `tic-tac-toe`. This tells Railway to build and
   deploy only that folder, using its `Dockerfile`.
4. **For `tic-tac-toe/` specifically**: also add a Postgres plugin to
   the same Railway project and attach it to this service so
   `DATABASE_URL` is set — the server fails fast on startup without a
   reachable database.
5. Railway will assign a public URL automatically. Auto-deploy on push
   to `main` is on by default once a repo is connected this way.

To deploy `patchwork/` (or `forbidden-island/` once it exists), repeat
step 2–3 as a **second Railway service** in the same project, pointing
its Root Directory at that folder — each prototype gets its own URL and
deploy lifecycle, independent of the others. `patchwork/` also needs its
own Postgres plugin, same as step 4 above but separate from
tic-tac-toe's — see [`patchwork/README.md`](patchwork/README.md)'s
"Railway setup: attaching Postgres" section for the dashboard steps.

## Pushing this repo to GitHub for the first time

From this folder:

```
git init
git add .
git commit -m "Initial commit: tic-tac-toe first pass"
git branch -M main
git remote add origin https://github.com/galeswift/board-game-engine.git
git push -u origin main
```

(Create the empty `board-game-engine` repo on GitHub first if it doesn't
exist yet — no need to initialize it with a README, since this push
brings one.)
