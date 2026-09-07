'use strict';

// Bootstrap-only: represents the four top-level phases from
// docs/architecture.md Section 12 (lobby -> setup -> mainLoop ->
// victory/defeat) with no real Forbidden Island rules yet - no island
// tiles, roles, flood deck, or treasures. The single `advancePhase`
// action cycles through them by hand so the phase machinery can be seen
// working end to end before any of that real game state is built on top
// of it.

const { defineGame } = require('../packages/rules-engine-core/src');

// Fixed demo order - not a real end condition. Real Forbidden Island
// reaches 'victory' by rescuing all 4 treasures and returning to Fools'
// Landing, and 'defeat' via any of several independent loss conditions
// (a role stranded, a treasure deck exhausted, the water level maxing
// out) - both are alternate terminal outcomes of 'mainLoop', not a fixed
// sequence. Chaining mainLoop -> victory -> defeat -> lobby here exists
// purely so the manual advance button can walk through every declared
// phase for a quick look.
const NEXT_PHASE = {
  lobby: 'setup',
  setup: 'mainLoop',
  mainLoop: 'victory',
  victory: 'defeat',
  defeat: 'lobby',
};

module.exports = defineGame({
  id: 'forbidden-island',
  gameVersion: 1,
  bounds: { players: { min: 2, max: 4 } },

  createPlayerState() {
    return {};
  },

  createInitialState() {
    return { shared: {}, turnOrder: {} };
  },

  phases: {
    initial: 'lobby',
    definitions: {
      lobby: { allowedActions: ['advancePhase'] },
      setup: { allowedActions: ['advancePhase'] },
      mainLoop: { allowedActions: ['advancePhase'] },
      victory: { allowedActions: ['advancePhase'] },
      defeat: { allowedActions: ['advancePhase'] },
    },
  },

  actions: {
    advancePhase: {
      legalParams() {
        return {};
      },
      execute(state) {
        return { commands: [{ type: 'TransitionPhase', payload: { to: NEXT_PHASE[state.phase.current] } }] };
      },
    },
  },
});
