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

async function createGame() {
  const res = await fetch(`${BASE}/api/games`, { method: 'POST' });
  return res.json();
}

async function createMultiplayerGame() {
  const res = await fetch(`${BASE}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'multiplayer' }),
  });
  return res.json();
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

async function placePatch(gameId, playerId, patchId = 'patch-01', row = 0, col = 0) {
  const action = { type: 'placePatch', patchId, rotation: 0, row, col };
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

      const socketA = new WebSocket(`${WS_BASE}/api/games/${gameId}/socket`);
      const socketB = new WebSocket(`${WS_BASE}/api/games/${gameId}/socket`);
      await Promise.all([waitForOpen(socketA), waitForOpen(socketB)]);

      const [messageA, messageB] = await Promise.all([
        waitForMessage(socketA),
        waitForMessage(socketB),
        fetch(`${BASE}/api/games/${gameId}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 }),
        }),
      ]);

      for (const message of [messageA, messageB]) {
        assert.equal(message.type, 'state');
        assert.equal(message.state.quiltBoards[0][0], 'patch-01');
      }

      socketA.close();
      socketB.close();
    });

    await t.test('a rejected action is not broadcast', async () => {
      const { gameId } = await createGame();
      const socket = new WebSocket(`${WS_BASE}/api/games/${gameId}/socket`);
      await waitForOpen(socket);

      // An out-of-bounds placement is rejected by applyAction and should
      // never reach the socket.
      await fetch(`${BASE}/api/games/${gameId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 8, col: 0 }),
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
      const { gameId, invites } = await createMultiplayerGame();
      const p1 = await join(gameId, tokenFor(invites, 0));
      const p2 = await join(gameId, tokenFor(invites, 1)); // now in-progress, player 0's turn

      const socketP1 = await connectAndAuthenticate(gameId, p1.playerId);
      const socketP2 = await connectAndAuthenticate(gameId, p2.playerId);

      const [messageP1, messageP2] = await Promise.all([
        waitForMessage(socketP1),
        waitForMessage(socketP2),
        placePatch(gameId, p1.playerId),
      ]);

      assert.deepEqual(messageP1.actions, [], "not player 0's turn anymore");
      // Player 1 still has all 5 starting buttons, so their
      // affordable-patch count is a fresh game's minus the one player 0
      // just took (see server.test.js's AFFORDABLE_PATCH_IDS for where 24
      // comes from: patches costing <= 5).
      assert.equal(messageP2.actions[0]?.params.patchId.domain.length, 23, "it's now player 1's turn, one patch already taken");
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
