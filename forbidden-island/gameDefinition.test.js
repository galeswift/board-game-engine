'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame, execute, replay, extractActionLog } = require('../packages/rules-engine-core/src');
const gameDefinition = require('./gameDefinition');
const { TILE_NAMES } = require('./islandTiles');

function act(record, type) {
  const result = execute(gameDefinition, record, { type });
  assert.equal(result.error, null, `expected ${type} to succeed, got ${result.error}`);
  return result.record;
}

test('starts in lobby', () => {
  const { state } = createGame(gameDefinition, { players: [0, 1] });
  assert.equal(state.phase.current, 'lobby');
});

test('startGame moves lobby straight through the instantaneous setup phase into mainLoop', () => {
  let record = createGame(gameDefinition, { players: [0, 1] });
  record = act(record, 'startGame');
  assert.equal(record.state.phase.current, 'mainLoop');
  assert.equal(record.state.shared.turnStep, 'actions');
});

test('startGame deals all 24 tiles, each exactly once, onto distinct board positions', () => {
  let record = createGame(gameDefinition, { players: [0, 1] });
  record = act(record, 'startGame');
  const tiles = Object.values(record.state.shared.islandTiles);
  assert.equal(tiles.length, 24);
  assert.deepEqual(tiles.map((t) => t.name).sort(), TILE_NAMES.slice().sort());
  assert.equal(new Set(tiles.map((t) => `${t.row},${t.col}`)).size, 24);
});

test('a turn is 3 actions, then treasure cards, then flood cards, then the next player', () => {
  let record = createGame(gameDefinition, { players: [0, 1] });
  record = act(record, 'startGame');
  assert.equal(record.state.turnOrder.current, '0');

  for (let i = 0; i < 3; i++) {
    assert.equal(execute(gameDefinition, record, { type: 'drawTreasureCards' }).error, 'not-treasure-step');
    record = act(record, 'takeAction');
  }
  assert.equal(record.state.shared.turnStep, 'treasure');
  assert.equal(execute(gameDefinition, record, { type: 'takeAction' }).error, 'not-action-step');

  record = act(record, 'drawTreasureCards');
  assert.equal(record.state.shared.turnStep, 'flood');

  const beforeFlood = record;
  record = act(record, 'drawFloodCards');
  if (record.state.phase.current === 'mainLoop') {
    assert.equal(record.state.shared.turnStep, 'actions');
    assert.equal(record.state.turnOrder.current, '1');
  } else {
    assert.equal(record.state.phase.current, 'defeat');
    assert.notEqual(record, beforeFlood);
  }
});

test('replay from the same seed and action log reproduces an identical fabricated playthrough', () => {
  let record = createGame(gameDefinition, { players: [0, 1] });
  record = act(record, 'startGame');
  for (let i = 0; i < 30 && record.state.phase.current === 'mainLoop'; i++) {
    const legalType = record.state.shared.turnStep === 'actions' ? 'takeAction'
      : record.state.shared.turnStep === 'treasure' ? 'drawTreasureCards'
      : 'drawFloodCards';
    record = act(record, legalType);
  }
  assert.notEqual(record.state.phase.current, 'mainLoop');

  const replayed = replay(gameDefinition, record.state.meta.seed, [0, 1], extractActionLog(record.log));
  assert.deepEqual(replayed.state, record.state);
});

// --- Illegal-action / phase-gate rejections -------------------------------

test('startGame is illegal once the game has left the lobby', () => {
  let record = createGame(gameDefinition, { players: [0, 1] });
  record = act(record, 'startGame');
  const before = record;
  const result = execute(gameDefinition, record, { type: 'startGame' });
  assert.equal(result.error, 'illegal-action');
  assert.equal(result.record, before, 'a rejected action must not mutate or replace the record');
});

test('mainLoop actions are illegal before startGame', () => {
  const record = createGame(gameDefinition, { players: [0, 1] });
  for (const type of ['takeAction', 'drawTreasureCards', 'drawFloodCards']) {
    const result = execute(gameDefinition, record, { type });
    assert.equal(result.error, 'illegal-action');
    assert.equal(result.record, record);
  }
});

test('no action at all is legal once the game reaches a terminal phase', () => {
  let record = createGame(gameDefinition, { players: [0, 1] });
  record = act(record, 'startGame');
  // Force straight to a terminal phase (bypassing the fabricated
  // turn/RNG mechanics entirely, which is fine - this test is only
  // about phase gating, not how a real game reaches victory/defeat) by
  // constructing state directly, same technique as the RNG-forcing
  // tests below: engine.execute() only cares that record.state has the
  // shape the game expects, not how a test arrived at it.
  record = { ...record, state: { ...record.state, phase: { current: 'defeat' } } };
  for (const type of ['startGame', 'takeAction', 'drawTreasureCards', 'drawFloodCards']) {
    assert.equal(execute(gameDefinition, record, { type }).error, 'illegal-action');
  }
});

// --- Forcing specific RNG branches deterministically ----------------------
//
// Rather than searching for a game seed that happens to produce a given
// outcome, these construct a record already in the precondition a
// command needs (turnStep, water level, etc. set directly) and only
// search for an meta.rngState that drives context.rng()'s *next* call(s)
// the way the test needs - the search space is tiny (a single rng.step
// call) and the result is a plain deterministic assertion, not a
// probabilistic one. See docs/architecture.md Section 3: commands are
// pure (state, payload, context) -> {state, events}, so this is exactly
// the "test the reducer in isolation" the design is meant to support.

const rng = require('../packages/rules-engine-core/src/rng');

// MAX_WATER_LEVEL/ACTIONS_PER_TURN below must match gameDefinition.js's
// own same-named constants - not exported (the frozen GameDefinition
// object returned by defineGame can't carry extra fields), so duplicated
// here deliberately rather than reached into via an internal require.
const MAX_WATER_LEVEL = 8;

function readyForTreasureStep(record) {
  let r = record;
  for (let i = 0; i < 3; i++) r = act(r, 'takeAction');
  assert.equal(r.state.shared.turnStep, 'treasure');
  return r;
}

// DrawTreasureCards makes 4 consecutive context.rng() calls, not 2 - a
// waters-rise roll *and* a treasure-found roll per card, for both of the
// 2 cards drawn (see its own code). This controls all 4, so a test can
// pin exactly which of those independent checks fire without any of the
// others sneaking in an extra water-level bump or treasure find.
function findFourStepRngState(predicate) {
  for (let seed = 0; seed < 100000; seed++) {
    const s1 = rng.step(seed);
    const s2 = rng.step(s1.nextState);
    const s3 = rng.step(s2.nextState);
    const s4 = rng.step(s3.nextState);
    if (predicate(s1.value, s2.value, s3.value, s4.value)) return seed;
  }
  throw new Error('findFourStepRngState: no matching state found in range');
}

test('drawTreasureCards can raise the water level (a "Waters Rise" card)', () => {
  let record = createGame(gameDefinition, { players: [0, 1] });
  record = act(record, 'startGame');
  record = readyForTreasureStep(record);

  // Card 1's waters-rise roll (< 0.2) fires; every other roll (card 1's
  // treasure check, card 2's both checks) is pinned to not fire, so
  // exactly one water-level bump and no treasure is the only possible
  // outcome.
  const rngState = findFourStepRngState((v1, v2, v3, v4) => v1 < 0.2 && v2 >= 0.3 && v3 >= 0.2 && v4 >= 0.3);
  record = { ...record, state: { ...record.state, meta: { ...record.state.meta, rngState } } };

  const before = record.state.shared;
  record = act(record, 'drawTreasureCards');
  assert.equal(record.state.shared.waterLevel, before.waterLevel + 1);
  assert.equal(record.state.shared.treasuresFound, before.treasuresFound);
});

test('drawTreasureCards can find a treasure without raising the water level', () => {
  let record = createGame(gameDefinition, { players: [0, 1] });
  record = act(record, 'startGame');
  record = readyForTreasureStep(record);

  // Card 1's treasure roll (< 0.3) fires; every waters-rise roll (both
  // cards) and card 2's treasure roll are pinned to not fire.
  const rngState = findFourStepRngState((v1, v2, v3, v4) => v1 >= 0.2 && v2 < 0.3 && v3 >= 0.2 && v4 >= 0.3);
  record = { ...record, state: { ...record.state, meta: { ...record.state.meta, rngState } } };

  const before = record.state.shared;
  record = act(record, 'drawTreasureCards');
  assert.equal(record.state.shared.waterLevel, before.waterLevel, 'no waters-rise roll fired');
  assert.equal(record.state.shared.treasuresFound, before.treasuresFound + 1);
});

test('finding the 4th treasure transitions mainLoop straight to victory', () => {
  let record = createGame(gameDefinition, { players: [0, 1] });
  record = act(record, 'startGame');
  record = readyForTreasureStep(record);
  // Already holding 3 of the 4 needed - constructed directly, same
  // rationale as the terminal-phase test above.
  record = { ...record, state: { ...record.state, shared: { ...record.state.shared, treasuresFound: 3 } } };

  // Card 1 finds the 4th treasure; card 2's treasure roll is pinned to
  // not also fire, so the result is exactly 4, never 5.
  const rngState = findFourStepRngState((_v1, v2, _v3, v4) => v2 < 0.3 && v4 >= 0.3);
  record = { ...record, state: { ...record.state, meta: { ...record.state.meta, rngState } } };

  record = act(record, 'drawTreasureCards');
  assert.equal(record.state.shared.treasuresFound, 4);
  assert.equal(record.state.phase.current, 'victory');
});

test('drawFloodCards always ends the game once the water level is already at its max', () => {
  // Collapse chance is waterLevel / MAX_WATER_LEVEL - at the max, that's
  // 1, so this holds for *every* rngState, not just a found one. Picking
  // rngState 0 specifically proves it's not seed-dependent.
  let record = createGame(gameDefinition, { players: [0, 1] });
  record = act(record, 'startGame');
  record = readyForTreasureStep(record);
  record = act(record, 'drawTreasureCards'); // -> turnStep 'flood'
  record = {
    ...record,
    state: {
      ...record.state,
      meta: { ...record.state.meta, rngState: 0 },
      shared: { ...record.state.shared, waterLevel: MAX_WATER_LEVEL, turnStep: 'flood' },
    },
  };

  record = act(record, 'drawFloodCards');
  assert.equal(record.state.phase.current, 'defeat');
});

test('drawFloodCards never ends the game while the water level is at its minimum', () => {
  // Symmetric to the above: chance is 0/MAX = 0, so this holds for every
  // rngState too.
  let record = createGame(gameDefinition, { players: [0, 1] });
  record = act(record, 'startGame');
  record = readyForTreasureStep(record);
  record = act(record, 'drawTreasureCards');
  record = {
    ...record,
    state: {
      ...record.state,
      meta: { ...record.state.meta, rngState: 12345 },
      shared: { ...record.state.shared, waterLevel: 0, turnStep: 'flood' },
    },
  };

  record = act(record, 'drawFloodCards');
  assert.equal(record.state.phase.current, 'mainLoop');
  assert.equal(record.state.shared.turnStep, 'actions', 'survives and passes to the next player');
});

// --- Bounds -----------------------------------------------------------------

test('accepts between 2 and 4 players', () => {
  for (const count of [2, 3, 4]) {
    const { state } = createGame(gameDefinition, { players: Array.from({ length: count }, (_, i) => i) });
    assert.equal(Object.keys(state.players).length, count);
  }
});

test('rejects fewer than 2 or more than 4 players', () => {
  assert.throws(() => createGame(gameDefinition, { players: [0] }));
  assert.throws(() => createGame(gameDefinition, { players: [0, 1, 2, 3, 4] }));
});

// --- Cross-invariant: many random playthroughs ------------------------------

test('property: across many random-seeded playthroughs, water level and treasures found stay monotonic and in bounds', () => {
  const TREASURES_TO_WIN = 4;
  for (let trial = 0; trial < 25; trial++) {
    let record = createGame(gameDefinition, { players: [0, 1] });
    record = act(record, 'startGame');
    let lastWaterLevel = record.state.shared.waterLevel;
    let lastTreasuresFound = record.state.shared.treasuresFound;

    for (let i = 0; i < 60 && record.state.phase.current === 'mainLoop'; i++) {
      const legalType = record.state.shared.turnStep === 'actions' ? 'takeAction'
        : record.state.shared.turnStep === 'treasure' ? 'drawTreasureCards'
        : 'drawFloodCards';
      record = act(record, legalType);

      const { waterLevel, treasuresFound } = record.state.shared;
      assert.ok(waterLevel >= lastWaterLevel, 'water level never decreases');
      assert.ok(waterLevel <= MAX_WATER_LEVEL, 'water level never exceeds its max');
      assert.ok(treasuresFound >= lastTreasuresFound, 'treasures found never decreases');
      // Not <= TREASURES_TO_WIN unconditionally: a single draw can find
      // a treasure on *both* cards, so a count of 3 can jump straight to
      // 5, overshooting 4 in the same action that triggers victory (the
      // AllTreasuresFound check is `>=`, not `===`, precisely so an
      // overshoot still wins rather than getting stuck). Only bounded
      // while still actually in mainLoop.
      if (record.state.phase.current === 'mainLoop') {
        assert.ok(treasuresFound <= TREASURES_TO_WIN, 'treasures found never exceeds the win count mid-game');
      } else if (record.state.phase.current === 'victory') {
        assert.ok(treasuresFound >= TREASURES_TO_WIN, 'victory only ever follows reaching the win count');
      }
      assert.ok(['lobby', 'setup', 'mainLoop', 'victory', 'defeat'].includes(record.state.phase.current));
      lastWaterLevel = waterLevel;
      lastTreasuresFound = treasuresFound;
    }

    // Every trial must reach a real conclusion within 60 actions -
    // otherwise this test would be silently not exercising the
    // win/loss paths at all.
    assert.notEqual(record.state.phase.current, 'mainLoop', `trial ${trial} did not conclude within 60 actions`);
  }
});
