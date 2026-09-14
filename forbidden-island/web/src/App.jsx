import { useEffect, useState } from 'react';
import Board from './components/Board.jsx';

const PHASE_LABELS = {
  lobby: 'Lobby',
  setup: 'Setting up…',
  mainLoop: 'Playing',
  victory: 'Victory! The team escaped the island.',
  defeat: 'Defeat. The island claimed the team.',
};

const ACTION_LABELS = {
  startGame: 'Start Game',
  takeAction: 'Take Action',
  drawTreasureCards: 'Draw Treasure Cards',
  drawFloodCards: 'Draw Flood Cards',
};

async function fetchState() {
  const res = await fetch('/api/state');
  return res.json();
}

async function postAction(type) {
  const res = await fetch('/api/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
  });
  return res.json();
}

async function postNewGame() {
  const res = await fetch('/api/new-game', { method: 'POST' });
  return res.json();
}

export default function App() {
  const [gameState, setGameState] = useState(null);
  const [legalActions, setLegalActions] = useState([]);

  function applyView(view) {
    setGameState(view.state);
    setLegalActions(view.actions || []);
  }

  useEffect(() => {
    fetchState().then(applyView);
  }, []);

  if (!gameState) {
    return (
      <main>
        <h1>Forbidden Island</h1>
        <p className="phase">Loading…</p>
      </main>
    );
  }

  const phase = gameState.phase.current;
  const isPlaying = phase === 'mainLoop';
  const islandTiles = gameState.shared.islandTiles || {};
  const hasIsland = Object.keys(islandTiles).length > 0;

  return (
    <main>
      <h1>Forbidden Island</h1>
      <p className="hint">
        Bootstrap: the board below is dealt for real during setup, but the
        turn/water-level/treasure playthrough is still fabricated - no
        roles or real decks yet.
      </p>
      <p className="phase">{PHASE_LABELS[phase] || phase}</p>

      {hasIsland && <Board tiles={islandTiles} />}

      {isPlaying && (
        <dl className="stats">
          <div>
            <dt>Water level</dt>
            <dd>{gameState.shared.waterLevel}</dd>
          </div>
          <div>
            <dt>Treasures found</dt>
            <dd>{gameState.shared.treasuresFound} / 4</dd>
          </div>
          <div>
            <dt>Turn</dt>
            <dd>Player {gameState.turnOrder.current} — {gameState.shared.turnStep}</dd>
          </div>
        </dl>
      )}

      <div className="controls">
        {/* The client never decides which buttons are enabled by reading
            gameState itself - only by what queryLegalActions reported as
            `legalActions`. See docs/architecture.md, "Client Authority: Zero". */}
        {legalActions.map((action) => (
          <button key={action.type} onClick={() => postAction(action.type).then(applyView)}>
            {action.type === 'takeAction'
              ? `${ACTION_LABELS.takeAction} (${gameState.shared.actionsRemaining} left)`
              : ACTION_LABELS[action.type] || action.type}
          </button>
        ))}
      </div>

      <button className="new-game" onClick={() => postNewGame().then(applyView)}>
        New Game
      </button>
    </main>
  );
}
