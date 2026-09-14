'use strict';

// Builds the REAL production Docker image (same Dockerfile, same repo-root
// build context Railway uses) and runs it as a real container, then hits
// its API over HTTP - the same class of check that would have caught the
// "Cannot find module './islandTiles'" crash: every other test here
// requires files directly (`require('./gameDefinition')`) or runs
// server.js straight off disk, so a file simply missing from the
// Dockerfile's COPY list was invisible to all of them. Only actually
// building and running the image proves the deployed artifact works.
//
// Deliberately NOT part of `npm test` / node --test discovery (this file
// doesn't end in .test.js) - it needs Docker installed and takes far
// longer than the rest of the suite, so it's its own opt-in script
// (`npm run test:docker`) run in CI as a separate step and by hand
// before a Railway-affecting change, not on every local test run.

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const DOCKERFILE = path.join('forbidden-island', 'Dockerfile');
const IMAGE_TAG = 'forbidden-island-smoke-test';
const CONTAINER_NAME = 'forbidden-island-smoke-test';
const PORT = 34999;
const BASE = `http://localhost:${PORT}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}`);
  }
}

// Split from removeImage() deliberately: a leftover container from a
// previous crashed run has to go *before* a fresh `docker run`, but
// removing the image at that point would delete the one the build step
// immediately above just produced, before it's ever run.
function removeContainer() {
  spawnSync('docker', ['rm', '-f', CONTAINER_NAME]); // best-effort - fine if none exists
}

function removeImage() {
  spawnSync('docker', ['rmi', IMAGE_TAG]); // best-effort - fine if none exists
}

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/state`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      throw new Error(`server never became reachable at ${BASE} within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

async function main() {
  console.log(`Building ${IMAGE_TAG} from ${DOCKERFILE} (context: ${REPO_ROOT})...`);
  // --load: some Docker Desktop configurations build with a buildx
  // driver that doesn't put the result in the classic local image store
  // by default - without this, the build reports success but `docker
  // run` right after can't find the image at all.
  run('docker', ['build', '--load', '-f', DOCKERFILE, '-t', IMAGE_TAG, '.'], { cwd: REPO_ROOT });

  removeContainer(); // in case a previous run's container was left behind
  console.log(`Starting container on port ${PORT}...`);
  run('docker', ['run', '-d', '--name', CONTAINER_NAME, '-p', `${PORT}:3000`, IMAGE_TAG]);

  await waitForServer();
  console.log('Server is up - exercising the real API...');

  const startRes = await fetch(`${BASE}/api/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'startGame' }),
  });
  assert(startRes.ok, `POST startGame returned ${startRes.status}`);
  const { state } = await startRes.json();
  assert(state.phase.current === 'mainLoop', `expected phase 'mainLoop', got '${state.phase.current}'`);
  assert(
    Object.keys(state.shared.islandTiles).length === 24,
    `expected 24 island tiles, got ${Object.keys(state.shared.islandTiles).length}`,
  );

  console.log('Docker smoke test passed: the built image starts and serves a real game.');
}

main()
  .then(() => {
    removeContainer();
    removeImage();
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    // Leave the container and image in place on failure - inspect with
    // `docker logs forbidden-island-smoke-test`, then clean up by hand
    // (`docker rm -f forbidden-island-smoke-test && docker rmi
    // forbidden-island-smoke-test`) once done. This is how the crash
    // this script guards against was originally diagnosed.
    console.error(`\nContainer left running for inspection: docker logs ${CONTAINER_NAME}`);
    process.exit(1);
  });
