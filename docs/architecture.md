# Board Game Rules Engine — Architecture Plan (v4)

*Player state as a first-class object, phases as a core structure,
Patchwork / Forbidden Island as proof-of-concept games, and ECS dropped
entirely. Last updated August 20, 2026.*

> **Status note:** `tic-tac-toe/` in this repo is a deliberately simplified
> **first-pass implementation**, not a build of the full architecture
> described below (see Section 0 of the `tic-tac-toe` folder's own notes,
> and the top-level repo README). It's a real, working, deployed prototype
> built to get something live quickly — direct board mutation, no
> command/event pipeline, no phases, no deterministic context. The plan
> below is the intended target architecture as the engine and the
> Patchwork / Forbidden Island prototypes grow; expect `tic-tac-toe/` to
> be migrated toward it incrementally rather than rewritten wholesale.

---

# 0. What Changed Since v3

**ECS has been dropped entirely.** No `World`, no `Entity`/`Component`
storage, no generic `query()` API anywhere in core. Game state — including
players and, in Forbidden Island, the island tiles — is represented as
plain nested JSON-compatible objects throughout. This removes an entire
layer of core (and its tests) and simplifies several downstream sections;
see Section 4 for the resulting state shape and Section 15 for a summary
of exactly what got simpler.

Everything else from v3 is unchanged:

1. **Player state is a first-class, individually-addressable object**
   within game state. Every game declares its player state shape up
   front, alongside its other bounds. (Section 4)
2. **Phases are a core structural concept.** A game declares an
   ordered/graph-based set of phases (setup, play, scoring, etc.); a game
   that doesn't care about phases still declares exactly one. Phases gate
   which actions are legal, using the same shared-predicate principle
   already established for action legality. (Section 6)
3. **The second and third proof-of-concept games are Patchwork and
   Forbidden Island**, chosen because they stress different parts of the
   architecture than tic-tac-toe: asymmetric turn order, per-player
   asymmetric abilities, shared board state that changes independently of
   player actions, and phase-gated vs. always-legal actions. (Section 12)

The command/event execution model, deterministic replay, atomic
transactions, append-only log, and invariant-first testing from v2 are all
retained unchanged.

---

# 1. Repository Structure

Unchanged in shape from v2. One addition: the game packages now reflect
the updated proof-of-concept lineup.

```
/packages
  /rules-engine-core          <- zero knowledge of any specific game
  /game-tic-tac-toe           <- first proof case (simple)
  /game-patchwork             <- second proof case (asymmetric turn order,
                                  per-player economy, phases)
  /game-forbidden-island      <- third proof case (cooperative, asymmetric
                                  player roles, shared flooding board,
                                  always-legal interrupt actions)
  /server
```

Dependency direction is unchanged and still enforced: game packages depend
on core; core depends on nothing game-specific, ever.

---

# 2. MVC-Style Layering (Unchanged Split; Client Authority Now Explicit)

```
Model                          Controller                      View
-----                          ----------                      ----
Rules Engine (core + games) -> HTTP/WS API layer (/server) ->  Frontend
Deterministic, headless        translates requests into          Renders state snapshots
JSON-in / JSON-out              transactions, returns              Sends action requests
                                 state + events + effects           Contains no game logic
```

### Client Authority: Zero

"Contains no game logic" (above) is not just about rule execution — it
also covers **legality**. The client is a dumb terminal: it renders
whatever state (or legal-action list) the server hands it and forwards
user intent as action requests. It never independently determines
whether a move is legal — not even for UI affordances like disabling a
button or greying out a cell — by reading `state` and reasoning about it
locally. If the client needs to know what's currently allowed, it asks
the server.

Concretely:

- Core exposes legality as a query, not just a gate: `queryLegalActions(state,
  playerId) -> Action[]`, built on the same shared predicates
  `execute` already uses (Section 6's "shared gate... reused by both
  `execute` and `queryLegalActions`" is this same mechanism — what's new
  here is that calling it is *mandatory* for the client, not an optional
  convenience).
- Any UI affordance that depends on legality (can this cell be clicked,
  is this button enabled, whose turn indicator to show) is driven
  entirely by the response to a `queryLegalActions` call (or the
  `state`/`error` a `execute` request already returned), never by the
  client re-deriving it from a locally-held copy of `state`.
- This is a deliberate trade against responsiveness — every affordance
  decision costs a round trip to the server. That trade is accepted on
  purpose: optimistic UI, client-side prediction, and latency-hiding
  tricks are explicitly **out of scope** for this design. Don't design
  for them, and don't add them speculatively.

`tic-tac-toe/` now carries a first-pass version of this, ahead of the
rest of the full architecture landing: `GET /api/games/:id/actions`
returns `queryLegalActions(state)` as action-shape descriptors (e.g.
`{ type: 'placePiece', params: { cell: { domain: [0, 2, 5, ...] } } }`),
`public/client.js` drives every cell's enabled/disabled state from that
response instead of reading `state.board`/`state.status` locally, and
`POST /api/games/:id/actions/preview` computes an action's result
without persisting it — reusing `applyAction` itself, since it was
already a pure `(state, action) -> { state, error }` function with no
side effect other than what the caller does with the result. This is
consistent with "Preview and commit sharing one execution path"
(Sections 7–11) despite predating the full command/event pipeline;
`tic-tac-toe/` doesn't need phases or a command/event log to honor
client-authority-zero, because the same pure-function discipline that
was already required of it (Section 0, CLAUDE.md) is what makes preview
and commit trivially the same computation. Patchwork and Forbidden
Island are expected to expose `queryLegalActions` and a preview
endpoint the same way, just with per-player-addressed action lists and
richer parameter domains (a placement position × rotation × flip space
rather than a flat cell index).

---

# 3. Deterministic Execution Context (Unchanged from v2, ID Generation Simplified)

Every transaction is threaded through a single deterministic context:
seeded RNG (never `Math.random()`), a deterministic ID sequence (never
`crypto.randomUUID()` for anything gameplay-relevant), and an action
sequence number. Given `(initial state, seed, ordered actions)`, replay
must reproduce a byte-identical final state. This matters even more for
Patchwork (patch draw order) and Forbidden Island (flood deck and treasure
deck shuffling/reshuffling) than it did for tic-tac-toe, since both depend
on shuffled decks as core mechanics.

With ECS dropped, the ID sequence is no longer a generic "entity ID"
concept in core — it's just a deterministic counter/generator that a
game's rules or commands can call whenever a domain object needs a stable
ID (a specific patch instance, a treasure card in a discard pile). Simpler
than before: no entity-creation lifecycle to design, just
`context.nextId('patch')` producing deterministic, reproducible IDs on
request.

---

# 4. Game State Shape: Shared State + Individually-Addressed Player State

Per the new requirement, player state is promoted to a formal, named part
of the state shape rather than living inside a generic `players` blob or
being scattered across board cells.

```js
state = {
  meta: { engineSchemaVersion, gameId, gameVersion },
  phase: { current, ... },        // Section 6
  shared: { /* board, decks, market, water level, etc. - game-specific */ },
  players: {
    "player-1": { /* this player's individual state */ },
    "player-2": { /* this player's individual state */ },
  },
  turnOrder: { /* whose turn it is / how that's determined - game-specific */ },
}
```

`players` is a map keyed by `playerId`, not an array — this makes "get this
player's state" an O(1), unambiguous lookup rather than a search, and
keeps player identity stable even if turn order or seating changes
mid-game (relevant for Patchwork's non-alternating turns, Section 12).

### Declaring player state shape up front

Consistent with the original requirement that a game must declare its
bounds ahead of time (board size, pieces, etc.), a game must also declare
its player state shape as part of `GameDefinition`:

```js
export const PatchworkDefinition = defineGame({
  id: 'patchwork',
  bounds: {
    players: { min: 2, max: 2 },
  },
  createPlayerState(playerConfig) {
    return {
      buttons: 5,
      quiltBoard: createEmptyQuiltBoard(9, 9),
      timeTrackPosition: 0,
      specialTileClaimed: false,
    };
  },
  createInitialState(players) {
    // builds shared state + calls createPlayerState(...) per player,
    // assembling them under state.players
  },
  // ...
});
```

This keeps the same discipline as the board/pieces declaration from the
original plan: nothing about a player's state shape is implicit or
discovered at runtime. Core validates that `createPlayerState` exists and
that its output is used consistently for every declared player.

### Player state is a plain keyed object, not an entity collection

ECS has been dropped (Section 0), so there's no `World`/`Entity` layer
backing `state.players` — it's simply a plain object keyed by `playerId`,
as shown above. The same applies to any other collection-shaped game
concept, including Forbidden Island's 24 island tiles (Section 12), which
are represented the same way: `state.shared.islandTiles["fools-landing"] =
{ name, floodState }`. Access is direct property lookup or standard array
methods (`Object.values(state.players)`, `.map()`, `.filter()`) — no query
API, no component-type lookup, no entity lifecycle to manage.

---

# 5. Game Definition (Updated)

`GameDefinition` now formally includes player state and phase declarations
alongside the shape already established in v2 (versioning, bounds,
actions, rules):

```js
export function defineGame({
  id, gameVersion, bounds,
  createPlayerState, createInitialState,
  phases,               // Section 6
  actions, rules,
  transactionLimits,
}) {
  // validates shape at registration time, including that every phase
  // referenced by an action's `allowedPhases` (if any) actually exists
}
```

---

# 6. Phases as a Core Structural Concept

Many games have distinct stages with different legal actions: a setup
phase, one or more play phases, a scoring phase, sometimes a phase that
repeats per round. This is now a first-class concept in core rather than
something every game reimplements as ad hoc state fields and manual
checks.

### Declaring phases

A game declares its phases as a small state machine — an initial phase,
and for each phase, which actions are legal and what triggers a
transition out of it. Transitions happen the same way every other state
change happens: a rule reacting to an event emits a `TransitionPhase`
command, processed by the same `CommandProcessor` that handles everything
else (Section 8 of v2). There is no separate phase-mutation pathway.

```js
phases: {
  initial: 'setup',
  definitions: {
    setup: {
      allowedActions: ['dealStartingPatches', 'placeTimeTokens'],
      transitions: [{ onEvent: 'SetupComplete', to: 'play' }],
    },
    play: {
      allowedActions: ['buyPatch', 'advanceOnTimeTrack'],
      transitions: [{ onEvent: 'BothPlayersReachedEnd', to: 'scoring' }],
    },
    scoring: {
      allowedActions: [],
      transitions: [{ onEvent: 'ScoringComplete', to: 'gameOver' }],
    },
    gameOver: {
      allowedActions: [],
    },
  },
}
```

A game with no meaningful phase structure (tic-tac-toe) still declares
exactly one:

```js
phases: {
  initial: 'play',
  definitions: {
    play: { allowedActions: ['placePiece'] },
  },
}
```

This keeps phase-handling code paths exercised even by the simplest game,
rather than being an untested branch that only activates once a
phase-heavy game shows up.

### Phase-gated action legality

Core checks `allowedActions` for the current phase **before** calling an
action's own `execute` — this is a shared gate, not something every action
re-checks itself, consistent with the existing principle that legality
checks live in one place and are reused by both `execute` and
`queryLegalActions`.

### Actions that bypass phase gating

Forbidden Island has cards (Helicopter Lift, Sandbag) that are playable
regardless of whose turn it is or what phase is active — a genuine
"interrupt" action. Rather than forcing these into every phase's
`allowedActions` list (fragile — easy to forget when a new phase is
added), an action can declare itself phase-independent:

```js
export const sandbag = {
  phaseRestricted: false,   // legal regardless of current phase
  execute(state, params, context) { /* ... */ },
};
```

Core skips the phase gate entirely for such actions and defers wholly to
the action's own `execute` predicate. This is a deliberate, explicit
escape hatch — not a loophole — precisely because "always legal" actions
like this are common enough in real games to warrant first-class support
rather than a workaround.

---

# 7-11. (Commands/Events/Effects, Rule Dispatch, Rule-Loop Protection, Transaction Log, Preview=Commit)

Unchanged from v2. Phase transitions and player-state updates both flow
through the same command/event pipeline already designed — no new
mutation pathway was introduced by either addition in this revision. See
the v2 document for full detail on:

- The Command / Event / Effect three-tier model.
- Deterministic event queue dispatch replacing rule polling.
- `maxEvents` / `maxRuleDepth` protection against cyclic rule chains.
- The append-only transaction log.
- Preview and commit sharing one execution path.

---

# 12. Proof-of-Concept Games: Tic-Tac-Toe, Patchwork, Forbidden Island

### Phase 2 — `game-tic-tac-toe` (unchanged from v2)
Simple proof case: fixed 3x3 board, alternating turns, single phase, no
per-player asymmetry. Establishes the baseline pipeline end to end.

### Phase 3 — `game-patchwork` (new second proof case)

Chosen because it stresses parts of the architecture tic-tac-toe doesn't
touch at all:

- **Individually-addressed player state that's genuinely rich**: each
  player has a button count, a 9x9 quilt board (itself a small grid of
  filled/empty cells), a position on the shared time track, and whether
  they've claimed the 7x7 bonus tile.
- **Non-alternating turn order.** After each action, the player *further
  behind* on the shared time track takes the next turn — sometimes the
  same player goes twice in a row. This tests whether "whose turn is it"
  can be expressed as a per-game rule/query over shared state, rather than
  a hardcoded rotation the core assumes.
- **Phases that matter**: setup (deal patches, place time tokens) → play
  (the bulk of the game) → scoring (final tally, including the 7x7 bonus
  and per-empty-square penalty) → game over.
- **Actions with complex, spatially-validated parameters**: buying a patch
  requires choosing a patch from a circular market, a rotation/flip, and a
  placement position on the player's own quilt board — validated against
  the irregular polyomino shape actually fitting without overlap.
- **Passive triggers from movement**: passing (not landing on, *passing*)
  a button-income space on the time track triggers automatic button
  income — a good test of event-driven rules reacting to a state change
  that wasn't the direct target of the action that caused it.

Representative tests:
1. Turn order correctly alternates control based on time-track position,
   not turn count.
2. A patch placement is rejected if the shape doesn't fit or overlaps
   existing pieces on the player's own quilt board — using shared
   predicates identical to what `queryLegalActions` would report.
3. Passing (not landing on) a button-income space triggers exactly one
   `ButtonsEarned` event, sized to the player's current button-producing
   patches.
4. Final scoring phase correctly computes the 7x7 bonus and the
   empty-square penalty from each player's individual quilt board state.
5. Full replay from `(initial state, seed, action log)` reproduces an
   identical final board and score for both players.

### Phase 4 — `game-forbidden-island` (new third proof case)

Chosen because it stresses cooperative and asymmetric-role mechanics that
neither prior game touches:

- **Asymmetric player state by design**: each player has a role (Diver,
  Navigator, Pilot, Engineer, Explorer, Messenger) that changes what
  actions are available to them or how existing actions behave (e.g. the
  Pilot can fly anywhere once per turn; the Engineer shores up two tiles
  for the cost of one action). This is the clearest possible test of
  individually-addressed player state actually mattering, not just being
  organizationally tidy.
- **A shared board that changes independently of player actions**: 24
  island tiles, each with a flood state (normal / flooded / sunk), driven
  by a flood-card deck rather than by player choices directly. Represented
  as a plain keyed object under `state.shared.islandTiles` (Section 4) —
  a good test that plain state scales to a 24-item collection without
  needing anything fancier.
- **Multi-phase turns with a required sequence**: take up to 3 actions →
  draw 2 treasure cards (which may trigger "Waters Rise," reshuffling the
  flood discard pile back into the deck) → draw flood cards equal to the
  current water level. This tests phases that repeat every turn, not just
  once per game, and a phase transition triggering non-trivial deck
  manipulation.
- **Always-legal interrupt actions**: Helicopter Lift and Sandbag cards
  can be played by their holder regardless of whose turn or phase it is —
  directly exercises the `phaseRestricted: false` escape hatch from
  Section 6.
- **Cooperative win/loss conditions evaluated against shared state**: the
  team wins or loses together based on conditions that reference the
  entire board and every player's position simultaneously (e.g. a player
  stranded on a sinking tile with no valid moves), rather than a single
  player's state in isolation — a different shape of rule than "does this
  player have three in a row."
- **Meaningful RNG under replay**: flood deck and treasure deck shuffling,
  plus reshuffling the flood discard back into the draw deck on "Waters
  Rise," is a much better real-world test of the seeded RNG and replay
  guarantee than tic-tac-toe or even Patchwork provide.

Representative tests:
1. A Pilot's fly action is available even though no other role has it —
   proves per-player action availability driven by individual player
   state, not a single shared action list.
2. Sandbag is playable during another player's action phase — proves the
   `phaseRestricted: false` escape hatch works mid-turn.
3. Drawing a "Waters Rise" treasure card correctly reshuffles the flood
   discard pile into the flood deck and increases the water level by
   exactly one step.
4. A tile sinking that strands a player (no adjacent unsunk tile and no
   role-specific movement exception) correctly triggers a loss condition
   evaluated against the whole board and all player positions.
5. Full replay from `(initial state, seed, action log)` reproduces an
   identical island state, deck order, and water level.

### Note on the previously-proposed synthetic "torture test" game

The earlier reviewer's suggestion of a small adversarial game designed
purely to create retaliation/cascade chains remains a reasonable, cheap
sanity check — it can be built in under an hour and would catch cyclic
rule bugs fast. It's optional now rather than a required phase, since
Patchwork and Forbidden Island exercise similar chained-trigger and
determinism concerns through real gameplay, but if fast, early confidence
in the rule-loop protection (Section 9 of v2) is wanted before investing
in a full Patchwork build, it's cheap enough to insert as Phase 2.5.

---

# 13. Testing Strategy (Unchanged from v2, Extended)

The invariant-first approach from v2 (rejected actions never mutate state,
preview and commit produce identical results, replay is byte-identical
given the same seed, etc.) still applies unchanged and is tested against
the fake game in core. Patchwork and Forbidden Island add game-specific
invariants worth calling out explicitly:

- **Patchwork**: turn-order determination is a pure function of shared
  state (time-track positions) and produces the same next-player result
  regardless of how many times it's queried without an intervening
  action.
- **Forbidden Island**: cooperative loss conditions are evaluated
  consistently regardless of *which* player's action triggered the
  state change that caused them (i.e. the check isn't accidentally
  scoped to "the acting player" when it should be scoped to the whole
  team).

---

# 14. What Dropping ECS Actually Simplifies

Concretely, compared to the v3 plan:

- **Core is smaller.** `World.js`, `Entity.js`, and the component-storage
  layer (and their tests) are removed entirely from
  `rules-engine-core/src/state/`. There's no generic entity/component
  system to build, document, or maintain going forward.
- **No query API to design or learn.** State access is native JS
  (`state.players[id]`, `Object.values(...)`, `.find()`, `.filter()`)
  instead of a custom `world.query(componentType)` abstraction that every
  game author would otherwise need to learn.
- **Serialization is close to free.** `toJSON`/`fromJSON` on plain nested
  state is essentially the version envelope (Section 5) around
  `structuredClone`-compatible data, rather than custom logic to walk an
  entity graph and reconstruct component maps.
- **Debugging is more direct.** Logging or breakpoint-inspecting `state`
  shows exactly the shape a game author wrote in `createInitialState` —
  no indirection through entity IDs to look up component data.
- **One fewer unresolved architectural question.** The "how much ECS"
  debate (Section 4 of v3) disappears along with its associated code and
  decision point — there's nothing left to confirm before implementation
  starts.
- **Nothing was lost that the games actually needed.** None of the three
  proof-of-concept games (tic-tac-toe, Patchwork, Forbidden Island) rely
  on dynamic entity composition (an entity gaining/losing component types
  at runtime) — the one capability ECS provides that plain state can't
  replicate directly. If a future game genuinely needs that (e.g. a game
  where "units" gain and lose buffs/abilities dynamically), it can be
  addressed for that specific game's state shape without reopening this
  as a core-wide architectural decision.

---

# 15. Remaining Open Questions

- Should `phases.definitions[phase].allowedActions` support wildcards or
  tags (e.g. "any action tagged `movement`") for games with many actions
  per phase, or should every phase enumerate actions explicitly even when
  verbose?
- For Forbidden Island's asymmetric roles: should role-specific action
  availability be modeled as *different actions per role* (e.g.
  `pilotFly` only registered for the Pilot's role) or as *one action with
  role-conditional legality* inside a shared `fly` action? The former
  keeps each action simple; the latter keeps the action list shorter. Worth
  deciding with a concrete role or two sketched out before committing.
- Should the optional synthetic "torture test" game (Section 12) be built
  as a cheap Phase 2.5 sanity check, or skipped entirely in favor of
  going straight to Patchwork?
