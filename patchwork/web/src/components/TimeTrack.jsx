// A horizontal read of the shared time track: each player's pawn
// positioned along a 0..trackLength bar, with tick marks at the
// button-income spaces (see patchwork/timeTrack.js) so it's visible at
// a glance when a move is about to cross one. `trackLength` is 0 until
// App.jsx's loadTrackInfo() fetch resolves - renders a flat bar with no
// markers in that brief window rather than dividing by zero.
//
// `playerTimePositions` is keyed by 0-based slot index (0, 1) - the
// "Player 1"/"Player 2" display names are slot + 1, derived here, never
// stored anywhere as their own value (see engine.js).
export default function TimeTrack({ playerTimePositions, trackLength, buttonIncomeSpaces = [] }) {
  const max = trackLength || 1;
  const percentFor = (position) => `${Math.min(100, (position / max) * 100)}%`;
  // Nudge the markers apart vertically when they're close together on
  // the bar (most visibly at the very start, both at/near space 0) so
  // neither pawn is ever fully hidden behind the other.
  const close = Math.abs(playerTimePositions[0] - playerTimePositions[1]) / max < 0.04;

  return (
    <div className="time-track">
      <div className="time-track-bar">
        <div className='time-track-stack'>
            {buttonIncomeSpaces.map((space) => (
            <span
                key={space}
                className={['p0-time-track-tick']}
                style={{ left: percentFor(space) }}
                title={`Button income at space ${space}`}
            />
            ))}
        </div>
        <div className='time-track-stack'>
            {buttonIncomeSpaces.map((space) => (
            <span
                key={space}
                className={['p1-time-track-tick']}
                style={{ left: percentFor(space) }}
                title={`Button income at space ${space}`}
            />
            ))}
        </div>
        <span
          className={['time-track-marker', 'slot-0', close && 'nudge-up'].filter(Boolean).join(' ')}
          style={{ left: percentFor(playerTimePositions[0]) }}
          title={`Player 1: space ${playerTimePositions[0]}`}
        >
          1
        </span>
        <span
          className={['time-track-marker', 'slot-1', close && 'nudge-down'].filter(Boolean).join(' ')}
          style={{ left: percentFor(playerTimePositions[1]) }}
          title={`Player 2: space ${playerTimePositions[1]}`}
        >
          2
        </span>
      </div>
      <div className="time-track-labels">
        <span>Player 1 · {playerTimePositions[0]}</span>
        <span>Player 2 · {playerTimePositions[1]}</span>
      </div>
    </div>
  );
}
