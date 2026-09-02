'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, execute, preview, queryLegalActions, replay } = require('../src/engine');
const fakeGame = require('./fixtures/fakeGame');

test('createGame builds a lobby-less initial state with player state per slot', () => {
  const { state, log } = createGame(fakeGame, { mode: 'local' });
  assert.equal(state.phase.current, 'play');
  assert.deepEqual(Object.keys(state.players), ['0']);
  assert.deepEqual(state.players['0'], { score: 0 });
  assert.equal(state.shared.counter, 0);
  assert.equal(state.shared.incrementsRemaining, 3);
  assert.deepEqual(log, []);
});

test('rejected actions never mutate the record', () => {
  const record = createGame(fakeGame, { mode: 'local' });
  const result = execute(fakeGame, record, { type: 'nonexistentAction' });
  assert.equal(result.error, 'illegal-action');
  assert.equal(result.record, record);
});

test('preview computes the same next state as execute, without persisting it', () => {
  const record = createGame(fakeGame, { mode: 'local' });
  const previewed = preview(fakeGame, record, { type: 'increment' });
  const committed = execute(fakeGame, record, { type: 'increment' });
  assert.deepEqual(previewed.state, committed.record.state);
  // preview() must not have mutated the caller's own record.
  assert.equal(record.state.shared.counter, 0);
});

test('replay from the same seed and action log reproduces a byte-identical final state', () => {
  let record = createGame(fakeGame, { mode: 'local' });
  const seed = record.state.meta.seed;
  const actionLog = [];
  for (let i = 0; i < 3; i++) {
    const action = { type: 'increment' };
    actionLog.push(action);
    const result = execute(fakeGame, record, action);
    assert.equal(result.error, null);
    record = result.record;
  }
  assert.equal(record.state.phase.current, 'done');

  const replayed = replay(fakeGame, seed, [0], actionLog);
  assert.deepEqual(replayed.state, record.state);
});

test('replay from a different seed produces a different counter value (same actions, different randomness)', () => {
  const actionLog = [{ type: 'increment' }, { type: 'increment' }, { type: 'increment' }];
  const a = replay(fakeGame, 1, [0], actionLog);
  const b = replay(fakeGame, 2, [0], actionLog);
  assert.notEqual(a.state.shared.counter, b.state.shared.counter);
});

test('queryLegalActions excludes an action once its legalParams returns null', () => {
  let record = createGame(fakeGame, { mode: 'local' });
  for (let i = 0; i < 3; i++) {
    const result = execute(fakeGame, record, { type: 'increment' });
    record = result.record;
  }
  const legalActions = queryLegalActions(fakeGame, record, null, undefined);
  assert.deepEqual(legalActions, []);
});
