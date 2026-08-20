'use strict';

// Zero external dependencies on purpose - no npm install step needed,
// keeps the Dockerfile as dead simple as possible.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createGame, applyAction, queryLegalActions } = require('./engine');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// In-memory store. Fine for a first pass; games are lost on redeploy/restart.
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // POST /api/games -> create a new game
  if (pathname === '/api/games' && req.method === 'POST') {
    const id = crypto.randomBytes(4).toString('hex');
    const state = createGame();
    games.set(id, state);
    sendJSON(res, 201, { gameId: id, state });
    return;
  }

  // GET /api/games/:id -> fetch current state
  const gameMatch = pathname.match(/^\/api\/games\/([a-zA-Z0-9]+)$/);
  if (gameMatch && req.method === 'GET') {
    const state = games.get(gameMatch[1]);
    if (!state) return sendJSON(res, 404, { error: 'not-found' });
    sendJSON(res, 200, { gameId: gameMatch[1], state });
    return;
  }

  // GET /api/games/:id/actions -> list currently legal actions. The
  // client asks this instead of inferring legality from `state` itself
  // (see docs/architecture.md, "Client Authority: Zero").
  const actionMatch = pathname.match(/^\/api\/games\/([a-zA-Z0-9]+)\/actions$/);
  if (actionMatch && req.method === 'GET') {
    const id = actionMatch[1];
    const state = games.get(id);
    if (!state) return sendJSON(res, 404, { error: 'not-found' });
    sendJSON(res, 200, { gameId: id, actions: queryLegalActions(state) });
    return;
  }

  // POST /api/games/:id/actions -> apply an action
  if (actionMatch && req.method === 'POST') {
    const id = actionMatch[1];
    const state = games.get(id);
    if (!state) return sendJSON(res, 404, { error: 'not-found' });
    try {
      const action = await readJsonBody(req);
      const result = applyAction(state, action);
      games.set(id, result.state);
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
  // an action, just not persisted. applyAction is already pure, so
  // preview and commit are literally the same function call - only
  // whether the result gets written to `games` differs.
  const previewMatch = pathname.match(/^\/api\/games\/([a-zA-Z0-9]+)\/actions\/preview$/);
  if (previewMatch && req.method === 'POST') {
    const id = previewMatch[1];
    const state = games.get(id);
    if (!state) return sendJSON(res, 404, { error: 'not-found' });
    try {
      const action = await readJsonBody(req);
      const result = applyAction(state, action);
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

server.listen(PORT, () => {
  console.log(`Tic-tac-toe server listening on port ${PORT}`);
});
