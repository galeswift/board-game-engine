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

async function createGame() {
  const res = await fetch(`${BASE}/api/games`, { method: 'POST' });
  return res.json();
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
  } finally {
    child.kill();
  }
});
