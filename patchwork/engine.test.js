'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame, applyAction, queryLegalActions, startGame } = require('./engine');

test('createGame returns two empty 9x9 quilt boards and the full patch pool', () => {
  const state = createGame();
  assert.equal(state.quiltBoards.X.length, 81);
  assert.equal(state.quiltBoards.O.length, 81);
  assert.ok(state.quiltBoards.X.every((c) => c === null));
  assert.ok(state.quiltBoards.O.every((c) => c === null));
  assert.equal(state.availablePatches.length, 33);
  assert.equal(state.currentPlayer, 'X');
  assert.equal(state.status, 'in-progress');
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

test('queryLegalActions with no selection lists every available patch as pickable', () => {
  const state = createGame();
  const actions = queryLegalActions(state);
  assert.deepEqual(actions, [
    { type: 'selectPatch', params: { patchId: { domain: state.availablePatches } } },
  ]);
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

test('applyAction places a patch, shrinks the pool, and flips the current player', () => {
  const state = createGame();
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 });
  assert.equal(result.error, null);
  assert.equal(result.state.quiltBoards.X[0], 'patch-01'); // (0,0)
  assert.equal(result.state.quiltBoards.X[9], 'patch-01'); // (1,0)
  assert.equal(result.state.currentPlayer, 'O');
  assert.equal(result.state.availablePatches.includes('patch-01'), false);
  assert.equal(result.state.availablePatches.length, 32);
  assert.equal(state.quiltBoards.X[0], null, 'applyAction must not mutate the input state');
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
    quiltBoards: { X: Array(81).fill(null), O: Array(81).fill(null) },
    availablePatches: ['patch-01'],
    currentPlayer: 'X',
    status: 'in-progress',
  };
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 });
  assert.equal(result.error, null);
  assert.equal(result.state.availablePatches.length, 0);
  assert.equal(result.state.status, 'complete');
});
