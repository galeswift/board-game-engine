const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const newGameBtn = document.getElementById('newGameBtn');
const shareBtn = document.getElementById('shareBtn');

let gameId = null;
let state = null;
let legalActions = [];

// The client never infers legality from `state` itself - it only ever
// acts on what queryLegalActions (GET /api/games/:id/actions) reports.
// See docs/architecture.md, "Client Authority: Zero".
function legalCells() {
  const place = legalActions.find((a) => a.type === 'placePiece');
  return place ? new Set(place.params.cell.domain) : new Set();
}

async function refreshLegalActions() {
  const res = await fetch(`/api/games/${gameId}/actions`);
  const data = await res.json();
  legalActions = data.actions || [];
}

function render() {
  const cells = legalCells();
  boardEl.innerHTML = '';
  state.board.forEach((value, i) => {
    const btn = document.createElement('button');
    btn.className = 'cell';
    btn.textContent = value || '';
    btn.disabled = !cells.has(i);
    btn.addEventListener('click', () => placePiece(i));
    boardEl.appendChild(btn);
  });

  if (state.status === 'won') {
    statusEl.textContent = `${state.winner} wins!`;
  } else if (state.status === 'draw') {
    statusEl.textContent = "It's a draw.";
  } else {
    statusEl.textContent = `${state.currentPlayer}'s turn`;
  }
}

async function placePiece(cell) {
  const res = await fetch(`/api/games/${gameId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'placePiece', cell }),
  });
  const data = await res.json();
  if (data.state) {
    state = data.state;
    await refreshLegalActions();
    render();
  }
}

async function createGame() {
  const res = await fetch('/api/games', { method: 'POST' });
  const data = await res.json();
  gameId = data.gameId;
  state = data.state;
  const url = new URL(window.location);
  url.searchParams.set('game', gameId);
  window.history.replaceState({}, '', url);
  await refreshLegalActions();
  render();
}

async function loadGame(id) {
  const res = await fetch(`/api/games/${id}`);
  if (!res.ok) {
    await createGame();
    return;
  }
  const data = await res.json();
  gameId = data.gameId;
  state = data.state;
  await refreshLegalActions();
  render();
}

newGameBtn.addEventListener('click', createGame);
shareBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(window.location.href);
  shareBtn.textContent = 'Copied!';
  setTimeout(() => { shareBtn.textContent = 'Copy Share Link'; }, 1500);
});

const params = new URLSearchParams(window.location.search);
const existingId = params.get('game');
if (existingId) {
  loadGame(existingId);
} else {
  createGame();
}
