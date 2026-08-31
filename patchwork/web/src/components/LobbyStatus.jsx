export default function LobbyStatus({ mode, lobby, mySlot, gameState }) {
  if (mode !== 'multiplayer' || !lobby) return null;

  return (
    <div id="lobbyStatus" className="lobby-status">
      <p id="myRole" className="my-role">{mySlot ? `You are ${mySlot}` : 'Spectating'}</p>
      <ul id="playerList" className="player-list">
        {['X', 'O'].map((slot) => {
          const claimed = lobby[slot].claimed;
          const isTurn = gameState.status === 'in-progress' && gameState.currentPlayer === slot;
          const detail = !claimed
            ? 'waiting…'
            : isTurn ? (slot === mySlot ? 'your turn' : 'their turn') : 'joined';

          return (
            <li
              key={slot}
              className={[slot === mySlot && 'is-you', isTurn && 'is-turn'].filter(Boolean).join(' ')}
            >
              <span>{slot}{slot === mySlot ? ' (you)' : ''}</span>
              <span>{detail}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
