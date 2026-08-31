'use strict';

// Two real dependencies now: `ws` for the live push channel, `pg` for
// persistence (see docs/architecture.md's "Client Authority: Zero"
// section and CLAUDE.md's dependency notes). Everything else stays on
// Node's built-in `http` module, per this project's usual pattern.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { createGame, applyAction, queryLegalActions, startGame } = require('./engine');
const { ensureSchema, insertGame, getGame, saveGame } = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SLOTS = ['X', 'O'];

// Runtime-only: live WebSocket connections per game, keyed by gameId.
// Never persisted (a socket can't be serialized) and not affected by a
// restart the way `db.js`'s rows are - a reconnecting client just opens
// a fresh socket against whatever db.js already has stored.
const socketsByGame = new Map();

// A slot's playerId, or null if the game is local / the id matches
// nothing. Multiplayer identity lives entirely in `lobby`, not in
// engine state, so this lookup is the one place that maps an incoming
// playerId to "whose move is this."
function slotForPlayerId(lobby, playerId) {
  if (!lobby || !playerId) return null;
  return SLOTS.find((slot) => lobby[slot].playerId === playerId) || null;
}

// A slot's invite token, or null. Each slot's token is generated once at
// game creation and never changes - it's the durable credential a player
// holds, not a one-time code, which is what makes /join idempotent (see
// the join handler below).
function slotForToken(lobby, token) {
  if (!lobby || !token) return null;
  return SLOTS.find((slot) => lobby[slot].token === token) || null;
}

// Redacted lobby view for a multiplayer game: claimed/open per slot,
// never the tokens. Shared by every endpoint that needs to tell a
// client "who's here" (create, join, GET, and the WS state push) so a
// UI can show a live player list without ever seeing anyone's invite
// token, its own or anyone else's.
function lobbySummary(record) {
  if (record.mode !== 'multiplayer') return undefined;
  return {
    X: { claimed: record.lobby.X.playerId !== null },
    O: { claimed: record.lobby.O.playerId !== null },
  };
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
function broadcastState(gameId, record) {
  const sockets = socketsByGame.get(gameId);
  if (!sockets) return;
  for (const socket of sockets) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    const actions = scopedActions(record, socket.playerId);
    socket.send(JSON.stringify({ type: 'state', state: record.state, actions, lobby: lobbySummary(record) }));
  }
}

// Informational only - never used to gate anything server-side. Lets a
// UI show "opponent connected/disconnected" without that status having
// any bearing on slot ownership or turn order, both of which are
// entirely `lobby`'s job.
function broadcastPresence(gameId, slot, connected, exclude) {
  const sockets = socketsByGame.get(gameId);
  if (!sockets) return;
  const body = JSON.stringify({ type: 'presence', slot, connected });
  for (const socket of sockets) {
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
      ? {
        X: { playerId: null, token: crypto.randomBytes(12).toString('hex') },
        O: { playerId: null, token: crypto.randomBytes(12).toString('hex') },
      }
      : null;
    await insertGame(id, mode, state, lobby);
    if (mode === 'multiplayer') {
      // Invite tokens are returned only here, at creation - never echoed
      // back by any other endpoint (the lobby summary below is
      // claimed/open only).
      const invites = SLOTS.map((slot) => ({ slot, token: lobby[slot].token }));
      const record = { mode, state, lobby };
      sendJSON(res, 201, { gameId: id, mode, state, invites, lobby: lobbySummary(record) });
    } else {
      sendJSON(res, 201, { gameId: id, state }); // unchanged shape for local
    }
    return;
  }

  // GET /api/games/:id -> fetch current state. For multiplayer games,
  // includes a redacted lobby summary (claimed/open per slot) so a UI
  // can show "waiting for player O" - never the tokens themselves.
  const gameMatch = pathname.match(/^\/api\/games\/([a-zA-Z0-9]+)$/);
  if (gameMatch && req.method === 'GET') {
    const record = await getGame(gameMatch[1]);
    if (!record) return sendJSON(res, 404, { error: 'not-found' });
    sendJSON(res, 200, { gameId: gameMatch[1], mode: record.mode, state: record.state, lobby: lobbySummary(record) });
    return;
  }

  // POST /api/games/:id/join -> claim (or reconnect to) the lobby slot
  // a { inviteToken } belongs to. Idempotent: the first use of a slot's
  // token claims it and issues a playerId; every later use of that same
  // token returns that same playerId again - joining and reconnecting
  // are the same operation (see docs/architecture.md's note on this).
  // Auto-starts the game once both slots are filled.
  const joinMatch = pathname.match(/^\/api\/games\/([a-zA-Z0-9]+)\/join$/);
  if (joinMatch && req.method === 'POST') {
    const id = joinMatch[1];
    const record = await getGame(id);
    if (!record) return sendJSON(res, 404, { error: 'not-found' });
    if (record.mode !== 'multiplayer') return sendJSON(res, 400, { error: 'not-multiplayer' });

    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      return sendJSON(res, 400, { error: 'invalid-json' });
    }

    const slot = slotForToken(record.lobby, body.inviteToken);
    if (!slot) return sendJSON(res, 400, { error: 'invalid-invite' });

    const existingPlayerId = record.lobby[slot].playerId;
    if (existingPlayerId) {
      // Reconnect: same token, same playerId, no new state, no write.
      return sendJSON(res, 200, { gameId: id, playerId: existingPlayerId, slot, state: record.state, lobby: lobbySummary(record) });
    }

    const playerId = crypto.randomBytes(8).toString('hex');
    record.lobby[slot].playerId = playerId;

    if (SLOTS.every((s) => record.lobby[s].playerId !== null)) {
      record.state = startGame(record.state);
    }
    await saveGame(id, { state: record.state, lobby: record.lobby });
    if (record.state.status === 'in-progress') {
      broadcastState(id, record);
    }

    sendJSON(res, 200, { gameId: id, playerId, slot, state: record.state, lobby: lobbySummary(record) });
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
    const record = await getGame(id);
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
    const record = await getGame(id);
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
        await saveGame(id, { state: record.state, lobby: record.lobby });
        broadcastState(id, record);
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
  // written to storage/pushed over the socket differs.
  const previewMatch = pathname.match(/^\/api\/games\/([a-zA-Z0-9]+)\/actions\/preview$/);
  if (previewMatch && req.method === 'POST') {
    const id = previewMatch[1];
    const record = await getGame(id);
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

wss.on('connection', (socket, gameId, lobby) => {
  let sockets = socketsByGame.get(gameId);
  if (!sockets) {
    sockets = new Set();
    socketsByGame.set(gameId, sockets);
  }
  sockets.add(socket);

  socket.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (e) {
      return;
    }
    if (message.type !== 'authenticate') return;
    const slot = slotForPlayerId(lobby, message.playerId);
    if (!slot) return; // unrecognized playerId - stays an unauthenticated/spectator socket
    socket.playerId = message.playerId;
    broadcastPresence(gameId, slot, true, socket);
  });

  socket.on('close', () => {
    sockets.delete(socket);
    const slot = slotForPlayerId(lobby, socket.playerId);
    if (slot) broadcastPresence(gameId, slot, false, socket);
  });
});

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const socketMatch = url.pathname.match(/^\/api\/games\/([a-zA-Z0-9]+)\/socket$/);
  const gameId = socketMatch && socketMatch[1];
  const record = gameId && await getGame(gameId);
  if (!record) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, gameId, record.lobby);
  });
});

// Fail fast if the database isn't reachable - no retry/backoff, matching
// this project's prototype-level error handling elsewhere.
ensureSchema()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Tic-tac-toe server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to reach the database:', err.code || err.message || err);
    process.exit(1);
  });
