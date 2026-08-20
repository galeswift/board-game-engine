# Project brief for Claude Code

This is `board-game-engine`: prototypes for a board game rules engine,
one self-contained folder per game.

**Full architecture plan (read this before making design decisions):**
`docs/architecture.md`. It covers the command/event execution model,
deterministic replay, phases, player state, and why ECS was dropped. Any
work that touches game state, actions, or rules should be consistent with
it unless explicitly told otherwise.

## Current state of the repo

- **`tic-tac-toe/`** — first pass, deployed on Railway. Deliberately
  simplified: zero npm dependencies, direct state mutation, no
  command/event pipeline, no phases yet. This is intentional (see the
  status note at the top of `docs/architecture.md`), not an oversight —
  don't "fix" it into the full architecture without being asked.
- **`patchwork/`** — not started. Second proof-of-concept per the
  architecture plan (Section 12): tests asymmetric, time-track-driven
  turn order and per-player economy.
- **`forbidden-island/`** — not started. Third proof-of-concept: tests
  asymmetric player roles, always-legal interrupt actions, and
  cooperative win/loss conditions.

## Conventions

- Each game folder is independently deployable to Railway: one
  `Dockerfile` per folder, Railway's **Root Directory** setting per
  service points at that folder. No shared build step across folders yet.
- Keep dependencies minimal. `tic-tac-toe/` intentionally uses only
  Node's built-in `http` module — prefer that pattern unless a real need
  for a framework/library comes up.
- Rules/actions should be pure functions: `(state, input) -> result`,
  never mutating the input in place. This holds even in the simplified
  `tic-tac-toe/` first pass.
- Commit messages and PRs: this repo deploys via Railway's GitHub
  auto-deploy on push to `main` — treat pushes to `main` as production
  deploys, not scratch commits.

## Workflow

Pushing to `main` triggers an automatic Railway redeploy for whichever
service's Root Directory contains the changed files. There's no staging
environment yet — be as sure as reasonably possible before merging.
