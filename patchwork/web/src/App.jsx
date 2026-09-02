import { useEffect, useMemo, useRef, useState } from 'react';
import QuiltBoard from './components/QuiltBoard.jsx';
import TimeTrack from './components/TimeTrack.jsx';
import MoneyStatus from './components/MoneyStatus.jsx';
import PatchPicker from './components/PatchPicker.jsx';
import RotateControl from './components/RotateControl.jsx';
import LobbyStatus from './components/LobbyStatus.jsx';
import InvitePanel from './components/InvitePanel.jsx';
import Controls from './components/Controls.jsx';
import { loadPatches, loadTrackInfo, rotatePatch } from './data/patches.js';

const SLOTS = [0, 1];

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
  const [patches, setPatches] = useState([]);
  const [trackInfo, setTrackInfo] = useState({ trackLength: 0, buttonIncomeSpaces: [] });
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
  const [highlightedCells, setHighlightedCells] = useState([]);

  const initedRef = useRef(false);
  const playerIdRef = useRef(null);
  // Guards against createGame/loadGame calls racing each other - e.g.
  // the initial auto-create-on-load firing, then a "New Game" click
  // starting a second one before the first has finished. Both are full
  // async chains (create -> maybe join -> fetch legal actions), so
  // nothing guarantees they settle in start order; without this, a
  // slower *earlier* call's state could land after and clobber a
  // faster *later* one's, leaving gameId and legalActions describing
  // two different games. Each call captures its own token and only
  // commits state if it's still the most recent call when it finishes.
  const loadTokenRef = useRef(0);
  // How many createGame/loadGame calls are currently in flight. While
  // this is > 0, the UI must not be interactive - even a call that's
  // about to lose the loadTokenRef race still renders a real,
  // "ready to act" gameState/legalActions pair for its own (soon to be
  // discarded) game in the meantime, which is enough for something
  // driving the UI quickly (a test, a fast double-click) to act on a
  // game that's about to disappear underneath it.
  const [pendingLoads, setPendingLoads] = useState(0);

  function updatePlayerId(id) {
    playerIdRef.current = id;
    setPlayerId(id);
  }

  function clearSelection() {
    setSelectedPatchId(null);
    setRotation(0);
    setPlacementDomain([]);
    setHighlightedCells([]);
  }

  async function createGame(requestedMode) {
    const token = ++loadTokenRef.current;
    setPendingLoads((n) => n + 1);
    try {
      await createGameInner(requestedMode, token);
    } finally {
      setPendingLoads((n) => n - 1);
    }
  }

  async function createGameInner(requestedMode, token) {
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
      const ownInvite = data.invites.find((i) => i.slot === 0);
      const opponentInvite = data.invites.find((i) => i.slot === 1);
      const joined = await joinLobbyRequest(gid, ownInvite.token);
      if (joined) {
        newPlayerId = joined.playerId;
        newSlot = joined.slot;
        newLobby = joined.lobby;
      }
      url.searchParams.set('invite', ownInvite.token);
      newInviteLink = inviteLinkFor(gid, opponentInvite.token);
    }

    const newLegalActions = await fetchLegalActions(gid, newPlayerId);

    // A newer createGame/loadGame call started while this one was
    // still in flight - let that one's state win instead of
    // clobbering it with this now-stale result (see loadTokenRef).
    if (loadTokenRef.current !== token) return;

    window.history.replaceState({}, '', url);

    setGameId(gid);
    setMode(newMode);
    updatePlayerId(newPlayerId);
    setMySlot(newSlot);
    setGameState(data.state);
    setLobby(newLobby);
    setInviteLink(newInviteLink);
    clearSelection();
    setLegalActions(newLegalActions);
  }

  async function loadGame(id, joinToken) {
    const token = ++loadTokenRef.current;
    setPendingLoads((n) => n + 1);
    try {
      await loadGameInner(id, joinToken, token);
    } finally {
      setPendingLoads((n) => n - 1);
    }
  }

  async function loadGameInner(id, joinToken, token) {
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

    const newLegalActions = await fetchLegalActions(gid, newPlayerId);

    if (loadTokenRef.current !== token) return;

    setGameId(gid);
    setMode(newMode);
    updatePlayerId(newPlayerId);
    setMySlot(newSlot);
    setGameState(newGameState);
    setLobby(newLobby);
    setInviteLink('');
    clearSelection();
    setLegalActions(newLegalActions);
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

  
  async function advanceTimeToken() {
    const action = { type: 'advanceTimeToken' };
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

  async function placeSelectedPatch(row, col) {
    if (!selectedPatchId) return;
    const pivot = nearestInDomain(row, col, placementDomain);
    if (!pivot) return; // no legal placement anywhere near this cell
    const [pivotRow, pivotCol] = pivot;
    const action = { type: 'placePatch', patchId: selectedPatchId, rotation, row: pivotRow, col: pivotCol };
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
  
  async function addHighlightedCell(row, col) {
    setHighlightedCells((prev) => {
      const newSet = new Set(prev.map(([r, c]) => `${r},${c}`));
      newSet.add(`${row},${col}`);
      return Array.from(newSet).map((s) => s.split(',').map(Number));
    });
  }

  async function removeHighlightedCell(row, col) {
    setHighlightedCells((prev) => {
      const newSet = new Set(prev.map(([r, c]) => `${r},${c}`));
      newSet.delete(`${row},${col}`);
      return Array.from(newSet).map((s) => s.split(',').map(Number));
    });
  }

  async function clearHighlightedCells() {
    setHighlightedCells([]);
  }

  // `row`/`col` mean the shape's *pivot* on both ends of the wire -
  // patches.js's rotatePatch (imported below) rotates the pivot right
  // alongside the cells, identically on client and server, so there's
  // no separate anchor formula to keep in sync here. `placementDomain`
  // is already a list of legal pivot positions straight from the
  // server (see fetchPlacementDomain above); hovering/clicking near the
  // edge just snaps to the closest one in that list - no board-size or
  // shape-fit math needed client-side to do that.
  function nearestInDomain(row, col, domain) {
    if (domain.length === 0) return null;
    let best = null;
    let bestDist = Infinity;
    for (const [r, c] of domain) {
      const dist = Math.abs(r - row) + Math.abs(c - col);
      if (dist < bestDist) {
        bestDist = dist;
        best = [r, c];
      }
    }
    return best;
  }

  async function updateHighlights(row, col) {
    clearHighlightedCells();
    const pivot = nearestInDomain(row, col, placementDomain);
    if (!pivot) return;
    const patch = patchesById.get(selectedPatchId);
    if (!patch) return; // patches haven't loaded yet - shouldn't happen (nothing is selectable until they have), but don't crash if it does
    const shape = rotatePatch(patch, rotation);
    const [pivotRow, pivotCol] = pivot;
    const anchorRow = pivotRow - shape.pivot[0];
    const anchorCol = pivotCol - shape.pivot[1];
    for (const [r, c] of shape.cells) {
      addHighlightedCell(anchorRow + r, anchorCol + c);
    }
  }

  async function clearHighlights(row, col) {      
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
    loadPatches().then(setPatches);
    loadTrackInfo().then(setTrackInfo);
    const params = new URLSearchParams(window.location.search);
    const existingId = params.get('game');
    if (existingId) {
      loadGame(existingId, params.get('invite'));
    } else {
      createGame('local');
    }
  }, []);

  // Built once per fetch, not re-derived per lookup - the only client-side
  // use of this data is display (picker icons, the hover/rotate preview),
  // never legality (see docs/architecture.md, "Client Authority: Zero").
  const patchesById = useMemo(() => new Map(patches.map((p) => [p.id, p])), [patches]);

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

  // pendingLoads > 0 means a createGame/loadGame call is still in
  // flight - even if `gameState` already holds a real, actionable game
  // from an earlier call, it may be about to be replaced (see
  // loadTokenRef/pendingLoads above), so the UI must not look
  // interactive until everything has settled on one final game.
  if (!gameState || pendingLoads > 0) {
    return (
      <main>
        <h1>Patchwork</h1>
        <p id="status">Loading…</p>
      </main>
    );
  }

  const canAct = legalActions.some((a) => a.type === 'selectPatch');
  // The only patches actually pickable right now - the 3 in front of
  // the neutral token, further filtered to what's affordable (see
  // engine.js's queryLegalActions/patchCircle.js) - straight from the
  // server, per "Client Authority: Zero": PatchPicker must never
  // recompute this from gameState.availablePatches (the whole
  // remaining circle) itself.
  const pickableDomain = legalActions.find((a) => a.type === 'selectPatch')?.params.patchId.domain ?? [];
  const interactiveSlot = canAct ? gameState.currentPlayer : null;
  // The slot this browser controls right now: in multiplayer that's the
  // fixed identity from the invite token (mySlot, null until joined -
  // never anyone else's turn to act as); in local pass-and-play there's
  // no per-slot identity at all, so it's whoever's turn it currently is.
  // Every consumer that used to branch on `mode === 'multiplayer'` to
  // choose between `mySlot` and `gameState.currentPlayer` reads this
  // instead, so that branch is only ever written once.
  const activeSlot = mode === 'multiplayer' ? mySlot : gameState.currentPlayer;
  const highlighted = new Set(highlightedCells.map(([row, col]) => `${row},${col}`));
  const statusText = gameState.phase === 'lobby'
    ? 'Waiting for another player to join… share the link!'
    : gameState.phase === 'complete'
      ? 'All patches have been placed!'
      : !canAct
        ? "Waiting for the other player…"
        : selectedPatchId
          ? `Choose where to place ${selectedPatchId} on your board`
          : `Player ${gameState.currentPlayer + 1} turn — pick a patch below`;
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
            label={mode === 'multiplayer' ? (slot === activeSlot ? 'Your board' : "Opponent's board") : `Player ${slot + 1}`}
            board={gameState.quiltBoards[slot]}
            interactive={slot === interactiveSlot && !!selectedPatchId}
            highlighted={highlighted}
            onCellClick={placeSelectedPatch}
            onUpdateHighlights={updateHighlights}
          />
        ))}
      </div>
      <button onClick={advanceTimeToken} disabled={activeSlot !== gameState.currentPlayer}>
        Advance Time Token
      </button>
      <RotateControl rotation={rotation} onRotate={rotateSelected} disabled={!selectedPatchId} />
      <MoneyStatus gameState={gameState} slots={SLOTS} />
      <TimeTrack
        playerTimePositions={gameState.timeTrackPositions}
        trackLength={trackInfo.trackLength}
        buttonIncomeSpaces={trackInfo.buttonIncomeSpaces}
      />
      <PatchPicker
        patches={patches}
        pickableDomain={pickableDomain}
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
        visible={gameState.phase === 'lobby' && !!inviteLink}
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
