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
  { id: 'patch-01', cover: [2, 1], cells: [[0, 0], [1, 0]] },
  { id: 'patch-02', cover: [2, 2], cells: [[0, 1], [1, 0], [1, 1]] },
  { id: 'patch-03', cover: [2, 2], cells: [[0, 1], [1, 0], [1, 1]] },
  { id: 'patch-04', cover: [3, 1], cells: [[0, 0], [1, 0], [2, 0]] },
  { id: 'patch-05', cover: [3, 2], cells: [[0, 1], [1, 0], [1, 1], [2, 0]] },
  { id: 'patch-06', cover: [3, 2], cells: [[0, 0], [1, 0], [2, 0], [1, 1], [2, 1]] },
  { id: 'patch-07', cover: [3, 5], cells: [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [0, 2], [2, 2]] },
  { id: 'patch-08', cover: [4, 3], cells: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1], [3, 1]] },
  { id: 'patch-09', cover: [2, 2], cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  { id: 'patch-10', cover: [4, 2], cells: [[0, 0], [1, 0], [2, 0], [1, 1], [2, 1], [3, 1]] },
  { id: 'patch-11', cover: [3, 2], cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  { id: 'patch-12', cover: [4, 2], cells: [[0, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1]] },
  { id: 'patch-13', cover: [4, 1], cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { id: 'patch-14', cover: [1, 5], cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
  { id: 'patch-15', cover: [4, 2], cells: [[0, 0], [1, 0], [2, 0], [3, 0], [2, 1]] },
  { id: 'patch-16', cover: [4, 2], cells: [[0, 0], [1, 0], [2, 0], [3, 0], [2, 1], [1, 1]] },
  { id: 'patch-17', cover: [3, 3], cells: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2], [2, 2]] },
  { id: 'patch-18', cover: [4, 3], cells: [[2, 0], [0, 1], [1, 1], [2, 1], [3, 1], [1, 2]] },
  { id: 'patch-19', cover: [3, 2], cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
  { id: 'patch-20', cover: [3, 3], cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] },
  { id: 'patch-21', cover: [3, 3], cells: [[0, 0], [1, 0], [2, 0], [1, 1], [0, 2], [1, 2], [2, 2]] },
  { id: 'patch-22', cover: [4, 3], cells: [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [3, 1], [1, 2], [2, 2]] },
  { id: 'patch-23', cover: [5, 2], cells: [[3, 0], [0, 1], [1, 1], [2, 1], [3, 1]] },
  { id: 'patch-24', cover: [3, 3], cells: [[2, 0], [0, 1], [1, 1], [2, 1], [2, 2]] },
  { id: 'patch-25', cover: [4, 2], cells: [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [3, 1]] },
  { id: 'patch-26', cover: [4, 3], cells: [[0, 0], [0, 1], [1, 1], [2, 1], [3, 1], [3, 2]] },
  { id: 'patch-27', cover: [3, 2], cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
  { id: 'patch-28', cover: [4, 3], cells: [[3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [3, 2]] },
  { id: 'patch-29', cover: [3, 3], cells: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]] },
  { id: 'patch-30', cover: [2, 3], cells: [[0, 0], [1, 0], [1, 1], [0, 2], [1, 2]] },
  { id: 'patch-31', cover: [4, 2], cells: [[2, 0], [3, 0], [0, 1], [1, 1], [2, 1]] },
  { id: 'patch-32', cover: [2, 3], cells: [[1, 0], [0, 1], [1, 1], [0, 2]] },
  { id: 'patch-33', cover: [3, 3], cells: [[2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2]] },
];

const BY_ID = new Map(PATCHES.map((patch) => [patch.id, patch]));

export function getPatch(id) {
  return BY_ID.get(id) || null;
}

// Same rotation formula as patches.js: 90deg clockwise per step,
// (r, c) -> (c, rows-1-r), re-deriving the bounding box each time.
export function rotatePatch(patch, rotation) {
  let rows = patch.cover[0];
  let cols = patch.cover[1];
  let cells = patch.cells;
  const steps = ((rotation % 4) + 4) % 4;
  for (let i = 0; i < steps; i++) {
    cells = cells.map(([r, c]) => [c, rows - 1 - r]);
    [rows, cols] = [cols, rows];
  }
  return { rows, cols, cells };
}
