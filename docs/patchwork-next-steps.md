# Patchwork: async-multiplayer parity + React conversion — handoff

**Purpose of this doc**: a separate Claude Code session (or future you) can
read this and pick the work back up without re-deriving context. Written
mid-project because the originating session was hitting its context/
compaction limit.

## Context

`tic-tac-toe/` went through four phases this session to get real async
multiplayer: a WebSocket live-push channel, a lobby/`playerId` identity
model, per-slot invite links (join = reconnect, idempotent), and
Postgres-backed persistence. That work is done, tested (47 automated
tests: `node:test` for engine/server/socket/persistence, plus Playwright
browser tests), deployed to Railway, and pushed to `main`. The original
implementation plan (all 4 phases, in detail) is saved at
`C:\Users\kmiro\.claude\plans\ticklish-swinging-stearns.md` on this
machine — read it for the exact design rationale (invite-token identity,
why `engine.js` stays identity-free, the `lobbySummary` scoping pattern,
etc.) if porting logic and the "why" isn't obvious from the code alone.

The plan now is to bring `patchwork/` up to the same level, then move its
UI to React (its actual game — a 9×9 quilt board, patch pieces, a
circular market, a time track — is genuinely component-shaped in a way
tic-tac-toe's 3×3 grid never was, so React is justified there even though
it wasn't for tic-tac-toe).

Agreed 5-step sequence, in order (see rationale below for why this order):

1. Duplicate tic-tac-toe's **backend** into `patchwork/` for parity.
2. User deploys `patchwork/` to Railway themselves (needs its own
   separate Postgres plugin, same reasoning as why each game folder is
   an independent Railway service).
3. Convert `patchwork/`'s frontend to React (Vite).
4. ~~Find/recreate Patchwork's assets~~ — **done**, see below.
5. Wire up an image-plug-in convention for those assets.

Why this order: doing #1 before #3 avoids wasted work (no point building
a Vite/React frontend against a backend that doesn't have the lobby/WS/
persistence API surface yet). Doing #3 before #5 means the image-slot
component gets built once, correctly, inside the real component tree,
instead of prototyped in vanilla JS and then rewritten.

## Status

### Done
- **#4 — patch reference data.** All 33 real Patchwork patches
  (shape, button cost, time cost, button income) reconstructed from a
  public open-source implementation of the physical game
  ([CACppuccino/PatchworkGame](https://github.com/CACppuccino/PatchworkGame)
  on GitHub — the exact source arrays are `tileCost`, `tileCover`,
  `tileSpace`, `tileTimetoken`, `tileButton` in
  `src/comp1140/ass2/PatchworkGame.java`). Verified against known real
  card values (e.g. the 1×5 straight patch costing 7 buttons/1 time/1
  income). That Java source actually has 34 entries; the 34th
  (all-zero, single-cell) is a synthetic filler from that repo's own
  simulation, not a real patch — **only use the first 33**, indices
  `0..32`.

  Two themed reskins were explored (woodworking/power-tools, then a
  bakery) and both were rejected as not matching what the user has in
  mind — **no theme, no generated icons**. The settled data model is
  neutral: each patch just has a stable `id` (`patch-01`..`patch-33`)
  plus its real mechanical stats. The full data, exactly as agreed, is
  reproduced below so it doesn't only live in an ephemeral preview
  artifact:

  ```js
  // 33 real Patchwork patches. cover = [rows, cols] bounding box.
  // cells = [row, col] offsets of filled cells within that box.
  // cost = button cost to buy, time = time-track spaces to advance,
  // income = button income earned each time you pass a button space
  // on the time track while owning this patch.
  const PATCHES = [
    { id: 'patch-01', cost:2, time:1, income:0, cover:[2,1], cells:[[0,0],[1,0]] },
    { id: 'patch-02', cost:1, time:3, income:0, cover:[2,2], cells:[[0,1],[1,0],[1,1]] },
    { id: 'patch-03', cost:3, time:1, income:0, cover:[2,2], cells:[[0,1],[1,0],[1,1]] },
    { id: 'patch-04', cost:2, time:2, income:0, cover:[3,1], cells:[[0,0],[1,0],[2,0]] },
    { id: 'patch-05', cost:3, time:2, income:1, cover:[3,2], cells:[[0,1],[1,0],[1,1],[2,0]] },
    { id: 'patch-06', cost:2, time:2, income:0, cover:[3,2], cells:[[0,0],[1,0],[2,0],[1,1],[2,1]] },
    { id: 'patch-07', cost:1, time:4, income:1, cover:[3,5], cells:[[1,0],[1,1],[1,2],[1,3],[1,4],[0,2],[2,2]] },
    { id: 'patch-08', cost:0, time:3, income:1, cover:[4,3], cells:[[0,1],[1,0],[1,1],[1,2],[2,1],[3,1]] },
    { id: 'patch-09', cost:6, time:5, income:2, cover:[2,2], cells:[[0,0],[0,1],[1,0],[1,1]] },
    { id: 'patch-10', cost:4, time:2, income:0, cover:[4,2], cells:[[0,0],[1,0],[2,0],[1,1],[2,1],[3,1]] },
    { id: 'patch-11', cost:2, time:2, income:0, cover:[3,2], cells:[[1,0],[0,1],[1,1],[2,1]] },
    { id: 'patch-12', cost:1, time:5, income:1, cover:[4,2], cells:[[0,0],[3,0],[0,1],[1,1],[2,1],[3,1]] },
    { id: 'patch-13', cost:3, time:3, income:1, cover:[4,1], cells:[[0,0],[1,0],[2,0],[3,0]] },
    { id: 'patch-14', cost:7, time:1, income:1, cover:[1,5], cells:[[0,0],[0,1],[0,2],[0,3],[0,4]] },
    { id: 'patch-15', cost:3, time:4, income:1, cover:[4,2], cells:[[0,0],[1,0],[2,0],[3,0],[2,1]] },
    { id: 'patch-16', cost:7, time:4, income:2, cover:[4,2], cells:[[0,0],[1,0],[2,0],[3,0],[2,1],[1,1]] },
    { id: 'patch-17', cost:3, time:6, income:2, cover:[3,3], cells:[[1,0],[2,0],[0,1],[1,1],[1,2],[2,2]] },
    { id: 'patch-18', cost:2, time:1, income:0, cover:[4,3], cells:[[2,0],[0,1],[1,1],[2,1],[3,1],[1,2]] },
    { id: 'patch-19', cost:4, time:6, income:2, cover:[3,2], cells:[[2,0],[0,1],[1,1],[2,1]] },
    { id: 'patch-20', cost:5, time:4, income:0, cover:[3,3], cells:[[1,0],[0,1],[1,1],[2,1],[1,2]] },
    { id: 'patch-21', cost:2, time:3, income:1, cover:[3,3], cells:[[0,0],[1,0],[2,0],[1,1],[0,2],[1,2],[2,2]] },
    { id: 'patch-22', cost:5, time:3, income:2, cover:[4,3], cells:[[1,0],[2,0],[0,1],[1,1],[2,1],[3,1],[1,2],[2,2]] },
    { id: 'patch-23', cost:10, time:3, income:2, cover:[5,2], cells:[[3,0],[0,1],[1,1],[2,1],[3,1]] },
    { id: 'patch-24', cost:5, time:5, income:3, cover:[3,3], cells:[[2,0],[0,1],[1,1],[2,1],[2,2]] },
    { id: 'patch-25', cost:10, time:5, income:0, cover:[4,2], cells:[[0,0],[1,0],[0,1],[1,1],[2,1],[3,1]] },
    { id: 'patch-26', cost:1, time:2, income:1, cover:[4,3], cells:[[0,0],[0,1],[1,1],[2,1],[3,1],[3,2]] },
    { id: 'patch-27', cost:4, time:2, income:2, cover:[3,2], cells:[[0,0],[1,0],[2,0],[2,1]] },
    { id: 'patch-28', cost:7, time:2, income:3, cover:[4,3], cells:[[3,0],[0,1],[1,1],[2,1],[3,1],[3,2]] },
    { id: 'patch-29', cost:10, time:4, income:0, cover:[3,3], cells:[[0,0],[1,0],[1,1],[2,1],[2,2]] },
    { id: 'patch-30', cost:1, time:2, income:1, cover:[2,3], cells:[[0,0],[1,0],[1,1],[0,2],[1,2]] },
    { id: 'patch-31', cost:2, time:3, income:3, cover:[4,2], cells:[[2,0],[3,0],[0,1],[1,1],[2,1]] },
    { id: 'patch-32', cost:7, time:6, income:0, cover:[2,3], cells:[[1,0],[0,1],[1,1],[0,2]] },
    { id: 'patch-33', cost:8, time:6, income:1, cover:[3,3], cells:[[2,0],[0,1],[1,1],[2,1],[0,2],[1,2]] },
  ];
  ```

  There's also a private preview artifact from this session showing this
  data rendered as a grid (shape outline + cost/time/income + an empty
  image-slot placeholder per piece) — ask the user for the link if you
  want to see it rendered rather than just reading the array, but the
  array above is the actual source of truth; the artifact isn't checked
  into the repo and may not be reachable from a different session.

- **#5 — validated, not yet implemented.** The image-plug-in
  *convention* was proven out in that same preview artifact:
  - Each patch has a stable `id` (`patch-01`..`patch-33`, as above).
  - The UI looks for an image at `images/patches/<id>.png` (path/format
    still arbitrary — pick whatever fits the real Vite project
    structure when #3 is done, e.g. `src/assets/patches/<id>.png`
    imported directly, which is more idiomatic for a Vite/React app
    than a runtime `fetch`/`<img src>` guess).
  - Missing image → render a plain placeholder (no broken-image icon,
    no layout shift) rather than erroring. In the vanilla-JS preview
    this was done via `<img onerror>` swapping in a placeholder div;
    in React this is more naturally a small `<PatchArt id>` component
    that either renders the imported asset or a placeholder `<div>`.
  - **This is intentionally not wired into any real code yet** — there
    is no live `patchwork/` frontend to wire it into until #1 and #3
    are done. Do that wiring as part of #3, not before.

### Not started
- **#1 — duplicate tic-tac-toe's backend into `patchwork/`.**
  `patchwork/` is currently frozen at tic-tac-toe's *very first* state
  (see `patchwork/README.md` — "structural clone... same rules...
  don't treat `patchwork/engine.js` as a starting point"). None of this
  session's multiplayer work has been ported. Concretely, port:
  - `server.js` — the full route set (create/join/actions/actions
    preview/GET), the `lobbySummary`/`scopedActions`/`slotForPlayerId`/
    `slotForToken` helpers, the WebSocket live channel
    (`socketsByGame`, `broadcastState`, `broadcastPresence`, the
    `/api/games/:id/socket` upgrade handler).
  - `db.js` — Postgres persistence layer (`ensureSchema`, `insertGame`,
    `getGame`, `saveGame`), **including** the `ensureSchema` fix for
    the concurrent-first-`CREATE TABLE IF NOT EXISTS` race (catches
    Postgres error codes `42P07` and `23505` — this was a real bug
    found and fixed during testing, don't lose it on a naive re-copy).
  - `docker-compose.yml` — local Postgres for dev/test, on its own port
    if run alongside tic-tac-toe's (or just don't run both at once).
  - `package.json` — add `ws` and `pg` as real dependencies, `playwright`
    as a devDependency; keep `Dockerfile`'s `npm install --omit=dev`
    step (already present from patchwork's initial scaffold).
  - The test suite: `engine.test.js`, `server.test.js`, `socket.test.js`,
    `persistence.test.js`, `browser.test.js` — port and adapt (new
    ports, since patchwork will run on a different port than
    tic-tac-toe's tests; e.g. tic-tac-toe uses 34599/34899/34905/34906
    for its various test files — pick a distinct range for patchwork so
    the two projects' test suites could theoretically run concurrently
    without port collisions, though they're separate folders/processes
    either way).
  - **Deliberately skip**: `public/client.js`, `public/index.html`,
    `public/style.css`. Porting the vanilla-JS client just to replace
    it in step #3 is wasted work — go straight to React for the
    frontend.
  - **Keep as-is**: `engine.js` stays the tic-tac-toe-rules placeholder
    for now (still "bootstrap-only, expected to be replaced wholesale"
    per `CLAUDE.md`) — parity here is about the *backend plumbing*
    (lobby/identity/WS/persistence), not the game rules, which is a
    separate, later effort (the real Patchwork engine: asymmetric
    turn order, per-player economy, phase transitions — see
    `docs/architecture.md` Section 12).

- **#2 — Railway deployment.** User's responsibility. Needs its own
  Postgres plugin, separate from tic-tac-toe's (same reasoning as why
  they're separate Railway services at all — independent lifecycles).
  Mirror `tic-tac-toe/README.md`'s "Railway setup: attaching Postgres"
  section (dashboard-click steps, not CLI — that was a deliberate
  choice made this session, the user prefers being walked through UI
  clicks over pasting CLI commands).

- **#3 — Vite + React conversion.** Not started. Recommendation from
  this session: Vite (not Create React App — lighter, faster, minimal
  config), producing a static `dist/` build that the existing Node
  `http` server can keep serving as-is (point `PUBLIC_DIR` at `dist/`
  instead of `public/` — no need to run Vite's own server in
  production, no change to the one-process deploy model). Natural
  component boundaries for the real Patchwork UI: quilt board, patch
  piece, market, time track, player stats panel.

## Key decisions/constraints to carry forward

- **Client Authority: Zero** (see `docs/architecture.md`) still
  applies: the React client must never compute its own legality — it
  asks the server (`queryLegalActions`-equivalent), same as
  tic-tac-toe.
- **No accounts, no localStorage.** Multiplayer identity is the
  invite-token-per-slot model (join and reconnect are the same
  idempotent operation) — reuse this exactly, don't reinvent it for
  Patchwork.
- **Zero-dependency default, documented exceptions only.** tic-tac-toe
  now has `ws`/`pg` as real dependencies (documented in `CLAUDE.md` and
  `server.js`'s top comment) — patchwork picking up the same two (plus
  `playwright` as a devDependency) is expected and fine, just document
  it the same way when you do.
- **Each game folder is fully independent** — own Dockerfile, own
  Railway service, own Postgres. Never share state/infra between
  `tic-tac-toe/` and `patchwork/`.
