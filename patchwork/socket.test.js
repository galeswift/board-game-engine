'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { WebSocket } = require('ws');

const PORT = 35899; // distinct from every other *.test.js port in this folder
const BASE = `http://localhost:${PORT}`;
const WS_BASE = `ws://localhost:${PORT}`;

async function waitForServer(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(`${BASE}/`);
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function waitForMessage(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for a message')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchActions(gameId, { playerId, patchId, rotation } = {}) {
  const params = new URLSearchParams();
  if (playerId) params.set('playerId', playerId);
  if (patchId) params.set('patchId', patchId);
  if (rotation != null) params.set('rotation', String(rotation));
  const qs = params.toString();
  const res = await fetch(`${BASE}/api/games/${gameId}/actions${qs ? `?${qs}` : ''}`);
  return res.json();
}

// Whether a just-dealt circle's opening 3-patch offer contains anything
// affordable at the starting 5 buttons - see createGame/
// createReadyMultiplayerGame below for how this becomes a real fix
// (retry with a fresh shuffle) instead of a flaky test.
async function hasAffordableOffer(gameId, opts = {}) {
  const { actions } = await fetchActions(gameId, opts);
  const domain = actions[0]?.params?.patchId?.domain || [];
  return domain.length > 0;
}

// A test failure should never mean "rerun and hope" - retries with a
// bounded attempt count, discarding any game whose opening offer
// happens to be entirely unaffordable (rare, but a real possibility
// with a random shuffle) and dealing a fresh one instead. See
// project_patchwork_multiplayer_flake.md for how this was diagnosed.
async function createGame() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(`${BASE}/api/games`, { method: 'POST' });
    const data = await res.json();
    if (await hasAffordableOffer(data.gameId)) return data;
  }
  throw new Error('createGame: no affordable opening offer after 10 attempts');
}

async function createMultiplayerGame() {
  const res = await fetch(`${BASE}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'multiplayer' }),
  });
  return res.json();
}

// Like createMultiplayerGame, but also joins both slots and guarantees
// the resulting in-progress game's opening offer is affordable - for
// tests that need to immediately act on a real placement right after
// both players are seated.
async function createReadyMultiplayerGame() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const created = await createMultiplayerGame();
    const p1 = await join(created.gameId, tokenFor(created.invites, 0));
    const p2 = await join(created.gameId, tokenFor(created.invites, 1));
    if (await hasAffordableOffer(created.gameId, { playerId: p1.playerId })) {
      return { ...created, p1, p2 };
    }
  }
  throw new Error('createReadyMultiplayerGame: no affordable opening offer after 10 attempts');
}

async function join(gameId, inviteToken) {
  const res = await fetch(`${BASE}/api/games/${gameId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteToken }),
  });
  return res.json();
}

function tokenFor(invites, slot) {
  return invites.find((i) => i.slot === slot).token;
}

// Which patch is buyable isn't fixed (the patch circle is shuffled per
// game - gameDefinition.js/patchCircle.js), so ask the server which of
// the 3 currently offered patches is pickable, then where it's legal to
// place, rather than assuming a fixed id/anchor.
async function firstPickablePlacement(gameId, opts = {}) {
  const { actions } = await fetchActions(gameId, opts);
  const domain = actions[0].params.patchId.domain;
  // Every caller reaches this via createGame()/createReadyMultiplayerGame()
  // (both retry until the opening offer is affordable), so an empty
  // domain here means one of those guarantees broke, not "rare bad
  // luck, rerun."
  assert.ok(domain.length > 0, 'no affordable patch offered - the calling helper should have guaranteed this, so this points at a real bug');
  const patchId = domain[0];
  const { actions: placeActions } = await fetchActions(gameId, { ...opts, patchId, rotation: 0 });
  const [row, col] = placeActions[0].params.anchor.domain[0];
  return { patchId, row, col };
}

async function placePatch(gameId, playerId, patchId, row, col) {
  const action = { type: 'placePatch', params: { patchId, rotation: 0, row, col } };
  if (playerId) action.playerId = playerId;
  return fetch(`${BASE}/api/games/${gameId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
}

async function connectAndAuthenticate(gameId, playerId) {
  const socket = new WebSocket(`${WS_BASE}/api/games/${gameId}/socket`);
  await waitForOpen(socket);
  socket.send(JSON.stringify({ type: 'authenticate', playerId }));
  await sleep(100); // no ack protocol - give the server a beat to bind it
  return socket;
}

test('WebSocket live channel', async (t) => {
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });

  try {
    await waitForServer();

    await t.test('both connected sockets receive a state push after a REST move', async () => {
      const { gameId } = await createGame();
      const { patchId, row, col } = await firstPickablePlacement(gameId);

      const socketA = new WebSocket(`${WS_BASE}/api/games/${gameId}/socket`);
      const socketB = new WebSocket(`${WS_BASE}/api/games/${gameId}/socket`);
      await Promise.all([waitForOpen(socketA), waitForOpen(socketB)]);

      const [messageA, messageB] = await Promise.all([
        waitForMessage(socketA),
        waitForMessage(socketB),
        fetch(`${BASE}/api/games/${gameId}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'placePatch', params: { patchId, rotation: 0, row, col } }),
        }),
      ]);

      for (const message of [messageA, messageB]) {
        assert.equal(message.type, 'state');
        assert.equal(message.state.players['0'].quiltBoard.includes(patchId), true);
      }

      socketA.close();
      socketB.close();
    });

    await t.test('a rejected action is not broadcast', async () => {
      const { gameId } = await createGame();
      const { actions } = await fetchActions(gameId);
      const patchId = actions[0].params.patchId.domain[0];
      const socket = new WebSocket(`${WS_BASE}/api/games/${gameId}/socket`);
      await waitForOpen(socket);

      // row: 8 is off the board regardless of which patch this is -
      // rejected by applyAction and should never reach the socket.
      await fetch(`${BASE}/api/games/${gameId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'placePatch', params: { patchId, rotation: 0, row: 8, col: 0 } }),
      });

      await assert.rejects(() => waitForMessage(socket, 500));
      socket.close();
    });

    await t.test('connecting to an unknown game is refused', async () => {
      const socket = new WebSocket(`${WS_BASE}/api/games/doesnotexist/socket`);
      await new Promise((resolve) => {
        socket.once('error', resolve);
        socket.once('close', resolve);
      });
    });

    await t.test('authenticating scopes each socket\'s state push to its own slot', async () => {
      const { gameId, p1, p2 } = await createReadyMultiplayerGame(); // now in-progress, player 0's turn

      const socketP1 = await connectAndAuthenticate(gameId, p1.playerId);
      const socketP2 = await connectAndAuthenticate(gameId, p2.playerId);

      const { patchId, row, col } = await firstPickablePlacement(gameId, { playerId: p1.playerId });
      const [messageP1, messageP2] = await Promise.all([
        waitForMessage(socketP1),
        waitForMessage(socketP2),
        placePatch(gameId, p1.playerId, patchId, row, col),
      ]);

      assert.deepEqual(messageP1.actions, [], "not player 0's turn anymore");
      // It's now player 1's turn - up to the 3 the circle now offers
      // them (fewer if some aren't affordable), never including the
      // patch player 0 just took (it's gone from the circle entirely).
      assert.ok(messageP2.actions[0]?.params.patchId.domain.length <= 3);
      assert.equal(messageP2.actions[0]?.params.patchId.domain.includes(patchId), false, "it's now player 1's turn, one patch already taken");
      assert.deepEqual(messageP1.lobby, { 0: { claimed: true }, 1: { claimed: true } }, 'the push includes a live lobby summary too');

      socketP1.close();
      socketP2.close();
    });

    await t.test('closing a bound socket broadcasts a presence update to others', async () => {
      const { gameId, invites } = await createMultiplayerGame();
      const p1 = await join(gameId, tokenFor(invites, 0));
      const p2 = await join(gameId, tokenFor(invites, 1));

      const socketP1 = await connectAndAuthenticate(gameId, p1.playerId);
      const socketP2 = await connectAndAuthenticate(gameId, p2.playerId);

      const presence = waitForMessage(socketP2);
      socketP1.close();

      assert.deepEqual(await presence, { type: 'presence', slot: 0, connected: false });
      socketP2.close();
    });
  } finally {
    child.kill();
  }
});
