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

// Whether a just-dealt circle's opening 3-patch offer contains anything
// affordable at the starting 5 buttons. A random shuffle can, rarely,
// offer 3 patches that all cost more than that - see
// hasAffordableOffer's callers below for how this is turned into a
// real fix (retry with a fresh shuffle) rather than a flaky test.
async function hasAffordableOffer(gameId, opts = {}) {
  const { actions } = await fetchActions(gameId, opts);
  const domain = actions[0]?.params?.patchId?.domain || [];
  return domain.length > 0;
}

// A test failure should never mean "rerun and hope" - retries here
// with a bounded attempt count instead, discarding any game whose
// opening offer happens to be entirely unaffordable and dealing a
// fresh one. 10 attempts against real patch-cost data (most of the 33
// patches cost <= 5) makes exhausting this astronomically unlikely
// without ever making the *game's* own shuffle deterministic (which
// would just move the non-determinism problem, not remove it).
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
// the resulting in-progress game's opening offer is affordable (see
// createGame's comment) - for tests that need to immediately act on a
// real placement right after both players are seated.
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

async function placePatch(gameId, { patchId, rotation = 0, row, col, playerId }) {
  const action = { type: 'placePatch', params: { patchId, rotation, row, col } };
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

// Which patch is buyable isn't fixed anymore (the patch circle is
// shuffled per game - engine.js/patchCircle.js), so tests that need to
// actually buy one ask the server which of the 3 currently offered
// patches is pickable, then where it's legal to place, rather than
// assuming a fixed id/anchor like the old flat-pool 'patch-01' did.
async function firstPickablePlacement(gameId, opts = {}) {
  const { actions } = await fetchActions(gameId, opts);
  const domain = actions[0].params.patchId.domain;
  // Every caller reaches this via createGame()/createReadyMultiplayerGame()
  // (both retry until the opening offer is affordable - see their
  // comments and project_patchwork_multiplayer_flake.md), so an empty
  // domain here means one of those guarantees broke, not "rare bad
  // luck, rerun" - fail loudly rather than falling through to a
  // confusing "cannot read domain of undefined" a few calls downstream.
  assert.ok(domain.length > 0, 'no affordable patch offered - the calling helper should have guaranteed this, so this points at a real bug');
  const patchId = domain[0];
  const { actions: placeActions } = await fetchActions(gameId, { ...opts, patchId, rotation: 0 });
  const [row, col] = placeActions[0].params.anchor.domain[0];
  return { patchId, row, col };
}

test('legal actions and preview endpoints', async (t) => {
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });

  try {
    await waitForServer();

    await t.test('GET /api/games/:id/actions lists the currently-offered, affordable patches, plus advanceTimeToken', async () => {
      const { gameId } = await createGame();
      const res = await fetch(`${BASE}/api/games/${gameId}/actions`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.actions[0].type, 'selectPatch');
      const domain = body.actions[0].params.patchId.domain;
      // Never more than the 3 the circle actually offers right now
      // (engine.js/patchCircle.js) - could be fewer if some aren't
      // affordable with the starting 5 buttons.
      assert.ok(domain.length <= 3);
      assert.ok(domain.every((id) => AFFORDABLE_PATCH_IDS.includes(id)));
      assert.deepEqual(body.actions[1], { type: 'advanceTimeToken', params: {} });
    });

    await t.test('the pickable-patch domain excludes a patch once it has been bought', async () => {
      const { gameId } = await createGame();
      const { patchId, row, col } = await firstPickablePlacement(gameId);
      await placePatch(gameId, { patchId, row, col });
      // Turn passes to player 1 (still behind on the time track after
      // player 0's move) - whoever's turn it is now, the bought patch
      // is gone from the circle entirely, so never offered to anyone.
      const { actions } = await fetchActions(gameId);
      assert.equal(actions[0].params.patchId.domain.includes(patchId), false);
    });

    await t.test('GET /actions with a patchId reports the placement-anchor domain for that patch', async () => {
      const { gameId } = await createGame();
      const { actions: initial } = await fetchActions(gameId);
      const patchId = initial[0].params.patchId.domain[0];
      const { actions } = await fetchActions(gameId, { patchId });
      assert.equal(actions[0].type, 'placePatch');
      assert.equal(actions[0].params.patchId, patchId);
      assert.equal(actions[0].params.rotation, 0, 'defaults to rotation 0');
      assert.ok(actions[0].params.anchor.domain.length > 0);
    });

    await t.test('GET /actions honors an explicit rotation parameter', async () => {
      const { gameId } = await createGame();
      const { actions: initial } = await fetchActions(gameId);
      const patchId = initial[0].params.patchId.domain[0];
      const { actions } = await fetchActions(gameId, { patchId, rotation: 1 });
      assert.equal(actions[0].params.rotation, 1);
    });

    await t.test('GET /actions with an already-placed patchId reports no placements', async () => {
      const { gameId } = await createGame();
      const { patchId, row, col } = await firstPickablePlacement(gameId);
      await placePatch(gameId, { patchId, row, col });
      const { actions } = await fetchActions(gameId, { patchId });
      assert.deepEqual(actions, []);
    });

    await t.test('GET /api/games/:id/actions 404s for an unknown game', async () => {
      const res = await fetch(`${BASE}/api/games/doesnotexist/actions`);
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { error: 'not-found' });
    });

    await t.test('POST preview computes the result without persisting it', async () => {
      const { gameId } = await createGame();
      const { patchId, row, col } = await firstPickablePlacement(gameId);
      const previewRes = await fetch(`${BASE}/api/games/${gameId}/actions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'placePatch', params: { patchId, rotation: 0, row, col } }),
      });
      assert.equal(previewRes.status, 200);
      const previewBody = await previewRes.json();
      assert.equal(previewBody.preview.players['0'].quiltBoard.includes(patchId), true);
      assert.equal(previewBody.error, null);

      const stateRes = await fetch(`${BASE}/api/games/${gameId}`);
      const { state } = await stateRes.json();
      assert.equal(state.players['0'].quiltBoard.includes(patchId), false, 'preview must not persist to the stored game');
    });

    await t.test('POST preview surfaces the same errors a real action would', async () => {
      const { gameId } = await createGame();
      const { actions } = await fetchActions(gameId);
      const patchId = actions[0].params.patchId.domain[0];
      const res = await fetch(`${BASE}/api/games/${gameId}/actions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // row: 8 is off the board regardless of which patch this is -
        // forces invalid-placement, not invalid-patch.
        body: JSON.stringify({ type: 'placePatch', params: { patchId, rotation: 0, row: 8, col: 0 } }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'invalid-placement');
      assert.equal(body.preview.players['0'].quiltBoard.every((c) => c === null), true, 'a rejected preview reports the unchanged state');
    });

    await t.test('POST preview 404s for an unknown game', async () => {
      const res = await fetch(`${BASE}/api/games/doesnotexist/actions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'placePatch', params: { patchId: 'patch-01', rotation: 0, row: 0, col: 0 } }),
      });
      assert.equal(res.status, 404);
    });

    await t.test('creating a multiplayer game starts in the lobby with two distinct invite tokens', async () => {
      const { mode, state, invites, lobby } = await createMultiplayerGame();
      assert.equal(mode, 'multiplayer');
      assert.equal(state.phase.current, 'lobby');
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
      assert.equal(first.state.phase.current, 'lobby', 'still waiting on the second slot');

      const second = await join(gameId, tokenFor(invites, 1));
      assert.equal(second.slot, 1);
      assert.ok(second.playerId);
      assert.notEqual(second.playerId, first.playerId);
      assert.equal(second.state.phase.current, 'play', 'auto-starts once both slots are filled');
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
      assert.equal((await res.json()).error, 'illegal-action');
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
      const { gameId, p1, p2 } = await createReadyMultiplayerGame(); // p1 moves first

      // 'not-your-turn' is checked before the action's own patchId is
      // even looked at, so a placeholder id is fine here.
      const outOfTurn = await placePatch(gameId, { patchId: 'patch-01', row: 0, col: 0, playerId: p2.playerId });
      assert.equal(outOfTurn.status, 400);
      assert.equal((await outOfTurn.json()).error, 'not-your-turn');

      const { patchId, row, col } = await firstPickablePlacement(gameId, { playerId: p1.playerId });
      const onTurn = await placePatch(gameId, { patchId, row, col, playerId: p1.playerId });
      assert.equal(onTurn.status, 200);
      const onTurnBody = await onTurn.json();
      assert.equal(onTurnBody.state.players['0'].quiltBoard.includes(patchId), true);
      assert.equal(onTurnBody.state.turnOrder.current, '1', 'turn passes to the other player');
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
