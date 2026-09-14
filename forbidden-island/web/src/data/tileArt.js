// Placeholder ASCII art for the 24 real Forbidden Island tiles - stands
// in for real tile art until forbidden-island has actual island state
// (gameDefinition.js is still the fabricated-playthrough bootstrap, see
// its own top comment). Deliberately plain ASCII, not AI-generated
// imagery, and deliberately rough - these are pure grey-box placeholders.
//
// Tiles that share a treasure (Cave of Embers/Shadows, Temple of the
// Sun/Moon, Coral/Tidal Palace, Howling/Whispering Garden) reuse a base
// design with a small variant, same as the real board's paired art. The
// four Gate tiles (the only entrances to Fools' Landing) share one
// design with just the label changed.

const GATE = [
  ' _.-""-._ ',
  '| [| |] |',
  '| [| |] |',
  "'-.____.-'",
];

function gate(name) {
  return { name, art: GATE };
}

function treasurePair(nameA, artA, nameB, artB, treasure) {
  return [
    { name: nameA, art: artA, treasure },
    { name: nameB, art: artB, treasure },
  ];
}

export const ISLAND_TILES = [
  // Gates - the only tiles adjacent to Fools' Landing.
  gate('Bronze Gate'),
  gate('Gold Gate'),
  gate('Iron Gate'),
  gate('Silver Gate'),

  // Fools' Landing - the helicopter lift-off point, center of the island.
  {
    name: "Fools' Landing",
    art: [
      '   ___   ',
      '  / H \\  ',
      ' | --- | ',
      '  \\___/  ',
    ],
  },

  // Treasure tile pairs (2 tiles each, either grants the treasure).
  ...treasurePair(
    'Cave of Embers',
    ['  /\\/\\   ', ' ( >.< )  ', '  \\ vv/  ', '   \\/    '],
    'Cave of Shadows',
    ['  /\\/\\   ', ' ( -.- )  ', '  \\ ..../  ', '   \\/    '],
    'Fire Crystal'
  ),
  ...treasurePair(
    'Temple of the Sun',
    ['   .-.   ', "  ( * )  ", ' /|   |\\ ', ' ^^^^^^^ '],
    'Temple of the Moon',
    ['   .-.   ', "  ( C )  ", ' /|   |\\ ', ' ^^^^^^^ '],
    'Earth Stone'
  ),
  ...treasurePair(
    'Coral Palace',
    [' /\\/\\/\\  ', '|########|', ' \\      / ', "  '----'  "],
    'Tidal Palace',
    [' ~~~~~~~ ', '|########|', ' \\      / ', "  '----'  "],
    "Ocean's Chalice"
  ),
  ...treasurePair(
    'Howling Garden',
    ['  * . *  ', ' .-""""-. ', ' | @  @ | ', " '-...-'  "],
    'Whispering Garden',
    ['   . .   ', ' .-"""-. ', ' | ~  ~ | ', " '-...-'  "],
    'Statue of the Wind Goddess'
  ),

  // Flavor tiles - no treasure, just terrain to move/flood/sink.
  {
    name: 'Breakers Bridge',
    art: ['~~~~~~~~~', '==|====|=', '~~~~~~~~~', '==|====|='],
  },
  {
    name: 'Cliffs of Abandon',
    art: ['    /\\   ', '   /  \\  ', '  /    \\ ', '_/      \\_'],
  },
  {
    name: 'Crimson Forest',
    art: ['  ^ ^ ^  ', ' ^^^^^^^ ', '  | | |  ', '  V V V  '],
  },
  {
    name: 'Dunes of Deception',
    art: [' .-~-.-~. ', '~-.-~-.-~ ', ' .-~-.-~. ', '~-.-~-.-~ '],
  },
  {
    name: 'Lost Lagoon',
    art: [' .~~~~~. ', '(  o o  )', ' `.___.`  ', '  ~~~~~  '],
  },
  {
    name: 'Melting Sands',
    art: [' o o o o ', '  o o o  ', ' o o o o ', '  o o o  '],
  },
  {
    name: 'Misty Marsh',
    art: [' . . . . ', '..  .  ..', ' . . . . ', '..  .  ..'],
  },
  {
    name: 'Observatory',
    art: ['   /^\\   ', '  | o |  ', '  |___|  ', '  =====  '],
  },
  {
    name: 'Phantom Rock',
    art: ['   /\\    ', '  /..\\   ', ' /....\\  ', '/......\\ '],
  },
  {
    name: 'Twilight Hollow',
    art: [' )    (  ', '(  )  )  ', ' )  (  ( ', '(    )   '],
  },
  {
    name: 'Watchtower',
    art: ['   [#]   ', '   [#]   ', '  =====  ', '   | |   '],
  },
];
