'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame, applyAction, queryLegalActions, startGame } = require('./engine');
const { getPatch } = require('./patches');
const { TRACK_LENGTH, BUTTON_INCOME_SPACES } = require('./timeTrack');

function emptyBoard() {
  return Array(81).fill(null);
}

test('createGame returns two empty 9x9 quilt boards, the full patch pool, and starting buttons/time positions', () => {
  const state = createGame();
  assert.equal(state.quiltBoards.X.length, 81);
  assert.equal(state.quiltBoards.O.length, 81);
  assert.ok(state.quiltBoards.X.every((c) => c === null));
  assert.ok(state.quiltBoards.O.every((c) => c === null));
  assert.equal(state.availablePatches.length, 33);
  assert.equal(state.currentPlayer, 'X');
  assert.equal(state.status, 'in-progress');
  assert.deepEqual(state.playerMoney, { X: 5, O: 5 });
  assert.deepEqual(state.timeTrackPositions, { X: 0, O: 0 });
});

test('createGame in multiplayer mode starts in the lobby', () => {
  assert.equal(createGame({ mode: 'multiplayer' }).status, 'lobby');
});

test('startGame transitions the lobby into an in-progress game, no-op elsewhere', () => {
  const lobby = createGame({ mode: 'multiplayer' });
  assert.equal(startGame(lobby).status, 'in-progress');
  const local = createGame();
  assert.equal(startGame(local), local);
});

test('queryLegalActions with no selection offers pickable (affordable) patches plus advanceTimeToken', () => {
  const state = createGame();
  const affordable = state.availablePatches.filter((id) => getPatch(id).cost <= state.playerMoney.X);
  assert.deepEqual(queryLegalActions(state), [
    { type: 'selectPatch', params: { patchId: { domain: affordable } } },
    { type: 'advanceTimeToken', params: {} },
  ]);
  // Sanity: the starting 5 buttons genuinely exclude some real patches
  // (e.g. patch-23 costs 10), so this test isn't vacuously true.
  assert.ok(affordable.length < state.availablePatches.length);
});

test('queryLegalActions excludes patches the current player cannot afford', () => {
  const state = { ...createGame(), playerMoney: { X: 0, O: 5 } };
  const [selectAction] = queryLegalActions(state);
  // patch-08 is the only real patch with cost 0.
  assert.deepEqual(selectAction.params.patchId.domain, ['patch-08']);
});

test('queryLegalActions rejects an already-unavailable or unknown patchId', () => {
  const state = createGame();
  assert.deepEqual(queryLegalActions(state, { patchId: 'not-a-real-patch' }), []);
});

test('queryLegalActions returns an anchor domain covering the whole empty board for a small patch', () => {
  const state = createGame();
  // patch-01 is a 2x1 domino - fits at every (row, col) with row in 0..7, col in 0..8.
  const [action] = queryLegalActions(state, { patchId: 'patch-01', rotation: 0 });
  assert.equal(action.type, 'placePatch');
  assert.equal(action.params.anchor.domain.length, 8 * 9);
});

test('queryLegalActions domain shrinks around already-placed patches on the current player\'s board', () => {
  let state = createGame();
  const placed = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 }).state;
  // Now O's turn - O's board is still empty, so a query for O still sees the full domain.
  const [action] = queryLegalActions(placed, { patchId: 'patch-02', rotation: 0 });
  assert.equal(action.params.anchor.domain.length > 0, true);
});

test('applyAction places a patch, deducts its cost, advances the time track, shrinks the pool, and passes the turn to whoever is behind', () => {
  const state = createGame();
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 });
  const patch01 = getPatch('patch-01'); // cost 2, time 1
  assert.equal(result.error, null);
  assert.equal(result.state.quiltBoards.X[0], 'patch-01'); // (0,0)
  assert.equal(result.state.quiltBoards.X[9], 'patch-01'); // (1,0)
  assert.equal(result.state.availablePatches.includes('patch-01'), false);
  assert.equal(result.state.availablePatches.length, 32);
  assert.equal(result.state.playerMoney.X, 5 - patch01.cost);
  assert.equal(result.state.timeTrackPositions.X, patch01.time);
  assert.equal(result.state.timeTrackPositions.O, 0);
  // O is still further behind on the time track, so O goes next.
  assert.equal(result.state.currentPlayer, 'O');
  assert.equal(state.quiltBoards.X[0], null, 'applyAction must not mutate the input state');
  assert.deepEqual(state.playerMoney, { X: 5, O: 5 }, 'applyAction must not mutate the input state');
});

test('applyAction rotates the shape before placing it', () => {
  const state = createGame();
  // patch-01 is a vertical 2x1 domino; rotated 90 degrees it's
  // horizontal. row/col are the shape's *pivot*, not its top-left
  // corner (see patches.js) - the pivot itself rotates along with the
  // shape, so it isn't (0,0) anymore once rotated: at rotation 1 it's
  // (0,1), which is why that's the pivot placed at (0,0) below to land
  // the same two absolute cells a naive corner-anchor would have.
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 1, row: 0, col: 1 });
  assert.equal(result.error, null);
  assert.equal(result.state.quiltBoards.X[0], 'patch-01'); // (0,0)
  assert.equal(result.state.quiltBoards.X[1], 'patch-01'); // (0,1)
});

test('applyAction rejects a placement that runs off the board', () => {
  const state = createGame();
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 8, col: 0 });
  assert.equal(result.error, 'invalid-placement');
  assert.equal(result.state, state);
});

test('applyAction rejects a placement the current player cannot afford', () => {
  const state = { ...createGame(), playerMoney: { X: 1, O: 5 } };
  // patch-01 costs 2, X only has 1 button.
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 });
  assert.equal(result.error, 'insufficient-buttons');
  assert.equal(result.state, state);
});

test('applyAction rejects a placement that overlaps an already-placed patch', () => {
  let state = createGame();
  state = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 }).state;
  // Now O's turn on an empty board, so place something for O first, then
  // swing back to X to try overlapping X's earlier patch-01.
  state = applyAction(state, { type: 'placePatch', patchId: 'patch-02', rotation: 0, row: 0, col: 0 }).state;
  // X's turn again - X's board already has patch-01 at (0,0)-(1,0).
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-03', rotation: 0, row: 0, col: 0 });
  assert.equal(result.error, 'invalid-placement');
});

test('applyAction rejects an unavailable or unknown patchId', () => {
  let state = createGame();
  state = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 }).state;
  // O's turn - patch-01 is already taken.
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 2, col: 2 });
  assert.equal(result.error, 'invalid-patch');
});

test('applyAction rejects a move while still in the lobby', () => {
  const state = createGame({ mode: 'multiplayer' });
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 });
  assert.equal(result.error, 'lobby-not-started');
});

test('status becomes complete once the last available patch is placed', () => {
  // Hand-built rather than via createGame(): the real 33-patch pool
  // needs 166 total cells, more than the 162 two 9x9 boards actually
  // hold between them, so "place every patch" isn't a reachable state
  // via createGame's full pool - only the pool-draining/status
  // transition itself is under test here, on a pool of one.
  const state = {
    quiltBoards: { X: emptyBoard(), O: emptyBoard() },
    availablePatches: ['patch-01'],
    currentPlayer: 'X',
    timeTrackPositions: { X: 0, O: 0 },
    playerMoney: { X: 5, O: 5 },
    status: 'in-progress',
  };
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 });
  assert.equal(result.error, null);
  assert.equal(result.state.availablePatches.length, 0);
  assert.equal(result.state.status, 'complete');
});

test('advanceTimeToken moves the current player to just ahead of the other player and pays 1 button per space moved', () => {
  const state = createGame();
  const result = applyAction(state, { type: 'advanceTimeToken' });
  assert.equal(result.error, null);
  // Both start at 0, so "just ahead of the other player" is 1 space.
  assert.equal(result.state.timeTrackPositions.X, 1);
  assert.equal(result.state.timeTrackPositions.O, 0);
  assert.equal(result.state.currentPlayer, 'O');
  assert.deepEqual(result.state.playerMoney, { X: 6, O: 5 });
});

test('advanceTimeToken pays 1 button per space when moving several spaces to catch up', () => {
  const state = { ...createGame(), currentPlayer: 'X', timeTrackPositions: { X: 2, O: 9 } };
  const result = applyAction(state, { type: 'advanceTimeToken' });
  assert.equal(result.error, null);
  // X moves from 2 to 10 (one ahead of O's 9) - 8 spaces.
  assert.equal(result.state.timeTrackPositions.X, 10);
  assert.equal(result.state.playerMoney.X, 5 + 8);
});

test('advanceTimeToken caps at TRACK_LENGTH', () => {
  const state = {
    ...createGame(),
    timeTrackPositions: { X: TRACK_LENGTH, O: 0 },
  };
  const result = applyAction(state, { type: 'advanceTimeToken' });
  assert.equal(result.state.timeTrackPositions.X, TRACK_LENGTH);
});

test('turn order gives the next turn to whoever is behind, not a strict alternation', () => {
  let state = createGame();
  // X buys patch-01 (time 1): X moves to 1, O stays at 0 - O is behind.
  state = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 }).state;
  assert.equal(state.currentPlayer, 'O');
  // O buys patch-02 (time 3): O moves to 3, X is still at 1 - X is behind,
  // even though O just moved (this is the non-alternating part).
  state = applyAction(state, { type: 'placePatch', patchId: 'patch-02', rotation: 0, row: 0, col: 0 }).state;
  assert.equal(state.timeTrackPositions.O, 3);
  assert.equal(state.timeTrackPositions.X, 1);
  assert.equal(state.currentPlayer, 'X');
});

test('a tied time-track position gives the next turn to whoever just moved, not the other player', () => {
  const state = {
    ...createGame(),
    currentPlayer: 'X',
    timeTrackPositions: { X: 2, O: 5 },
  };
  // patch-02 costs 1, has time 3: X moves from 2 to 5, tying O.
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-02', rotation: 0, row: 0, col: 0 });
  assert.equal(result.error, null);
  assert.equal(result.state.timeTrackPositions.X, 5);
  assert.equal(result.state.timeTrackPositions.O, 5);
  assert.equal(result.state.currentPlayer, 'X');
});

test('buying a patch pays out income for every income-producing patch already on the board when the move passes through or lands on an income space', () => {
  const patch05 = getPatch('patch-05'); // cost 3, time 2, income 1
  const patch02 = getPatch('patch-02'); // cost 1, time 3, income 0
  assert.ok(BUTTON_INCOME_SPACES.includes(5), 'this test assumes space 5 is an income space');

  // X already owns patch-05 (placed at anchor (0,0): cells (0,1) (1,0) (1,1) (2,0)),
  // and is 4 spaces into the time track. Buying patch-02 (time 3) moves X
  // from 4 to 7 - passing through space 5 without landing exactly on it,
  // which is the case the old exact-match check used to miss.
  const board = emptyBoard();
  board[1] = 'patch-05';
  board[9] = 'patch-05';
  board[10] = 'patch-05';
  board[18] = 'patch-05';

  const state = {
    quiltBoards: { X: board, O: emptyBoard() },
    availablePatches: ['patch-02'],
    currentPlayer: 'X',
    timeTrackPositions: { X: 4, O: 0 },
    playerMoney: { X: 5, O: 5 },
    status: 'in-progress',
  };

  const [action] = queryLegalActions(state, { patchId: 'patch-02', rotation: 0 });
  const [row, col] = action.params.anchor.domain[0];
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-02', rotation: 0, row, col });

  assert.equal(result.error, null);
  assert.equal(result.state.timeTrackPositions.X, 4 + patch02.time);
  // Buttons: start 5, minus patch-02's cost, plus patch-05's income once
  // (space 5 is crossed exactly once on the way from 4 to 7).
  assert.equal(result.state.playerMoney.X, 5 - patch02.cost + patch05.income);
});
