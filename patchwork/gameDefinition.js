'use strict';

// Patchwork's actual rules, expressed as a packages/rules-engine-core
// GameDefinition (see docs/architecture.md Section 12 - Patchwork was
// picked as the second proof-of-concept specifically to stress-test this
// generic phases/command/event design; this file is what closes the gap
// flagged in docs/patchwork-next-steps.md's "retrofit" entry).
//
// Every command reducer below is a near-verbatim port of what used to
// live inline in the old direct-mutation engine.js
// (placePatchGetNextState/advanceTimeTokenGetNextState/
// calculateGlobalBoardIncome/calculateButtonIncome/nextPlayerFrom) - this
// is a re-plumbing of *where* that logic lives (small pure reducers +
// rules instead of one big function), not a rules rewrite.

const { defineGame } = require('../packages/rules-engine-core/src');
const { PATCHES, getPatch, rotatePatch } = require('./patches');
const { TRACK_LENGTH, BUTTON_INCOME_SPACES } = require('./timeTrack');
const { createPatchCircle, offeredPatches, takePatch } = require('./patchCircle');

const BOARD_SIZE = 9;

// Verified against published rules (UltraBoardGames / Happy Piranha /
// Geeky Hobbies, cross-checked 2026-09-01): final score = buttons -
// 2*(empty squares) + 7 if you're the one who completed a full 7x7
// sub-area on your board. The real rule is a *race* - whoever completes
// a 7x7 area first claims the bonus during play, not a re-evaluation at
// game end for both players - see the ClaimBonusTile command/rule below.
const SEVEN_BY_SEVEN_BONUS = 7;
const SEVEN_BY_SEVEN_SIZE = 7;

function emptyBoard() {
  return Array(BOARD_SIZE * BOARD_SIZE).fill(null);
}

function otherSlot(slot) {
  return slot === '0' ? '1' : '0';
}

function normalizeRotation(rotation) {
  return ((Number(rotation) || 0) % 4 + 4) % 4;
}

// patchCircle.js's functions take/return { patchCircle, neutralTokenIndex }
// - state stores that same data under shared.market.{circle,neutralTokenIndex}
// (a naming difference that predates this migration), so every call into
// patchCircle.js bridges the field names here rather than at each call site.
function circleFrom(state) {
  return { patchCircle: state.shared.market.circle, neutralTokenIndex: state.shared.market.neutralTokenIndex };
}

// True if every cell of `shape` (already rotated) fits inside the board
// with its top-left corner at (row, col) without overlapping an
// occupied cell. Bounds are checked by the caller.
function fits(board, shape, row, col) {
  return shape.cells.every(([dr, dc]) => board[(row + dr) * BOARD_SIZE + (col + dc)] === null);
}

// Scans in corner coordinates but returns the domain in pivot
// coordinates - shape.pivot (patches.js) is the one, shared definition
// of what "row, col" means on the wire for this shape.
function placementDomain(board, shape) {
  const domain = [];
  for (let row = 0; row + shape.rows <= BOARD_SIZE; row++) {
    for (let col = 0; col + shape.cols <= BOARD_SIZE; col++) {
      if (fits(board, shape, row, col)) domain.push([row + shape.pivot[0], col + shape.pivot[1]]);
    }
  }
  return domain;
}

function calculateButtonIncome(board) {
  let income = 0;
  for (const patchId of new Set(board)) {
    if (patchId) {
      const patch = getPatch(patchId);
      if (patch && patch.income) income += patch.income;
    }
  }
  return income;
}

// Any of the 9 possible 7x7 windows on a 9x9 board fully covered.
function hasFullSevenBySeven(board) {
  for (let row = 0; row + SEVEN_BY_SEVEN_SIZE <= BOARD_SIZE; row++) {
    for (let col = 0; col + SEVEN_BY_SEVEN_SIZE <= BOARD_SIZE; col++) {
      let full = true;
      for (let dr = 0; dr < SEVEN_BY_SEVEN_SIZE && full; dr++) {
        for (let dc = 0; dc < SEVEN_BY_SEVEN_SIZE; dc++) {
          if (board[(row + dr) * BOARD_SIZE + (col + dc)] === null) {
            full = false;
            break;
          }
        }
      }
      if (full) return true;
    }
  }
  return false;
}

// "Whoever's behind on the time track goes next; a tie favors the mover
// going again" - verified against real rules earlier in this project,
// unchanged from the old engine.js's nextPlayerFrom. Compares both
// slots directly (not "mover vs other") to match that logic exactly.
function nextMover(players, moverSlot) {
  const pos0 = players['0'].timeTrackPosition;
  const pos1 = players['1'].timeTrackPosition;
  if (pos0 === pos1) return moverSlot;
  return pos0 < pos1 ? '0' : '1';
}

module.exports = defineGame({
  id: 'patchwork',
  gameVersion: 1,
  bounds: { players: { min: 2, max: 2 } },

  createPlayerState() {
    return { buttons: 5, quiltBoard: emptyBoard(), timeTrackPosition: 0, score: null };
  },

  createInitialState() {
    return {
      shared: { market: { circle: [], neutralTokenIndex: 0 }, bonusTileHolder: null },
      turnOrder: { current: '0' },
    };
  },

  // lobby -> setup -> play -> scoring -> gameOver. 'setup' and 'scoring'
  // are both instantaneous/fully automatic (nobody ever chooses anything
  // during them) - like the old hand-rolled phase field, they're never
  // externally observable as a persisted response, because the whole
  // command/event chain they trigger (DealPatchCircle -> SetupComplete,
  // ComputeScore -> ScoringComplete) drains synchronously within the
  // same execute() call that entered them, before that call returns.
  phases: {
    initial: 'lobby',
    definitions: {
      lobby: { allowedActions: ['startGame'] },
      setup: { allowedActions: [], transitions: [{ onEvent: 'SetupComplete', to: 'play' }] },
      play: {
        allowedActions: ['selectPatch', 'placePatch', 'advanceTimeToken'],
        transitions: [{ onEvent: 'BothPlayersFinished', to: 'scoring' }],
      },
      scoring: { allowedActions: [], transitions: [{ onEvent: 'ScoringComplete', to: 'gameOver' }] },
      gameOver: { allowedActions: [] },
    },
  },

  commands: {
    DealPatchCircle: (state, _payload, context) => {
      const { patchCircle, neutralTokenIndex } = createPatchCircle(PATCHES, context.rng);
      return {
        state: { ...state, shared: { ...state.shared, market: { circle: patchCircle, neutralTokenIndex } } },
        events: [{ type: 'SetupComplete', payload: {} }],
      };
    },

    PayForPatch: (state, { slot, cost }) => ({
      state: {
        ...state,
        players: { ...state.players, [slot]: { ...state.players[slot], buttons: state.players[slot].buttons - cost } },
      },
      events: [],
    }),

    PlacePatchOnBoard: (state, { slot, patchId, rotation, row, col }) => {
      const patch = getPatch(patchId);
      const shape = rotatePatch(patch, rotation);
      const anchorRow = row - shape.pivot[0];
      const anchorCol = col - shape.pivot[1];
      const board = state.players[slot].quiltBoard.slice();
      for (const [dr, dc] of shape.cells) {
        board[(anchorRow + dr) * BOARD_SIZE + (anchorCol + dc)] = patchId;
      }
      return {
        state: { ...state, players: { ...state.players, [slot]: { ...state.players[slot], quiltBoard: board } } },
        events: [{ type: 'PatchPlaced', payload: { slot, patchId } }],
      };
    },

    TakePatchFromCircle: (state, { offset }) => {
      const { patchCircle, neutralTokenIndex } = takePatch(circleFrom(state), offset);
      return {
        state: { ...state, shared: { ...state.shared, market: { circle: patchCircle, neutralTokenIndex } } },
        events: [],
      };
    },

    // Shared by both placePatch (buttonsPerSpace: 0 - the "you get
    // button income" clause only applies to advanceTimeToken) and
    // advanceTimeToken (buttonsPerSpace: 1). Passed-space button income
    // is deliberately NOT computed here - see the TimeTrackAdvanced rule
    // below, which is what actually makes this a "passive trigger from
    // movement" (docs/architecture.md Section 12) rather than logic
    // baked directly into the mutation that caused it.
    AdvanceTimeTrack: (state, { slot, toPosition, buttonsPerSpace }) => {
      const fromPosition = state.players[slot].timeTrackPosition;
      const cappedTo = Math.min(toPosition, TRACK_LENGTH);
      const spacesMoved = cappedTo - fromPosition;
      const nextPlayers = {
        ...state.players,
        [slot]: {
          ...state.players[slot],
          timeTrackPosition: cappedTo,
          buttons: state.players[slot].buttons + buttonsPerSpace * spacesMoved,
        },
      };
      return {
        state: { ...state, players: nextPlayers, turnOrder: { current: nextMover(nextPlayers, slot) } },
        events: [{ type: 'TimeTrackAdvanced', payload: { slot, from: fromPosition, to: cappedTo } }],
      };
    },

    AddButtons: (state, { slot, amount }) => ({
      state: {
        ...state,
        players: { ...state.players, [slot]: { ...state.players[slot], buttons: state.players[slot].buttons + amount } },
      },
      events: [],
    }),

    ClaimBonusTile: (state, { slot }) => ({
      state: { ...state, shared: { ...state.shared, bonusTileHolder: slot } },
      events: [{ type: 'BonusTileClaimed', payload: { slot } }],
    }),

    // Real end condition (verified against published rules 2026-09-01,
    // superseding the old engine.js's "patch circle is empty" check -
    // that was never actually correct: with 33 patches and a 53-space
    // track shared by 2 players, the circle essentially never empties
    // before both players finish the track). "Both players' time tokens
    // have reached the end" is the only real end condition.
    EmitGameEnded: (state) => ({ state, events: [{ type: 'BothPlayersFinished', payload: {} }] }),

    ComputeScore: (state) => {
      const nextPlayers = {};
      for (const slot of Object.keys(state.players)) {
        const player = state.players[slot];
        const emptySquares = player.quiltBoard.filter((cell) => cell === null).length;
        const bonus = state.shared.bonusTileHolder === slot ? SEVEN_BY_SEVEN_BONUS : 0;
        nextPlayers[slot] = { ...player, score: player.buttons - 2 * emptySquares + bonus };
      }
      return { state: { ...state, players: nextPlayers }, events: [{ type: 'ScoringComplete', payload: {} }] };
    },
  },

  rules: [
    {
      on: 'PhaseEntered',
      handler: (state, event) => {
        if (event.payload.phase === 'setup') return [{ type: 'DealPatchCircle', payload: {} }];
        if (event.payload.phase === 'scoring') return [{ type: 'ComputeScore', payload: {} }];
        return [];
      },
    },
    {
      // "First to complete a 7x7 area" - a race, not an end-of-game
      // re-evaluation, so this has to be checked right when a patch
      // lands, not deferred to ComputeScore.
      on: 'PatchPlaced',
      handler: (state, event) => {
        if (state.shared.bonusTileHolder) return [];
        const board = state.players[event.payload.slot].quiltBoard;
        return hasFullSevenBySeven(board) ? [{ type: 'ClaimBonusTile', payload: { slot: event.payload.slot } }] : [];
      },
    },
    {
      // "Passive triggers from movement" (docs/architecture.md Section
      // 12): button income for *passing* (not landing on) a
      // BUTTON_INCOME_SPACES space, as a rule reacting to the fact that
      // time-track position changed - not inlined into whatever action
      // caused the movement.
      on: 'TimeTrackAdvanced',
      handler: (state, event) => {
        let spacesPassed = 0;
        for (let pos = event.payload.from + 1; pos <= event.payload.to; pos++) {
          if (BUTTON_INCOME_SPACES.includes(pos)) spacesPassed += 1;
        }
        if (spacesPassed === 0) return [];
        const amount = spacesPassed * calculateButtonIncome(state.players[event.payload.slot].quiltBoard);
        return amount > 0 ? [{ type: 'AddButtons', payload: { slot: event.payload.slot, amount } }] : [];
      },
    },
    {
      on: 'TimeTrackAdvanced',
      handler: (state) =>
        state.players['0'].timeTrackPosition >= TRACK_LENGTH && state.players['1'].timeTrackPosition >= TRACK_LENGTH
          ? [{ type: 'EmitGameEnded', payload: {} }]
          : [],
    },
  ],

  actions: {
    // Only ever issued internally by server.js (create for local mode,
    // join for multiplayer once both slots fill) - never a real
    // client-facing move. server.js must reject a client-submitted
    // {type:'startGame'} on the public POST .../actions route and must
    // not surface it via GET .../actions while in 'lobby', since core
    // has no concept of "is the lobby actually full" (that's
    // server.js's `lobby` object, entirely outside engine state).
    startGame: {
      legalParams(state) {
        return state.phase.current === 'lobby' ? {} : null;
      },
      execute() {
        return { commands: [{ type: 'TransitionPhase', payload: { to: 'setup' } }] };
      },
    },

    // Purely descriptive - mirrors the old queryLegalActions' "here's
    // what you could pick" hint. The client never actually commits a
    // {type:'selectPatch'} action (a real move is always placePatch);
    // this exists so 'selectPatch' can be a real, defineGame-validated
    // action whose legalParams participates in the shared
    // queryLegalActions loop the same way every other action's does.
    selectPatch: {
      legalParams(state, playerId, selection) {
        if (selection && selection.patchId) return null;
        const slot = state.turnOrder.current;
        const offered = offeredPatches(circleFrom(state));
        const affordable = offered.filter((id) => {
          const patch = getPatch(id);
          return patch && patch.cost <= state.players[slot].buttons;
        });
        return { patchId: { domain: affordable } };
      },
      execute() {
        return { error: 'selectPatch-is-informational-only' };
      },
    },

    advanceTimeToken: {
      legalParams(state, playerId, selection) {
        return selection && selection.patchId ? null : {};
      },
      execute(state) {
        const slot = state.turnOrder.current;
        const other = otherSlot(slot);
        const spacesToAdvance = Math.max(
          0,
          state.players[other].timeTrackPosition - state.players[slot].timeTrackPosition + 1
        );
        const toPosition = state.players[slot].timeTrackPosition + spacesToAdvance;
        return { commands: [{ type: 'AdvanceTimeTrack', payload: { slot, toPosition, buttonsPerSpace: 1 } }] };
      },
    },

    placePatch: {
      legalParams(state, playerId, selection) {
        if (!selection || !selection.patchId) return null;
        const slot = state.turnOrder.current;
        const offered = offeredPatches(circleFrom(state));
        if (!offered.includes(selection.patchId)) return null;
        const patch = getPatch(selection.patchId);
        if (!patch) return null;
        const rotation = normalizeRotation(selection.rotation);
        const shape = rotatePatch(patch, rotation);
        const domain = placementDomain(state.players[slot].quiltBoard, shape);
        return { patchId: selection.patchId, rotation, anchor: { domain } };
      },
      execute(state, params) {
        const slot = state.turnOrder.current;
        const { patchId, row, col } = params || {};
        const offered = offeredPatches(circleFrom(state));
        const offerOffset = offered.indexOf(patchId);
        if (typeof patchId !== 'string' || offerOffset === -1) return { error: 'invalid-patch' };

        const patch = getPatch(patchId);
        if (!patch) return { error: 'invalid-patch' };
        if (!Number.isInteger(row) || !Number.isInteger(col)) return { error: 'invalid-placement' };
        if (patch.cost > state.players[slot].buttons) return { error: 'insufficient-buttons' };

        const rotation = normalizeRotation(params.rotation);
        const shape = rotatePatch(patch, rotation);
        const anchorRow = row - shape.pivot[0];
        const anchorCol = col - shape.pivot[1];
        if (anchorRow < 0 || anchorCol < 0 || anchorRow + shape.rows > BOARD_SIZE || anchorCol + shape.cols > BOARD_SIZE) {
          return { error: 'invalid-placement' };
        }
        if (!fits(state.players[slot].quiltBoard, shape, anchorRow, anchorCol)) {
          return { error: 'invalid-placement' };
        }

        const toPosition = state.players[slot].timeTrackPosition + patch.time;
        return {
          commands: [
            { type: 'PayForPatch', payload: { slot, cost: patch.cost } },
            { type: 'PlacePatchOnBoard', payload: { slot, patchId, rotation, row, col } },
            { type: 'TakePatchFromCircle', payload: { offset: offerOffset } },
            { type: 'AdvanceTimeTrack', payload: { slot, toPosition, buttonsPerSpace: 0 } },
          ],
        };
      },
    },
  },
});
