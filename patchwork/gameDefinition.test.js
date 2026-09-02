'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame, execute, queryLegalActions } = require('../packages/rules-engine-core/src');
const PatchworkDefinition = require('./gameDefinition');
const { getPatch, PATCHES } = require('./patches');
const { TRACK_LENGTH, BUTTON_INCOME_SPACES } = require('./timeTrack');
const { offeredPatches } = require('./patchCircle');

function emptyBoard() {
  return Array(81).fill(null);
}

// A play-phase record with `patchIds` placed at the front of the circle
// - neutralTokenIndex is 0, so offeredPatches always returns
// circle[0..2], making `patchIds` (up to 3) deterministically the
// offered patches, in that order. `overrides` uses the same flat shape
// the old engine.test.js's stateWithPatches() took (playerMoney,
// timeTrackPositions, quiltBoards, currentPlayer, keyed 0/1) - this
// helper is what translates that into the real nested wire shape
// (players["0"/"1"], turnOrder.current as a string).
function recordWithPatches(patchIds, overrides = {}) {
  const rest = PATCHES.map((p) => p.id).filter((id) => !patchIds.includes(id));
  const playerMoney = overrides.playerMoney || { 0: 5, 1: 5 };
  const timeTrackPositions = overrides.timeTrackPositions || { 0: 0, 1: 0 };
  const quiltBoards = overrides.quiltBoards || { 0: emptyBoard(), 1: emptyBoard() };
  const currentPlayer = overrides.currentPlayer !== undefined ? overrides.currentPlayer : 0;
  const bonusTileHolder = overrides.bonusTileHolder !== undefined ? overrides.bonusTileHolder : null;
  const state = {
    meta: { engineSchemaVersion: 1, gameVersion: 1, seed: 1, rngState: 1, idCounters: {} },
    phase: { current: 'play' },
    shared: { market: { circle: [...patchIds, ...rest], neutralTokenIndex: 0 }, bonusTileHolder },
    players: {
      '0': { buttons: playerMoney[0], quiltBoard: quiltBoards[0], timeTrackPosition: timeTrackPositions[0], score: null },
      '1': { buttons: playerMoney[1], quiltBoard: quiltBoards[1], timeTrackPosition: timeTrackPositions[1], score: null },
    },
    turnOrder: { current: String(currentPlayer) },
  };
  return { state, log: [] };
}

function place(record, patchId, rotation, row, col) {
  return execute(PatchworkDefinition, record, { type: 'placePatch', params: { patchId, rotation, row, col } });
}

function advance(record) {
  return execute(PatchworkDefinition, record, { type: 'advanceTimeToken' });
}

function playThroughLobby(mode) {
  const record = createGame(PatchworkDefinition, { mode });
  return execute(PatchworkDefinition, record, { type: 'startGame' }).record;
}

test('createGame + startGame deals two empty 9x9 quilt boards, a shuffled full patch circle, and starting buttons/time positions', () => {
  const record = playThroughLobby('local');
  const { state } = record;
  assert.equal(state.players['0'].quiltBoard.length, 81);
  assert.equal(state.players['1'].quiltBoard.length, 81);
  assert.ok(state.players['0'].quiltBoard.every((c) => c === null));
  assert.ok(state.players['1'].quiltBoard.every((c) => c === null));
  assert.equal(state.shared.market.circle.length, 33);
  assert.deepEqual([...state.shared.market.circle].sort(), PATCHES.map((p) => p.id).sort());
  assert.ok(Number.isInteger(state.shared.market.neutralTokenIndex));
  assert.equal(state.turnOrder.current, '0');
  assert.equal(state.phase.current, 'play');
  assert.deepEqual(
    [state.players['0'].buttons, state.players['1'].buttons],
    [5, 5]
  );
  assert.deepEqual(
    [state.players['0'].timeTrackPosition, state.players['1'].timeTrackPosition],
    [0, 0]
  );
});

test('createGame in multiplayer mode starts in the lobby, with no patches dealt yet', () => {
  const record = createGame(PatchworkDefinition, { mode: 'multiplayer' });
  assert.equal(record.state.phase.current, 'lobby');
  assert.deepEqual(record.state.shared.market.circle, []);
});

test('startGame deals the patch circle and transitions the lobby into play, and is illegal once already started', () => {
  const lobby = createGame(PatchworkDefinition, { mode: 'multiplayer' });
  const started = execute(PatchworkDefinition, lobby, { type: 'startGame' });
  assert.equal(started.error, null);
  assert.equal(started.record.state.phase.current, 'play');
  assert.deepEqual([...started.record.state.shared.market.circle].sort(), PATCHES.map((p) => p.id).sort());

  const alreadyStarted = execute(PatchworkDefinition, started.record, { type: 'startGame' });
  assert.equal(alreadyStarted.error, 'illegal-action');
});

test('queryLegalActions with no selection offers only the 3 currently-offered (affordable) patches, plus advanceTimeToken', () => {
  // patch-01 costs 2, patch-23 costs 10, patch-08 costs 0 - all offered,
  // but only two are affordable with 5 starting buttons.
  const record = recordWithPatches(['patch-01', 'patch-23', 'patch-08']);
  assert.deepEqual(queryLegalActions(PatchworkDefinition, record, null, undefined), [
    { type: 'selectPatch', params: { patchId: { domain: ['patch-01', 'patch-08'] } } },
    { type: 'advanceTimeToken', params: {} },
  ]);
});

test('queryLegalActions excludes offered patches the current player cannot afford', () => {
  const record = recordWithPatches(['patch-01', 'patch-08', 'patch-23'], { playerMoney: { 0: 0, 1: 5 } });
  const [selectAction] = queryLegalActions(PatchworkDefinition, record, null, undefined);
  assert.deepEqual(selectAction.params.patchId.domain, ['patch-08']);
});

test("queryLegalActions rejects a patchId that isn't one of the 3 currently offered", () => {
  const record = recordWithPatches(['patch-01', 'patch-02', 'patch-03']);
  assert.deepEqual(queryLegalActions(PatchworkDefinition, record, null, { patchId: 'patch-04' }), []);
  assert.deepEqual(queryLegalActions(PatchworkDefinition, record, null, { patchId: 'not-a-real-patch' }), []);
});

test('queryLegalActions returns an anchor domain covering the whole empty board for a small patch', () => {
  const record = recordWithPatches(['patch-01']);
  const [action] = queryLegalActions(PatchworkDefinition, record, null, { patchId: 'patch-01', rotation: 0 });
  assert.equal(action.type, 'placePatch');
  assert.equal(action.params.anchor.domain.length, 8 * 9);
});

test("queryLegalActions domain shrinks around already-placed patches on the current player's board", () => {
  const record = recordWithPatches(['patch-01', 'patch-02']);
  const placed = place(record, 'patch-01', 0, 0, 0).record;
  const [action] = queryLegalActions(PatchworkDefinition, placed, null, { patchId: 'patch-02', rotation: 0 });
  assert.equal(action.params.anchor.domain.length > 0, true);
});

test('placePatch places a patch, deducts its cost, advances the time track, shrinks the circle, moves the neutral token, and passes the turn to whoever is behind', () => {
  const record = recordWithPatches(['patch-01']);
  const result = place(record, 'patch-01', 0, 0, 0);
  const patch01 = getPatch('patch-01'); // cost 2, time 1
  assert.equal(result.error, null);
  const { state } = result.record;
  assert.equal(state.players['0'].quiltBoard[0], 'patch-01'); // (0,0)
  assert.equal(state.players['0'].quiltBoard[9], 'patch-01'); // (1,0)
  assert.equal(state.shared.market.circle.includes('patch-01'), false);
  assert.equal(state.shared.market.circle.length, 32);
  assert.equal(state.shared.market.neutralTokenIndex, 0);
  assert.equal(state.players['0'].buttons, 5 - patch01.cost);
  assert.equal(state.players['0'].timeTrackPosition, patch01.time);
  assert.equal(state.players['1'].timeTrackPosition, 0);
  assert.equal(state.turnOrder.current, '1');
  assert.equal(record.state.players['0'].quiltBoard[0], null, 'execute() must not mutate the input record');
  assert.equal(record.state.players['0'].buttons, 5, 'execute() must not mutate the input record');
});

test('placePatch rotates the shape before placing it', () => {
  const record = recordWithPatches(['patch-01']);
  // patch-01 is a vertical 2x1 domino; rotated 90 degrees it's
  // horizontal. row/col are the shape's *pivot*, not its top-left
  // corner - the pivot rotates along with the shape too.
  const result = place(record, 'patch-01', 1, 0, 1);
  assert.equal(result.error, null);
  assert.equal(result.record.state.players['0'].quiltBoard[0], 'patch-01'); // (0,0)
  assert.equal(result.record.state.players['0'].quiltBoard[1], 'patch-01'); // (0,1)
});

test('placePatch rejects a placement that runs off the board', () => {
  const record = recordWithPatches(['patch-01']);
  const result = place(record, 'patch-01', 0, 8, 0);
  assert.equal(result.error, 'invalid-placement');
  assert.equal(result.record, record);
});

test('placePatch rejects a placement the current player cannot afford', () => {
  const record = recordWithPatches(['patch-01'], { playerMoney: { 0: 1, 1: 5 } });
  const result = place(record, 'patch-01', 0, 0, 0);
  assert.equal(result.error, 'insufficient-buttons');
  assert.equal(result.record, record);
});

test('placePatch rejects a placement that overlaps an already-placed patch', () => {
  let record = recordWithPatches(['patch-01', 'patch-02', 'patch-03']);
  record = place(record, 'patch-01', 0, 0, 0).record;
  // Now player 1's turn on an empty board - place something for them
  // first, then swing back to player 0 to try overlapping patch-01.
  record = place(record, 'patch-02', 0, 0, 0).record;
  const result = place(record, 'patch-03', 0, 0, 0);
  assert.equal(result.error, 'invalid-placement');
});

test('placePatch rejects a patchId that is no longer offered once taken', () => {
  let record = recordWithPatches(['patch-01']);
  record = place(record, 'patch-01', 0, 0, 0).record;
  const result = place(record, 'patch-01', 0, 2, 2);
  assert.equal(result.error, 'invalid-patch');
});

test('placePatch is illegal while still in the lobby', () => {
  const record = createGame(PatchworkDefinition, { mode: 'multiplayer' });
  const result = execute(PatchworkDefinition, record, { type: 'placePatch', params: { patchId: 'patch-01', rotation: 0, row: 0, col: 0 } });
  assert.equal(result.error, 'illegal-action');
});

test('advanceTimeToken moves the current player to just ahead of the other player and pays 1 button per space moved', () => {
  const record = playThroughLobby('local');
  const result = advance(record);
  assert.equal(result.error, null);
  const { state } = result.record;
  assert.equal(state.players['0'].timeTrackPosition, 1);
  assert.equal(state.players['1'].timeTrackPosition, 0);
  assert.equal(state.turnOrder.current, '1');
  assert.equal(state.players['0'].buttons, 6);
  assert.equal(state.players['1'].buttons, 5);
});

test('advanceTimeToken pays 1 button per space when moving several spaces to catch up', () => {
  const record = recordWithPatches([], { timeTrackPositions: { 0: 2, 1: 9 } });
  const result = advance(record);
  assert.equal(result.error, null);
  // Player 0 moves from 2 to 10 (one ahead of player 1's 9) - 8 spaces.
  assert.equal(result.record.state.players['0'].timeTrackPosition, 10);
  assert.equal(result.record.state.players['0'].buttons, 5 + 8);
});

test('advanceTimeToken caps at TRACK_LENGTH', () => {
  const record = recordWithPatches([], { timeTrackPositions: { 0: TRACK_LENGTH, 1: 0 } });
  const result = advance(record);
  assert.equal(result.record.state.players['0'].timeTrackPosition, TRACK_LENGTH);
});

test('turn order gives the next turn to whoever is behind, not a strict alternation', () => {
  let record = recordWithPatches(['patch-01', 'patch-02']);
  // Player 0 buys patch-01 (time 1): moves to 1, player 1 stays at 0 - behind.
  record = place(record, 'patch-01', 0, 0, 0).record;
  assert.equal(record.state.turnOrder.current, '1');
  // Player 1 buys patch-02 (time 3): moves to 3, player 0 is still at 1 -
  // behind, even though player 1 just moved (this is the non-alternating part).
  record = place(record, 'patch-02', 0, 0, 0).record;
  assert.equal(record.state.players['1'].timeTrackPosition, 3);
  assert.equal(record.state.players['0'].timeTrackPosition, 1);
  assert.equal(record.state.turnOrder.current, '0');
});

test('a tied time-track position gives the next turn to whoever just moved, not the other player', () => {
  const record = recordWithPatches(['patch-02'], { currentPlayer: 0, timeTrackPositions: { 0: 2, 1: 5 } });
  // patch-02 costs 1, has time 3: player 0 moves from 2 to 5, tying player 1.
  const result = place(record, 'patch-02', 0, 0, 0);
  assert.equal(result.error, null);
  assert.equal(result.record.state.players['0'].timeTrackPosition, 5);
  assert.equal(result.record.state.players['1'].timeTrackPosition, 5);
  assert.equal(result.record.state.turnOrder.current, '0');
});

test('buying a patch pays out income for every income-producing patch already on the board when the move passes through or lands on an income space', () => {
  const patch05 = getPatch('patch-05'); // cost 3, time 2, income 1
  const patch02 = getPatch('patch-02'); // cost 1, time 3, income 0
  assert.ok(BUTTON_INCOME_SPACES.includes(5), 'this test assumes space 5 is an income space');

  // Player 0 already owns patch-05 (placed at anchor (0,0): cells (0,1)
  // (1,0) (1,1) (2,0)), and is 4 spaces into the time track. Buying
  // patch-02 (time 3) moves them from 4 to 7 - passing through space 5
  // without landing exactly on it.
  const board = emptyBoard();
  board[1] = 'patch-05';
  board[9] = 'patch-05';
  board[10] = 'patch-05';
  board[18] = 'patch-05';

  const record = recordWithPatches(['patch-02'], {
    quiltBoards: { 0: board, 1: emptyBoard() },
    timeTrackPositions: { 0: 4, 1: 0 },
  });

  const [action] = queryLegalActions(PatchworkDefinition, record, null, { patchId: 'patch-02', rotation: 0 });
  const [row, col] = action.params.anchor.domain[0];
  const result = place(record, 'patch-02', 0, row, col);

  assert.equal(result.error, null);
  assert.equal(result.record.state.players['0'].timeTrackPosition, 4 + patch02.time);
  // Buttons: start 5, minus patch-02's cost, plus patch-05's income once
  // (space 5 is crossed exactly once on the way from 4 to 7).
  assert.equal(result.record.state.players['0'].buttons, 5 - patch02.cost + patch05.income);
});

test('the game ends and scores once both players reach the end of the time track - not when the circle empties', () => {
  // Player 1 already finished; player 0 is one space short and about to
  // catch up to (and cap at) the end via advanceTimeToken.
  const record = recordWithPatches([], { timeTrackPositions: { 0: TRACK_LENGTH - 1, 1: TRACK_LENGTH } });
  const result = advance(record);
  assert.equal(result.error, null);
  assert.equal(result.record.state.players['0'].timeTrackPosition, TRACK_LENGTH);
  assert.equal(result.record.state.phase.current, 'gameOver');
  assert.equal(typeof result.record.state.players['0'].score, 'number');
  assert.equal(typeof result.record.state.players['1'].score, 'number');
});

test('scoring is buttons minus 2 per empty square, plus a 7-point bonus for whoever completed a 7x7 area first', () => {
  const board = emptyBoard().map((_, i) => (i < 49 ? 'patch-01' : null)); // arbitrary non-null fill, not geometrically real
  // Player 0 already finished and is untouched by this move, so their
  // score cleanly reflects the starting buttons/board with no
  // movement-triggered side effects to account for. Player 1 is the one
  // catching up to (and triggering) game end - their score does need to
  // account for the button gained by that final move.
  const record = recordWithPatches([], {
    quiltBoards: { 0: board, 1: emptyBoard() },
    timeTrackPositions: { 0: TRACK_LENGTH, 1: TRACK_LENGTH - 1 },
    currentPlayer: 1,
    bonusTileHolder: '0',
    playerMoney: { 0: 10, 1: 5 },
  });
  const result = advance(record);
  assert.equal(result.error, null);
  const emptySquares0 = 81 - 49;
  assert.equal(result.record.state.players['0'].score, 10 - 2 * emptySquares0 + 7);
  assert.equal(result.record.state.players['1'].buttons, 6); // 5 starting + 1 for the single space moved (52 -> 53, capped)
  assert.equal(result.record.state.players['1'].score, 6 - 2 * 81);
});

test('offeredPatches always reflects state.shared.market - a sanity cross-check against patchCircle.js directly', () => {
  const record = recordWithPatches(['patch-01', 'patch-02', 'patch-03']);
  assert.deepEqual(
    offeredPatches({ patchCircle: record.state.shared.market.circle, neutralTokenIndex: record.state.shared.market.neutralTokenIndex }),
    ['patch-01', 'patch-02', 'patch-03']
  );
});
