const SLOTS = [0, 1];

export default function LobbyStatus({ mode, lobby, mySlot, gameState }) {
  if (mode !== 'multiplayer' || !lobby) return null;

  return (
    <div id="lobbyStatus" className="lobby-status">
      {/* mySlot is a 0-based index and can legitimately be 0 (falsy) -
          check against null explicitly, not truthiness. */}
      <p id="myRole" className="my-role">{mySlot !== null ? `You are Player ${mySlot + 1}` : 'Spectating'}</p>
      <ul id="playerList" className="player-list">
        {SLOTS.map((slot) => {
          const claimed = lobby[slot].claimed;
          const isTurn = gameState.phase.current === 'play' && Number(gameState.turnOrder.current) === slot;
          const detail = !claimed
            ? 'waiting…'
            : isTurn ? (slot === mySlot ? 'your turn' : 'their turn') : 'joined';

          return (
            <li
              key={slot}
              className={[slot === mySlot && 'is-you', isTurn && 'is-turn'].filter(Boolean).join(' ')}
            >
              <span>Player {slot + 1}{slot === mySlot ? ' (you)' : ''}</span>
              <span>{detail}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
