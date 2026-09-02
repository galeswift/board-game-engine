'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isActionLegal } = require('../src/phases');
const { createGame, execute, queryLegalActions } = require('../src/engine');
const fakeGame = require('./fixtures/fakeGame');

const definition = {
  phases: {
    definitions: {
      play: { allowedActions: ['move'] },
      done: { allowedActions: [] },
    },
  },
};

test('isActionLegal is true only for actions the current phase allows', () => {
  assert.equal(isActionLegal(definition, { phase: { current: 'play' } }, 'move'), true);
  assert.equal(isActionLegal(definition, { phase: { current: 'play' } }, 'somethingElse'), false);
  assert.equal(isActionLegal(definition, { phase: { current: 'done' } }, 'move'), false);
});

test('isActionLegal is false for an unknown phase rather than throwing', () => {
  assert.equal(isActionLegal(definition, { phase: { current: 'nonexistent' } }, 'move'), false);
});

// execute() and queryLegalActions() must agree on legality - both read
// through the exact same isActionLegal/allowedActions source of truth
// (phases.js), demonstrated here behaviorally: an action excluded from
// queryLegalActions' domain is also rejected by execute().
test('execute() and queryLegalActions() agree: an action outside the current phase is both excluded and rejected', () => {
  let record = createGame(fakeGame, { mode: 'local' });
  // Drain the fake game's three increments so it transitions to 'done'.
  for (let i = 0; i < 3; i++) {
    const result = execute(fakeGame, record, { type: 'increment' });
    assert.equal(result.error, null);
    record = result.record;
  }
  assert.equal(record.state.phase.current, 'done');

  const legalActions = queryLegalActions(fakeGame, record, null, undefined);
  assert.deepEqual(legalActions, []);

  const rejected = execute(fakeGame, record, { type: 'increment' });
  assert.equal(rejected.error, 'illegal-action');
});
