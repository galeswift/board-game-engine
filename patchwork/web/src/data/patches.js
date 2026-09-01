// Patch shape/cost/time/income data now comes from the server
// (GET /api/patches, serving patchwork/patches.js's PATCHES directly -
// pivot included, already computed there) instead of a hand-maintained
// client-side duplicate. That duplicate existed only because of this
// repo's "no shared build step across folders" convention (CLAUDE.md),
// and it drifted out of sync with the real values more than once - see
// docs/patchwork-next-steps.md. Fetching it at runtime keeps the server
// as the one source of truth without sharing any build/import step
// across the server/web npm projects. Still display-only, same as
// before: never used for legality, which always comes from a game's own
// /actions domain (see docs/architecture.md, "Client Authority: Zero").
let patchesPromise = null;

export function loadPatches() {
  if (!patchesPromise) {
    patchesPromise = fetch('/api/patches')
      .then((res) => res.json())
      .then((data) => data.patches || []);
  }
  return patchesPromise;
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
