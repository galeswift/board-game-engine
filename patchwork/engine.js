'use strict';

// First real slice of Patchwork's rules (see docs/patchwork-next-steps.md):
// pick a patch from a shared pool, rotate it, place it on your own 9x9
// quilt board. Deliberately minimal - no cost, no time track, no button
// economy, no scoring, no win condition. Only legality check is
// geometric: fits the grid, doesn't overlap what's already placed.
//
// Still a small direct-mutation engine (pure (state, action) -> {state,
// error} functions), not the full command/event/phase pipeline from
// docs/architecture.md - same reasoning tic-tac-toe never adopted it
// either (see the status note at the top of that doc).

const { PATCHES, getPatch, rotatePatch } = require('./patches');

const BOARD_SIZE = 9;

function emptyBoard() {
  return Array(BOARD_SIZE * BOARD_SIZE).fill(null);
}

function createGame({ mode = 'local' } = {}) {
  return {
    quiltBoards: { X: emptyBoard(), O: emptyBoard() },
    availablePatches: PATCHES.map((p) => p.id),
    currentPlayer: 'X',
    // 'lobby' | 'in-progress' | 'complete'. 'complete' once every patch
    // has been placed - no winner/scoring here, just nothing left to do.
    status: mode === 'multiplayer' ? 'lobby' : 'in-progress',
  };
}

// Pure function: state -> state. 'lobby' -> 'in-progress'. A no-op
// outside 'lobby' so callers don't need to guard the call site.
function startGame(state) {
  if (state.status !== 'lobby') {
    return state;
  }
  return { ...state, status: 'in-progress' };
}

// True if every cell of `shape` (already rotated) fits inside the board
// with its top-left corner at (row, col) without overlapping an
// occupied cell. Bounds are checked by the caller (row/col +
// shape.rows/cols <= BOARD_SIZE); this only checks occupancy. Corner
// coordinates, not pivot coordinates - see queryLegalActions/applyAction
// below for where the pivot<->corner conversion actually happens.
function fits(board, shape, row, col) {
  return shape.cells.every(([dr, dc]) => board[(row + dr) * BOARD_SIZE + (col + dc)] === null);
}

// Scans in corner coordinates (bounded and simple: row/col + shape's
// own rows/cols <= BOARD_SIZE) but returns the domain in pivot
// coordinates - shape.pivot (see patches.js) is the one, shared
// definition of what "row, col" means on the wire for this shape, so
// every corner anchor gets shifted by it before being handed back.
function placementDomain(board, shape) {
  const domain = [];
  for (let row = 0; row + shape.rows <= BOARD_SIZE; row++) {
    for (let col = 0; col + shape.cols <= BOARD_SIZE; col++) {
      if (fits(board, shape, row, col)) domain.push([row + shape.pivot[0], col + shape.pivot[1]]);
    }
  }
  return domain;
}

// Pure function: state -> Action[]. Same "Client Authority: Zero"
// pattern as before, extended with an optional `selection` (which
// patch/rotation the client currently has picked, if any) - the client
// never computes placement legality itself, it asks for the domain
// once it knows which patch it wants to try.
//
// Always checks against quiltBoards[state.currentPlayer] - server.js's
// scopedActions already returns [] to anyone who isn't the current
// player, so only the current player's own board is ever a legitimate
// query target here.
function queryLegalActions(state, { patchId, rotation } = {}) {
  if (state.status !== 'in-progress') {
    return [];
  }
  if (patchId == null) {
    return [{ type: 'selectPatch', params: { patchId: { domain: state.availablePatches.slice() } } }];
  }
  if (!state.availablePatches.includes(patchId)) {
    return [];
  }
  const patch = getPatch(patchId);
  if (!patch) return [];
  const rot = ((Number(rotation) || 0) % 4 + 4) % 4;
  const shape = rotatePatch(patch, rot);
  const board = state.quiltBoards[state.currentPlayer];
  const domain = placementDomain(board, shape);
  return [{ type: 'placePatch', params: { patchId, rotation: rot, anchor: { domain } } }];
}

// Pure function: (state, action) -> { state, error }
// Never mutates the input state. Re-derives the same fit check
// queryLegalActions would report - never trusts the client's own
// rotation/pivot math.
function applyAction(state, action) {
  if (state.status === 'lobby') {
    return { state, error: 'lobby-not-started' };
  }
  if (state.status !== 'in-progress') {
    return { state, error: 'game-over' };
  }
  if (!action || action.type !== 'placePatch') {
    return { state, error: 'unknown-action' };
  }

  // action.row/action.col are the shape's *pivot* position on the board
  // - the same coordinate space queryLegalActions' anchor domain is in,
  // and the same one the client renders/highlights in (see
  // patches.js's rotatePatch). Converted to a top-left corner here,
  // once, before any of the actual fit/bounds checking below.
  const { patchId, row, col } = action;
  if (typeof patchId !== 'string' || !state.availablePatches.includes(patchId)) {
    return { state, error: 'invalid-patch' };
  }
  const patch = getPatch(patchId);
  if (!patch) {
    return { state, error: 'invalid-patch' };
  }
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return { state, error: 'invalid-placement' };
  }

  const rotation = ((Number(action.rotation) || 0) % 4 + 4) % 4;
  const shape = rotatePatch(patch, rotation);
  const anchorRow = row - shape.pivot[0];
  const anchorCol = col - shape.pivot[1];
  if (anchorRow < 0 || anchorCol < 0 || anchorRow + shape.rows > BOARD_SIZE || anchorCol + shape.cols > BOARD_SIZE) {
    return { state, error: 'invalid-placement' };
  }

  const board = state.quiltBoards[state.currentPlayer];
  if (!fits(board, shape, anchorRow, anchorCol)) {
    return { state, error: 'invalid-placement' };
  }

  const nextBoard = board.slice();
  for (const [dr, dc] of shape.cells) {
    nextBoard[(anchorRow + dr) * BOARD_SIZE + (anchorCol + dc)] = patchId;
  }

  const availablePatches = state.availablePatches.filter((id) => id !== patchId);
  const nextPlayer = state.currentPlayer === 'X' ? 'O' : 'X';

  const nextState = {
    quiltBoards: { ...state.quiltBoards, [state.currentPlayer]: nextBoard },
    availablePatches,
    currentPlayer: nextPlayer,
    status: availablePatches.length === 0 ? 'complete' : 'in-progress',
  };

  return { state: nextState, error: null };
}

module.exports = { createGame, applyAction, queryLegalActions, startGame };
