'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPatchCircle, offeredPatches, takePatch } = require('./patchCircle');
const { PATCHES } = require('./patches');
const rng = require('../packages/rules-engine-core/src/rng');

// Test-only rng - these tests aren't exercising determinism/replay
// themselves (that's packages/rules-engine-core/test/replay.test.js's
// job), just createPatchCircle's shuffle/token-placement logic, so a
// fresh Math.random()-seeded generator per call is fine here.
function testRng() {
  let state = Math.floor(Math.random() * 0x7fffffff);
  return () => {
    const step = rng.step(state);
    state = step.nextState;
    return step.value;
  };
}

test('createPatchCircle is a full shuffle of every real patch, no duplicates or drops', () => {
  const { patchCircle } = createPatchCircle(PATCHES, testRng());
  assert.equal(patchCircle.length, 33);
  assert.deepEqual([...patchCircle].sort(), PATCHES.map((p) => p.id).sort());
});

test('the same seeded rng sequence produces the same shuffle', () => {
  const a = createPatchCircle(PATCHES, testRng());
  const fixedSeed = 12345;
  function seededRng(seed) {
    let state = seed;
    return () => {
      const step = rng.step(state);
      state = step.nextState;
      return step.value;
    };
  }
  const b = createPatchCircle(PATCHES, seededRng(fixedSeed));
  const c = createPatchCircle(PATCHES, seededRng(fixedSeed));
  assert.deepEqual(b, c);
  assert.notDeepEqual(a.patchCircle, b.patchCircle);
});

test('the neutral token starts immediately after the smallest patch (patch-01, the 1x2 domino)', () => {
  const { patchCircle, neutralTokenIndex } = createPatchCircle(PATCHES, testRng());
  const smallestIndex = patchCircle.indexOf('patch-01');
  assert.equal(neutralTokenIndex, (smallestIndex + 1) % patchCircle.length);
  // The smallest patch itself is never one of the first three offered.
  assert.equal(offeredPatches({ patchCircle, neutralTokenIndex }).includes('patch-01'), false);
});

test('offeredPatches returns exactly the 3 patches clockwise of the token', () => {
  const state = { patchCircle: ['a', 'b', 'c', 'd', 'e'], neutralTokenIndex: 1 };
  assert.deepEqual(offeredPatches(state), ['b', 'c', 'd']);
});

test('offeredPatches wraps around the end of the circle', () => {
  const state = { patchCircle: ['a', 'b', 'c', 'd', 'e'], neutralTokenIndex: 4 };
  assert.deepEqual(offeredPatches(state), ['e', 'a', 'b']);
});

test('offeredPatches returns fewer than 3 once the circle itself has fewer than 3 left', () => {
  const state = { patchCircle: ['a', 'b'], neutralTokenIndex: 0 };
  assert.deepEqual(offeredPatches(state), ['a', 'b']);
});

test('takePatch removes the middle offered patch and moves the token to sit where it was', () => {
  // circle: [A,B,C,D,E,F,G], token at index 2 -> offers C,D,E. Buying D
  // (offset 1) should leave [A,B,C,E,F,G] with the token now pointing at E.
  const state = { patchCircle: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], neutralTokenIndex: 2 };
  const result = takePatch(state, 1);
  assert.equal(result.takenId, 'D');
  assert.deepEqual(result.patchCircle, ['A', 'B', 'C', 'E', 'F', 'G']);
  assert.equal(result.neutralTokenIndex, 3);
  assert.equal(result.patchCircle[result.neutralTokenIndex], 'E');
});

test('takePatch removes the first offered patch (offset 0)', () => {
  const state = { patchCircle: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], neutralTokenIndex: 2 };
  const result = takePatch(state, 0);
  assert.equal(result.takenId, 'C');
  assert.deepEqual(result.patchCircle, ['A', 'B', 'D', 'E', 'F', 'G']);
  assert.equal(result.neutralTokenIndex, 2);
  assert.equal(result.patchCircle[result.neutralTokenIndex], 'D');
});

test('takePatch removes the last offered patch (offset 2)', () => {
  const state = { patchCircle: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], neutralTokenIndex: 2 };
  const result = takePatch(state, 2);
  assert.equal(result.takenId, 'E');
  assert.deepEqual(result.patchCircle, ['A', 'B', 'C', 'D', 'F', 'G']);
  assert.equal(result.neutralTokenIndex, 4);
  assert.equal(result.patchCircle[result.neutralTokenIndex], 'F');
});

test('takePatch handles a purchase that wraps around the end of the circle', () => {
  // token at index 4 of 5 -> offers index 4,0,1 (E,A,B). Buying offset 2 (B)...
  const state = { patchCircle: ['A', 'B', 'C', 'D', 'E'], neutralTokenIndex: 4 };
  const result = takePatch(state, 2);
  assert.equal(result.takenId, 'B');
  assert.deepEqual(result.patchCircle, ['A', 'C', 'D', 'E']);
  // New token index should land on C, the patch right after B.
  assert.equal(result.patchCircle[result.neutralTokenIndex], 'C');
});

test('takePatch does not mutate the input state', () => {
  const state = { patchCircle: ['A', 'B', 'C'], neutralTokenIndex: 0 };
  const before = JSON.stringify(state);
  takePatch(state, 1);
  assert.equal(JSON.stringify(state), before);
});

test('buying every patch down to an empty circle never drops, duplicates, or crashes - across many random runs', () => {
  for (let run = 0; run < 200; run++) {
    let state = createPatchCircle(PATCHES, testRng());
    const taken = [];
    while (state.patchCircle.length > 0) {
      const offers = offeredPatches(state);
      const offset = Math.floor(Math.random() * offers.length);
      const result = takePatch(state, offset);
      assert.equal(result.takenId, offers[offset]);
      taken.push(result.takenId);
      state = { patchCircle: result.patchCircle, neutralTokenIndex: result.neutralTokenIndex };
    }
    assert.deepEqual(taken.sort(), PATCHES.map((p) => p.id).sort(), `run ${run}: every patch taken exactly once`);
  }
});
