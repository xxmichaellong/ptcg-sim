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

### First positional family

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

This context is not exported from the package entry point and is not yet called
by a route. A later all-or-nothing interpreter will create it only after the
entire positional schema has passed, abandon the whole candidate on any typed
adapter error or command rejection, and install state only after canonical
invariants pass.

## Next conversion slices

1. Interpret lifecycle and movement families into a private canonical candidate,
   then run the normal game-core invariants and stable hash.
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
