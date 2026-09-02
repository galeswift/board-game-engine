'use strict';

// Mulberry32 - a small, fast, well-distributed 32-bit PRNG. Chosen over
// Math.random() specifically because it's a pure function of its own
// state: same input state always produces the same {nextState, value}
// pair, which is the one property replay (docs/architecture.md Section 3)
// actually needs. Never call this directly from game code - go through
// context.js's context.rng(), which owns threading the state forward.
function step(state) {
  let t = (state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) | 0;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { nextState: t, value };
}

module.exports = { step };
