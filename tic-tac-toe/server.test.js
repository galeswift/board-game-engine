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

async function createMultiplayerGame() {
  const res = await fetch(`${BASE}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'multiplayer' }),
  });
  return res.json();
}

async function join(gameId) {
  const res = await fetch(`${BASE}/api/games/${gameId}/join`, { method: 'POST' });
  return res.json();
}

async function placePiece(gameId, cell, playerId) {
  const action = { type: 'placePiece', cell };
  if (playerId) action.playerId = playerId;
  return fetch(`${BASE}/api/games/${gameId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
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

    await t.test('creating a multiplayer game starts in the lobby', async () => {
      const { mode, state } = await createMultiplayerGame();
      assert.equal(mode, 'multiplayer');
      assert.equal(state.status, 'lobby');
    });

    await t.test('joining claims slots in order and auto-starts once full', async () => {
      const { gameId } = await createMultiplayerGame();

      const first = await join(gameId);
      assert.equal(first.slot, 'X');
      assert.ok(first.playerId);
      assert.equal(first.state.status, 'lobby', 'still waiting on the second slot');

      const second = await join(gameId);
      assert.equal(second.slot, 'O');
      assert.ok(second.playerId);
      assert.notEqual(second.playerId, first.playerId);
      assert.equal(second.state.status, 'in-progress', 'auto-starts once both slots are filled');
    });

    await t.test('joining a full lobby is rejected', async () => {
      const { gameId } = await createMultiplayerGame();
      await join(gameId);
      await join(gameId);
      const res = await fetch(`${BASE}/api/games/${gameId}/join`, { method: 'POST' });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: 'lobby-full' });
    });

    await t.test('joining a local game is rejected', async () => {
      const { gameId } = await createGame();
      const res = await fetch(`${BASE}/api/games/${gameId}/join`, { method: 'POST' });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: 'not-multiplayer' });
    });

    await t.test('actions before the lobby is full are rejected', async () => {
      const { gameId } = await createMultiplayerGame();
      const { playerId } = await join(gameId);
      const res = await placePiece(gameId, 0, playerId);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, 'lobby-not-started');
    });

    await t.test('actions require a valid playerId once the game has started', async () => {
      const { gameId } = await createMultiplayerGame();
      await join(gameId);
      await join(gameId);

      const missing = await placePiece(gameId, 0);
      assert.equal(missing.status, 400);
      assert.equal((await missing.json()).error, 'invalid-player');

      const bogus = await placePiece(gameId, 0, 'not-a-real-player-id');
      assert.equal(bogus.status, 400);
      assert.equal((await bogus.json()).error, 'invalid-player');
    });

    await t.test('actions enforce whose turn it is', async () => {
      const { gameId } = await createMultiplayerGame();
      const x = await join(gameId); // slot X, moves first
      const o = await join(gameId); // slot O

      const outOfTurn = await placePiece(gameId, 0, o.playerId);
      assert.equal(outOfTurn.status, 400);
      assert.equal((await outOfTurn.json()).error, 'not-your-turn');

      const onTurn = await placePiece(gameId, 0, x.playerId);
      assert.equal(onTurn.status, 200);
      assert.equal((await onTurn.json()).state.board[0], 'X');
    });

    await t.test('GET /actions is scoped to the requesting playerId', async () => {
      const { gameId } = await createMultiplayerGame();
      const x = await join(gameId);
      const o = await join(gameId); // game is now in-progress, X's turn

      const xView = await fetch(`${BASE}/api/games/${gameId}/actions?playerId=${x.playerId}`);
      assert.equal((await xView.json()).actions.length, 1, "the player whose turn it is sees the real domain");

      const oView = await fetch(`${BASE}/api/games/${gameId}/actions?playerId=${o.playerId}`);
      assert.deepEqual((await oView.json()).actions, [], "not this player's turn");

      const noPlayerView = await fetch(`${BASE}/api/games/${gameId}/actions`);
      assert.deepEqual((await noPlayerView.json()).actions, [], 'no playerId at all is treated like a spectator');
    });
  } finally {
    child.kill();
  }
});
