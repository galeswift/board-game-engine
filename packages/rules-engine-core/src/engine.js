'use strict';

const crypto = require('crypto');
const { runAction } = require('./dispatch');
const { isActionLegal } = require('./phases');
const { createContext, createReadOnlyContext } = require('./context');

function playerSlots(definition, players) {
  const count = players && players.length ? players.length : definition.bounds.players.min;
  return Array.from({ length: count }, (_, i) => i);
}

function baseState(definition, seed, slots, initArgs) {
  const state = {
    meta: {
      engineSchemaVersion: 1,
      gameVersion: definition.gameVersion,
      seed,
      rngState: seed,
      idCounters: {},
    },
    phase: { current: definition.phases.initial },
    shared: {},
    players: {},
    turnOrder: {},
  };
  for (const slot of slots) {
    state.players[String(slot)] = definition.createPlayerState(slot);
  }
  const initial = definition.createInitialState(initArgs) || {};
  state.shared = initial.shared || {};
  state.turnOrder = initial.turnOrder || {};
  return state;
}

// createGame(definition, {mode, players}) -> { state, log: [] }
// The seed's own origin doesn't need to be deterministic (crypto.randomInt
// here is fine) - determinism is about replay being reproducible FROM a
// given seed, not about how that seed was first chosen.
function createGame(definition, { mode, players } = {}) {
  const seed = crypto.randomInt(0, 0x7fffffff);
  const slots = playerSlots(definition, players);
  const state = baseState(definition, seed, slots, { mode, slots });
  return { state, log: [] };
}

// execute(definition, record, action) -> { record, error, events, effects }
// Rejected actions never touch `record` - same "rejected actions never
// mutate state" invariant the rest of this repo already relies on.
function execute(definition, record, action) {
  if (!action || typeof action.type !== 'string') {
    return { record, error: 'no-action', events: [], effects: [] };
  }
  if (!isActionLegal(definition, record.state, action.type)) {
    return { record, error: 'illegal-action', events: [], effects: [] };
  }
  const actionDef = definition.actions[action.type];
  const context = createContext(record.state);
  const result = actionDef.execute(record.state, action.params, context);
  if (!result || result.error) {
    return { record, error: (result && result.error) || 'action-rejected', events: [], effects: [] };
  }
  const { state: dispatchedState, log: deltaLog } = runAction(
    definition,
    record.state,
    context,
    result.commands || []
  );
  const finalState = context.finalize(dispatchedState);
  const nextRecord = { state: finalState, log: [...record.log, ...deltaLog] };
  const events = deltaLog.filter((entry) => entry.kind === 'event').map((entry) => entry.event);
  return { record: nextRecord, error: null, events, effects: result.effects || [] };
}

// preview(definition, record, action) -> { state, error, events }
// A thin wrapper around execute() that discards the log/record instead
// of persisting it - this is what makes "preview and commit share one
// execution path" literally true in code, not just true in comment.
function preview(definition, record, action) {
  const { record: nextRecord, error, events } = execute(definition, record, action);
  return { state: nextRecord.state, error, events };
}

// queryLegalActions(definition, record, playerId, selection) -> Action[]
// Same shared gate as execute() (phases.isActionLegal, via the phase's
// own allowedActions list) - never a second, hand-written copy of
// "what's legal right now". Uses a read-only context so a legality
// query can never consume randomness or allocate an id.
function queryLegalActions(definition, record, playerId, selection) {
  const phase = definition.phases.definitions[record.state.phase.current];
  const readOnlyContext = createReadOnlyContext();
  const results = [];
  for (const actionType of phase.allowedActions || []) {
    const actionDef = definition.actions[actionType];
    const legal = actionDef.legalParams(record.state, playerId, selection, readOnlyContext);
    if (legal) results.push({ type: actionType, params: legal });
  }
  return results;
}

// replay(definition, seed, players, actionLog) -> record
// Rebuilds initial state from an explicit seed (skipping createGame's
// own crypto.randomInt) and folds execute() over the action log in
// order. A byte-identical final state given the same (seed, actions) is
// guaranteed because rngState/idCounters are pure functions of the
// ordered sequence of context.rng()/context.nextId() calls, which is
// itself a pure function of (seed, ordered actions) - nothing else in
// core ever touches meta.rngState/idCounters.
function replay(definition, seed, players, actionLog) {
  const slots = playerSlots(definition, players);
  const state = baseState(definition, seed, slots, { slots });
  let record = { state, log: [] };
  for (const action of actionLog) {
    const result = execute(definition, record, action);
    if (result.error) {
      throw new Error(`rules-engine-core: replay hit an illegal/rejected action - ${result.error}`);
    }
    record = result.record;
  }
  return record;
}

module.exports = { createGame, execute, preview, queryLegalActions, replay };
