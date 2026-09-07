'use strict';

// Still a bootstrap, one step up from pure phase-cycling: this fabricates
// a full lobby -> setup -> mainLoop -> victory/defeat playthrough with
// placeholder turn actions, but there is still no island - no tiles, no
// roles, no real treasure/flood decks. "Water level," "treasures found,"
// and whether the island collapses on a given turn are all just numbers
// pushed around by the seeded RNG, not derived from any board state.
// This exists to exercise the turn-structure/RNG/win-loss-transition
// shape of the real game (docs/architecture.md Section 12) before any of
// that real state exists.

const { defineGame } = require('../packages/rules-engine-core/src');

const ACTIONS_PER_TURN = 3;
const TREASURE_CARDS_PER_DRAW = 2;
const TREASURES_TO_WIN = 4;
const MAX_WATER_LEVEL = 8;
const INITIAL_WATER_LEVEL = 1;
// Per treasure card drawn - loosely standing in for a "Waters Rise" card
// (real deck) and for happening to hold a matching treasure set (real
// deck), respectively. Chosen only to make a fabricated game last a
// handful of turns, not calibrated against the real card counts.
const WATERS_RISE_CHANCE = 0.2;
const TREASURE_FOUND_CHANCE = 0.3;

function nextSlot(state) {
  const slots = Object.keys(state.players).sort();
  const currentIndex = slots.indexOf(state.turnOrder.current);
  return slots[(currentIndex + 1) % slots.length];
}

module.exports = defineGame({
  id: 'forbidden-island',
  gameVersion: 1,
  bounds: { players: { min: 2, max: 4 } },

  createPlayerState() {
    return {};
  },

  createInitialState() {
    return {
      shared: {
        waterLevel: INITIAL_WATER_LEVEL,
        treasuresFound: 0,
        // Where in the current player's turn we are - gates which of the
        // three mainLoop actions is legal right now, standing in for the
        // real "3 actions -> draw 2 treasure cards -> draw flood cards"
        // sequence (Section 12).
        turnStep: 'actions',
        actionsRemaining: ACTIONS_PER_TURN,
      },
      turnOrder: { current: '0' },
    };
  },

  phases: {
    initial: 'lobby',
    definitions: {
      lobby: { allowedActions: ['startGame'] },
      // Instantaneous, like patchwork's setup - nobody chooses anything
      // here (yet), it just marks the point where real setup - dealing
      // starting hands, placing pawns on Fools' Landing - would go.
      setup: { allowedActions: [], transitions: [{ onEvent: 'SetupComplete', to: 'mainLoop' }] },
      mainLoop: {
        allowedActions: ['takeAction', 'drawTreasureCards', 'drawFloodCards'],
        transitions: [
          { onEvent: 'AllTreasuresFound', to: 'victory' },
          { onEvent: 'IslandLost', to: 'defeat' },
        ],
      },
      victory: { allowedActions: [] },
      defeat: { allowedActions: [] },
    },
  },

  commands: {
    CompleteFabricatedSetup: (state) => ({ state, events: [{ type: 'SetupComplete', payload: {} }] }),

    SpendAction: (state) => {
      const actionsRemaining = state.shared.actionsRemaining - 1;
      return {
        state: {
          ...state,
          shared: { ...state.shared, actionsRemaining, turnStep: actionsRemaining > 0 ? 'actions' : 'treasure' },
        },
        events: [],
      };
    },

    DrawTreasureCards: (state, _payload, context) => {
      let { waterLevel, treasuresFound } = state.shared;
      for (let i = 0; i < TREASURE_CARDS_PER_DRAW; i++) {
        if (context.rng() < WATERS_RISE_CHANCE) waterLevel = Math.min(waterLevel + 1, MAX_WATER_LEVEL);
        if (context.rng() < TREASURE_FOUND_CHANCE) treasuresFound += 1;
      }
      return {
        state: { ...state, shared: { ...state.shared, waterLevel, treasuresFound, turnStep: 'flood' } },
        events: treasuresFound >= TREASURES_TO_WIN ? [{ type: 'AllTreasuresFound', payload: {} }] : [],
      };
    },

    DrawFloodCards: (state, _payload, context) => {
      // Fabricated collapse check standing in for "a player is stranded
      // with nowhere to go" - scales with water level so the game
      // trends toward an ending, but proves nothing about real flood
      // mechanics.
      if (context.rng() < state.shared.waterLevel / MAX_WATER_LEVEL) {
        return { state, events: [{ type: 'IslandLost', payload: {} }] };
      }
      return {
        state: {
          ...state,
          shared: { ...state.shared, actionsRemaining: ACTIONS_PER_TURN, turnStep: 'actions' },
          turnOrder: { current: nextSlot(state) },
        },
        events: [],
      };
    },
  },

  rules: [
    {
      on: 'PhaseEntered',
      handler: (state, event) =>
        event.payload.phase === 'setup' ? [{ type: 'CompleteFabricatedSetup', payload: {} }] : [],
    },
  ],

  actions: {
    // Internal-only, same as patchwork's startGame - never a real
    // client-facing move once this has a lobby/join flow of its own.
    startGame: {
      legalParams(state) {
        return state.phase.current === 'lobby' ? {} : null;
      },
      execute() {
        return { commands: [{ type: 'TransitionPhase', payload: { to: 'setup' } }] };
      },
    },

    // Each action's execute() re-checks turnStep itself, not just
    // legalParams - the phase gate in engine.js's execute() only checks
    // that the action type is allowed in the current *phase*
    // (mainLoop), not the finer-grained turnStep within it. legalParams
    // is what queryLegalActions reports to the client; execute() has to
    // agree independently, same as patchwork's placePatch re-validating
    // its own params rather than trusting the caller ran legalParams
    // first.
    takeAction: {
      legalParams(state) {
        return state.shared.turnStep === 'actions' && state.shared.actionsRemaining > 0 ? {} : null;
      },
      execute(state) {
        if (state.shared.turnStep !== 'actions' || state.shared.actionsRemaining <= 0) {
          return { error: 'not-action-step' };
        }
        return { commands: [{ type: 'SpendAction', payload: {} }] };
      },
    },

    drawTreasureCards: {
      legalParams(state) {
        return state.shared.turnStep === 'treasure' ? {} : null;
      },
      execute(state) {
        if (state.shared.turnStep !== 'treasure') return { error: 'not-treasure-step' };
        return { commands: [{ type: 'DrawTreasureCards', payload: {} }] };
      },
    },

    drawFloodCards: {
      legalParams(state) {
        return state.shared.turnStep === 'flood' ? {} : null;
      },
      execute(state) {
        if (state.shared.turnStep !== 'flood') return { error: 'not-flood-step' };
        return { commands: [{ type: 'DrawFloodCards', payload: {} }] };
      },
    },
  },
});
