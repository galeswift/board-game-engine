'use strict';

// Runs every project's own test suite from one command and prints an
// aggregate pass/fail summary. This is purely a convenience runner, not
// a shared build step (CLAUDE.md's "no shared build step across
// folders" is about deploys) - each suite below is exactly the same
// `npm test`/`node --test` a developer would already run inside that
// folder; nothing here builds or bundles anything.
//
// tic-tac-toe and patchwork each need their own local Postgres running
// first (`docker compose up -d` inside that folder) - their suites will
// fail fast without one, same as running them individually would.

const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  // No package.json of its own by design (see its own README) - run
  // directly with node --test rather than through npm.
  { name: 'rules-engine-core', cwd: 'packages/rules-engine-core', command: 'node', args: ['--test'] },
  { name: 'tic-tac-toe', cwd: 'tic-tac-toe', command: 'npm', args: ['test'] },
  { name: 'patchwork', cwd: 'patchwork', command: 'npm', args: ['test'] },
  { name: 'forbidden-island', cwd: 'forbidden-island', command: 'npm', args: ['test'] },
];

const results = [];
for (const suite of SUITES) {
  console.log(`\n=== ${suite.name} (${suite.cwd}) ===`);
  // shell: true - spawnSync can't invoke npm's .cmd shim directly on
  // Windows (fails with EINVAL); routing through the shell resolves it,
  // and is a no-op difference on POSIX.
  const result = spawnSync(suite.command, suite.args, {
    cwd: path.join(__dirname, suite.cwd),
    stdio: 'inherit',
    shell: true,
  });
  results.push({ name: suite.name, ok: result.status === 0 });
}

console.log('\n=== Summary ===');
let allOk = true;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  if (!r.ok) allOk = false;
}

process.exit(allOk ? 0 : 1);
