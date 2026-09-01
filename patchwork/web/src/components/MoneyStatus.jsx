export default function MoneyStatus({ gameState, slots}) {
  return (
    <div className="money-row">
        {slots.map((slot) => (
            <div key={slot} className={['pill-slot-' + slot, 'money-pill', slot === gameState.currentPlayer && 'is-turn'].filter(Boolean).join(' ')}>
            <span className="money-pill-slot">P{slot + 1}</span>
            <span className="money-pill-amount">{gameState.playerMoney[slot]}</span>
            </div>
        ))}
    </div>
  );
}
