'use strict';

// End-to-end browser coverage of the pick-a-patch/rotate/place MVP
// flow: everything else in this suite tests the HTTP/WS API directly,
// but the React client's rendering, patch picker, rotate control, and
// live-update-without-reload behavior have no automated coverage
// otherwise. Uses raw `playwright` (a devDependency only - it never
// touches the Dockerfile/production image) driven from node:test,
// rather than pulling in a second test framework (@playwright/test).
//
// Requires `web/dist` to already be built (`npm run build`) since
// server.js serves that directory as static files, same as every other
// *.test.js file here also needs a reachable Postgres (see README.md).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const PORT = 35906; // distinct from every other *.test.js port in this folder
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

function myRoleText(page) {
  return page.locator('#myRole').textContent();
}

async function waitForRole(page, expected) {
  await waitFor(async () => (await myRoleText(page)) === expected);
}

async function pickFirstAvailablePatch(page) {
  const tile = page.locator('.patch-tile:not(:disabled)').first();
  const patchId = await tile.getAttribute('data-patch-id');
  await tile.click();
  return patchId;
}

// Highlighting is hover-driven (App.jsx's updateHighlights, fired from
// QuiltBoard's onMouseEnter) - it no longer appears just from selecting
// a patch, so placing one now means hovering a board cell first. The
// board center is empty on a fresh game, so it's a safe hover target
// for (almost) any patch shape/rotation.
async function hoverBoardCenter(page, slot = 'X') {
  const cell = page.locator(`#quiltBoard-${slot} .quilt-cell`).nth(4 * 9 + 4); // row 4, col 4
  await cell.hover();
  return cell;
}

test('browser end-to-end', async (t) => {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  const browser = await chromium.launch();

  try {
    await waitForServer();

    await t.test('local game: select a patch, rotate it, place it, turn passes', async () => {
      const page = await browser.newPage();
      await page.goto(BASE);
      await page.locator('#newLocalGameBtn').click();
      await waitFor(async () => (await page.locator('#status').textContent()) === 'Player X turn — pick a patch below');

      const patchId = await pickFirstAvailablePatch(page);
      await waitFor(async () => (await page.locator('#rotateBtn').textContent()) === 'Rotate (0°)');
      await page.locator('#rotateBtn').click();
      await waitFor(async () => (await page.locator('#rotateBtn').textContent()) === 'Rotate (90°)');

      // Hovering the board previews the placement (a highlighted
      // footprint); clicking that same cell places it.
      const cell = await hoverBoardCenter(page);
      await page.locator('#quiltBoard-X .quilt-cell.highlight').first().waitFor();
      await cell.click();

      await waitFor(async () => (await page.locator(`.patch-tile[data-patch-id="${patchId}"]`).isDisabled()));
      await waitFor(async () => (await page.locator('#quiltBoard-X .quilt-cell.filled').count()) > 0);
      // X just moved and is still ahead of O (who hasn't moved at all
      // yet), so O - still further behind on the time track - goes next.
      assert.equal(await page.locator('#status').textContent(), 'Player O turn — pick a patch below', "turn passes to whoever is behind on the time track");

      await page.close();
    });

    await t.test('local game: hovering the non-active board does not preview or place on the active one', async () => {
      const page = await browser.newPage();
      await page.goto(BASE);
      await page.locator('#newLocalGameBtn').click();
      await waitFor(async () => (await page.locator('#status').textContent()) === 'Player X turn — pick a patch below');

      const patchId = await pickFirstAvailablePatch(page); // X's turn - X's board is active, O's is not
      const oCell = page.locator('#quiltBoard-O .quilt-cell').nth(4 * 9 + 4);
      await oCell.hover();

      // No highlight anywhere - not on the hovered (inactive) board, and
      // not leaked onto the active board either.
      assert.equal(await page.locator('.quilt-cell.highlight').count(), 0);

      await oCell.click();
      // Nothing placed anywhere, and the selection is untouched (still
      // mid-placement on the same patch) - a proxy for "no
      // state-changing POST happened".
      assert.equal(await page.locator('.quilt-cell.filled').count(), 0);
      assert.equal(await page.locator('#status').textContent(), `Choose where to place ${patchId} on your board`);

      await page.close();
    });

    await t.test('multiplayer: a placement flips the turn and live-updates the guest with no reload', async () => {
      const hostCtx = await browser.newContext();
      const hostPage = await hostCtx.newPage();
      await hostPage.goto(BASE);
      await hostPage.locator('#newMultiplayerGameBtn').click();
      await waitForRole(hostPage, 'You are X');

      const inviteLink = await hostPage.locator('#inviteLinkInput').inputValue();

      const guestCtx = await browser.newContext();
      const guestPage = await guestCtx.newPage();
      await guestPage.goto(inviteLink);
      await waitForRole(guestPage, 'You are O');

      await waitFor(async () => (await hostPage.locator('#status').textContent()) === 'Player X turn — pick a patch below');
      assert.equal(await guestPage.locator('#status').textContent(), 'Waiting for the other player…');

      const patchId = await pickFirstAvailablePatch(hostPage);
      const cell = await hoverBoardCenter(hostPage);
      await hostPage.locator('#quiltBoard-X .quilt-cell.highlight').first().waitFor();
      await cell.click();

      // Guest's view updates live: it's now their turn (still behind on
      // the time track), and the placed patch is greyed out on their
      // picker too (shared pool).
      await waitFor(async () => (await guestPage.locator('#status').textContent()) === 'Player O turn — pick a patch below');
      await waitFor(async () => await guestPage.locator(`.patch-tile[data-patch-id="${patchId}"]`).isDisabled());
      await waitFor(async () => (await hostPage.locator('#status').textContent()) === 'Waiting for the other player…');

      // And the host's own placement is visible on the *opponent's*
      // board from the guest's point of view.
      await waitFor(async () => (await guestPage.locator("#quiltBoard-X .quilt-cell.filled").count()) > 0);

      await hostCtx.close();
      await guestCtx.close();
    });
  } finally {
    await browser.close();
    server.kill();
  }
});
