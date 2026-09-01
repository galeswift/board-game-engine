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

### Done (this session)
- **#1 — duplicate tic-tac-toe's backend into `patchwork/`.** Ported:
  `engine.js` (mode/lobby/`startGame`), `server.js` (full route set,
  lobby/identity helpers, WS channel, upgrade handler, fail-fast
  startup), `db.js` (including the `42P07`/`23505` race fix, pointed at
  its own `patchwork` database), `docker-compose.yml` (`patchwork` db,
  host port `5433` so it can run alongside tic-tac-toe's), `Dockerfile`,
  and `package.json` (`ws`/`pg` deps, `playwright` devDependency). Tests
  ported: `engine.test.js`, `server.test.js`, `socket.test.js`,
  `persistence.test.js`, on a distinct port range (`356xx`) from
  tic-tac-toe's. All passing (47 tests). `engine.js` is still
  tic-tac-toe's rules, deliberately - see "Keep as-is" below, unchanged
  from the original plan.

- **#2 — Railway deployment.** `patchwork/README.md` now has the
  dashboard-click "Railway setup: attaching Postgres" section, mirroring
  tic-tac-toe's, naming `patchwork`'s own separate Postgres plugin.
  **Actually creating the Railway service/database is still the user's
  step** - not done by this session, per the original plan below.

- **#3 — Vite + React conversion.** Done: `patchwork/web/` is a new Vite
  React app (its own `package.json`, kept separate from the server's so
  React/Vite deps never enter the server's production Dockerfile stage).
  Components: `App`, `Board` (since replaced by `QuiltBoard` - see the
  gameplay slice below), `LobbyStatus`, `InvitePanel`, `Controls` -
  a like-for-like port of the old vanilla-JS client's behavior (create
  local/multiplayer, join-by-invite-token, `?game=&invite=` URL params,
  WS live push, "Client Authority: Zero" legal-actions scoping), same
  dark theme, same element ids/classes (so the ported `browser.test.js`
  needed only a port-number change). Old `patchwork/public/` (vanilla-JS
  client) deleted - fully superseded. `server.js`'s `PUBLIC_DIR` now
  points at `web/dist`. `Dockerfile` is multi-stage: stage 1 builds
  `web/` with `npm ci && npm run build`, stage 2 copies that `dist/`
  output alongside the server's own `npm install --omit=dev`. Root
  `package.json` gained a `build` script (`npm --prefix web run build`).
  `browser.test.js` ported and passing against the real React build (4
  tests, including the turn-label regression check from tic-tac-toe's
  version).

  **Not in scope, as planned**: no real Patchwork board/patches/market
  UI - the engine is still tic-tac-toe's rules, that's later, separate
  work. The image-plugin convention from #5 stays unwired - no patch art
  to plug in until the real engine and its UI exist.

- **#2, the actual Railway click-through — done.** The user created the
  Railway project, pointed its Root Directory at `patchwork/`, and
  provisioned the Postgres plugin. Deployed and confirmed working.

- **First real gameplay slice: pick a patch, rotate, place it, pass the
  turn.** A deliberately minimal MVP cut, not the full engine below -
  see the plan at `C:\Users\kmiro\.claude\plans\quirky-kindling-pebble.md`
  on this machine for the full design rationale. `engine.js` was
  rewritten wholesale (no longer tic-tac-toe's placeholder): state is
  `{ quiltBoards: { X, O }, availablePatches, currentPlayer, status }`,
  a shared/depleting pool of all 33 real patches (`patchwork/patches.js`,
  new - the reference data above plus `getPatch`/`rotatePatch`). A
  player picks a patch, can rotate it 90°-at-a-time (no flip), then
  places it on their own 9x9 board; turn flips to the other lobby slot
  on a successful placement. Only legality check is geometric (fits the
  grid, doesn't overlap that player's own already-placed patches) - no
  cost, no time track, no button economy, no scoring, no win condition,
  all deliberately out of scope for this pass.

  Extended (not replaced) the "Client Authority: Zero" pattern:
  `queryLegalActions(state, { patchId, rotation })` now takes an
  optional selection - no patch picked yet returns the pickable-patch
  domain (`selectPatch`), a patch+rotation picked returns the anchor
  placement domain (`placePatch`) for that specific choice.
  `GET .../actions` gained optional `patchId`/`rotation` query params
  wired straight through; `POST .../actions` and `.../preview` needed
  no change, they already forward the raw action body. The client
  fetches the placement domain fresh every time the selection or
  rotation changes - it never computes fit/overlap itself.

  Frontend: `web/src/data/patches.js` (a trimmed client-side duplicate
  of the server's patch geometry, display-only, never used for
  legality), `components/QuiltBoard.jsx` (replaces the old `Board.jsx`),
  `PatchPicker.jsx`, `RotateControl.jsx`, `PatchShape.jsx`. All 33
  patches always shown, greyed out once taken from the pool.

  All tests (engine/server/socket/persistence/browser, 45 total)
  rewritten for the new action vocabulary and passing, including two
  new Playwright scenarios: local pass-and-play select→rotate→place,
  and a multiplayer placement live-updating a second browser context
  with the turn flipped and the picker in sync.

- **Hover placement preview + shared client/server pivot.** Follow-up
  UX pass on top of the MVP slice above, done interactively with the
  user driving a lot of the client code directly. Hovering the board
  now previews the selected patch's rotated footprint before you click
  (`App.jsx`'s `updateHighlights`, wired from `QuiltBoard`'s
  `onMouseEnter`) instead of only highlighting on click.

  Mid-way through, the user pushed back on an early version that
  computed the hover "pivot" (treating the hovered cell as the shape's
  center, not its top-left corner) purely client-side, invented fresh
  in `App.jsx` and unknown to the server - explicitly asked for the
  pivot to be a first-class part of the shape instead, shared
  identically by both ends. Result: `patches.js` (both the server copy
  and `web/src/data/patches.js`) now computes a `pivot: [row, col]` per
  patch at module load (`floor((rows-1)/2), floor((cols-1)/2)` on the
  unrotated shape), and `rotatePatch` rotates the pivot through the
  identical per-step transform as `cells`, so it stays attached to the
  shape through every rotation. `engine.js`'s wire contract changed to
  match: `row`/`col` in both `queryLegalActions`' anchor domain and
  `applyAction`'s `placePatch` now mean the shape's *pivot* position,
  not its top-left corner - the corner-space math (`fits`, the domain
  scan) is unchanged internally, just shifted by `shape.pivot` at the
  boundary. The client now just snaps a hover/click to the nearest
  pivot in the server-returned domain (`nearestInDomain` in `App.jsx`,
  a plain list lookup, no board-geometry knowledge needed) instead of
  computing its own clamp/anchor math.

  Found and fixed a real bug during this work: `QuiltBoard.jsx` wired
  `onClick`/`onMouseEnter` unconditionally on every cell of *every*
  board, so hovering the non-active board (the opponent's, or in local
  mode whichever slot isn't `currentPlayer`) fed that board's
  coordinates into the single shared placement-preview state and
  corrupted the highlight shown on the actually-active board. Fixed by
  gating both handlers on the `interactive` prop, with a regression
  test in `browser.test.js` covering it. Test suite is now 46.

- **Dockerfile bug found via a real Railway crash, fixed and verified
  properly.** The engine.js rewrite in the MVP slice added
  `patchwork/patches.js` as a new required module, but the
  Dockerfile's `COPY server.js engine.js db.js ./` line was never
  updated to include it - worked fine in every local test (`node
  server.js` always runs from the full source tree, so the missing
  file never surfaced) but crash-looped on Railway
  (`Cannot find module './patches'`). Fixed the `COPY` line, and this
  time actually verified it by building the real image
  (`docker build`) and running the container against local Postgres
  before pushing again, rather than trusting local `node` execution -
  worth doing that verification step for any future Dockerfile change
  here, since local testing structurally can't catch this class of bug.

### Not started
- **The full real Patchwork engine and UI.** Asymmetric, time-track-driven
  turn order, per-player economy (buttons), phase transitions (setup →
  play → scoring → game over), actual button cost to buy a patch — see
  `docs/architecture.md` Section 12. This is where the #5 image-plugin
  convention (`<PatchArt id>` in `web/src/`) finally gets wired in.
  `PATCHES`' `cost`/`time`/`income` fields already exist in
  `patchwork/patches.js` (the server-side data module), unused by the
  engine yet - `web/src/data/patches.js`'s client-side copy deliberately
  trimmed them out since nothing client-side needs them yet either.

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
