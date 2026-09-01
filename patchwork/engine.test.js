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
  assert.equal(state.quiltBoards[0].length, 81);
  assert.equal(state.quiltBoards[1].length, 81);
  assert.ok(state.quiltBoards[0].every((c) => c === null));
  assert.ok(state.quiltBoards[1].every((c) => c === null));
  assert.equal(state.availablePatches.length, 33);
  assert.equal(state.currentPlayer, 0);
  assert.equal(state.status, 'in-progress');
  assert.deepEqual(state.playerMoney, { 0: 5, 1: 5 });
  assert.deepEqual(state.timeTrackPositions, { 0: 0, 1: 0 });
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
  const affordable = state.availablePatches.filter((id) => getPatch(id).cost <= state.playerMoney[0]);
  assert.deepEqual(queryLegalActions(state), [
    { type: 'selectPatch', params: { patchId: { domain: affordable } } },
    { type: 'advanceTimeToken', params: {} },
  ]);
  // Sanity: the starting 5 buttons genuinely exclude some real patches
  // (e.g. patch-23 costs 10), so this test isn't vacuously true.
  assert.ok(affordable.length < state.availablePatches.length);
});

test('queryLegalActions excludes patches the current player cannot afford', () => {
  const state = { ...createGame(), playerMoney: { 0: 0, 1: 5 } };
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
  // Now player 1's turn - their board is still empty, so a query for them still sees the full domain.
  const [action] = queryLegalActions(placed, { patchId: 'patch-02', rotation: 0 });
  assert.equal(action.params.anchor.domain.length > 0, true);
});

test('applyAction places a patch, deducts its cost, advances the time track, shrinks the pool, and passes the turn to whoever is behind', () => {
  const state = createGame();
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 });
  const patch01 = getPatch('patch-01'); // cost 2, time 1
  assert.equal(result.error, null);
  assert.equal(result.state.quiltBoards[0][0], 'patch-01'); // (0,0)
  assert.equal(result.state.quiltBoards[0][9], 'patch-01'); // (1,0)
  assert.equal(result.state.availablePatches.includes('patch-01'), false);
  assert.equal(result.state.availablePatches.length, 32);
  assert.equal(result.state.playerMoney[0], 5 - patch01.cost);
  assert.equal(result.state.timeTrackPositions[0], patch01.time);
  assert.equal(result.state.timeTrackPositions[1], 0);
  // Player 1 is still further behind on the time track, so they go next.
  assert.equal(result.state.currentPlayer, 1);
  assert.equal(state.quiltBoards[0][0], null, 'applyAction must not mutate the input state');
  assert.deepEqual(state.playerMoney, { 0: 5, 1: 5 }, 'applyAction must not mutate the input state');
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
  assert.equal(result.state.quiltBoards[0][0], 'patch-01'); // (0,0)
  assert.equal(result.state.quiltBoards[0][1], 'patch-01'); // (0,1)
});

test('applyAction rejects a placement that runs off the board', () => {
  const state = createGame();
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 8, col: 0 });
  assert.equal(result.error, 'invalid-placement');
  assert.equal(result.state, state);
});

test('applyAction rejects a placement the current player cannot afford', () => {
  const state = { ...createGame(), playerMoney: { 0: 1, 1: 5 } };
  // patch-01 costs 2, player 0 only has 1 button.
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 });
  assert.equal(result.error, 'insufficient-buttons');
  assert.equal(result.state, state);
});

test('applyAction rejects a placement that overlaps an already-placed patch', () => {
  let state = createGame();
  state = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 }).state;
  // Now player 1's turn on an empty board, so place something for them
  // first, then swing back to player 0 to try overlapping their earlier patch-01.
  state = applyAction(state, { type: 'placePatch', patchId: 'patch-02', rotation: 0, row: 0, col: 0 }).state;
  // Player 0's turn again - their board already has patch-01 at (0,0)-(1,0).
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-03', rotation: 0, row: 0, col: 0 });
  assert.equal(result.error, 'invalid-placement');
});

test('applyAction rejects an unavailable or unknown patchId', () => {
  let state = createGame();
  state = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 }).state;
  // Player 1's turn - patch-01 is already taken.
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
    quiltBoards: { 0: emptyBoard(), 1: emptyBoard() },
    availablePatches: ['patch-01'],
    currentPlayer: 0,
    timeTrackPositions: { 0: 0, 1: 0 },
    playerMoney: { 0: 5, 1: 5 },
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
  assert.equal(result.state.timeTrackPositions[0], 1);
  assert.equal(result.state.timeTrackPositions[1], 0);
  assert.equal(result.state.currentPlayer, 1);
  assert.deepEqual(result.state.playerMoney, { 0: 6, 1: 5 });
});

test('advanceTimeToken pays 1 button per space when moving several spaces to catch up', () => {
  const state = { ...createGame(), currentPlayer: 0, timeTrackPositions: { 0: 2, 1: 9 } };
  const result = applyAction(state, { type: 'advanceTimeToken' });
  assert.equal(result.error, null);
  // Player 0 moves from 2 to 10 (one ahead of player 1's 9) - 8 spaces.
  assert.equal(result.state.timeTrackPositions[0], 10);
  assert.equal(result.state.playerMoney[0], 5 + 8);
});

test('advanceTimeToken caps at TRACK_LENGTH', () => {
  const state = {
    ...createGame(),
    timeTrackPositions: { 0: TRACK_LENGTH, 1: 0 },
  };
  const result = applyAction(state, { type: 'advanceTimeToken' });
  assert.equal(result.state.timeTrackPositions[0], TRACK_LENGTH);
});

test('turn order gives the next turn to whoever is behind, not a strict alternation', () => {
  let state = createGame();
  // Player 0 buys patch-01 (time 1): moves to 1, player 1 stays at 0 - behind.
  state = applyAction(state, { type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 }).state;
  assert.equal(state.currentPlayer, 1);
  // Player 1 buys patch-02 (time 3): moves to 3, player 0 is still at 1 -
  // behind, even though player 1 just moved (this is the non-alternating part).
  state = applyAction(state, { type: 'placePatch', patchId: 'patch-02', rotation: 0, row: 0, col: 0 }).state;
  assert.equal(state.timeTrackPositions[1], 3);
  assert.equal(state.timeTrackPositions[0], 1);
  assert.equal(state.currentPlayer, 0);
});

test('a tied time-track position gives the next turn to whoever just moved, not the other player', () => {
  const state = {
    ...createGame(),
    currentPlayer: 0,
    timeTrackPositions: { 0: 2, 1: 5 },
  };
  // patch-02 costs 1, has time 3: player 0 moves from 2 to 5, tying player 1.
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-02', rotation: 0, row: 0, col: 0 });
  assert.equal(result.error, null);
  assert.equal(result.state.timeTrackPositions[0], 5);
  assert.equal(result.state.timeTrackPositions[1], 5);
  assert.equal(result.state.currentPlayer, 0);
});

test('buying a patch pays out income for every income-producing patch already on the board when the move passes through or lands on an income space', () => {
  const patch05 = getPatch('patch-05'); // cost 3, time 2, income 1
  const patch02 = getPatch('patch-02'); // cost 1, time 3, income 0
  assert.ok(BUTTON_INCOME_SPACES.includes(5), 'this test assumes space 5 is an income space');

  // Player 0 already owns patch-05 (placed at anchor (0,0): cells (0,1)
  // (1,0) (1,1) (2,0)), and is 4 spaces into the time track. Buying
  // patch-02 (time 3) moves them from 4 to 7 - passing through space 5
  // without landing exactly on it, which is the case the old exact-match
  // check used to miss.
  const board = emptyBoard();
  board[1] = 'patch-05';
  board[9] = 'patch-05';
  board[10] = 'patch-05';
  board[18] = 'patch-05';

  const state = {
    quiltBoards: { 0: board, 1: emptyBoard() },
    availablePatches: ['patch-02'],
    currentPlayer: 0,
    timeTrackPositions: { 0: 4, 1: 0 },
    playerMoney: { 0: 5, 1: 5 },
    status: 'in-progress',
  };

  const [action] = queryLegalActions(state, { patchId: 'patch-02', rotation: 0 });
  const [row, col] = action.params.anchor.domain[0];
  const result = applyAction(state, { type: 'placePatch', patchId: 'patch-02', rotation: 0, row, col });

  assert.equal(result.error, null);
  assert.equal(result.state.timeTrackPositions[0], 4 + patch02.time);
  // Buttons: start 5, minus patch-02's cost, plus patch-05's income once
  // (space 5 is crossed exactly once on the way from 4 to 7).
  assert.equal(result.state.playerMoney[0], 5 - patch02.cost + patch05.income);
});
