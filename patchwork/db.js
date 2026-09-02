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
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/patchwork',
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
        log JSONB NOT NULL DEFAULT '[]',
        lobby JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  } catch (err) {
    if (err.code !== '42P07' && err.code !== '23505') throw err;
  }
  // Self-heals a `games` table that predates the `log` column (this
  // migration's own local Postgres, and the live Railway deploy, both
  // already have the table from before this column existed).
  await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS log JSONB NOT NULL DEFAULT '[]'`);
  // The rules-engine-core retrofit changed `state`'s own shape (flat
  // fields -> { meta, phase, shared, players, turnOrder }) - a pre-
  // migration row has no `meta` key at all. docs/patchwork-next-steps.md's
  // "clean break" decision said these rows are disposable prototype
  // data; this is what actually disposes of them, rather than leaving
  // them to throw on first read (toWireState reads state.meta.*
  // unconditionally). Runs on every startup - a no-op once no
  // old-shaped rows remain, same self-healing pattern as the ALTER
  // above.
  await pool.query(`DELETE FROM games WHERE NOT (state ? 'meta')`);
}

// `log` is packages/rules-engine-core's append-only transaction log
// (record.log) - stored alongside state so a restarted server picks up
// exactly where the in-memory record left off, same as state/lobby
// already did.
async function insertGame(id, mode, state, log, lobby) {
  await pool.query(
    'INSERT INTO games (id, mode, state, log, lobby) VALUES ($1, $2, $3, $4, $5)',
    [id, mode, state, JSON.stringify(log), lobby],
  );
}

// { mode, state, log, lobby } or null if no game has this id. `pg`
// parses the JSONB columns back into plain objects automatically.
async function getGame(id) {
  const { rows } = await pool.query('SELECT mode, state, log, lobby FROM games WHERE id = $1', [id]);
  return rows[0] || null;
}

async function saveGame(id, { state, log, lobby }) {
  await pool.query('UPDATE games SET state = $2, log = $3, lobby = $4 WHERE id = $1', [id, state, JSON.stringify(log), lobby]);
}

module.exports = { pool, ensureSchema, insertGame, getGame, saveGame };
