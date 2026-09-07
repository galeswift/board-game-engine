# Forbidden Island (bootstrap)

Third prototype: eventually a Forbidden Island implementation used to
stress-test the rules engine's handling of asymmetric player roles,
always-legal interrupt actions, and cooperative win/loss conditions (see
the root [docs/architecture.md](../docs/architecture.md), Section 12).

Right now this folder only bootstraps the phase structure on top of
`packages/rules-engine-core` — `lobby` → `setup` → `mainLoop` →
`victory` → `defeat` — with a single `advancePhase` action that cycles
through them manually via a button in the UI. There's no island, no
roles, no flood deck, no real turn structure, and no lobby/multiplayer
join flow yet; state lives in memory and resets on every restart.

## Running locally

```
cd forbidden-island
npm install
npm start
```

Then open `http://localhost:3000` and click "Advance Phase" to step
through lobby → setup → mainLoop → victory → defeat → back to lobby.

## Tests

```
npm test
```

## Railway setup: Root Directory / Dockerfile Path

`Dockerfile`'s build context is the **repo root**, not `forbidden-island/`
- it needs to `COPY` files from `packages/`, outside this folder. That
means the service's Railway settings need **both** of these (Root
Directory alone isn't enough - Railway's default Dockerfile discovery
only looks at the top of Root Directory, not subfolders):

1. **Settings → Root Directory**: `.` (the repo root) - this is what
   becomes the Docker build context.
2. **Settings → Build → Dockerfile Path**: `forbidden-island/Dockerfile`
   - tells Railway which file, inside that root-directory context, is
   the actual Dockerfile. This is a dedicated field in the Settings UI,
   not an environment variable.

Verify locally before changing these on a live service:
`docker build -f forbidden-island/Dockerfile -t forbidden-island-test .`
from the repo root.

No database plugin is needed - this bootstrap has no persistence yet.
