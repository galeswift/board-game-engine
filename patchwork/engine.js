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
const { TRACK_LENGTH, BUTTON_INCOME_SPACES } = require('./timeTrack');

const BOARD_SIZE = 9;

function emptyBoard() {
  return Array(BOARD_SIZE * BOARD_SIZE).fill(null);
}

function createGame({ mode = 'local' } = {}) {
  return {
    quiltBoards: { X: emptyBoard(), O: emptyBoard() },
    availablePatches: PATCHES.map((p) => p.id),
    currentPlayer: 'X',
    timeTrackPositions: { X: 0, O: 0 },
    playerMoney: { X: 5, O: 5 },
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
    const affordablePatches = state.availablePatches.filter((id) => {
      const patch = getPatch(id);
      return patch && patch.cost <= state.playerMoney[state.currentPlayer];
    });
    return [{ type: 'selectPatch', params: { patchId: { domain: affordablePatches } } },
            { type: 'advanceTimeToken', params: {} } ];
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
  if (!action ) {
    return { state, error: 'no-action' };
  }

  let nextState = state;
  if( action.type === 'placePatch')
  {
    nextState = placePatchGetNextState(state, action);
  }
  else if( action.type === 'advanceTimeToken')
  {
    nextState = advanceTimeTokenGetNextState(state, action); 
  }

  if (nextState.error) {
    return { state, error: nextState.error };
  }

  return { state: nextState, error: null };
}

function advanceTimeTokenGetNextState(state, action) {
  if( action.type !== 'advanceTimeToken' )
    return { state, error: 'unknown-action' };

  const nextTimeTrackPositions = { ...state.timeTrackPositions };

  // Move to one space in front of the other player (this action can only be taken by the active player, which guarantees that numSpacesToAdvance is at least 1)
  const numSpacesToAdvance = Math.max(0, state.timeTrackPositions[otherPlayer(state.currentPlayer)] - state.timeTrackPositions[state.currentPlayer] + 1 );
  const nextPosition = state.timeTrackPositions[state.currentPlayer] + numSpacesToAdvance;
  if( nextPosition > TRACK_LENGTH )
  {
    return { state, error: 'somehow got ahead of the track' };
  }
  nextTimeTrackPositions[state.currentPlayer] = Math.min(nextPosition, TRACK_LENGTH);
  
  const nextPlayerMoney = { ...state.playerMoney };

  // You get a button for each space moved
  nextPlayerMoney[state.currentPlayer] += numSpacesToAdvance;

  // Add button income for each space advanced, if the space is a button income space
  nextPlayerMoney[state.currentPlayer] += calculateGlobalBoardIncome(state, state.quiltBoards, nextTimeTrackPositions);

  return {
    quiltBoards: { ...state.quiltBoards },
    availablePatches: state.availablePatches,
    currentPlayer: nextPlayerFrom(nextTimeTrackPositions, state.currentPlayer),
    timeTrackPositions: nextTimeTrackPositions,
    playerMoney: nextPlayerMoney,
    status: state.status,
  };
}

function calculateGlobalBoardIncome(state, nextBoard, nextTimeTrackPositions) {
  let income = 0;
  for (let timeTrackPosition = state.timeTrackPositions[state.currentPlayer] + 1; timeTrackPosition <= nextTimeTrackPositions[state.currentPlayer]; timeTrackPosition++) {
    if (BUTTON_INCOME_SPACES.includes(timeTrackPosition)) {
      income += calculateButtonIncome(nextBoard[state.currentPlayer]);
    }
  }
  return income;
}

function otherPlayer(player) {
  return player === 'X' ? 'O' : 'X';
}

function nextPlayerFrom(timeTrackPositions, currentPlayer) { 
  if ( timeTrackPositions.X == timeTrackPositions.O )
  {
      return currentPlayer;
  }
  else
  {
      return timeTrackPositions.X < timeTrackPositions.O ? 'X' : 'O';
  }
}

function calculateButtonIncome(board) {
  let income = 0;
  for (const patchId of new Set(board)) {
    if (patchId) {
      const patch = getPatch(patchId);
      if (patch && patch.income) {
        income += patch.income;
      }
    }
  }
  return income;
} 

function placePatchGetNextState(state, action) {

  if( action.type !== 'placePatch' )
    return { state, error: 'unknown-action' };

  // Validate the patchId, rotation, and anchor coordinates. The pivot
  // is the one, shared definition of what "row, col" means on the wire
  // for this shape (see patches.js), so every corner anchor gets
  // shifted by it before being handed back.
  
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

  if( patch.cost > state.playerMoney[state.currentPlayer] )
  {
    return { state, error: 'insufficient-buttons' };
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

  // Piece is valid to place - compute the next state. Copy the board, apply the patch,
  const nextPlayerMoney = { ...state.playerMoney };
  nextPlayerMoney[state.currentPlayer] -= patch.cost;

  const nextBoard = board.slice();
  for (const [dr, dc] of shape.cells) {
    nextBoard[(anchorRow + dr) * BOARD_SIZE + (anchorCol + dc)] = patchId;
  }

  const nextBoards = { ...state.quiltBoards, [state.currentPlayer]: nextBoard };
  const nextTimeTrackPositions = { ...state.timeTrackPositions };
  nextTimeTrackPositions[state.currentPlayer] = Math.min(nextTimeTrackPositions[state.currentPlayer] + patch.time, TRACK_LENGTH);
  nextPlayerMoney[state.currentPlayer] += calculateGlobalBoardIncome(state, nextBoards, nextTimeTrackPositions);

  const availablePatches = state.availablePatches.filter((id) => id !== patchId);
  const nextPlayer = nextPlayerFrom(nextTimeTrackPositions, state.currentPlayer);


  return {
    quiltBoards: nextBoards,
    availablePatches,
    currentPlayer: nextPlayer,
    timeTrackPositions: nextTimeTrackPositions,
    playerMoney: nextPlayerMoney,
    status: availablePatches.length === 0 ? 'complete' : 'in-progress',
  };
}

module.exports = { createGame, applyAction, queryLegalActions, startGame };
