import { useEffect, useRef, useState } from 'react';
import QuiltBoard from './components/QuiltBoard.jsx';
import PatchPicker from './components/PatchPicker.jsx';
import RotateControl from './components/RotateControl.jsx';
import LobbyStatus from './components/LobbyStatus.jsx';
import InvitePanel from './components/InvitePanel.jsx';
import Controls from './components/Controls.jsx';

const SLOTS = ['X', 'O'];

function inviteLinkFor(id, token) {
  const link = new URL(`${window.location.origin}${window.location.pathname}`);
  link.searchParams.set('game', id);
  link.searchParams.set('invite', token);
  return link.toString();
}

// The turn-agnostic "what's pickable" query - no patch selected yet.
// Same "Client Authority: Zero" pattern as before: the client never
// decides whose turn it is, it reads that off whether this comes back
// non-empty.
async function fetchLegalActions(gameId, playerId) {
  const query = playerId ? `?playerId=${encodeURIComponent(playerId)}` : '';
  const res = await fetch(`/api/games/${gameId}/actions${query}`);
  const data = await res.json();
  return data.actions || [];
}

// Once a patch (and rotation) is selected, ask the server for the
// domain of legal anchors - the client never computes placement
// legality itself (see engine.js's queryLegalActions).
async function fetchPlacementDomain(gameId, playerId, patchId, rotation) {
  const params = new URLSearchParams({ patchId, rotation: String(rotation) });
  if (playerId) params.set('playerId', playerId);
  const res = await fetch(`/api/games/${gameId}/actions?${params.toString()}`);
  const data = await res.json();
  const placement = (data.actions || []).find((a) => a.type === 'placePatch');
  return placement ? placement.params.anchor.domain : [];
}

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
  const [lobby, setLobby] = useState(null);
  const [inviteLink, setInviteLink] = useState('');
  const [shareLabel, setShareLabel] = useState('Copy Share Link');
  const [copyLabel, setCopyLabel] = useState('Copy Invite Link');

  // Selection is purely local UI state - never sent anywhere until the
  // player actually places the patch. Reset on every new state (a
  // placement, a turn change pushed over the socket, a fresh load).
  const [selectedPatchId, setSelectedPatchId] = useState(null);
  const [rotation, setRotation] = useState(0);
  const [placementDomain, setPlacementDomain] = useState([]);

  const initedRef = useRef(false);
  const playerIdRef = useRef(null);

  function updatePlayerId(id) {
    playerIdRef.current = id;
    setPlayerId(id);
  }

  function clearSelection() {
    setSelectedPatchId(null);
    setRotation(0);
    setPlacementDomain([]);
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
      const joined = await joinLobbyRequest(gid, ownInvite.token);
      if (joined) {
        newPlayerId = joined.playerId;
        newSlot = joined.slot;
        newLobby = joined.lobby;
      }
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
    clearSelection();
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
      const joined = await joinLobbyRequest(gid, joinToken);
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
    clearSelection();
    setLegalActions(await fetchLegalActions(gid, newPlayerId));
  }

  async function selectPatch(patchId) {
    if (patchId === selectedPatchId) {
      clearSelection();
      return;
    }
    setSelectedPatchId(patchId);
    setRotation(0);
    setPlacementDomain(await fetchPlacementDomain(gameId, playerId, patchId, 0));
  }

  async function rotateSelected() {
    if (!selectedPatchId) return;
    const nextRotation = (rotation + 1) % 4;
    setRotation(nextRotation);
    setPlacementDomain(await fetchPlacementDomain(gameId, playerId, selectedPatchId, nextRotation));
  }

  async function placeSelectedPatch(row, col) {
    if (!selectedPatchId) return;
    const action = { type: 'placePatch', patchId: selectedPatchId, rotation, row, col };
    if (playerId) action.playerId = playerId;
    const res = await fetch(`/api/games/${gameId}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    const data = await res.json();
    if (data.state) {
      setGameState(data.state);
      clearSelection();
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
        clearSelection(); // a new state (ours or the opponent's move) invalidates any in-flight selection
      }
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

  const canAct = legalActions.some((a) => a.type === 'selectPatch');
  const interactiveSlot = canAct ? gameState.currentPlayer : null;
  const highlighted = new Set(placementDomain.map(([row, col]) => `${row},${col}`));

  const statusText = gameState.status === 'lobby'
    ? 'Waiting for another player to join… share the link!'
    : gameState.status === 'complete'
      ? 'All patches have been placed!'
      : !canAct
        ? "Waiting for the other player…"
        : selectedPatchId
          ? `Choose where to place ${selectedPatchId} on your board`
          : "Your turn — pick a patch below";

  return (
    <main className="patchwork-app">
      <h1>Patchwork</h1>
      <p id="status">{statusText}</p>

      <LobbyStatus mode={mode} lobby={lobby} mySlot={mySlot} gameState={gameState} />

      <div className="quilt-boards">
        {SLOTS.map((slot) => (
          <QuiltBoard
            key={slot}
            slot={slot}
            label={mode === 'multiplayer' ? (slot === mySlot ? 'Your board' : "Opponent's board") : `Player ${slot}`}
            board={gameState.quiltBoards[slot]}
            interactive={slot === interactiveSlot && !!selectedPatchId}
            highlighted={highlighted}
            onCellClick={placeSelectedPatch}
          />
        ))}
      </div>

      <RotateControl rotation={rotation} onRotate={rotateSelected} disabled={!selectedPatchId} />

      <PatchPicker
        availablePatches={gameState.availablePatches}
        selectedPatchId={selectedPatchId}
        onSelect={selectPatch}
        disabled={!canAct}
      />

      <Controls
        onNewLocal={() => createGame('local')}
        onNewMultiplayer={() => createGame('multiplayer')}
        onShare={handleShare}
        shareLabel={shareLabel}
      />

      <p className="hint">Local: pass-and-play on one device. Multiplayer: share
        the link so a second player can join from any device. Pick a patch,
        rotate it if you like, then click a highlighted square on your own
        board to place it.</p>

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
