'use strict';

// One real dependency now: `ws`, for the live push channel (see
// docs/architecture.md's "Client Authority: Zero" section and
// CLAUDE.md's dependency note). Everything else stays on Node's
// built-in `http` module, per this project's usual pattern.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { createGame, applyAction, queryLegalActions, startGame } = require('./engine');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SLOTS = ['X', 'O'];

// In-memory store. Fine for a first pass; games (and their connected
// sockets) are lost on redeploy/restart. Each entry is:
//   { state, mode, lobby, sockets }
// `state` is the pure engine state. `mode` is 'local' | 'multiplayer'.
// `lobby` (multiplayer only) is { X: { playerId }, O: { playerId } } -
// this is server-owned identity bookkeeping, not engine state; engine.js
// stays identity-free. `sockets` is a runtime-only Set of live
// WebSocket connections - never persisted, never part of engine state.
const games = new Map();

// A slot's playerId, or null if the game is local / the id matches
// nothing. Multiplayer identity lives entirely in `lobby`, not in
// engine state, so this lookup is the one place that maps an incoming
// playerId to "whose move is this."
function slotForPlayerId(lobby, playerId) {
  if (!lobby || !playerId) return null;
  return SLOTS.find((slot) => lobby[slot].playerId === playerId) || null;
}

// The legal-actions list a specific caller is allowed to see. Local
// games have no identity concept, so everyone sees the real domain
// (unchanged pass-and-play behavior). Multiplayer games only reveal the
// real domain to whichever slot's turn it actually is - anyone else
// (wrong player, unrecognized playerId, a spectator) gets an empty
// list, same principle GET /actions and the WS state push both apply.
function scopedActions(record, playerId) {
  const actions = queryLegalActions(record.state);
  if (record.mode !== 'multiplayer') return actions;
  const slot = slotForPlayerId(record.lobby, playerId);
  return slot && slot === record.state.currentPlayer ? actions : [];
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
};

function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Pushes the current state to every live socket for a game, each scoped
// to whatever that socket authenticated as (see the WS section below) -
// the same per-caller scoping GET /actions applies. Only called after a
// real state change (a successful action, or the lobby filling up) - a
// rejected action has nothing new to tell anyone.
function broadcastState(record) {
  for (const socket of record.sockets) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    const actions = scopedActions(record, socket.playerId);
    socket.send(JSON.stringify({ type: 'state', state: record.state, actions }));
  }
}

// Informational only - never used to gate anything server-side. Lets a
// UI show "opponent connected/disconnected" without that status having
// any bearing on slot ownership or turn order, both of which are
// entirely `lobby`'s job.
function broadcastPresence(record, slot, connected, exclude) {
  const body = JSON.stringify({ type: 'presence', slot, connected });
  for (const socket of record.sockets) {
    if (socket === exclude || socket.readyState !== WebSocket.OPEN) continue;
    socket.send(body);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // POST /api/games -> create a new game. { mode: 'local' | 'multiplayer' },
  // defaulting to 'local' so existing no-body callers are unaffected.
  if (pathname === '/api/games' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      return sendJSON(res, 400, { error: 'invalid-json' });
    }
    const mode = body.mode === 'multiplayer' ? 'multiplayer' : 'local';
    const id = crypto.randomBytes(4).toString('hex');
    const state = createGame({ mode });
    const lobby = mode === 'multiplayer'
      ? { X: { playerId: null }, O: { playerId: null } }
      : null;
    games.set(id, { state, mode, lobby, sockets: new Set() });
    if (mode === 'multiplayer') {
      sendJSON(res, 201, { gameId: id, mode, state });
    } else {
      sendJSON(res, 201, { gameId: id, state }); // unchanged shape for local
    }
    return;
  }

  // GET /api/games/:id -> fetch current state
  const gameMatch = pathname.match(/^\/api\/games\/([a-zA-Z0-9]+)$/);
  if (gameMatch && req.method === 'GET') {
    const record = games.get(gameMatch[1]);
    if (!record) return sendJSON(res, 404, { error: 'not-found' });
    sendJSON(res, 200, { gameId: gameMatch[1], mode: record.mode, state: record.state });
    return;
  }

  // POST /api/games/:id/join -> claim an open lobby slot. No invite
  // token yet (that's the next increment) - any caller can claim any
  // open slot. Auto-starts the game once both slots are filled.
  const joinMatch = pathname.match(/^\/api\/games\/([a-zA-Z0-9]+)\/join$/);
  if (joinMatch && req.method === 'POST') {
    const id = joinMatch[1];
    const record = games.get(id);
    if (!record) return sendJSON(res, 404, { error: 'not-found' });
    if (record.mode !== 'multiplayer') return sendJSON(res, 400, { error: 'not-multiplayer' });

    const openSlot = SLOTS.find((slot) => record.lobby[slot].playerId === null);
    if (!openSlot) return sendJSON(res, 400, { error: 'lobby-full' });

    const playerId = crypto.randomBytes(8).toString('hex');
    record.lobby[openSlot].playerId = playerId;

    if (SLOTS.every((slot) => record.lobby[slot].playerId !== null)) {
      record.state = startGame(record.state);
      broadcastState(record);
    }

    sendJSON(res, 200, { gameId: id, playerId, slot: openSlot, state: record.state });
    return;
  }

  // GET /api/games/:id/actions -> list currently legal actions. The
  // client asks this instead of inferring legality from `state` itself
  // (see docs/architecture.md, "Client Authority: Zero"). For
  // multiplayer games, scoped to the caller's own playerId (?playerId=)
  // - anyone whose slot isn't the current turn sees an empty list.
  const actionMatch = pathname.match(/^\/api\/games\/([a-zA-Z0-9]+)\/actions$/);
  if (actionMatch && req.method === 'GET') {
    const id = actionMatch[1];
    const record = games.get(id);
    if (!record) return sendJSON(res, 404, { error: 'not-found' });
    const playerId = url.searchParams.get('playerId');
    sendJSON(res, 200, { gameId: id, actions: scopedActions(record, playerId) });
    return;
  }

  // POST /api/games/:id/actions -> apply an action. Multiplayer games
  // require a `playerId` in the body matching the slot whose turn it
  // is; local games are unchanged (no identity to check).
  if (actionMatch && req.method === 'POST') {
    const id = actionMatch[1];
    const record = games.get(id);
    if (!record) return sendJSON(res, 404, { error: 'not-found' });
    try {
      const action = await readJsonBody(req);
      if (record.mode === 'multiplayer') {
        const slot = slotForPlayerId(record.lobby, action.playerId);
        if (!slot) {
          return sendJSON(res, 400, { gameId: id, state: record.state, error: 'invalid-player' });
        }
        if (slot !== record.state.currentPlayer) {
          return sendJSON(res, 400, { gameId: id, state: record.state, error: 'not-your-turn' });
        }
      }
      const result = applyAction(record.state, action);
      record.state = result.state;
      if (!result.error) {
        broadcastState(record);
      }
      sendJSON(res, result.error ? 400 : 200, {
        gameId: id,
        state: result.state,
        error: result.error,
      });
    } catch (e) {
      sendJSON(res, 400, { error: 'invalid-json' });
    }
    return;
  }

  // POST /api/games/:id/actions/preview -> same computation as applying
  // an action, just not persisted (and not broadcast - nothing actually
  // changed). applyAction is already pure, so preview and commit are
  // literally the same function call - only whether the result gets
  // written to `games`/pushed over the socket differs.
  const previewMatch = pathname.match(/^\/api\/games\/([a-zA-Z0-9]+)\/actions\/preview$/);
  if (previewMatch && req.method === 'POST') {
    const id = previewMatch[1];
    const record = games.get(id);
    if (!record) return sendJSON(res, 404, { error: 'not-found' });
    try {
      const action = await readJsonBody(req);
      const result = applyAction(record.state, action);
      sendJSON(res, result.error ? 400 : 200, {
        gameId: id,
        preview: result.state,
        error: result.error,
      });
    } catch (e) {
      sendJSON(res, 400, { error: 'invalid-json' });
    }
    return;
  }

  // Static file serving for everything else (GET only)
  if (req.method === 'GET') {
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(PUBLIC_DIR, filePath);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    serveStatic(res, filePath);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// WebSocket live channel: GET (upgrade) /api/games/:id/socket. Kept as
// a manual `noServer` WebSocketServer, rather than one bound directly to
// `server`, so only this one path is treated as a socket upgrade -
// everything else stays plain HTTP.
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (socket, record) => {
  record.sockets.add(socket);

  socket.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (e) {
      return;
    }
    if (message.type !== 'authenticate') return;
    const slot = slotForPlayerId(record.lobby, message.playerId);
    if (!slot) return; // unrecognized playerId - stays an unauthenticated/spectator socket
    socket.playerId = message.playerId;
    broadcastPresence(record, slot, true, socket);
  });

  socket.on('close', () => {
    record.sockets.delete(socket);
    const slot = slotForPlayerId(record.lobby, socket.playerId);
    if (slot) broadcastPresence(record, slot, false, socket);
  });
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const socketMatch = url.pathname.match(/^\/api\/games\/([a-zA-Z0-9]+)\/socket$/);
  const record = socketMatch && games.get(socketMatch[1]);
  if (!record) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, record);
  });
});

server.listen(PORT, () => {
  console.log(`Tic-tac-toe server listening on port ${PORT}`);
});
