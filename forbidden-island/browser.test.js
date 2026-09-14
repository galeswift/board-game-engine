'use strict';

// End-to-end browser coverage of the React client: server.test.js covers
// the HTTP API directly, this covers the client actually rendering the
// board and driving a turn through real button clicks - same rationale
// and pattern as patchwork/browser.test.js. Uses raw `playwright` (a
// devDependency only) from node:test rather than a second test
// framework.
//
// Requires web/dist to already be built (`npm run build`) since
// server.js serves that directory as static files.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const PORT = 35951; // distinct from server.test.js's port in this same folder
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

async function waitFor(fn, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() > deadline) throw new Error('waitFor: condition never became true');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// The server keeps exactly one in-memory game for its whole process
// lifetime (no per-test isolation) - every subtest below shares the one
// spawned server, so each has to reset to a fresh lobby itself rather
// than assuming the previous subtest left it there.
async function resetGame() {
  await fetch(`${BASE}/api/new-game`, { method: 'POST' });
}

test('browser end-to-end', async (t) => {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  const browser = await chromium.launch();

  try {
    await waitForServer();

    await t.test('starting a game deals and renders the real 24-tile board', async () => {
      await resetGame();
      const page = await browser.newPage();
      await page.goto(BASE);
      await page.locator('button:has-text("Start Game")').click();
      await page.locator('.board').waitFor();
      assert.equal(await page.locator('.tile').count(), 24);
      assert.equal(await page.locator('.phase').textContent(), 'Playing');
      await page.close();
    });

    await t.test('legality drives the UI, not client-side state: only the current step\'s button is offered', async () => {
      await resetGame();
      const page = await browser.newPage();
      await page.goto(BASE);
      await page.locator('button:has-text("Start Game")').click();
      await page.locator('.board').waitFor();

      // Right after starting, only "Take Action" should be offered -
      // drawTreasureCards/drawFloodCards aren't legal yet.
      assert.equal(await page.locator('button:has-text("Draw Treasure Cards")').count(), 0);
      assert.equal(await page.locator('button:has-text("Draw Flood Cards")').count(), 0);
      await waitFor(async () => (await page.locator('button:has-text("Take Action")').count()) === 1);

      await page.close();
    });

    await t.test('a full turn - 3 actions, treasure cards, flood cards - passes the turn or ends the game', async () => {
      await resetGame();
      const page = await browser.newPage();
      await page.goto(BASE);
      await page.locator('button:has-text("Start Game")').click();
      await page.locator('.board').waitFor();

      // Waits for each click's response to actually land (the button's
      // own "(N left)" count updating) before firing the next one -
      // rapid-fire clicks without this can race their POSTs' responses,
      // leaving the UI showing a stale state (see the test that found
      // this).
      for (let remaining = 3; remaining >= 1; remaining--) {
        const button = page.locator('button', { hasText: `Take Action (${remaining} left)` });
        await button.waitFor();
        await button.click();
      }
      await waitFor(async () => (await page.locator('button:has-text("Draw Treasure Cards")').count()) === 1);
      await page.locator('button:has-text("Draw Treasure Cards")').click();

      await waitFor(async () => (await page.locator('button:has-text("Draw Flood Cards")').count()) === 1);
      await page.locator('button:has-text("Draw Flood Cards")').click();

      // Wait for *this* click's own response to land - checking .phase
      // alone isn't enough, since it already reads 'Playing' before the
      // flood-draw click is even processed (the game hasn't left
      // mainLoop yet either way). Once "Draw Flood Cards" itself is no
      // longer offered, the click's result - survive (back to
      // "actions") or collapse (phase changes) - has been applied.
      await waitFor(async () => (await page.locator('button:has-text("Draw Flood Cards")').count()) === 0);

      // The game either continues to player 1's turn or ends (a rare
      // island collapse) - both are legitimate outcomes of the same
      // fabricated RNG, so assert on whichever actually happened rather
      // than assuming survival.
      const phase = await page.locator('.phase').textContent();
      if (phase === 'Playing') {
        assert.ok(
          (await page.locator('dd', { hasText: /^Player 1/ }).count()) > 0,
          'turn passed to player 1',
        );
      } else {
        assert.equal(phase, 'Defeat. The island claimed the team.');
      }

      await page.close();
    });

    await t.test('New Game resets to a fresh lobby, board included', async () => {
      await resetGame();
      const page = await browser.newPage();
      await page.goto(BASE);
      // Start a real game first, so this test actually exercises New
      // Game undoing something, rather than finding an already-fresh
      // lobby by coincidence.
      await page.locator('button:has-text("Start Game")').click();
      await page.locator('.board').waitFor();

      await page.locator('button:has-text("New Game")').click();
      await waitFor(async () => (await page.locator('.phase').textContent()) === 'Lobby');
      assert.equal(await page.locator('.board').count(), 0);
      assert.equal(await page.locator('button:has-text("Start Game")').count(), 1);
      await page.close();
    });
  } finally {
    await browser.close();
    server.kill();
  }
});
