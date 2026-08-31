'use strict';

// End-to-end browser coverage - everything else in this suite tests the
// HTTP/WS API directly, but client.js's rendering, the invite panel,
// and the live-update-without-reload behavior have no automated
// coverage otherwise. Uses raw `playwright` (a devDependency only - it
// never touches the Dockerfile/production image) driven from node:test,
// rather than pulling in a second test framework (@playwright/test) on
// top of the one this project already uses everywhere else.
//
// Requires a reachable Postgres, same as every other *.test.js file
// here (see README.md).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const PORT = 34906; // distinct from every other *.test.js port in this folder
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

function cellText(page, index) {
  return page.locator('.cell').nth(index).textContent();
}

function myRoleText(page) {
  return page.locator('#myRole').textContent();
}

// client.js auto-creates a local game on any page load with no ?game=
// in the URL (see the bottom of client.js). That means a bare
// page.goto(BASE) already has `.cell` elements on the page before a
// "New Multiplayer Game" click even starts - waiting for `.cell` to
// exist is not a valid signal that the *new* game finished loading.
// Waiting for the expected role text is a real signal instead.
async function waitForRole(page, expected) {
  await waitFor(async () => (await myRoleText(page)) === expected);
}

test('browser end-to-end', async (t) => {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  const browser = await chromium.launch();

  try {
    await waitForServer();

    await t.test('local game: create and play a move', async () => {
      const page = await browser.newPage();
      await page.goto(BASE); // already auto-creates a local game on load
      await page.locator('#newLocalGameBtn').click(); // explicitly start a fresh one anyway
      await waitFor(async () => (await page.locator('#status').textContent()) === "X's turn");

      await page.locator('.cell').nth(4).click();
      await waitFor(async () => (await cellText(page, 4)) === 'X');
      assert.equal(await page.locator('#status').textContent(), "O's turn");

      await page.close();
    });

    await t.test('multiplayer: role, live updates, and lobby status across two browsers', async () => {
      const hostCtx = await browser.newContext();
      const hostPage = await hostCtx.newPage();
      await hostPage.goto(BASE);
      await hostPage.locator('#newMultiplayerGameBtn').click();
      await waitForRole(hostPage, 'You are X');

      const inviteLink = await hostPage.locator('#inviteLinkInput').inputValue();
      assert.match(inviteLink, /invite=/);

      // Board is unclickable while waiting - queryLegalActions returns
      // [] during 'lobby', same as it does once the game is over.
      assert.equal(await page_isBoardFullyDisabled(hostPage), true);

      const guestCtx = await browser.newContext();
      const guestPage = await guestCtx.newPage();
      await guestPage.goto(inviteLink);
      await waitForRole(guestPage, 'You are O');

      // Once both have joined, the host's invite panel (for inviting
      // someone else into O's now-taken seat) should disappear.
      await waitFor(async () => await hostPage.locator('#invitePanel').isHidden());

      // Host (X) moves; guest's page must update live, with no reload.
      await hostPage.locator('.cell').nth(0).click();
      await waitFor(async () => (await cellText(guestPage, 0)) === 'X');
      assert.equal(await guestPage.locator('#status').textContent(), "O's turn");

      // Regression check: the player-list row for *your own* slot must
      // say "your turn" when it's your turn, not "their turn" - a real
      // bug found in review (the label was hardcoded to "their turn"
      // regardless of whose row it was on).
      const guestRows = await guestPage.locator('#playerList li').allTextContents();
      assert.match(guestRows.find((r) => r.startsWith('O')), /your turn/);
      assert.doesNotMatch(guestRows.find((r) => r.startsWith('X')), /turn/);

      const hostRows = await hostPage.locator('#playerList li').allTextContents();
      assert.doesNotMatch(hostRows.find((r) => r.startsWith('X')), /turn/, "not X's turn anymore");
      assert.match(hostRows.find((r) => r.startsWith('O')), /their turn/, "from X's perspective, O's row says their turn");

      await hostCtx.close();
      await guestCtx.close();
    });

    await t.test('multiplayer: reconnecting via the same invite link restores the seat', async () => {
      const ctx1 = await browser.newContext();
      const page1 = await ctx1.newPage();
      await page1.goto(BASE);
      await page1.locator('#newMultiplayerGameBtn').click();
      await waitForRole(page1, 'You are X');
      const hostUrl = page1.url(); // carries the host's own ?invite= token
      const opponentInvite = await page1.locator('#inviteLinkInput').inputValue();

      // A solo host can't move yet - the game stays in 'lobby' until
      // both slots are filled, so a second player has to join first.
      const opponentCtx = await browser.newContext();
      const opponentPage = await opponentCtx.newPage();
      await opponentPage.goto(opponentInvite);
      await waitForRole(opponentPage, 'You are O');

      await page1.locator('.cell').nth(0).click();
      await waitFor(async () => (await cellText(page1, 0)) === 'X');

      await ctx1.close(); // simulates closing the tab
      await opponentCtx.close();

      const ctx2 = await browser.newContext();
      const page2 = await ctx2.newPage();
      await page2.goto(hostUrl); // reopening the bookmarked link
      await waitForRole(page2, 'You are X');

      assert.equal(await cellText(page2, 0), 'X', 'the earlier move is still there');

      await ctx2.close();
    });
  } finally {
    await browser.close();
    server.kill();
  }
});

async function page_isBoardFullyDisabled(page) {
  const states = await page.locator('.cell').evaluateAll((cells) => cells.map((c) => c.disabled));
  return states.every(Boolean);
}
