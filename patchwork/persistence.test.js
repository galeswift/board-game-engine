'use strict';

// This is the actual regression Phase 4 (in tic-tac-toe) exists to fix:
// game state must survive the server process restarting, not just live
// in the in-memory Map the earlier phases used. Kept as its own file
// (rather than folded into server.test.js) because it needs to kill and
// respawn the server mid-test, unlike every other test here which keeps
// one server alive for the whole file.
//
// Requires a reachable Postgres (see docker-compose.yml / README) - the
// server now fails fast on startup if it can't reach the database, so
// this test (and every other one in the suite) needs that DB up first.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 35905; // distinct from every other *.test.js port in this folder
const BASE = `http://localhost:${PORT}`;

function spawnServer() {
  return spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
}

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

function waitForExit(child) {
  return new Promise((resolve) => child.once('exit', resolve));
}

// A test failure should never mean "rerun and hope" - a random
// shuffle can, rarely, offer 3 opening patches that are all
// unaffordable at the starting 5 buttons; retry with a fresh game
// instead of asserting and hoping (see
// project_patchwork_multiplayer_flake.md for how this was diagnosed).
async function createAffordableGame() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const createRes = await fetch(`${BASE}/api/games`, { method: 'POST' });
    const { gameId } = await createRes.json();
    const { actions } = await (await fetch(`${BASE}/api/games/${gameId}/actions`)).json();
    const domain = actions[0]?.params?.patchId?.domain || [];
    if (domain.length > 0) return { gameId, domain };
  }
  throw new Error('createAffordableGame: no affordable opening offer after 10 attempts');
}

test('game state survives a server restart', async () => {
  let child = spawnServer();
  try {
    await waitForServer();

    // Which patch to buy isn't hardcoded - the patch circle is shuffled
    // per game (gameDefinition.js/patchCircle.js), so ask the server
    // which of the 3 currently offered patches is actually pickable,
    // then where it's legal to place, rather than assuming a fixed
    // id/anchor.
    const { gameId, domain } = await createAffordableGame();
    const patchId = domain[0];
    const { actions: placeActions } = await (await fetch(`${BASE}/api/games/${gameId}/actions?patchId=${patchId}&rotation=0`)).json();
    const [row, col] = placeActions[0].params.anchor.domain[0];

    await fetch(`${BASE}/api/games/${gameId}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'placePatch', params: { patchId, rotation: 0, row, col } }),
    });

    child.kill();
    await waitForExit(child);

    child = spawnServer();
    await waitForServer();

    const res = await fetch(`${BASE}/api/games/${gameId}`);
    assert.equal(res.status, 200, 'the game is still there after the process restarted');
    const { state } = await res.json();
    assert.equal(state.players['0'].quiltBoard.includes(patchId), true, 'the move made before the restart is still there');
  } finally {
    child.kill();
  }
});
