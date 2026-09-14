'use strict';

// API-level integration tests, same pattern as patchwork/server.test.js
// and tic-tac-toe/server.test.js: spawn the real server as a child
// process and hit its real HTTP endpoints, rather than importing
// server.js's internals directly. No database here (unlike those two) -
// forbidden-island keeps one in-memory game for its whole process
// lifetime, so /api/new-game is what a test resets between scenarios.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 35950; // distinct from browser.test.js's port in this same folder
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

async function getState() {
  const res = await fetch(`${BASE}/api/state`);
  return { status: res.status, body: await res.json() };
}

async function postAction(type) {
  const res = await fetch(`${BASE}/api/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
  });
  return { status: res.status, body: await res.json() };
}

async function postNewGame() {
  const res = await fetch(`${BASE}/api/new-game`, { method: 'POST' });
  return { status: res.status, body: await res.json() };
}

test('forbidden-island server API', async (t) => {
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });

  try {
    await waitForServer();

    await t.test('GET / serves the built frontend', async () => {
      const res = await fetch(`${BASE}/`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('Forbidden Island'), 'served page should include the app title');
    });

    await t.test('an unknown route 404s rather than crashing the server', async () => {
      const res = await fetch(`${BASE}/no-such-route`);
      assert.equal(res.status, 404);
    });

    await t.test('GET /api/state starts a fresh game in the lobby, with startGame as the only legal action', async () => {
      const { status, body } = await getState();
      assert.equal(status, 200);
      assert.equal(body.state.phase.current, 'lobby');
      assert.deepEqual(body.actions, [{ type: 'startGame', params: {} }]);
    });

    await t.test('POST /api/actions with an action illegal in the current phase is rejected, and never mutates state', async () => {
      const before = await getState();
      const { status, body } = await postAction('drawFloodCards');
      assert.equal(status, 400);
      assert.equal(body.error, 'illegal-action');
      const after = await getState();
      assert.deepEqual(after.body.state, before.body.state);
    });

    await t.test('POST /api/actions with an unknown action type is rejected', async () => {
      const { status, body } = await postAction('notARealAction');
      assert.equal(status, 400);
      assert.equal(body.error, 'illegal-action');
    });

    await t.test('POST /api/actions with malformed JSON is rejected without crashing the server', async () => {
      const res = await fetch(`${BASE}/api/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, 'invalid-json');
      await waitForServer(); // the server must still be up for later tests
    });

    await t.test('POST /api/actions with startGame deals a 24-tile island and enters mainLoop', async () => {
      const { status, body } = await postAction('startGame');
      assert.equal(status, 200);
      assert.equal(body.state.phase.current, 'mainLoop');
      assert.equal(Object.keys(body.state.shared.islandTiles).length, 24);
      assert.deepEqual(body.actions, [{ type: 'takeAction', params: {} }]);
    });

    await t.test('a full turn is reachable through the real API: 3 actions, treasure cards, flood cards', async () => {
      for (let i = 0; i < 3; i++) {
        const { status, body } = await postAction('takeAction');
        assert.equal(status, 200);
        assert.equal(body.state.shared.actionsRemaining, 3 - (i + 1));
      }
      const { status: treasureStatus, body: treasureBody } = await postAction('drawTreasureCards');
      assert.equal(treasureStatus, 200);
      assert.equal(treasureBody.state.shared.turnStep, 'flood');

      const { status: floodStatus, body: floodBody } = await postAction('drawFloodCards');
      assert.equal(floodStatus, 200);
      // Either survives to the next player's turn or the island
      // collapses - both are legitimate RNG outcomes; either way the
      // request must succeed and report a coherent resulting state.
      if (floodBody.state.phase.current === 'mainLoop') {
        assert.equal(floodBody.state.turnOrder.current, '1');
      } else {
        assert.equal(floodBody.state.phase.current, 'defeat');
      }
    });

    await t.test('POST /api/new-game replaces the in-memory game with a fresh one, regardless of prior state', async () => {
      const { status, body } = await postNewGame();
      assert.equal(status, 200);
      assert.equal(body.state.phase.current, 'lobby');
      assert.deepEqual(body.actions, [{ type: 'startGame', params: {} }]);

      const after = await getState();
      assert.deepEqual(after.body, body, 'GET /api/state agrees with what POST /api/new-game just returned');
    });
  } finally {
    child.kill();
  }
});
