'use strict';

// The Command/Event/Effect dispatch loop (docs/architecture.md Sections
// 6-11 reference this mechanics as "unchanged from v2", but no v2
// document exists in this repo - this file IS that missing design,
// written to satisfy every v4 constraint that's actually readable: a
// shared legality gate (phases.js), TransitionPhase flowing through the
// same processor as every other mutation (no second mutation pathway),
// and an append-only log.
//
// Deliberately NOT implemented here: maxEvents/maxRuleDepth cycle
// protection. An authoring bug where a rule re-emits an event it itself
// reacts to will hang the process rather than error cleanly - accepted
// risk per the current scope decision (nothing in Patchwork has a
// cascading-rule scenario to prove a loop guard against yet; add this
// before Forbidden Island, whose water-rise/reshuffle chains are exactly
// the shape of bug this would need to catch).

function applyCommand(definition, state, command, context, queue, log) {
  const reducer = definition.commandReducers[command.type];
  if (!reducer) {
    throw new Error(`rules-engine-core: unknown command type "${command.type}"`);
  }
  const { state: nextState, events = [] } = reducer(state, command.payload, context);
  log.push({ kind: 'command', command });
  for (const event of events) queue.push(event);
  return nextState;
}

function drainEvents(definition, state, queue, context, log) {
  while (queue.length > 0) {
    const event = queue.shift();
    log.push({ kind: 'event', event });

    // Implicit phase-transition rule: check the CURRENT phase's declared
    // transitions for this event before any game-authored rule runs, so
    // game authors never hand-write a TransitionPhase command themselves.
    const currentPhase = definition.phases.definitions[state.phase.current];
    const transition = (currentPhase.transitions || []).find((t) => t.onEvent === event.type);
    if (transition) {
      state = applyCommand(
        definition,
        state,
        { type: 'TransitionPhase', payload: { to: transition.to } },
        context,
        queue,
        log
      );
    }

    // Game-authored rules reacting to this event, in declaration order.
    for (const rule of definition.rulesByEvent[event.type] || []) {
      const commands = rule.handler(state, event, context) || [];
      for (const command of commands) {
        state = applyCommand(definition, state, command, context, queue, log);
      }
    }
  }
  return state;
}

// state -> state, folding every seed command and every command any rule
// or the implicit phase-transition emits in reaction, in strict FIFO
// event order. `log` is a flat, ordered {kind, command|event}[] - the
// append-only transaction log entry for this one action.
function runAction(definition, state, context, seedCommands) {
  const queue = [];
  const log = [];
  for (const command of seedCommands) {
    state = applyCommand(definition, state, command, context, queue, log);
  }
  state = drainEvents(definition, state, queue, context, log);
  return { state, log };
}

module.exports = { runAction };
