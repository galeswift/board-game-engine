'use strict';

// A deliberately trivial game used only by rules-engine-core's own
// tests - NOT tic-tac-toe, NOT patchwork. Keeps core's tests from
// depending on (or accidentally coupling to) any real game package.
//
// Rules: one shared counter, three increments of a random 1-3 amount
// each, then the game transitions from 'play' to 'done'. Exercises:
// phase-gated legality, command/event dispatch, an implicit phase
// transition triggered by a game-emitted event, and context.rng().
const { defineGame } = require('../../src/defineGame');

module.exports = defineGame({
  id: 'fake-counter',
  gameVersion: 1,
  bounds: { players: { min: 1, max: 2 } },

  createPlayerState() {
    return { score: 0 };
  },

  createInitialState() {
    return { shared: { counter: 0, incrementsRemaining: 3 }, turnOrder: { current: '0' } };
  },

  phases: {
    initial: 'play',
    definitions: {
      play: {
        allowedActions: ['increment'],
        transitions: [{ onEvent: 'CounterFinished', to: 'done' }],
      },
      done: {
        allowedActions: [],
      },
    },
  },

  commands: {
    Increment: (state, { amount }) => {
      const nextRemaining = state.shared.incrementsRemaining - 1;
      const nextState = {
        ...state,
        shared: { ...state.shared, counter: state.shared.counter + amount, incrementsRemaining: nextRemaining },
      };
      const events = nextRemaining <= 0 ? [{ type: 'CounterFinished', payload: {} }] : [];
      return { state: nextState, events };
    },
  },

  rules: [],

  actions: {
    increment: {
      legalParams(state) {
        return state.shared.incrementsRemaining > 0 ? {} : null;
      },
      execute(state, params, context) {
        const amount = Math.floor(context.rng() * 3) + 1;
        return { commands: [{ type: 'Increment', payload: { amount } }] };
      },
    },
  },
});
