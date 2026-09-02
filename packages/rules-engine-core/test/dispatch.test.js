'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runAction } = require('../src/dispatch');

// dispatch.js only reads definition.commandReducers/phases/rulesByEvent -
// build these by hand rather than through defineGame() so these tests
// isolate the dispatch loop itself from defineGame's validation.
function definitionWith({ commandReducers, phases, rulesByEvent }) {
  return { commandReducers, phases, rulesByEvent: rulesByEvent || {} };
}

const noopContext = { rng: () => 0, nextId: () => 'id-1' };

test('runAction applies a seed command and returns its log entry', () => {
  const definition = definitionWith({
    commandReducers: {
      SetValue: (state, { value }) => ({ state: { ...state, value }, events: [] }),
    },
    phases: { definitions: { play: { allowedActions: [] } } },
  });
  const { state, log } = runAction(definition, { value: 0 }, noopContext, [{ type: 'SetValue', payload: { value: 5 } }]);
  assert.equal(state.value, 5);
  assert.deepEqual(log, [{ kind: 'command', command: { type: 'SetValue', payload: { value: 5 } } }]);
});

test('runAction throws on an unregistered command type', () => {
  const definition = definitionWith({ commandReducers: {}, phases: { definitions: {} } });
  assert.throws(
    () => runAction(definition, {}, noopContext, [{ type: 'Nonexistent', payload: {} }]),
    /unknown command type "Nonexistent"/
  );
});

test('a rule reacting to an emitted event runs and its own command is logged after the event', () => {
  const definition = definitionWith({
    commandReducers: {
      Ping: (state) => ({ state, events: [{ type: 'Pinged', payload: {} }] }),
      Pong: (state) => ({ state: { ...state, ponged: true }, events: [] }),
    },
    phases: { definitions: { play: { allowedActions: [] } } },
    rulesByEvent: {
      Pinged: [{ on: 'Pinged', handler: () => [{ type: 'Pong', payload: {} }] }],
    },
  });
  const { state, log } = runAction(definition, { phase: { current: 'play' } }, noopContext, [
    { type: 'Ping', payload: {} },
  ]);
  assert.equal(state.ponged, true);
  assert.deepEqual(
    log.map((entry) => (entry.kind === 'command' ? entry.command.type : entry.event.type)),
    ['Ping', 'Pinged', 'Pong']
  );
});

test('an event matching the current phase transition emits an implicit TransitionPhase before rules run', () => {
  const definition = definitionWith({
    commandReducers: {
      Finish: (state) => ({ state, events: [{ type: 'Finished', payload: {} }] }),
      // Hand-built definitions bypass defineGame(), which normally
      // injects this reducer for every game - wire it in manually here
      // since this test is deliberately isolating dispatch.js itself.
      TransitionPhase: (state, { to }) => ({
        state: { ...state, phase: { ...state.phase, current: to } },
        events: [{ type: 'PhaseEntered', payload: { phase: to } }],
      }),
    },
    phases: {
      definitions: {
        play: { allowedActions: [], transitions: [{ onEvent: 'Finished', to: 'done' }] },
        done: { allowedActions: [] },
      },
    },
  });
  const { state, log } = runAction(definition, { phase: { current: 'play' } }, noopContext, [
    { type: 'Finish', payload: {} },
  ]);
  assert.equal(state.phase.current, 'done');
  const types = log.map((entry) => (entry.kind === 'command' ? entry.command.type : entry.event.type));
  assert.deepEqual(types, ['Finish', 'Finished', 'TransitionPhase', 'PhaseEntered']);
});

test('multiple rules for the same event all run, in declaration order', () => {
  const order = [];
  const definition = definitionWith({
    commandReducers: { Noop: (state) => ({ state, events: [] }) },
    phases: { definitions: { play: { allowedActions: [] } } },
    rulesByEvent: {
      Trigger: [
        { on: 'Trigger', handler: () => { order.push('first'); return [{ type: 'Noop', payload: {} }]; } },
        { on: 'Trigger', handler: () => { order.push('second'); return [{ type: 'Noop', payload: {} }]; } },
      ],
    },
  });
  const definitionWithSeed = {
    ...definition,
    commandReducers: { ...definition.commandReducers, Kick: (state) => ({ state, events: [{ type: 'Trigger', payload: {} }] }) },
  };
  runAction(definitionWithSeed, { phase: { current: 'play' } }, noopContext, [{ type: 'Kick', payload: {} }]);
  assert.deepEqual(order, ['first', 'second']);
});
