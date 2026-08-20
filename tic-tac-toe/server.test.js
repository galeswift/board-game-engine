'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 34599;
const BASE = `http://localhost:${PORT}`;

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

async function createGame() {
  const res = await fetch(`${BASE}/api/games`, { method: 'POST' });
  return res.json();
}

async function placePiece(gameId, cell) {
  return fetch(`${BASE}/api/games/${gameId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'placePiece', cell }),
  });
}

test('legal actions and preview endpoints', async (t) => {
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });

  try {
    await waitForServer();

    await t.test('GET /api/games/:id/actions lists every legal cell on a fresh game', async () => {
      const { gameId } = await createGame();
      const res = await fetch(`${BASE}/api/games/${gameId}/actions`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.actions, [
        { type: 'placePiece', params: { cell: { domain: [0, 1, 2, 3, 4, 5, 6, 7, 8] } } },
      ]);
    });

    await t.test('legal actions domain shrinks after a move', async () => {
      const { gameId } = await createGame();
      await placePiece(gameId, 4);
      const res = await fetch(`${BASE}/api/games/${gameId}/actions`);
      const { actions } = await res.json();
      assert.deepEqual(actions[0].params.cell.domain, [0, 1, 2, 3, 5, 6, 7, 8]);
    });

    await t.test('legal actions is empty once the game is over', async () => {
      const { gameId } = await createGame();
      for (const cell of [0, 3, 1, 4, 2]) {
        await placePiece(gameId, cell);
      }
      const res = await fetch(`${BASE}/api/games/${gameId}/actions`);
      const { actions } = await res.json();
      assert.deepEqual(actions, []);
    });

    await t.test('GET /api/games/:id/actions 404s for an unknown game', async () => {
      const res = await fetch(`${BASE}/api/games/doesnotexist/actions`);
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { error: 'not-found' });
    });

    await t.test('POST preview computes the result without persisting it', async () => {
      const { gameId } = await createGame();
      const previewRes = await fetch(`${BASE}/api/games/${gameId}/actions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'placePiece', cell: 0 }),
      });
      assert.equal(previewRes.status, 200);
      const previewBody = await previewRes.json();
      assert.equal(previewBody.preview.board[0], 'X');
      assert.equal(previewBody.error, null);

      const stateRes = await fetch(`${BASE}/api/games/${gameId}`);
      const { state } = await stateRes.json();
      assert.equal(state.board[0], null, 'preview must not persist to the stored game');
    });

    await t.test('POST preview surfaces the same errors a real action would', async () => {
      const { gameId } = await createGame();
      const res = await fetch(`${BASE}/api/games/${gameId}/actions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'placePiece', cell: 99 }),
      });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), {
        gameId,
        preview: { board: Array(9).fill(null), currentPlayer: 'X', winner: null, status: 'in-progress' },
        error: 'invalid-cell',
      });
    });

    await t.test('POST preview 404s for an unknown game', async () => {
      const res = await fetch(`${BASE}/api/games/doesnotexist/actions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'placePiece', cell: 0 }),
      });
      assert.equal(res.status, 404);
    });
  } finally {
    child.kill();
  }
});
