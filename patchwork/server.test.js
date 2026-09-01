'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { PATCHES } = require('./patches');

const PORT = 35699; // distinct from tic-tac-toe's *.test.js ports (345xx/346xx)
const BASE = `http://localhost:${PORT}`;
// createGame() seeds each player with 5 starting buttons (engine.js) -
// queryLegalActions' selectPatch domain is filtered to what's actually
// affordable, so a fresh game doesn't offer every patch.
const AFFORDABLE_PATCH_IDS = PATCHES.filter((p) => p.cost <= 5).map((p) => p.id);

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

async function placePatch(gameId, { patchId, rotation = 0, row, col, playerId }) {
  const action = { type: 'placePatch', patchId, rotation, row, col };
  if (playerId) action.playerId = playerId;
  return fetch(`${BASE}/api/games/${gameId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
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

test('legal actions and preview endpoints', async (t) => {
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });

  try {
    await waitForServer();

    await t.test('GET /api/games/:id/actions lists every affordable patch as pickable on a fresh game, plus advanceTimeToken', async () => {
      const { gameId } = await createGame();
      const res = await fetch(`${BASE}/api/games/${gameId}/actions`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.actions, [
        { type: 'selectPatch', params: { patchId: { domain: AFFORDABLE_PATCH_IDS } } },
        { type: 'advanceTimeToken', params: {} },
      ]);
    });

    await t.test('the pickable-patch domain shrinks after a placement', async () => {
      const { gameId } = await createGame();
      await placePatch(gameId, { patchId: 'patch-01', row: 0, col: 0 });
      // Turn passes to player 1 (still behind on the time track after
      // player 0's move), so this now reports player 1's domain - their 5
      // buttons are untouched, so the only change from a fresh game is
      // patch-01 no longer available.
      const { actions } = await fetchActions(gameId);
      assert.equal(actions[0].params.patchId.domain.includes('patch-01'), false);
      assert.equal(actions[0].params.patchId.domain.length, AFFORDABLE_PATCH_IDS.length - 1);
    });

    await t.test('GET /actions with a patchId reports the placement-anchor domain for that patch', async () => {
      const { gameId } = await createGame();
      const { actions } = await fetchActions(gameId, { patchId: 'patch-01' });
      assert.equal(actions[0].type, 'placePatch');
      assert.equal(actions[0].params.patchId, 'patch-01');
      assert.equal(actions[0].params.rotation, 0, 'defaults to rotation 0');
      assert.ok(actions[0].params.anchor.domain.length > 0);
    });

    await t.test('GET /actions honors an explicit rotation parameter', async () => {
      const { gameId } = await createGame();
      const { actions } = await fetchActions(gameId, { patchId: 'patch-01', rotation: 1 });
      assert.equal(actions[0].params.rotation, 1);
    });

    await t.test('GET /actions with an already-placed patchId reports no placements', async () => {
      const { gameId } = await createGame();
      await placePatch(gameId, { patchId: 'patch-01', row: 0, col: 0 });
      const { actions } = await fetchActions(gameId, { patchId: 'patch-01' });
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
        body: JSON.stringify({ type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 }),
      });
      assert.equal(previewRes.status, 200);
      const previewBody = await previewRes.json();
      assert.equal(previewBody.preview.quiltBoards[0][0], 'patch-01');
      assert.equal(previewBody.error, null);

      const stateRes = await fetch(`${BASE}/api/games/${gameId}`);
      const { state } = await stateRes.json();
      assert.equal(state.quiltBoards[0][0], null, 'preview must not persist to the stored game');
    });

    await t.test('POST preview surfaces the same errors a real action would', async () => {
      const { gameId } = await createGame();
      const res = await fetch(`${BASE}/api/games/${gameId}/actions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 8, col: 0 }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'invalid-placement');
      assert.equal(body.preview.quiltBoards[0].every((c) => c === null), true, 'a rejected preview reports the unchanged state');
    });

    await t.test('POST preview 404s for an unknown game', async () => {
      const res = await fetch(`${BASE}/api/games/doesnotexist/actions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'placePatch', patchId: 'patch-01', rotation: 0, row: 0, col: 0 }),
      });
      assert.equal(res.status, 404);
    });

    await t.test('creating a multiplayer game starts in the lobby with two distinct invite tokens', async () => {
      const { mode, state, invites, lobby } = await createMultiplayerGame();
      assert.equal(mode, 'multiplayer');
      assert.equal(state.status, 'lobby');
      assert.equal(invites.length, 2);
      assert.notEqual(tokenFor(invites, 0), tokenFor(invites, 1));
      assert.deepEqual(lobby, { 0: { claimed: false }, 1: { claimed: false } });
    });

    await t.test('join responses include a live lobby summary, never the tokens', async () => {
      const { gameId, invites } = await createMultiplayerGame();
      const p1Token = tokenFor(invites, 0);

      const first = await join(gameId, p1Token);
      assert.deepEqual(first.lobby, { 0: { claimed: true }, 1: { claimed: false } });

      const second = await join(gameId, tokenFor(invites, 1));
      assert.deepEqual(second.lobby, { 0: { claimed: true }, 1: { claimed: true } });

      assert.equal(JSON.stringify(first).includes(p1Token), false, 'tokens must never be echoed back');
    });

    await t.test('joining with a slot\'s token claims it, auto-starting once both are filled', async () => {
      const { gameId, invites } = await createMultiplayerGame();

      const first = await join(gameId, tokenFor(invites, 0));
      assert.equal(first.slot, 0);
      assert.ok(first.playerId);
      assert.equal(first.state.status, 'lobby', 'still waiting on the second slot');

      const second = await join(gameId, tokenFor(invites, 1));
      assert.equal(second.slot, 1);
      assert.ok(second.playerId);
      assert.notEqual(second.playerId, first.playerId);
      assert.equal(second.state.status, 'in-progress', 'auto-starts once both slots are filled');
    });

    await t.test('re-joining with an already-claimed slot\'s token reconnects (same playerId)', async () => {
      const { gameId, invites } = await createMultiplayerGame();
      const p1Token = tokenFor(invites, 0);

      const first = await join(gameId, p1Token);
      const second = await join(gameId, p1Token);

      assert.equal(second.slot, 0);
      assert.equal(second.playerId, first.playerId, 'the same token always reconnects to the same identity');
    });

    await t.test('joining with an unknown or missing token is rejected', async () => {
      const { gameId } = await createMultiplayerGame();

      const unknown = await fetch(`${BASE}/api/games/${gameId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteToken: 'not-a-real-token' }),
      });
      assert.equal(unknown.status, 400);
      assert.deepEqual(await unknown.json(), { error: 'invalid-invite' });

      const missing = await fetch(`${BASE}/api/games/${gameId}/join`, { method: 'POST' });
      assert.equal(missing.status, 400);
      assert.deepEqual(await missing.json(), { error: 'invalid-invite' });
    });

    await t.test('joining a local game is rejected', async () => {
      const { gameId } = await createGame();
      const res = await fetch(`${BASE}/api/games/${gameId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteToken: 'irrelevant' }),
      });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: 'not-multiplayer' });
    });

    await t.test('GET /api/games/:id exposes a redacted lobby summary, never the tokens', async () => {
      const { gameId, invites } = await createMultiplayerGame();
      await join(gameId, tokenFor(invites, 0));

      const res = await fetch(`${BASE}/api/games/${gameId}`);
      const body = await res.json();
      assert.deepEqual(body.lobby, { 0: { claimed: true }, 1: { claimed: false } });
      assert.equal(JSON.stringify(body).includes(tokenFor(invites, 0)), false, 'tokens must never be echoed back');
    });

    await t.test('actions before the lobby is full are rejected', async () => {
      const { gameId, invites } = await createMultiplayerGame();
      const { playerId } = await join(gameId, tokenFor(invites, 0));
      const res = await placePatch(gameId, { patchId: 'patch-01', row: 0, col: 0, playerId });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, 'lobby-not-started');
    });

    await t.test('actions require a valid playerId once the game has started', async () => {
      const { gameId, invites } = await createMultiplayerGame();
      await join(gameId, tokenFor(invites, 0));
      await join(gameId, tokenFor(invites, 1));

      const missing = await placePatch(gameId, { patchId: 'patch-01', row: 0, col: 0 });
      assert.equal(missing.status, 400);
      assert.equal((await missing.json()).error, 'invalid-player');

      const bogus = await placePatch(gameId, { patchId: 'patch-01', row: 0, col: 0, playerId: 'not-a-real-player-id' });
      assert.equal(bogus.status, 400);
      assert.equal((await bogus.json()).error, 'invalid-player');
    });

    await t.test('actions enforce whose turn it is', async () => {
      const { gameId, invites } = await createMultiplayerGame();
      const p1 = await join(gameId, tokenFor(invites, 0)); // moves first
      const p2 = await join(gameId, tokenFor(invites, 1));

      const outOfTurn = await placePatch(gameId, { patchId: 'patch-01', row: 0, col: 0, playerId: p2.playerId });
      assert.equal(outOfTurn.status, 400);
      assert.equal((await outOfTurn.json()).error, 'not-your-turn');

      const onTurn = await placePatch(gameId, { patchId: 'patch-01', row: 0, col: 0, playerId: p1.playerId });
      assert.equal(onTurn.status, 200);
      const onTurnBody = await onTurn.json();
      assert.equal(onTurnBody.state.quiltBoards[0][0], 'patch-01');
      assert.equal(onTurnBody.state.currentPlayer, 1, 'turn passes to the other player');
    });

    await t.test('GET /actions is scoped to the requesting playerId', async () => {
      const { gameId, invites } = await createMultiplayerGame();
      const p1 = await join(gameId, tokenFor(invites, 0));
      const p2 = await join(gameId, tokenFor(invites, 1)); // now in-progress, player 0's turn

      const p1View = await fetchActions(gameId, { playerId: p1.playerId });
      assert.equal(p1View.actions.length, 2, "the player whose turn it is sees the real domain (selectPatch + advanceTimeToken)");

      const p2View = await fetchActions(gameId, { playerId: p2.playerId });
      assert.deepEqual(p2View.actions, [], "not this player's turn");

      const noPlayerView = await fetchActions(gameId);
      assert.deepEqual(noPlayerView.actions, [], 'no playerId at all is treated like a spectator');
    });
  } finally {
    child.kill();
  }
});
