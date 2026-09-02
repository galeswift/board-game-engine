# rules-engine-core

An implementation of `docs/architecture.md`'s command/event/phase design,
built to bring `patchwork/` up to that target architecture (see
`docs/patchwork-next-steps.md`'s retrofit entry for the "why").

**Scope note:** this is a Patchwork-scoped slice of the full v4 design,
not the complete generic architecture. Built: declared phases, a single
shared legality gate (`phases.isActionLegal`, used by both `execute()`
and `queryLegalActions()`), the command/event/effect dispatch loop,
deterministic seeded RNG + id generation, an append-only transaction log
with real replay support, and preview-as-a-thin-wrapper-around-execute.

**Deliberately not built yet** (no current consumer exercises them -
add when Forbidden Island actually needs them, not speculatively):
- `phaseRestricted: false` (the always-legal-interrupt escape hatch)
- `maxEvents`/`maxRuleDepth` cycle protection - an authoring bug where a
  rule re-emits an event it itself reacts to will hang the process, not
  error cleanly (see `src/dispatch.js`'s header comment)
- `transactionLimits` - not even accepted by `defineGame()` (a config
  field that's silently ignored is worse than one that's rejected)
- Player state keyed by an application-level `playerId` rather than a
  numeric seat/slot - `state.players` is keyed by seat index (`"0"`,
  `"1"`, ...), not by an auth-style identity. Patchwork's multiplayer
  `playerId` (an invite-token-derived auth credential) is deliberately
  kept entirely outside this package, in `patchwork/server.js`'s
  `lobby` object - core has no concept of it. See
  `patchwork/gameDefinition.js` and `patchwork/server.js`'s comments for
  the full rationale.

Zero runtime dependencies, plain CommonJS (matches the rest of this
repo's convention), no `package.json` of its own - consumed via a
relative `require('../packages/rules-engine-core/src')`.
