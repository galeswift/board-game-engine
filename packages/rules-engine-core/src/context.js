'use strict';

const rng = require('./rng');

// The one place a command reducer or action touches randomness/id
// generation - never Math.random()/crypto.randomUUID() directly (see
// docs/architecture.md Section 3). rngState/idCounters are threaded
// through in closure variables here, not written back into `state`
// until finalize() - that keeps every reducer's own diff limited to the
// game-relevant fields it actually changed, rather than every command
// touching state.meta as a side effect.
function createContext(state) {
  let rngState = state.meta.rngState;
  const idCounters = { ...state.meta.idCounters };
  return {
    rng() {
      const { nextState, value } = rng.step(rngState);
      rngState = nextState;
      return value;
    },
    nextId(namespace) {
      idCounters[namespace] = (idCounters[namespace] || 0) + 1;
      return `${namespace}-${idCounters[namespace]}`;
    },
    finalize(nextState) {
      return { ...nextState, meta: { ...nextState.meta, rngState, idCounters } };
    },
  };
}

// Used only for queryLegalActions' legalParams calls. A legality query
// must never consume randomness or allocate an id - doing so would mean
// two callers asking "what's legal right now" back-to-back could get
// different answers, or silently burn real RNG/id state that a later
// real action then can't reproduce under replay. Throwing here turns
// that class of bug into an immediate, loud failure instead of a subtle
// replay divergence.
function createReadOnlyContext() {
  return {
    rng() {
      throw new Error('rules-engine-core: legalParams must not call context.rng() - legality queries must not consume randomness');
    },
    nextId() {
      throw new Error('rules-engine-core: legalParams must not call context.nextId() - legality queries must not allocate ids');
    },
    finalize(state) {
      return state;
    },
  };
}

module.exports = { createContext, createReadOnlyContext };
