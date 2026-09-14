'use strict';

// Canonical Forbidden Island tile roster and board shape - used by
// gameDefinition.js's setup phase to deal a real (if still otherwise
// fabricated) island layout. See docs/architecture.md Section 12: "24
// island tiles... represented as a plain keyed object under
// state.shared.islandTiles". Tile *names* are gameplay-relevant (sent to
// the client as part of state); their ASCII placeholder art is a
// display-only concern that lives separately in
// web/src/data/tileArt.js, matched up by name - same split as
// patches.js (server, gameplay) vs. web/src/data/patches.js (client,
// display), see docs/architecture.md's "Client Authority: Zero".

const TREASURE_TILE_NAMES = {
  'Cave of Embers': 'Fire Crystal',
  'Cave of Shadows': 'Fire Crystal',
  'Temple of the Sun': 'Earth Stone',
  'Temple of the Moon': 'Earth Stone',
  'Coral Palace': "Ocean's Chalice",
  'Tidal Palace': "Ocean's Chalice",
  'Howling Garden': 'Statue of the Wind Goddess',
  'Whispering Garden': 'Statue of the Wind Goddess',
};

const OTHER_TILE_NAMES = [
  'Bronze Gate',
  'Gold Gate',
  'Iron Gate',
  'Silver Gate',
  "Fools' Landing",
  'Breakers Bridge',
  'Cliffs of Abandon',
  'Crimson Forest',
  'Dunes of Deception',
  'Lost Lagoon',
  'Melting Sands',
  'Misty Marsh',
  'Observatory',
  'Phantom Rock',
  'Twilight Hollow',
  'Watchtower',
];

const TILE_NAMES = [...Object.keys(TREASURE_TILE_NAMES), ...OTHER_TILE_NAMES];

// The real board's rounded-diamond shape, as a 6x6 grid with the 4
// corners trimmed to 3 cells each (36 - 12 = 24) - real Forbidden Island
// shuffles its physical tiles into this same fixed shape every game.
const BOARD_ROWS = [
  [2, 3],
  [1, 2, 3, 4],
  [0, 1, 2, 3, 4, 5],
  [0, 1, 2, 3, 4, 5],
  [1, 2, 3, 4],
  [2, 3],
];

function boardPositions() {
  const positions = [];
  BOARD_ROWS.forEach((cols, row) => {
    cols.forEach((col) => positions.push({ row, col }));
  });
  return positions;
}

// Fisher-Yates using context.rng - never Math.random() (see
// docs/architecture.md Section 3), so dealing the island is reproducible
// under replay same as everything else.
function shuffledTileNames(rng) {
  const names = TILE_NAMES.slice();
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  return names;
}

// dealIsland(rng) -> { [id]: { id, row, col, name, treasure, floodState } }
function dealIsland(rng) {
  const positions = boardPositions();
  const names = shuffledTileNames(rng);
  const tiles = {};
  positions.forEach((pos, i) => {
    const name = names[i];
    const id = `${pos.row}-${pos.col}`;
    tiles[id] = {
      id,
      row: pos.row,
      col: pos.col,
      name,
      treasure: TREASURE_TILE_NAMES[name] || null,
      floodState: 'normal',
    };
  });
  return tiles;
}

module.exports = { TILE_NAMES, BOARD_ROWS, dealIsland };
