'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rng = require('../src/rng');

test('rng.step is a pure function of its input state', () => {
  const a = rng.step(12345);
  const b = rng.step(12345);
  assert.deepEqual(a, b);
});

test('rng.step produces a value in [0, 1)', () => {
  let state = 42;
  for (let i = 0; i < 1000; i++) {
    const { nextState, value } = rng.step(state);
    assert.ok(value >= 0 && value < 1, `value ${value} out of range`);
    state = nextState;
  }
});

test('rng.step is not the identity function and does not stall on repeated seeds', () => {
  const seeds = [0, 1, -1, 0x7fffffff, -0x7fffffff];
  for (const seed of seeds) {
    const { nextState } = rng.step(seed);
    assert.notEqual(nextState, seed);
  }
});

test('the same seed reproduces the same sequence of values', () => {
  function sequence(seed, n) {
    let state = seed;
    const values = [];
    for (let i = 0; i < n; i++) {
      const step = rng.step(state);
      values.push(step.value);
      state = step.nextState;
    }
    return values;
  }
  assert.deepEqual(sequence(918273645, 20), sequence(918273645, 20));
  assert.notDeepEqual(sequence(918273645, 20), sequence(1, 20));
});
