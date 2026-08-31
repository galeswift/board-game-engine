'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { WebSocket } = require('ws');

const PORT = 34899; // distinct from server.test.js's port
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

async function placePiece(gameId, playerId, cell = 0) {
  const action = { type: 'placePiece', cell };
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
          body: JSON.stringify({ type: 'placePiece', cell: 4 }),
        }),
      ]);

      for (const message of [messageA, messageB]) {
        assert.equal(message.type, 'state');
        assert.equal(message.state.board[4], 'X');
      }

      socketA.close();
      socketB.close();
    });

    await t.test('a rejected action is not broadcast', async () => {
      const { gameId } = await createGame();
      const socket = new WebSocket(`${WS_BASE}/api/games/${gameId}/socket`);
      await waitForOpen(socket);

      // An out-of-range cell is rejected by applyAction and should never
      // reach the socket.
      await fetch(`${BASE}/api/games/${gameId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'placePiece', cell: 99 }),
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
      const x = await join(gameId, tokenFor(invites, 'X'));
      const o = await join(gameId, tokenFor(invites, 'O')); // now in-progress, X's turn

      const socketX = await connectAndAuthenticate(gameId, x.playerId);
      const socketO = await connectAndAuthenticate(gameId, o.playerId);

      const [messageX, messageO] = await Promise.all([
        waitForMessage(socketX),
        waitForMessage(socketO),
        placePiece(gameId, x.playerId),
      ]);

      assert.deepEqual(messageX.actions, [], "not X's turn anymore");
      assert.equal(messageO.actions[0]?.params.cell.domain.length, 8, "it's now O's turn");
      assert.deepEqual(messageX.lobby, { X: { claimed: true }, O: { claimed: true } }, 'the push includes a live lobby summary too');

      socketX.close();
      socketO.close();
    });

    await t.test('closing a bound socket broadcasts a presence update to others', async () => {
      const { gameId, invites } = await createMultiplayerGame();
      const x = await join(gameId, tokenFor(invites, 'X'));
      const o = await join(gameId, tokenFor(invites, 'O'));

      const socketX = await connectAndAuthenticate(gameId, x.playerId);
      const socketO = await connectAndAuthenticate(gameId, o.playerId);

      const presence = waitForMessage(socketO);
      socketX.close();

      assert.deepEqual(await presence, { type: 'presence', slot: 'X', connected: false });
      socketO.close();
    });
  } finally {
    child.kill();
  }
});
