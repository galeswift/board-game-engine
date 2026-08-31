// The client never infers legality from `board` itself - it only ever
// acts on what queryLegalActions (GET /api/games/:id/actions) reports.
// See docs/architecture.md, "Client Authority: Zero".
function legalCells(legalActions) {
  const place = legalActions.find((a) => a.type === 'placePiece');
  return place ? new Set(place.params.cell.domain) : new Set();
}

export default function Board({ board, legalActions, onCellClick }) {
  const cells = legalCells(legalActions);
  return (
    <div id="board" className="board">
      {board.map((value, i) => (
        <button
          key={i}
          className="cell"
          disabled={!cells.has(i)}
          onClick={() => onCellClick(i)}
        >
          {value || ''}
        </button>
      ))}
    </div>
  );
}
