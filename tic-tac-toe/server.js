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
const { createGame, applyAction, queryLegalActions } = require('./engine');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// In-memory store. Fine for a first pass; games (and their connected
// sockets) are lost on redeploy/restart. Each entry is
// { state, sockets }: `state` is the pure engine state, `sockets` is a
// runtime-only Set of live WebSocket connections for that game - never
// persisted, never part of engine state.
const games = new Map();

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

// Pushes the current state to every live socket for a game. Only called
// after a real state change (a successful action) - a rejected action
// has nothing new to tell anyone.
function broadcastState(record) {
  const body = JSON.stringify({ type: 'state', state: record.state });
  for (const socket of record.sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(body);
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // POST /api/games -> create a new game
  if (pathname === '/api/games' && req.method === 'POST') {
    const id = crypto.randomBytes(4).toString('hex');
    const state = createGame();
    games.set(id, { state, sockets: new Set() });
    sendJSON(res, 201, { gameId: id, state });
    return;
  }

  // GET /api/games/:id -> fetch current state
  const gameMatch = pathname.match(/^\/api\/games\/([a-zA-Z0-9]+)$/);
  if (gameMatch && req.method === 'GET') {
    const record = games.get(gameMatch[1]);
    if (!record) return sendJSON(res, 404, { error: 'not-found' });
    sendJSON(res, 200, { gameId: gameMatch[1], state: record.state });
    return;
  }

  // GET /api/games/:id/actions -> list currently legal actions. The
  // client asks this instead of inferring legality from `state` itself
  // (see docs/architecture.md, "Client Authority: Zero").
  const actionMatch = pathname.match(/^\/api\/games\/([a-zA-Z0-9]+)\/actions$/);
  if (actionMatch && req.method === 'GET') {
    const id = actionMatch[1];
    const record = games.get(id);
    if (!record) return sendJSON(res, 404, { error: 'not-found' });
    sendJSON(res, 200, { gameId: id, actions: queryLegalActions(record.state) });
    return;
  }

  // POST /api/games/:id/actions -> apply an action
  if (actionMatch && req.method === 'POST') {
    const id = actionMatch[1];
    const record = games.get(id);
    if (!record) return sendJSON(res, 404, { error: 'not-found' });
    try {
      const action = await readJsonBody(req);
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
  socket.on('close', () => {
    record.sockets.delete(socket);
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
