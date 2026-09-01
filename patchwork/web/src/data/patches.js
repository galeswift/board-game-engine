// Trimmed client-side copy of patchwork/patches.js - id/cover/cells only
// (no cost/time/income, unused until the button economy exists), plus
// the same rotation helper. Used only for instant visual rendering
// (picker icons, the selected/rotated preview) - never for legality,
// which always comes from the server's returned domain (server.js's
// GET .../actions with a patchId/rotation, engine.js's
// queryLegalActions). Duplicated rather than shared across the
// server/web npm projects, matching this repo's "no shared build step
// across folders" convention (see CLAUDE.md).
export const PATCHES = [
  { id: 'patch-01', cost: 2, time: 1, income: 0, cover: [2, 1], cells: [[0, 0], [1, 0]] },
  { id: 'patch-02', cost: 1, time: 3, income: 0, cover: [2, 2], cells: [[0, 1], [1, 0], [1, 1]] },
  { id: 'patch-03', cost: 3, time: 1, income: 0, cover: [2, 2], cells: [[0, 1], [1, 0], [1, 1]] },
  { id: 'patch-04', cost: 2, time: 2, income: 0, cover: [3, 1], cells: [[0, 0], [1, 0], [2, 0]] },
  { id: 'patch-05', cost: 3, time: 2, income: 1, cover: [3, 2], cells: [[0, 1], [1, 0], [1, 1], [2, 0]] },
  { id: 'patch-06', cost: 2, time: 2, income: 0, cover: [3, 2], cells: [[0, 0], [1, 0], [2, 0], [1, 1], [2, 1]] },
  { id: 'patch-07', cost: 1, time: 4, income: 1, cover: [3, 5], cells: [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [0, 2], [2, 2]] },
  { id: 'patch-08', cost: 0, time: 3, income: 1, cover: [4, 3], cells: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1], [3, 1]] },
  { id: 'patch-09', cost: 6, time: 5, income: 2, cover: [2, 2], cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  { id: 'patch-10', cost: 4, time: 2, income: 0, cover: [4, 2], cells: [[0, 0], [1, 0], [2, 0], [1, 1], [2, 1], [3, 1]] },
  { id: 'patch-11', cost: 2, time: 2, income: 0, cover: [3, 2], cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  { id: 'patch-12', cost: 1, time: 5, income: 1, cover: [4, 2], cells: [[0, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1]] },
  { id: 'patch-13', cost: 3, time: 3, income: 1, cover: [4, 1], cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { id: 'patch-14', cost: 7, time: 1, income: 1, cover: [1, 5], cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
  { id: 'patch-15', cost: 3, time: 4, income: 1, cover: [4, 2], cells: [[0, 0], [1, 0], [2, 0], [3, 0], [2, 1]] },
  { id: 'patch-16', cost: 7, time: 4, income: 2, cover: [4, 2], cells: [[0, 0], [1, 0], [2, 0], [3, 0], [2, 1], [1, 1]] },
  { id: 'patch-17', cost: 3, time: 6, income: 2, cover: [3, 3], cells: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2], [2, 2]] },
  { id: 'patch-18', cost: 2, time: 1, income: 0, cover: [4, 3], cells: [[2, 0], [0, 1], [1, 1], [2, 1], [3, 1], [1, 2]] },
  { id: 'patch-19', cost: 4, time: 6, income: 2, cover: [3, 2], cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
  { id: 'patch-20', cost: 5, time: 4, income: 0, cover: [3, 3], cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] },
  { id: 'patch-21', cost: 2, time: 3, income: 1, cover: [3, 3], cells: [[0, 0], [1, 0], [2, 0], [1, 1], [0, 2], [1, 2], [2, 2]] },
  { id: 'patch-22', cost: 5, time: 3, income: 2, cover: [4, 3], cells: [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [3, 1], [1, 2], [2, 2]] },
  { id: 'patch-23', cost: 10, time: 3, income: 2, cover: [5, 2], cells: [[3, 0], [0, 1], [1, 1], [2, 1], [3, 1]] },
  { id: 'patch-24', cost: 5, time: 5, income: 3, cover: [3, 3], cells: [[2, 0], [0, 1], [1, 1], [2, 1], [2, 2]] },
  { id: 'patch-25', cost: 10, time: 5, income: 0, cover: [4, 2], cells: [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [3, 1]] },
  { id: 'patch-26', cost: 1, time: 2, income: 1, cover: [4, 3], cells: [[0, 0], [0, 1], [1, 1], [2, 1], [3, 1], [3, 2]] },
  { id: 'patch-27', cost: 4, time: 2, income: 2, cover: [3, 2], cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
  { id: 'patch-28', cost: 7, time: 2, income: 3, cover: [4, 3], cells: [[3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [3, 2]] },
  { id: 'patch-29', cost: 10, time: 4, income: 0, cover: [3, 3], cells: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]] },
  { id: 'patch-30', cost: 1, time: 2, income: 1, cover: [2, 3], cells: [[0, 0], [1, 0], [1, 1], [0, 2], [1, 2]] },
  { id: 'patch-31', cost: 2, time: 3, income: 3, cover: [4, 2], cells: [[2, 0], [3, 0], [0, 1], [1, 1], [2, 1]] },
  { id: 'patch-32', cost: 7, time: 6, income: 0, cover: [2, 3], cells: [[1, 0], [0, 1], [1, 1], [0, 2]] },
  { id: 'patch-33', cost: 8, time: 6, income: 1, cover: [3, 3], cells: [[2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2]] },
]; timeCost:

// The pivot is a first-class part of each shape, matching
// patchwork/patches.js exactly (same formula, same rotation): it's the
// point "row, col" means in every server request (GET .../actions'
// anchor domain, and placePatch itself) - the client never invents its
// own separate notion of a placement anchor, it just rotates the same
// pivot the server does.
for (const patch of PATCHES) {
  patch.pivot = [Math.floor((patch.cover[0] - 1) / 2), Math.floor((patch.cover[1] - 1) / 2)];
}

const BY_ID = new Map(PATCHES.map((patch) => [patch.id, patch]));

export function getPatch(id) {
  return BY_ID.get(id) || null;
}

// Same rotation formula as patches.js: 90deg clockwise per step,
// (r, c) -> (c, rows-1-r), re-deriving the bounding box each time. The
// pivot goes through the identical per-step transform as every cell.
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
