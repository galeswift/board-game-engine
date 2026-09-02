'use strict';

// The real Patchwork market: patches aren't a flat pool, they're
// arranged in a shuffled circle with a "neutral token" marking where
// selection starts. Verified against the official rules (UltraBoardGames'
// rules page, see docs/patchwork-next-steps.md-adjacent session notes):
// "Locate the smallest patch (1x2) and place the neutral token between
// this patch and the next patch in clockwise order" - so the token sits
// immediately *after* the smallest patch, meaning the smallest patch is
// never itself one of the first three offered. "You can choose from the
// three patches in front of the neutral token" - only those three are
// ever selectable. "Place the neutral token next to the chosen patch" -
// after a purchase, the token moves to sit where the bought patch was,
// so the patch immediately after it becomes the new first-offered patch.
//
// `rng` is packages/rules-engine-core's seeded context.rng() - never
// Math.random() (see docs/architecture.md Section 3's deterministic
// replay requirement). The caller (gameDefinition.js's DealPatchCircle
// command) is the only place that ever has a real context to draw from.

// Fisher-Yates. Returns a new array - never mutates `items`.
function shuffle(items, rng) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// The patch with the fewest filled cells - the 1x2 domino, uniquely,
// among the real 33 patches. Computed rather than hardcoded to a
// specific id so this keeps working if patches.js's data ever changes.
function smallestPatchId(patches) {
  return patches.reduce((smallest, p) => (p.cells.length < smallest.cells.length ? p : smallest)).id;
}

// { patchCircle, neutralTokenIndex } - patchCircle is the shuffled patch
// id order (this is the "defined in game state, not the patches
// definition" ordering); neutralTokenIndex points at the first of the
// three currently-offered patches (patchCircle[neutralTokenIndex],
// [+1], [+2], wrapping with % patchCircle.length).
function createPatchCircle(patches, rng) {
  const patchCircle = shuffle(patches.map((p) => p.id), rng);
  const smallestIndex = patchCircle.indexOf(smallestPatchId(patches));
  const neutralTokenIndex = (smallestIndex + 1) % patchCircle.length;
  return { patchCircle, neutralTokenIndex };
}

// The 3 patch ids currently selectable, in clockwise order starting
// right after the neutral token. Fewer than 3 only once the circle
// itself has fewer than 3 patches left in it (end of game).
function offeredPatches({ patchCircle, neutralTokenIndex }) {
  const count = Math.min(3, patchCircle.length);
  return Array.from({ length: count }, (_, k) => patchCircle[(neutralTokenIndex + k) % patchCircle.length]);
}

// Next { patchCircle, neutralTokenIndex } after buying the patch at
// offset `offset` (0, 1, or 2) from the neutral token - see the file
// header for why the new token index is `takenIndex` (the bought
// patch's own index, already wrapped into the *old* circle) taken mod
// the *new* (shrunk-by-one) circle length: removing that patch shifts
// every later index down by one, so that same numeric position now
// holds the patch immediately following the one just taken - exactly
// "next to where the chosen patch was". Deriving this from the raw,
// not-yet-wrapped `neutralTokenIndex + offset` instead of `takenIndex`
// is a subtle bug: it only agrees with `takenIndex % newLength` when
// the purchase didn't itself wrap around the end of the old circle.
function takePatch({ patchCircle, neutralTokenIndex }, offset) {
  const takenIndex = (neutralTokenIndex + offset) % patchCircle.length;
  const takenId = patchCircle[takenIndex];
  const nextCircle = patchCircle.filter((_, i) => i !== takenIndex);
  const nextTokenIndex = nextCircle.length === 0 ? 0 : takenIndex % nextCircle.length;
  return { takenId, patchCircle: nextCircle, neutralTokenIndex: nextTokenIndex };
}

module.exports = { createPatchCircle, offeredPatches, takePatch };
