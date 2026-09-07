'use strict';

// Node's built-in http module only, per CLAUDE.md's "keep dependencies
// minimal" convention - this bootstrap has no lobby, no multiplayer, no
// persistence, so it doesn't need `ws`/`pg` the way tic-tac-toe/patchwork
// eventually did. A single in-memory game is enough to see a fabricated
// playthrough happen; it resets on every restart/redeploy (or via
// POST /api/new-game).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGame, execute, queryLegalActions } = require('../packages/rules-engine-core/src');
const gameDefinition = require('./gameDefinition');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'web', 'dist');
const CONTENT_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

let record = createGame(gameDefinition, { players: [0, 1] });

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// { state, actions } is everything the client needs to render - per
// docs/architecture.md's "Client Authority: Zero", it never derives
// button enabled/disabled state from `state` itself, only from what
// queryLegalActions reports here.
function gameView() {
  return { state: record.state, actions: queryLegalActions(gameDefinition, record) };
}

function serveStatic(req, res) {
  const requestPath = req.url === '/' ? '/index.html' : req.url;
  const fullPath = path.join(PUBLIC_DIR, requestPath);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(fullPath)] || 'text/plain' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/state') {
    sendJson(res, 200, gameView());
    return;
  }

  if (req.method === 'POST' && req.url === '/api/new-game') {
    record = createGame(gameDefinition, { players: [0, 1] });
    sendJson(res, 200, gameView());
    return;
  }

  if (req.method === 'POST' && req.url === '/api/actions') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let action;
      try {
        action = JSON.parse(body || '{}');
      } catch {
        sendJson(res, 400, { error: 'invalid-json' });
        return;
      }
      const result = execute(gameDefinition, record, action);
      if (result.error) {
        sendJson(res, 400, { error: result.error });
        return;
      }
      record = result.record;
      sendJson(res, 200, gameView());
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Forbidden Island prototype listening on port ${PORT}`);
});
