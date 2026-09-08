# Legacy import boundary

- Status: **v1 envelope parser and first private semantic adapters implemented**
- Supported source versions: `1.5`, `1.5.1`
- Production route status: unwired

## Purpose

PTCG Sim v1 saves are executable action histories, not state snapshots. Loading
one currently calls the legacy dispatcher for every record and allows earlier
actions to mutate the board even if a later record fails. V2 must never pass an
uploaded name into dynamic function lookup or install a partially converted
match.

`packages/legacy-import` is the only planned production package allowed to know
v1 action names, positional parameters, export versions, or action-era card
quirks. It remains independent of the browser, v1 runtime, renderer, transport,
and room authority.

## Source-backed format

The current exporter in
`client/src/initialization/document-event-listeners/sidebox/p1/bottom-buttons.js`
writes one JSON array:

```json
[
  { "version": "1.5.1" },
  {
    "user": "self",
    "emit": true,
    "action": "loadDeckData",
    "parameters": [
      [["2", "Pikachu", "Pokémon", "https://cards.example/pikachu.png"]]
    ]
  },
  {
    "user": "opp",
    "emit": true,
    "action": "loadDeckData",
    "parameters": [""]
  },
  {
    "user": "self",
    "emit": true,
    "action": "setup",
    "parameters": [[1, 0]]
  }
]
```

The first record is the displayed package version. The next two records always
bootstrap the self and opponent decks in that order. Each nonempty deck is an
array of `[quantity, name, category, imageUrl]` string tuples; the initial empty
deck sentinel is `""`. Remaining records are the source's exported action log.

Repository history shows the same exporter structure from initial version `1.5`
through `1.5.1`; commit `c9df292` changed only the displayed version string.
Both shapes are retained as source-shaped fixtures in
`tests/legacy-fixtures/saves/`. They establish parser compatibility, not yet a
claim that every historical action parameter has a semantic converter.

## Legacy hazards preserved as evidence, not behavior

V1 currently:

- parses before applying no payload, action-count, depth, or string bounds;
- ignores rather than verifies every object containing a `version` field;
- performs dynamic name lookup against the 50-entry action dispatcher;
- begins import side effects and clears action history before full validation;
- catches individual action failures and continues, leaving partial state;
- trusts positional arrays, owner strings, shuffle results, URLs, and DOM-era
  indices; and
- stores raw exports under weak four-character database keys without a per-item
  size boundary.

None of those properties are copied into the v2 runtime.

## Implemented checkpoint

`parseLegacyExportJson` now performs a side-effect-free first pass:

1. Reject empty, malformed, or oversized JSON before inspecting actions.
2. Require the first and only metadata record to declare `1.5` or `1.5.1`.
3. Require exact action record fields: `user`, `emit`, `action`, and
   `parameters`; genuine exported records always carry `emit: true`.
4. Accept only `self`/`opp` and the frozen 50-action dispatcher allowlist.
5. Require exact self-then-opponent `loadDeckData` bootstraps and validate their
   tuple structure.
6. Bound action count, parameter count, collection size, nesting, and strings.
7. Return typed path-specific diagnostics without invoking an action or
   producing canonical state.

Current provisional parser bounds are deliberately explicit and unwired, so a
real user corpus can adjust them before compatibility is promised:

| Boundary               | Limit                |
| ---------------------- | -------------------- |
| Raw JSON               | 4,194,304 code units |
| Action records         | 10,000               |
| Parameters per action  | 64                   |
| JSON nesting           | 16 levels            |
| Items per array/object | 10,000               |
| One string/field name  | 16,384 code units    |
| Deck rows per player   | 200                  |

The envelope parser itself remains independent of `game-core`. The package now
has one deliberate, one-way `game-core` dependency for its private semantic
adapters. Admission still completes before those adapters can allocate a
definition or identity, and no production route constructs imported match
state.

### Positional families

`decodeLegacyV1LifecycleActions` is the first private interpretation layer. It
decodes the two parser-verified `loadDeckData` records and exact `reset`,
`setup`, and `takeTurn` parameter tuples, but still applies nothing. Setup must
carry the source-produced complete zero-based permutation, including the valid
empty permutation for an empty deck. A reset carries exactly
`[clean, build, invalidMessage]` booleans. `takeTurn` must carry the action
owner after v1's export-copy perspective rewrite. A later `loadDeckData` is not
a genuine exporter record and fails closed.

Other allowlisted action families are deliberately ignored by this decoder,
not guessed. This lets each family acquire its own source-backed positional
schema while the final transaction can require every record to have exactly one
decoder before any canonical state is created.

`decodeLegacyV1MovementActions` starts the next private family with `draw` only.
The source record owns the target deck/hand through `user`; its two positional
parameters are the independently exported initiator and the already-clamped
draw count. The decoder therefore accepts both self/opp initiators without
requiring them to equal the target, but requires an integer count from 1 through
the canonical 200-card bound. Source-invalid/empty draws set `emit=false` and do
not belong in a locally applied genuine export. The remaining movement names
are still ignored by this non-applying decoder until their zone, index, stack,
visibility, and resolved-outcome behavior is frozen.

### Deck definition adapter

`decodeLegacyV1Decks` converts the two parser-verified deck tuples into
game-core `DeckEntry` values without constructing match state. Quantity strings
must be positive canonical decimal integers, and each player's expanded deck is
bounded by game-core's 200-card limit. Names, categories, and image URL strings
must satisfy the canonical model's limits; URLs remain inert data and are never
fetched by the importer. `Pokémon`, `Trainer`, and `Energy` are the source UI's
selectable categories; explicit `Unknown` is retained as a compatibility value
because game-core models it, but it is not presented as a selectable source UI
category.

Definition identity uses a shared self-then-opponent encounter registry over
the exact `[name, category, imageUrl]` tuple. IDs are short deterministic
ordinals, so they cannot leak uploaded text or collide through a truncated
hash. Adjacent exact duplicate rows are coalesced safely. A separated repeat
receives a distinct run ID so `A, B, A` never becomes `A, A, B`; matching run
occurrences across both players share IDs. Source strings and expanded row order
are otherwise preserved without trimming or Unicode normalization.

### Import command context

`createLegacyV1ImportContext` is a private, per-attempt adapter for future
transactional interpretation. One registry is shared by every action in the
attempt, so card instance IDs remain globally monotonic when game-core's
`LoadDeck` copy index restarts for the opponent. Card, stack, inspection, and
work-area IDs use separate deterministic ordinal namespaces and contain no
uploaded text. Recreating the context for a whole-attempt retry produces the
same IDs, event data, and canonical hash.

Each action receives an isolated command context with either no resolved
outcome, one source-recorded shuffle permutation, or one source-recorded bounded
integer. The adapter snapshots a permutation and reproduces v1's exact
`indices.map(index => values[index])` behavior only when its length and members
form a complete permutation for the canonical operation. Recorded integer
outcomes must be safe and inside the requested range. Missing, mismatched,
invalid, reused, unconsumed, or post-finish outcome access throws a typed,
record-indexed import error. It never calls `Math.random`, `crypto`, a seeded
PRNG, or an environment-dependent generator, because those would fabricate a
different result instead of importing the resolved fact.

This context is not exported from the package entry point and is not called by
a route. The lifecycle-only candidate below creates it after its closed subset
schema has passed. The complete interpreter will likewise abandon the whole
candidate on any typed adapter error or command rejection and install state only
after every supported positional schema and canonical invariant passes.

### Lifecycle-only canonical candidate

`buildLegacyV1LifecycleCandidate` proves that the admitted data, private
decoders, deterministic context, and normal game-core execution can form one
all-or-nothing conversion pipeline. The caller supplies the canonical match and
two seat identities; source `self` and `opp` are mapped to those seats without
turning legacy labels into authority.

This deliberately narrow builder succeeds only when every action is one of
`loadDeckData`, `reset`, `setup`, or `takeTurn`. Any other allowlisted family is
rejected before state construction, including `draw` in the representative
fixture. Deck and lifecycle diagnostics are lifted with their exact source
record/path, while context and canonical command failures also return no
candidate state.
Setup permutations are also cross-checked against the expanded source deck
before the target shell is created; the action-scoped adapter repeats that
validation at the canonical operation boundary as defense in depth.

The lifecycle mapping is source-backed:

- each bootstrap is a canonical `LoadDeck`;
- setup first reloads the original source deck, matching v1's internal
  `reset(..., build=true)`, then executes `SetupPlayer` with the recorded
  permutation;
- reset reloads the original source deck when `build` is true and loads an empty
  deck when it is false; `clean` and `invalidMessage` affect legacy presentation,
  not canonical state; and
- take-turn executes `StartTurn`; the closed subset proves the resolved
  draw/advance and empty-deck branches without fabricating a draw or increment.

One source record may therefore map to multiple canonical event batches. The
result retains the exact record-to-batch mapping, validates invariants after
normal game-core application, replays every batch from a fresh target shell,
and requires byte-identical stable serialization before returning the private
candidate. No partial batches escape on failure.

The closed subset cannot create play stacks, loose board cards, markers, or
cross-owner placements. It therefore does not yet claim take-turn cleanup/reveal
parity or dirty-board reset parity; those interactions stay gated on the
movement/state-family decoders rather than being inferred from an unreachable
lifecycle-only fixture.

## Next conversion slices

1. Continue source-backed positional schemas for direct movement after the
   non-applying `draw` atom, then widen the transactional candidate only after
   each newly admitted command is decoded.
2. Add markers, visibility/inspection, randomized/bulk, table signals, and the
   remaining action families using the same allowlisted dispatch table.
3. Produce a conversion report with warnings, dropped presentation fields, and
   the exact failing record/path. Integrity identities must use SHA-256 over the
   exact source bytes and a specified canonical target serialization; the
   current 32-bit game-core stable hash remains a non-security diagnostic only.
4. Only after representative real-user fixtures convert transactionally should
   the route loader or old `/import?key=` reader call this package.

No v1 module is imported, no save/replay route is enabled, and no visible UI or
UX changes in this checkpoint.
