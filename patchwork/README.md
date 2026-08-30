# Patchwork (scaffold)

This folder currently runs **tic-tac-toe's rules, copied as-is** — same
`server.js`/`engine.js` split, same HTTP API, same game — so there's a
real, independently deployable folder in place before any actual
Patchwork rules exist. Nothing in `engine.js` here reflects Patchwork;
don't build on top of it.

The real second prototype (per [`docs/architecture.md`](../docs/architecture.md)
Section 12) will stress-test the rules engine's handling of:

- Non-alternating, time-track-driven turn order
- Individually-addressed, per-player economy (buttons, quilt board)
- Phase transitions (setup → play → scoring → game over)

Building that out means replacing `engine.js` wholesale (and extending
`server.js`/the client as the state shape and action set change) — see
the root [README](../README.md) and `CLAUDE.md` for project context.

`tic-tac-toe/` has since grown async multiplayer, a WebSocket live
channel, and Postgres-backed persistence (see its own README). None of
that exists here yet — this scaffold is still the plain, zero-dependency,
in-memory version. If/when Patchwork needs any of that, `tic-tac-toe/`'s
implementation (and its README's Railway Postgres setup — a scripted
`railway add --database postgres` + `railway variables` pair, not a
manual dashboard step) is the pattern to reuse, pointed at a `patchwork`
service with its own separate database.

## Running locally

```
cd patchwork
node server.js
```

Then open `http://localhost:3000`.

## Testing

```
cd patchwork
npm test
```
