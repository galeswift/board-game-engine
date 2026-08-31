'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame, applyAction, queryLegalActions, startGame } = require('./engine');

test('createGame returns a fresh, empty board', () => {
  const state = createGame();
  assert.deepEqual(state.board, Array(9).fill(null));
  assert.equal(state.currentPlayer, 'X');
  assert.equal(state.winner, null);
  assert.equal(state.status, 'in-progress');
});

test('applyAction places a piece and alternates the current player', () => {
  const state = createGame();
  const result = applyAction(state, { type: 'placePiece', cell: 4 });
  assert.equal(result.error, null);
  assert.equal(result.state.board[4], 'X');
  assert.equal(result.state.currentPlayer, 'O');
  assert.equal(state.board[4], null, 'applyAction must not mutate the input state');
});

test('applyAction detects a win', () => {
  let state = createGame();
  for (const cell of [0, 3, 1, 4, 2]) { // X: 0,1,2 (top row) / O: 3,4
    state = applyAction(state, { type: 'placePiece', cell }).state;
  }
  assert.equal(state.status, 'won');
  assert.equal(state.winner, 'X');
});

test('applyAction detects a draw', () => {
  let state = createGame();
  // X O X / X O O / O X X
  for (const cell of [0, 1, 2, 4, 3, 5, 7, 6, 8]) {
    state = applyAction(state, { type: 'placePiece', cell }).state;
  }
  assert.equal(state.status, 'draw');
  assert.equal(state.winner, null);
});

test('applyAction rejects an occupied cell', () => {
  let state = createGame();
  state = applyAction(state, { type: 'placePiece', cell: 0 }).state;
  const result = applyAction(state, { type: 'placePiece', cell: 0 });
  assert.equal(result.error, 'occupied');
  assert.equal(result.state, state, 'rejected action returns the unchanged state');
});

test('applyAction rejects an out-of-range or non-integer cell', () => {
  const state = createGame();
  assert.equal(applyAction(state, { type: 'placePiece', cell: 99 }).error, 'invalid-cell');
  assert.equal(applyAction(state, { type: 'placePiece', cell: -1 }).error, 'invalid-cell');
  assert.equal(applyAction(state, { type: 'placePiece', cell: 1.5 }).error, 'invalid-cell');
});

test('applyAction rejects a move once the game is over', () => {
  let state = createGame();
  for (const cell of [0, 3, 1, 4, 2]) {
    state = applyAction(state, { type: 'placePiece', cell }).state;
  }
  const result = applyAction(state, { type: 'placePiece', cell: 5 });
  assert.equal(result.error, 'game-over');
});

test('queryLegalActions lists every empty cell as a placePiece domain on a fresh game', () => {
  const state = createGame();
  assert.deepEqual(queryLegalActions(state), [
    { type: 'placePiece', params: { cell: { domain: [0, 1, 2, 3, 4, 5, 6, 7, 8] } } },
  ]);
});

test('queryLegalActions domain shrinks as cells fill up', () => {
  let state = createGame();
  state = applyAction(state, { type: 'placePiece', cell: 4 }).state;
  const [action] = queryLegalActions(state);
  assert.deepEqual(action.params.cell.domain, [0, 1, 2, 3, 5, 6, 7, 8]);
});

test('queryLegalActions returns no actions once the game is won', () => {
  let state = createGame();
  for (const cell of [0, 3, 1, 4, 2]) {
    state = applyAction(state, { type: 'placePiece', cell }).state;
  }
  assert.deepEqual(queryLegalActions(state), []);
});

test('queryLegalActions returns no actions once the game is a draw', () => {
  let state = createGame();
  for (const cell of [0, 1, 2, 4, 3, 5, 7, 6, 8]) {
    state = applyAction(state, { type: 'placePiece', cell }).state;
  }
  assert.deepEqual(queryLegalActions(state), []);
});

test('createGame defaults to local mode, starting in-progress immediately', () => {
  assert.equal(createGame().status, 'in-progress');
  assert.equal(createGame({ mode: 'local' }).status, 'in-progress');
});

test('createGame in multiplayer mode starts in the lobby', () => {
  const state = createGame({ mode: 'multiplayer' });
  assert.equal(state.status, 'lobby');
  assert.deepEqual(state.board, Array(9).fill(null));
  assert.equal(state.currentPlayer, 'X');
});

test('applyAction rejects a move while still in the lobby', () => {
  const state = createGame({ mode: 'multiplayer' });
  const result = applyAction(state, { type: 'placePiece', cell: 0 });
  assert.equal(result.error, 'lobby-not-started');
  assert.equal(result.state, state, 'rejected action returns the unchanged state');
});

test('queryLegalActions returns no actions while still in the lobby', () => {
  const state = createGame({ mode: 'multiplayer' });
  assert.deepEqual(queryLegalActions(state), []);
});

test('startGame transitions the lobby into an in-progress game', () => {
  const state = createGame({ mode: 'multiplayer' });
  const started = startGame(state);
  assert.equal(started.status, 'in-progress');
  assert.equal(started.currentPlayer, 'X');
  assert.deepEqual(started.board, Array(9).fill(null));
  assert.equal(state.status, 'lobby', 'startGame must not mutate the input state');
});

test('startGame is a no-op outside the lobby', () => {
  const state = createGame(); // local, already in-progress
  assert.equal(startGame(state), state);
});
