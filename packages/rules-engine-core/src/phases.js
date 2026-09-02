'use strict';

// The single shared legality gate (docs/architecture.md Section 6:
// "a shared gate... reused by both execute and queryLegalActions").
// engine.js's execute() and queryLegalActions() both call exactly this
// function - there is deliberately no second copy of "is this action
// legal in this phase" logic anywhere else in core.
function isActionLegal(definition, state, actionType) {
  const phase = definition.phases.definitions[state.phase.current];
  if (!phase) return false;
  return (phase.allowedActions || []).includes(actionType);
}

module.exports = { isActionLegal };
