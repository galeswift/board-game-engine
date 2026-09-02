'use strict';

// Shared time-track data structure (see docs/architecture.md Section 12
// and docs/patchwork-next-steps.md's "Not started" section). Not wired
// into engine.js yet - this is just the data shape, deliberately, so it
// can be hooked up by hand.
//
// The physical board's time track is a line of 54 spaces (0 = start,
// 53 = final space) that both players' pawns move along independently.
// Whoever is *further behind* takes the next turn (non-alternating -
// see architecture.md Section 12). Landing on or passing a
// button-income space triggers automatic button income from whichever
// patches a player owns that produce it ("passive triggers from
// movement", same section).
//
// Button-income spaces occur every 6 spaces starting at 5 (5, 11, 17,
// ..., 53). Now checked against the same canonical source PATCHES was
// (CACppuccino/PatchworkGame's Java reference, see
// docs/patchwork-next-steps.md for that provenance) - its
// `specialButton` array is exactly this formula's output.
const TRACK_LENGTH = 53;
const BUTTON_INCOME_SPACES = Array.from(
  { length: Math.floor((TRACK_LENGTH - 5) / 6) + 1 },
  (_, i) => 5 + i * 6,
);

// The 5 physical 1x1 "leather patch" tiles placed on the time track at
// setup: whoever's token first passes (or lands on) one of these spaces
// claims that tile for free and places it on their own quilt board
// immediately (no button cost, doesn't come from the market pool) -
// same "pass or land" trigger as BUTTON_INCOME_SPACES, but each space
// only pays out once, to whoever crosses it first, not every player.
// Verified against CACppuccino/PatchworkGame's `specialTile` array
// (same source as PATCHES and BUTTON_INCOME_SPACES).
const SPECIAL_PATCH_SPACES = [20, 26, 32, 44, 50];

// Per-player slice of state.players[id] (architecture.md Section 4's
// createPlayerState). timeTrackPosition is a 0..TRACK_LENGTH space
// index; buttons is the player's spendable button count. 5 starting
// buttons matches the physical game's standard 2-player setup.
function createPlayerTimeTrackState({ buttons = 5 } = {}) {
  return {
    buttons,
    timeTrackPosition: 0,
  };
}

module.exports = { TRACK_LENGTH, BUTTON_INCOME_SPACES, SPECIAL_PATCH_SPACES, createPlayerTimeTrackState };
