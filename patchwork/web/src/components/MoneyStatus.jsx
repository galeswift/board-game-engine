export default function MoneyStatus({ gameState, slots}) {
  const currentPlayer = Number(gameState.turnOrder.current);
  return (
    <div className="money-row">
        {slots.map((slot) => (
            <div key={slot} className={['pill-slot-' + slot, 'money-pill', slot === currentPlayer && 'is-turn'].filter(Boolean).join(' ')}>
            <span className="money-pill-slot">P{slot + 1}</span>
            <span className="money-pill-amount">{gameState.players[String(slot)].buttons}</span>
            </div>
        ))}
    </div>
  );
}
