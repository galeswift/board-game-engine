// Patch shape/cost/time/income data, plus the shared time-track's
// length and button-income space positions, now come from the server
// (GET /api/patches - serves patchwork/patches.js's PATCHES and
// patchwork/timeTrack.js's TRACK_LENGTH/BUTTON_INCOME_SPACES directly,
// pivot included) instead of hand-maintained client-side duplicates.
// Those duplicates existed only because of this repo's "no shared build
// step across folders" convention (CLAUDE.md), and drifted out of sync
// with the real values more than once - see docs/patchwork-next-steps.md.
// Fetching at runtime keeps the server as the one source of truth
// without sharing any build/import step across the server/web npm
// projects. Still display-only, same as before: never used for
// legality, which always comes from a game's own /actions domain (see
// docs/architecture.md, "Client Authority: Zero").
let dataPromise = null;

function loadData() {
  if (!dataPromise) {
    dataPromise = fetch('/api/patches').then((res) => res.json());
  }
  return dataPromise;
}

export function loadPatches() {
  return loadData().then((data) => data.patches || []);
}

// { trackLength, buttonIncomeSpaces } - see TimeTrack.jsx.
export function loadTrackInfo() {
  return loadData().then((data) => ({
    trackLength: data.trackLength,
    buttonIncomeSpaces: data.buttonIncomeSpaces || [],
  }));
}

// Same rotation formula as patches.js: 90deg clockwise per step,
// (r, c) -> (c, rows-1-r), re-deriving the bounding box each time. The
// pivot goes through the identical per-step transform as every cell -
// it's already on `patch` (computed server-side), never invented here.
export function rotatePatch(patch, rotation) {
  let rows = patch.cover[0];
  let cols = patch.cover[1];
  let cells = patch.cells;
  let pivot = patch.pivot;
  const steps = ((rotation % 4) + 4) % 4;
  for (let i = 0; i < steps; i++) {
    cells = cells.map(([r, c]) => [c, rows - 1 - r]);
    pivot = [pivot[1], rows - 1 - pivot[0]];
    [rows, cols] = [cols, rows];
  }
  return { rows, cols, cells, pivot };
}
