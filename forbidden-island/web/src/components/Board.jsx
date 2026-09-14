import { ISLAND_TILES } from '../data/tileArt.js';

// Display-only lookup from a tile's gameplay name (state.shared.islandTiles,
// straight from the server) to its ASCII placeholder art - never used for
// legality, same "Client Authority: Zero" split as patchwork's
// data/patches.js. A name with no matching art (shouldn't happen once
// islandTiles.js and tileArt.js agree on the roster) just renders blank
// rather than crashing.
const ART_BY_NAME = new Map(ISLAND_TILES.map((t) => [t.name, t.art]));

const FLOOD_LABELS = {
  normal: '',
  flooded: '(flooded)',
  sunk: '(sunk)',
};

export default function Board({ tiles }) {
  const positioned = Object.values(tiles);
  if (positioned.length === 0) return null;

  const rows = Math.max(...positioned.map((t) => t.row)) + 1;
  const cols = Math.max(...positioned.map((t) => t.col)) + 1;
  const byPosition = new Map(positioned.map((t) => [`${t.row},${t.col}`, t]));

  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tile = byPosition.get(`${row},${col}`);
      const art = tile && ART_BY_NAME.get(tile.name);
      cells.push(
        <div key={`${row},${col}`} className={tile ? `tile flood-${tile.floodState}` : 'tile-empty'}>
          {tile && (
            <>
              {art && <pre>{art.join('\n')}</pre>}
              <div className="tile-name">{tile.name}</div>
              {tile.treasure && <div className="tile-treasure">{tile.treasure}</div>}
              {FLOOD_LABELS[tile.floodState] && <div className="tile-flood">{FLOOD_LABELS[tile.floodState]}</div>}
            </>
          )}
        </div>,
      );
    }
  }

  return (
    <div className="board" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {cells}
    </div>
  );
}
