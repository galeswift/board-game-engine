'use strict';

// 33 real Patchwork patches, reconstructed from a public open-source
// implementation of the physical game (see docs/patchwork-next-steps.md
// for provenance and verification notes). `cover` = [rows, cols]
// bounding box; `cells` = [row, col] offsets of filled cells within
// that box. `cost`/`time`/`income` aren't used by the engine yet (no
// button economy in this pass) - kept here so they don't need
// reconstructing again when that work happens.
const PATCHES = [
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
];

const BY_ID = new Map(PATCHES.map((patch) => [patch.id, patch]));

function getPatch(id) {
  return BY_ID.get(id) || null;
}

// Rotates a patch's shape 90deg clockwise, `rotation` times (0-3).
// (r, c) -> (c, rows-1-r) per step, re-deriving the bounding box each
// time - this keeps every intermediate shape normalized to start at
// [0,0], so the result never needs a separate translation pass.
function rotatePatch(patch, rotation) {
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

module.exports = { PATCHES, getPatch, rotatePatch };
