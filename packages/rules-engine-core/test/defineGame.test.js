'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defineGame } = require('../src/defineGame');

function minimalConfig(overrides = {}) {
  return {
    id: 'test-game',
    gameVersion: 1,
    bounds: { players: { min: 1, max: 1 } },
    createPlayerState: () => ({}),
    createInitialState: () => ({ shared: {}, turnOrder: {} }),
    phases: {
      initial: 'play',
      definitions: { play: { allowedActions: ['noop'] } },
    },
    actions: {
      noop: { legalParams: () => ({}), execute: () => ({ commands: [] }) },
    },
    ...overrides,
  };
}

test('valid config returns a frozen GameDefinition', () => {
  const definition = defineGame(minimalConfig());
  assert.equal(definition.id, 'test-game');
  assert.ok(Object.isFrozen(definition));
  assert.ok(definition.commandReducers.TransitionPhase);
});

test('throws when createPlayerState is missing', () => {
  const config = minimalConfig();
  delete config.createPlayerState;
  assert.throws(() => defineGame(config), /createPlayerState/);
});

test('throws when phases.initial does not reference a declared phase', () => {
  const config = minimalConfig({ phases: { initial: 'nope', definitions: { play: { allowedActions: [] } } } });
  assert.throws(() => defineGame(config), /phases\.initial/);
});

test('throws when a phase allows an unknown action', () => {
  const config = minimalConfig({
    phases: { initial: 'play', definitions: { play: { allowedActions: ['doesNotExist'] } } },
  });
  assert.throws(() => defineGame(config), /unknown action/);
});

test('throws when a transition targets an unknown phase', () => {
  const config = minimalConfig({
    phases: {
      initial: 'play',
      definitions: { play: { allowedActions: ['noop'], transitions: [{ onEvent: 'X', to: 'nowhere' }] } },
    },
  });
  assert.throws(() => defineGame(config), /unknown phase/);
});

test('throws when bounds.players.min > max', () => {
  const config = minimalConfig({ bounds: { players: { min: 3, max: 2 } } });
  assert.throws(() => defineGame(config), /bounds\.players/);
});

test('throws when an action is missing legalParams or execute', () => {
  const missingLegalParams = minimalConfig({ actions: { noop: { execute: () => ({ commands: [] }) } } });
  assert.throws(() => defineGame(missingLegalParams), /legalParams/);

  const missingExecute = minimalConfig({ actions: { noop: { legalParams: () => ({}) } } });
  assert.throws(() => defineGame(missingExecute), /execute/);
});

test('throws when a game tries to declare its own TransitionPhase command', () => {
  const config = minimalConfig({ commands: { TransitionPhase: () => ({ state: {}, events: [] }) } });
  assert.throws(() => defineGame(config), /reserved command name/);
});

test('rules are indexed by event type', () => {
  const config = minimalConfig({
    rules: [
      { on: 'A', handler: () => [] },
      { on: 'A', handler: () => [] },
      { on: 'B', handler: () => [] },
    ],
  });
  const definition = defineGame(config);
  assert.equal(definition.rulesByEvent.A.length, 2);
  assert.equal(definition.rulesByEvent.B.length, 1);
});
