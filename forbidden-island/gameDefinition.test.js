'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame, execute } = require('../packages/rules-engine-core/src');
const gameDefinition = require('./gameDefinition');

function advance(record) {
  const result = execute(gameDefinition, record, { type: 'advancePhase' });
  assert.equal(result.error, null);
  return result.record;
}

test('starts in lobby', () => {
  const { state } = createGame(gameDefinition, { players: [0, 1] });
  assert.equal(state.phase.current, 'lobby');
});

test('advancePhase cycles through every declared phase and back to lobby', () => {
  let record = createGame(gameDefinition, { players: [0, 1] });
  const seen = [record.state.phase.current];
  for (let i = 0; i < 5; i++) {
    record = advance(record);
    seen.push(record.state.phase.current);
  }
  assert.deepEqual(seen, ['lobby', 'setup', 'mainLoop', 'victory', 'defeat', 'lobby']);
});
