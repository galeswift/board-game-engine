'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame, execute, replay, extractActionLog } = require('../packages/rules-engine-core/src');
const gameDefinition = require('./gameDefinition');
const { TILE_NAMES } = require('./islandTiles');

function act(record, type) {
  const result = execute(gameDefinition, record, { type });
  assert.equal(result.error, null, `expected ${type} to succeed, got ${result.error}`);
  return result.record;
}

test('starts in lobby', () => {
  const { state } = createGame(gameDefinition, { players: [0, 1] });
  assert.equal(state.phase.current, 'lobby');
});

test('startGame moves lobby straight through the instantaneous setup phase into mainLoop', () => {
  let record = createGame(gameDefinition, { players: [0, 1] });
  record = act(record, 'startGame');
  assert.equal(record.state.phase.current, 'mainLoop');
  assert.equal(record.state.shared.turnStep, 'actions');
});

test('startGame deals all 24 tiles, each exactly once, onto distinct board positions', () => {
  let record = createGame(gameDefinition, { players: [0, 1] });
  record = act(record, 'startGame');
  const tiles = Object.values(record.state.shared.islandTiles);
  assert.equal(tiles.length, 24);
  assert.deepEqual(tiles.map((t) => t.name).sort(), TILE_NAMES.slice().sort());
  assert.equal(new Set(tiles.map((t) => `${t.row},${t.col}`)).size, 24);
});

test('a turn is 3 actions, then treasure cards, then flood cards, then the next player', () => {
  let record = createGame(gameDefinition, { players: [0, 1] });
  record = act(record, 'startGame');
  assert.equal(record.state.turnOrder.current, '0');

  for (let i = 0; i < 3; i++) {
    assert.equal(execute(gameDefinition, record, { type: 'drawTreasureCards' }).error, 'not-treasure-step');
    record = act(record, 'takeAction');
  }
  assert.equal(record.state.shared.turnStep, 'treasure');
  assert.equal(execute(gameDefinition, record, { type: 'takeAction' }).error, 'not-action-step');

  record = act(record, 'drawTreasureCards');
  assert.equal(record.state.shared.turnStep, 'flood');

  const beforeFlood = record;
  record = act(record, 'drawFloodCards');
  if (record.state.phase.current === 'mainLoop') {
    assert.equal(record.state.shared.turnStep, 'actions');
    assert.equal(record.state.turnOrder.current, '1');
  } else {
    assert.equal(record.state.phase.current, 'defeat');
    assert.notEqual(record, beforeFlood);
  }
});

test('replay from the same seed and action log reproduces an identical fabricated playthrough', () => {
  let record = createGame(gameDefinition, { players: [0, 1] });
  record = act(record, 'startGame');
  for (let i = 0; i < 30 && record.state.phase.current === 'mainLoop'; i++) {
    const legalType = record.state.shared.turnStep === 'actions' ? 'takeAction'
      : record.state.shared.turnStep === 'treasure' ? 'drawTreasureCards'
      : 'drawFloodCards';
    record = act(record, legalType);
  }
  assert.notEqual(record.state.phase.current, 'mainLoop');

  const replayed = replay(gameDefinition, record.state.meta.seed, [0, 1], extractActionLog(record.log));
  assert.deepEqual(replayed.state, record.state);
});
