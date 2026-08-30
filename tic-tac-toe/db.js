'use strict';

// Persistence layer: a single small table, JSONB for the two blobs that
// are already JSON-shaped in memory (engine state, lobby bookkeeping).
// No ORM - the schema is too small to earn one.
//
// Deliberately NOT here: WebSocket connections. Those are runtime-only
// (see server.js's socketsByGame) and never touch this module - a
// socket can't be serialized, and a client whose process restarted
// just reconnects against whatever this module already has stored.

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/tictactoe',
});

// `CREATE TABLE IF NOT EXISTS` is not actually safe against concurrent
// first-time callers - two sessions can both pass the "does it exist"
// check before either commits, and the loser gets a genuine catalog
// error despite the IF NOT EXISTS clause: either 42P07 (duplicate_table)
// or 23505 (unique_violation, from a race on pg_type/pg_class - this is
// the one Postgres actually raises in practice for this exact race).
// That race is real here: every test file spawns its own server
// process, and on a brand-new database they all call this at once.
// Since the only thing either error means is "someone else just
// created it," it's safe to treat as success rather than crash the
// server over it.
async function ensureSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        state JSONB NOT NULL,
        lobby JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  } catch (err) {
    if (err.code !== '42P07' && err.code !== '23505') throw err;
  }
}

async function insertGame(id, mode, state, lobby) {
  await pool.query(
    'INSERT INTO games (id, mode, state, lobby) VALUES ($1, $2, $3, $4)',
    [id, mode, state, lobby],
  );
}

// { mode, state, lobby } or null if no game has this id. `pg` parses
// the JSONB columns back into plain objects automatically.
async function getGame(id) {
  const { rows } = await pool.query('SELECT mode, state, lobby FROM games WHERE id = $1', [id]);
  return rows[0] || null;
}

async function saveGame(id, { state, lobby }) {
  await pool.query('UPDATE games SET state = $2, lobby = $3 WHERE id = $1', [id, state, lobby]);
}

module.exports = { pool, ensureSchema, insertGame, getGame, saveGame };
