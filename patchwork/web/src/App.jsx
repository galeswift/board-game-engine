import { useEffect, useRef, useState } from 'react';
import Board from './components/Board.jsx';
import LobbyStatus from './components/LobbyStatus.jsx';
import InvitePanel from './components/InvitePanel.jsx';
import Controls from './components/Controls.jsx';

function inviteLinkFor(id, token) {
  const link = new URL(`${window.location.origin}${window.location.pathname}`);
  link.searchParams.set('game', id);
  link.searchParams.set('invite', token);
  return link.toString();
}

async function fetchLegalActions(gameId, playerId) {
  const query = playerId ? `?playerId=${encodeURIComponent(playerId)}` : '';
  const res = await fetch(`/api/games/${gameId}/actions${query}`);
  const data = await res.json();
  return data.actions || [];
}

// Claims (or reconnects to) whichever slot `inviteToken` belongs to.
// Idempotent server-side: calling this again with the same token - a
// fresh join or a reconnect after closing the tab - returns the same
// playerId both times.
async function joinLobbyRequest(gameId, inviteToken) {
  const res = await fetch(`/api/games/${gameId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteToken }),
  });
  const data = await res.json();
  return data.playerId ? data : null;
}

export default function App() {
  const [gameId, setGameId] = useState(null);
  const [mode, setMode] = useState('local');
  const [playerId, setPlayerId] = useState(null);
  const [mySlot, setMySlot] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [legalActions, setLegalActions] = useState([]);
  // { X: { claimed }, O: { claimed } } for multiplayer games - never
  // contains tokens, just enough to render a player list.
  const [lobby, setLobby] = useState(null);
  const [inviteLink, setInviteLink] = useState('');
  const [shareLabel, setShareLabel] = useState('Copy Share Link');
  const [copyLabel, setCopyLabel] = useState('Copy Invite Link');

  const initedRef = useRef(false);
  // The invite link is the only credential for multiplayer identity - no
  // localStorage, no accounts. A ref (not state) so the socket effect
  // below can read the latest value at 'open' time without re-running
  // every time it changes.
  const playerIdRef = useRef(null);

  function updatePlayerId(id) {
    playerIdRef.current = id;
    setPlayerId(id);
  }

  async function createGame(requestedMode) {
    const res = await fetch('/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: requestedMode }),
    });
    const data = await res.json();
    const gid = data.gameId;
    const newMode = data.mode || 'local';

    const url = new URL(window.location);
    url.searchParams.set('game', gid);

    let newPlayerId = null;
    let newSlot = null;
    let newLobby = data.lobby || null;
    let newInviteLink = '';

    if (newMode === 'multiplayer') {
      const ownInvite = data.invites.find((i) => i.slot === 'X');
      const opponentInvite = data.invites.find((i) => i.slot === 'O');
      const joined = await joinLobbyRequest(gid, ownInvite.token); // creator claims the first slot automatically
      if (joined) {
        newPlayerId = joined.playerId;
        newSlot = joined.slot;
        newLobby = joined.lobby;
      }
      // The creator's own address bar becomes their personal reconnect
      // link - bookmarking it later needs no extra step.
      url.searchParams.set('invite', ownInvite.token);
      newInviteLink = inviteLinkFor(gid, opponentInvite.token);
    }

    window.history.replaceState({}, '', url);

    setGameId(gid);
    setMode(newMode);
    updatePlayerId(newPlayerId);
    setMySlot(newSlot);
    setGameState(data.state);
    setLobby(newLobby);
    setInviteLink(newInviteLink);
    setLegalActions(await fetchLegalActions(gid, newPlayerId));
  }

  async function loadGame(id, joinToken) {
    const res = await fetch(`/api/games/${id}`);
    if (!res.ok) {
      await createGame('local');
      return;
    }
    const data = await res.json();
    const gid = data.gameId;
    const newMode = data.mode || 'local';

    let newPlayerId = null;
    let newSlot = null;
    let newGameState = data.state;
    let newLobby = data.lobby || null;

    if (newMode === 'multiplayer' && joinToken) {
      const joined = await joinLobbyRequest(gid, joinToken); // first visit or a reconnect - same call either way
      if (joined) {
        newPlayerId = joined.playerId;
        newSlot = joined.slot;
        newGameState = joined.state;
        newLobby = joined.lobby;
      }
    }

    setGameId(gid);
    setMode(newMode);
    updatePlayerId(newPlayerId);
    setMySlot(newSlot);
    setGameState(newGameState);
    setLobby(newLobby);
    setInviteLink('');
    setLegalActions(await fetchLegalActions(gid, newPlayerId));
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
      setGameState(data.state);
      setLegalActions(await fetchLegalActions(gameId, playerId));
    }
  }

  async function handleShare() {
    await navigator.clipboard.writeText(window.location.href);
    setShareLabel('Copied!');
    setTimeout(() => setShareLabel('Copy Share Link'), 1500);
  }

  async function handleCopyInvite() {
    await navigator.clipboard.writeText(inviteLink);
    setCopyLabel('Copied!');
    setTimeout(() => setCopyLabel('Copy Invite Link'), 1500);
  }

  // Initial load: exactly once, mirroring client.js's bottom-of-file logic.
  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const existingId = params.get('game');
    if (existingId) {
      loadGame(existingId, params.get('invite'));
    } else {
      createGame('local');
    }
  }, []);

  // Live push: lets the *other* player's browser find out a move happened
  // without polling. Additive on top of the REST calls above, which
  // remain the source of truth. One socket per game load - depends only
  // on gameId (not playerId) so a batched playerId update right after
  // gameId doesn't reopen it; playerIdRef carries the latest value in.
  useEffect(() => {
    if (!gameId) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/games/${gameId}/socket`);
    socket.addEventListener('open', () => {
      if (playerIdRef.current) {
        socket.send(JSON.stringify({ type: 'authenticate', playerId: playerIdRef.current }));
      }
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'state') {
        setGameState(message.state);
        setLegalActions(message.actions || []);
        if (message.lobby) setLobby(message.lobby);
      }
      // 'presence' messages are cosmetic-only and not wired into the UI
      // yet - nothing in this phase depends on them.
    });
    return () => socket.close();
  }, [gameId]);

  if (!gameState) {
    return (
      <main>
        <h1>Patchwork</h1>
        <p id="status">Loading…</p>
      </main>
    );
  }

  const statusText = gameState.status === 'lobby'
    ? 'Waiting for another player to join… share the link!'
    : gameState.status === 'won'
      ? `${gameState.winner} wins!`
      : gameState.status === 'draw'
        ? "It's a draw."
        : `${gameState.currentPlayer}'s turn`;

  return (
    <main>
      <h1>Patchwork</h1>
      <p id="status">{statusText}</p>

      <LobbyStatus mode={mode} lobby={lobby} mySlot={mySlot} gameState={gameState} />

      <Board board={gameState.board} legalActions={legalActions} onCellClick={placePiece} />

      <Controls
        onNewLocal={() => createGame('local')}
        onNewMultiplayer={() => createGame('multiplayer')}
        onShare={handleShare}
        shareLabel={shareLabel}
      />

      <p className="hint">Local: pass-and-play on one device. Multiplayer: share
        the link so a second player can join from any device.</p>

      {/* The invite panel is only useful while still waiting for the
          opponent - once they've joined, sharing it again would just hand
          out someone else's seat. */}
      <InvitePanel
        visible={gameState.status === 'lobby' && !!inviteLink}
        inviteLink={inviteLink}
        onCopy={handleCopyInvite}
        copyLabel={copyLabel}
      />

      <p id="reconnectNotice" className="hint" hidden={!(mode === 'multiplayer' && playerId)}>
        <strong>Do not lose this link</strong> — it's the only way back
        into this game. Bookmark this page now; you can come back to it
        any time.
      </p>
    </main>
  );
}
