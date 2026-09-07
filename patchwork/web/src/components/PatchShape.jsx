// Renders a rotated patch shape as a small filled/empty grid, plus an
// optional cost/time badge row underneath. Pure display - the shape
// geometry always comes from data/patches.js on the client (fine for
// rendering) or the server's returned domain (for legality, never
// computed here).
export default function PatchShape({ shape, size = 10, cost, time, income }) {
  const filled = new Set(shape.cells.map(([r, c]) => `${r},${c}`));
  const cells = [];
  for (let r = 0; r < shape.rows; r++) {
    for (let c = 0; c < shape.cols; c++) {
      cells.push(filled.has(`${r},${c}`));
    }
  }

  return (
    <div className="patch-shape-wrap">
      <div
        className="patch-shape"
        style={{
          gridTemplateColumns: `repeat(${shape.cols}, ${size}px)`,
          gridTemplateRows: `repeat(${shape.rows}, ${size}px)`,
        }}
      >
        {cells.map((isFilled, i) => (
          <span key={i} className={isFilled ? 'patch-shape-cell filled' : 'patch-shape-cell'} />
        ))}
      </div>
      {(cost != null || time != null) && (
        <div className="patch-shape-stats">
          <span className="patch-stat patch-stat-cost" title="Button cost">{cost}</span>
          <span className="patch-stat patch-stat-time" title="Time cost">{time}</span>
          <span className="patch-stat patch-stat-income" title="Income">{income}</span>
        </div>
      )}
    </div>
  );
}
