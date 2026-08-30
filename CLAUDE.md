# Project brief for Claude Code

This is `board-game-engine`: prototypes for a board game rules engine,
one self-contained folder per game.

**Full architecture plan (read this before making design decisions):**
`docs/architecture.md`. It covers the command/event execution model,
deterministic replay, phases, player state, and why ECS was dropped. Any
work that touches game state, actions, or rules should be consistent with
it unless explicitly told otherwise.

## Current state of the repo

- **`tic-tac-toe/`** — first pass, deployed on Railway. Still direct
  state mutation and no command/event pipeline (intentional, see the
  status note at the top of `docs/architecture.md` — don't "fix" it into
  the full architecture without being asked). It has since grown async
  multiplayer: a `lobby` status/phase, `playerId`-scoped turn
  enforcement, per-slot invite-link identity (see `docs/architecture.md`
  Section 6 and "Client Authority: Zero"), and a WebSocket live-push
  channel — the last of these is why it's no longer zero-dependency (see
  below).
- **`patchwork/`** — scaffold only: currently a structural clone of
  `tic-tac-toe/` (same server.js/engine.js split, same game rules),
  deployable but not yet real Patchwork. Real rules per the architecture
  plan (Section 12) — asymmetric, time-track-driven turn order and
  per-player economy — haven't been built yet. Don't treat
  `patchwork/engine.js` as a starting point for those rules; it's
  bootstrap-only and expected to be replaced wholesale.
- **`forbidden-island/`** — not started. Third proof-of-concept: tests
  asymmetric player roles, always-legal interrupt actions, and
  cooperative win/loss conditions.

## Conventions

- Each game folder is independently deployable to Railway: one
  `Dockerfile` per folder, Railway's **Root Directory** setting per
  service points at that folder. No shared build step across folders yet.
- Keep dependencies minimal. `tic-tac-toe/` intentionally used only
  Node's built-in `http` module up through its first pass — prefer that
  pattern unless a real need for a framework/library comes up. It now
  carries one real dependency, `ws`, for its WebSocket live-push
  channel — a deliberate, discussed exception (see
  `tic-tac-toe/server.js`'s top comment), not a quiet departure from
  this convention. A second dependency, `pg` (Postgres), is planned next
  for persisting lobby/game state across restarts.
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
