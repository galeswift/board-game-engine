'use strict';

// Built into every game for free - a game never declares its own
// TransitionPhase command. Emits PhaseEntered so a game can react to
// *entering* a phase (e.g. a scoring phase computing its own final
// tally) without a second, game-invented phase-change mechanism.
function transitionPhaseReducer(state, { to }) {
  return {
    state: { ...state, phase: { ...state.phase, current: to } },
    events: [{ type: 'PhaseEntered', payload: { phase: to } }],
  };
}

// defineGame(config) -> GameDefinition. Validates shape at call time
// (registration time - i.e. at require()), so a broken game definition
// fails at server startup, not on a player's first request.
function defineGame(config) {
  const {
    id,
    gameVersion,
    bounds,
    createPlayerState,
    createInitialState,
    phases,
    actions = {},
    commands = {},
    rules = [],
  } = config;
  // Not accepted here: transactionLimits, phaseRestricted, and
  // maxEvents/maxRuleDepth cycle protection - all real pieces of
  // docs/architecture.md's target design, deliberately not built yet
  // (nothing in Patchwork exercises them, per the retrofit's scope
  // decision - see docs/patchwork-next-steps.md). Accepting and
  // silently ignoring a config field is worse than rejecting it
  // outright, so this is left unrecognized rather than stored-but-unused.

  if (typeof id !== 'string' || !id) {
    throw new Error('defineGame: "id" is required');
  }
  if (typeof createPlayerState !== 'function') {
    throw new Error(`defineGame(${id}): "createPlayerState" must be a function`);
  }
  if (typeof createInitialState !== 'function') {
    throw new Error(`defineGame(${id}): "createInitialState" must be a function`);
  }
  if (!bounds || !bounds.players || !Number.isInteger(bounds.players.min) || !Number.isInteger(bounds.players.max) || bounds.players.min < 1 || bounds.players.min > bounds.players.max) {
    throw new Error(`defineGame(${id}): "bounds.players" must declare integer min <= max, min >= 1`);
  }
  if (!phases || !phases.definitions || !phases.definitions[phases.initial]) {
    throw new Error(`defineGame(${id}): "phases.initial" must reference a phase declared in "phases.definitions"`);
  }
  for (const [phaseName, phase] of Object.entries(phases.definitions)) {
    for (const actionType of phase.allowedActions || []) {
      if (!actions[actionType]) {
        throw new Error(`defineGame(${id}): phase "${phaseName}" allows unknown action "${actionType}"`);
      }
    }
    for (const transition of phase.transitions || []) {
      if (!phases.definitions[transition.to]) {
        throw new Error(`defineGame(${id}): phase "${phaseName}" has a transition to unknown phase "${transition.to}"`);
      }
    }
  }
  for (const [actionType, actionDef] of Object.entries(actions)) {
    if (typeof actionDef.execute !== 'function') {
      throw new Error(`defineGame(${id}): action "${actionType}" is missing "execute"`);
    }
    if (typeof actionDef.legalParams !== 'function') {
      throw new Error(`defineGame(${id}): action "${actionType}" is missing "legalParams"`);
    }
  }
  for (const [commandType, reducer] of Object.entries(commands)) {
    if (typeof reducer !== 'function') {
      throw new Error(`defineGame(${id}): command "${commandType}" reducer must be a function`);
    }
  }
  if (commands.TransitionPhase) {
    throw new Error(`defineGame(${id}): "TransitionPhase" is a reserved command name (built into core)`);
  }

  const commandReducers = { TransitionPhase: transitionPhaseReducer, ...commands };

  const rulesByEvent = {};
  for (const rule of rules) {
    if (!rulesByEvent[rule.on]) rulesByEvent[rule.on] = [];
    rulesByEvent[rule.on].push(rule);
  }

  return Object.freeze({
    id,
    gameVersion,
    bounds,
    createPlayerState,
    createInitialState,
    phases,
    actions,
    commandReducers,
    rulesByEvent,
  });
}

module.exports = { defineGame };
