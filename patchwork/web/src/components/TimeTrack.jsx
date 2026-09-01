// A horizontal read of the shared time track: each player's pawn
// positioned along a 0..trackLength bar, with tick marks at the
// button-income spaces (see patchwork/timeTrack.js) so it's visible at
// a glance when a move is about to cross one. `trackLength` is 0 until
// App.jsx's loadTrackInfo() fetch resolves - renders a flat bar with no
// markers in that brief window rather than dividing by zero.
export default function TimeTrack({ playerTimePositions, trackLength, buttonIncomeSpaces = [] }) {
  const max = trackLength || 1;
  const percentFor = (position) => `${Math.min(100, (position / max) * 100)}%`;
  // Nudge the markers apart vertically when they're close together on
  // the bar (most visibly at the very start, both at/near space 0) so
  // neither pawn is ever fully hidden behind the other.
  const close = Math.abs(playerTimePositions.X - playerTimePositions.O) / max < 0.04;

  return (
    <div className="time-track">
      <div className="time-track-bar">
        {buttonIncomeSpaces.map((space) => (
          <span
            key={space}
            className="time-track-tick"
            style={{ left: percentFor(space) }}
            title={`Button income at space ${space}`}
          />
        ))}
        <span
          className={['time-track-marker', 'slot-x', close && 'nudge-up'].filter(Boolean).join(' ')}
          style={{ left: percentFor(playerTimePositions.X) }}
          title={`X: space ${playerTimePositions.X}`}
        >
          X
        </span>
        <span
          className={['time-track-marker', 'slot-o', close && 'nudge-down'].filter(Boolean).join(' ')}
          style={{ left: percentFor(playerTimePositions.O) }}
          title={`O: space ${playerTimePositions.O}`}
        >
          O
        </span>
      </div>
      <div className="time-track-labels">
        <span>X · {playerTimePositions.X}</span>
        <span>O · {playerTimePositions.O}</span>
      </div>
    </div>
  );
}
