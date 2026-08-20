# board-game-engine

Prototypes for a board game rules engine, one folder per game:

- **`tic-tac-toe/`** — first pass, deployable now. A deliberately simple
  Node.js server (no dependencies) with an in-memory game store and a
  mobile-friendly web UI.
- **`patchwork/`** — not yet implemented.
- **`forbidden-island/`** — not yet implemented.

Each folder is self-contained and deployable independently. This first
pass keeps things simple on purpose — no shared package, no build step,
no database.

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
node server.js
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
4. Railway will assign a public URL automatically. Auto-deploy on push
   to `main` is on by default once a repo is connected this way.

When `patchwork/` or `forbidden-island/` are ready, repeat step 2–3 as a
**second Railway service** in the same project, pointing its Root
Directory at that folder — each prototype gets its own URL and deploy
lifecycle, independent of the others.

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
