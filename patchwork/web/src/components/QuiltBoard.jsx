const BOARD_SIZE = 9;

// One player's 9x9 quilt board. `highlighted` (a Set of "row,col"
// strings, from the server's placement-anchor domain - see
// engine.js's queryLegalActions) is only meaningful when `interactive`
// is true; every other board renders read-only.
export default function QuiltBoard({ slot, label, board, interactive, highlighted, onCellClick }) {
  return (
    <div className="quilt-board-wrap">
      <p className="quilt-board-label">{label}</p>
      <div id={`quiltBoard-${slot}`} className={['quilt-board', interactive && 'interactive'].filter(Boolean).join(' ')}>
        {board.map((cell, i) => {
          const row = Math.floor(i / BOARD_SIZE);
          const col = i % BOARD_SIZE;
          const isHighlighted = interactive && highlighted.has(`${row},${col}`);
          return (
            <button
              key={i}
              className={['quilt-cell', cell && 'filled', isHighlighted && 'highlight'].filter(Boolean).join(' ')}
              disabled={!isHighlighted}
              data-row={row}
              data-col={col}
              onClick={() => onCellClick(row, col)}
            />
          );
        })}
      </div>
    </div>
  );
}
