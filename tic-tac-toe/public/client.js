const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const newLocalGameBtn = document.getElementById('newLocalGameBtn');
const newMultiplayerGameBtn = document.getElementById('newMultiplayerGameBtn');
const shareBtn = document.getElementById('shareBtn');

let gameId = null;
let mode = 'local';
let playerId = null; // multiplayer only; kept in memory only for now -
                      // no localStorage, no way to recover it on refresh
                      // yet. That's what the invite-link work replacing
                      // this open /join step is for.
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
  const query = playerId ? `?playerId=${encodeURIComponent(playerId)}` : '';
  const res = await fetch(`/api/games/${gameId}/actions${query}`);
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

  if (state.status === 'lobby') {
    statusEl.textContent = 'Waiting for another player to join… share the link!';
  } else if (state.status === 'won') {
    statusEl.textContent = `${state.winner} wins!`;
  } else if (state.status === 'draw') {
    statusEl.textContent = "It's a draw.";
  } else {
    statusEl.textContent = `${state.currentPlayer}'s turn`;
  }
}

// Live push: lets the *other* player's browser find out a move happened
// without polling. This is additive on top of the REST calls above,
// which remain the source of truth - a lost/never-connected socket just
// means you don't see updates live, not that anything is broken.
let socket = null;

function connectSocket() {
  if (socket) socket.close();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}/api/games/${gameId}/socket`);
  socket.addEventListener('open', () => {
    if (playerId) {
      socket.send(JSON.stringify({ type: 'authenticate', playerId }));
    }
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'state') {
      state = message.state;
      legalActions = message.actions || [];
      render();
    }
    // 'presence' messages are cosmetic-only and not wired into the UI
    // yet - nothing in this phase depends on them.
  });
}

async function placePiece(cell) {
  const action = { type: 'placePiece', cell };
  if (playerId) action.playerId = playerId;
  const res = await fetch(`/api/games/${gameId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
  const data = await res.json();
  if (data.state) {
    state = data.state;
    await refreshLegalActions();
    render();
  }
}

// Open join, no invite token yet - claims whatever slot is still free.
// Replaced by an invite-token-gated version next; until then, this is
// also the only way a second browser gets into a multiplayer game.
async function joinLobby() {
  const res = await fetch(`/api/games/${gameId}/join`, { method: 'POST' });
  const data = await res.json();
  if (data.playerId) {
    playerId = data.playerId;
    state = data.state;
  }
}

async function createGame(requestedMode) {
  const res = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: requestedMode }),
  });
  const data = await res.json();
  gameId = data.gameId;
  mode = data.mode || 'local';
  state = data.state;
  const url = new URL(window.location);
  url.searchParams.set('game', gameId);
  window.history.replaceState({}, '', url);
  if (mode === 'multiplayer') {
    await joinLobby(); // creator claims the first slot automatically
  }
  await refreshLegalActions();
  render();
  connectSocket();
}

async function loadGame(id) {
  const res = await fetch(`/api/games/${id}`);
  if (!res.ok) {
    await createGame('local');
    return;
  }
  const data = await res.json();
  gameId = data.gameId;
  mode = data.mode || 'local';
  state = data.state;
  if (mode === 'multiplayer' && !playerId) {
    await joinLobby(); // a fresh visitor to a shared multiplayer link
  }
  await refreshLegalActions();
  render();
  connectSocket();
}

newLocalGameBtn.addEventListener('click', () => createGame('local'));
newMultiplayerGameBtn.addEventListener('click', () => createGame('multiplayer'));
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
  createGame('local');
}
