const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const newLocalGameBtn = document.getElementById('newLocalGameBtn');
const newMultiplayerGameBtn = document.getElementById('newMultiplayerGameBtn');
const shareBtn = document.getElementById('shareBtn');
const invitePanelEl = document.getElementById('invitePanel');
const inviteLinkInputEl = document.getElementById('inviteLinkInput');
const copyInviteBtn = document.getElementById('copyInviteBtn');
const reconnectNoticeEl = document.getElementById('reconnectNotice');

let gameId = null;
let mode = 'local';
// The invite link is the only credential for multiplayer identity - no
// localStorage, no accounts. Losing it (and never bookmarking the page,
// see reconnectNoticeEl below) means losing your seat for good; that's
// a deliberate, documented tradeoff, not an oversight.
let playerId = null;
let state = null;
let legalActions = [];

function inviteLink(id, token) {
  const link = new URL(`${window.location.origin}${window.location.pathname}`);
  link.searchParams.set('game', id);
  link.searchParams.set('invite', token);
  return link.toString();
}

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

  // The invite panel is only useful while still waiting for the
  // opponent - once they've joined, sharing it again would just hand
  // out someone else's seat.
  if (state.status !== 'lobby') {
    invitePanelEl.hidden = true;
  }
  reconnectNoticeEl.hidden = !(mode === 'multiplayer' && playerId);
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

// Claims (or reconnects to) whichever slot `inviteToken` belongs to.
// Idempotent server-side: calling this again with the same token - a
// fresh join or a reconnect after closing the tab - returns the same
// playerId both times. No token, no slot: a bare ?game=<id> link can
// view but never join.
async function joinLobby(inviteToken) {
  const res = await fetch(`/api/games/${gameId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteToken }),
  });
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

  if (mode === 'multiplayer') {
    const ownInvite = data.invites.find((i) => i.slot === 'X');
    const opponentInvite = data.invites.find((i) => i.slot === 'O');
    await joinLobby(ownInvite.token); // creator claims the first slot automatically
    // The creator's own address bar becomes their personal reconnect
    // link - bookmarking it later needs no extra step.
    url.searchParams.set('invite', ownInvite.token);
    inviteLinkInputEl.value = inviteLink(gameId, opponentInvite.token);
    invitePanelEl.hidden = false;
  }

  window.history.replaceState({}, '', url);
  await refreshLegalActions();
  render();
  connectSocket();
}

async function loadGame(id, joinToken) {
  const res = await fetch(`/api/games/${id}`);
  if (!res.ok) {
    await createGame('local');
    return;
  }
  const data = await res.json();
  gameId = data.gameId;
  mode = data.mode || 'local';
  state = data.state;
  if (mode === 'multiplayer' && joinToken) {
    await joinLobby(joinToken); // first visit or a reconnect - same call either way
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
copyInviteBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(inviteLinkInputEl.value);
  copyInviteBtn.textContent = 'Copied!';
  setTimeout(() => { copyInviteBtn.textContent = 'Copy Invite Link'; }, 1500);
});

const params = new URLSearchParams(window.location.search);
const existingId = params.get('game');
if (existingId) {
  loadGame(existingId, params.get('invite'));
} else {
  createGame('local');
}
