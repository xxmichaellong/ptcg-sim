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

`decodeLegacyV1MovementActions` starts the next private family with `draw`,
`discardAndDraw`, `shuffleAndDraw`, `shuffleBottomAndDraw`, bottom-mode,
target-free loose-zone/stadium/new-play-stack/rich-whole-stack, and
source-zone-targeted active/bench `moveCardBundle`, direct prize
`shuffleZone`, `moveToDeckTop`, `shuffleIntoDeck`, `switchWithDeckTop`, and
`shufflePrizesToDeckBottom` records.
The draw record owns the target deck/hand through `user`; its two
positional parameters are the independently exported initiator and the
already-clamped draw count. The decoder therefore accepts both self/opp initiators without
requiring them to equal the target, but requires an integer count from 1 through
the canonical 200-card bound. Source-invalid/empty draws set `emit=false` and do
not belong in a locally applied genuine export.

`discardAndDraw` carries exactly `[initiator, count]` through its hand
context-menu and Alt-D ingress. V1 parses the prompted value, clamps it to the
current target deck before export, and accepts zero; invalid or negative input
sets `emit=false` and creates no genuine export record. The decoder therefore
requires a safe integer from zero through the canonical 200-card bound. Record
`user` selects the hand, deck, and discard zones independently of initiator.
Exact deck cardinality and ordered application remain conversion-time checks.

`shuffleAndDraw` carries exactly `[initiator, count, permutation]` through its
hand context-menu and Alt-S ingress. V1 clamps the count to the exact combined
deck and hand size, appends hand index zero to the deck tail until empty,
generates and applies a complete permutation to that combined order, then draws
from index zero. Zero and an empty combined permutation are valid. The decoder
requires a safe count from zero through 200 and a bounded complete permutation;
the count cannot exceed that recorded permutation. Their exact relationship to
current state remains a conversion-time check.

`shuffleBottomAndDraw` carries exactly
`[initiator, count, handPermutation]` through its hand context-menu and
Alt-ArrowDown ingress. V1 clamps the count to exact deck-plus-hand size, but
generates and applies the complete permutation only to the current hand. It
then appends that shuffled hand to the current deck and draws from index zero.
Zero, an empty hand permutation with a non-empty deck, and a completely empty
record are valid. The decoder requires a safe count from zero through 200 and a
bounded complete hand permutation; it deliberately does not compare their
lengths because the count may draw from the pre-existing deck. Exact count and
hand cardinality remain conversion-time checks.

The move-to-deck-bottom helper does not export `moveToDeckBottom`. It calls the
shared bundle and therefore carries exact
`[initiator, sourceZone, "deck", sourceIndex, false, "bottom"]` under action
name `moveCardBundle`. Context-menu and Arrow-Down ingress preserve the legacy
source coordinate; cover aliases keep their normal top/last-card conventions.
Stable card identity, exact current source state, and the already-bottom no-op
branch remain conversion-time responsibilities.

Ordinary loose movement uses the same action name with exact
`[initiator, sourceZone, destinationZone, sourceIndex, targetIndex, "move"]`.
Keyboard and context-menu ingress supply `false` for a target-free move; a
target-free drag leaves the JavaScript value undefined, which JSON serializes
to `null`. The decoder accepts both representations only when the destination
is deck, hand, prizes, discard, Lost Zone, board, or the discard/Lost Zone cover
aliases. `deckCover` is excluded because the drag handler routes it to the
separately exported move-to-top action before the generic bundle call. Active,
bench, attached-card, and inspection destinations remain outside this loose-zone
subshape because the same bundle also encodes new-stack, active/bench relocation,
and attach/evolve behavior. Numeric targets are admitted only for active/bench
destinations under the bounded shape below; every unrecognized mode remains
fail-closed.

Stadium placement is the separately admitted target-free destination within the
same move-mode tuple. The `G` shortcut supplies `false`; drag export can supply
`null`. V1 appends the selected card to the shared singleton and then moves a
previous index-zero incumbent to that card owner's discard. A same-stadium move
re-appends the only card and exports a genuine no-state record. Exact incumbent,
source identity, owner discard, and atomicity remain conversion-time checks.

Target-free active and bench destinations are decoded as new play stacks. The
`A`/`B` shortcuts supply `false`; an untargeted drag may serialize as `null`.
The source may use any legacy card-container name at the positional boundary,
but conversion currently resolves only ordinary zones, supported covers, loose
board, and stadium when it creates a new stack.

A numeric active/bench target is decoded as the bounded flat destination-array
coordinate exported by Q/E target selection or pointer drag. Conversion accepts
this shape from stable source zones and exact active/bench stack coordinates.
It reconstructs each target container in v1 refresh order: board-ordered stacks,
reversed evolution order (top first), then the already-versioned attachment
order. The coordinate must
identify the first, unattached top card of one current stack. Lower evolutions,
attachments, gaps, and out-of-range values fail the whole candidate instead of
being guessed. The candidate derives attachment versus evolution from the
source card's current category and executes atomic `PlaceCardOnPlayStack`, so
repeated attachments/evolutions can target already-rich stacks. A numeric
active/bench stack top uses the separate switching path below.

An active/bench source paired with a target-free active/bench destination is
also admitted when its flat coordinate identifies a stack top in the same exact
rich ordering. Conversion snapshots the entire board layout and executes
`MovePlayStack`. A numeric top target in the opposite active/bench slot supplies
the exact target stack and atomically swaps the pair. Same-zone top-target drops
are not admitted because the v1 drag guard never exports them. A lower evolution
or attachment source with a numeric top target instead executes atomic
`PlaceCardOnPlayStack`. Exact newest-to-oldest evolution and attachment offsets
are resolved after every prior mutation; same-stack reattachment is valid and a
lower Pokémon is reclassified as an attachment, matching v1. Target-free
top-card and attachment moves into loose zones use canonical
`MoveCardFromStack`. An attachment leaves its source stack in place. A top card
removes its stack and stages every lower evolution plus attachment in one
deterministically identified attachment-resolution work area, preserving the
canonical base-to-top and versioned attachment sequences plus the source-slot
hint. Direct lower-evolution departure, inspection, and work-area sources remain
closed for their distinct card-departure semantics.

A directly exported prize shuffle carries exactly
`[initiator, "prizes", permutation, true]`. Empty permutations are valid for an
empty prize zone. The source also calls the same helper internally for setup and
composite board, deck, hand, prize, and staged-zone actions with both message and
emit disabled; those helper calls are represented by their enclosing exported
action and must not be decoded as independent shuffles. The remaining movement
names are still ignored by this non-applying decoder until their zone, index,
stack, visibility, and resolved-outcome behavior is frozen.

`moveToDeckTop` carries exactly `[initiator, sourceZone, sourceIndex]`. Its
context-menu, Arrow-Up, and deck-cover drop paths all snapshot the same legacy
array coordinate before the action is exported. The decoder admits only the ten
legacy player card containers, shared stadium, and three cover aliases; indices
are safe integers from 0 through 199, and `deckCover` always denotes index zero.
The discard and Lost Zone covers select their current last index, which remains
a state-dependent conversion check. The action owner still selects the target
player's deck while initiator remains independent provenance.

`shuffleIntoDeck` carries exactly
`[initiator, sourceZone, sourceIndex, permutation]` through its context-menu and
S-key ingress. The source first appends the selected card to the deck tail,
generates a complete permutation against that post-move deck, applies it, and
only then exports the tuple. The decoder reuses the move-to-top source contract
and bounds the permutation to at most 200 positions; exact deck cardinality
remains a conversion-time state check.

`switchWithDeckTop` carries exactly
`[initiator, sourceZone, sourceIndex]` through its context-menu and Arrow-Right
ingress. The local source exports it only when the source is outside `deck` and
`deckCover`; those two zones are therefore rejected rather than admitted as
fabricated no-ops. V1 appends the selected card to the deck, rotates it to index
zero, and—when a prior deck top exists—moves that prior top from index one to
the end of the original source array. An empty deck keeps the selected card and
returns nothing. The decoder preserves the coordinate while exact source state
and the return ordering remain conversion-time checks.

`shufflePrizesToDeckBottom` carries exactly `[initiator, permutation]` through
its prize context-menu ingress. V1 returns before export when the prize zone is
empty; a genuine locally applied record therefore requires a non-empty complete
permutation. It first applies that order to the prize array, then repeatedly
removes prize index zero and appends it to the deck array. The deck sort hook
only changes DOM presentation and does not reorder either legacy array. Record
`user` remains the target player, while exact prize cardinality stays a
conversion-time source-state check.

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
a route. The closed candidate below creates it after its admitted schemas have
passed. The complete interpreter will likewise abandon the whole candidate on
any typed adapter error or command rejection and install state only after every
supported positional schema and canonical invariant passes.

### Closed canonical candidate

`buildLegacyV1Candidate` proves that the admitted data, private decoders,
deterministic context, and normal game-core execution can form one all-or-nothing
conversion pipeline. The caller supplies the canonical match and two seat
identities; source `self` and `opp` are mapped to those seats without turning
legacy labels into authority.

This deliberately narrow builder succeeds only when every action is one of
`loadDeckData`, `reset`, `setup`, `takeTurn`, `draw`, `discardAndDraw`,
`shuffleAndDraw`, `shuffleBottomAndDraw`, the bottom-mode, target-free
loose-zone/stadium/new-play-stack/rich-whole-stack, or source-zone-targeted
active/bench `moveCardBundle`, `moveToDeckTop`,
`shuffleIntoDeck`, `switchWithDeckTop`, `shufflePrizesToDeckBottom`, or the
direct prize form of `shuffleZone`. Any other allowlisted family or bundle
subshape is rejected before state construction. Deck, lifecycle, and movement diagnostics are lifted
with their exact source record/path, while context and canonical command
failures also return no candidate state.
The preflight additionally requires a one-to-one, source-ordered match between
all records and the union of private decoder outputs; a future allowlist/decoder
drift can neither omit nor double-apply a record.
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
  draw/advance and empty-deck branches without fabricating a draw or increment;
  and
- draw executes `DrawCards` for the record's target player. Before execution,
  the candidate requires the recorded already-clamped count to fit the exact
  current deck, so a forged short/empty/depleted-deck record fails the whole
  attempt instead of being silently clamped by game-core. The legacy initiator
  remains decoded provenance, not canonical target authority;
- discard-and-draw similarly requires its already-clamped count to fit the
  exact current target deck, then executes one atomic `DiscardHandAndDraw`.
  Existing hand order is appended to discard, cards are drawn from deck index
  zero into the hand, and drawn identities are concealed. A zero count still
  discards the whole hand and produces one batch. Forged unclamped counts fail
  the whole attempt before command execution; and
- shuffle-and-draw requires its already-clamped count and complete permutation
  length to fit the exact current deck-plus-hand count. V1's pre-shuffle input
  is the existing deck followed by the ordered hand, exactly matching canonical
  `ShuffleHandIntoDeckAndDraw`, so conversion supplies the recorded indices
  directly as its one-shot resolved outcome. The atomic event redraws from index
  zero and conceals the complete shuffled set. Zero-draw and empty-combined
  records remain valid, while stale counts or lengths fail the whole attempt;
  and
- shuffle-bottom-and-draw requires its already-clamped count to fit exact
  deck-plus-hand state while its complete permutation length must equal only
  the exact current hand. V1 and canonical `ShuffleHandToDeckBottomAndDraw`
  share the same input basis: shuffle the ordered old hand, append it after the
  unchanged old deck, then draw from index zero. Conversion therefore supplies
  the recorded hand indices directly as its one-shot resolved outcome. The
  atomic event conceals the shuffled hand plus drawn identities and preserves
  zero-draw, empty-hand/non-empty-deck, and completely empty records. Stale
  counts or hand-order lengths fail the whole attempt; and
- the bottom-mode move-card bundle resolves an ordinary player-zone, cover, or
  stadium source coordinate to a stable card ID and executes
  `MoveCardToDeckBottom`. Its exact source tuple must retain deck destination,
  false target, and bottom mode. A card already at last-index deck bottom keeps
  a zero-batch source record instead of asking the live command to accept a
  no-op. Stale coordinates and unresolved stack/work-area sources fail the whole
  candidate; and
- the target-free move-mode bundle resolves the same stable source coordinate,
  normalizes source plus supported discard/Lost Zone destination cover aliases,
  and executes canonical `MoveCard` only for loose player-zone destinations.
  V1's splice-then-push order and canonical default insertion both append to the
  destination tail.
  Deck, hand, and prize destinations conceal identity through the normal domain
  rule. Same-zone moves reorder a non-tail card to the tail; an already-tail
  record remains source-authentic but produces zero canonical batches. Both
  explicit `false` and JSON-serialized drag `null` are accepted as no target.
  Play destinations use the dedicated branches below; stale cards and
  unresolved stack/work-area sources return no candidate; and
- stadium-destination move bundles snapshot the exact zero-or-one incumbent and
  execute one canonical `MoveCardToStadium`. Empty placement emits one move;
  replacement atomically moves the incumbent to its own discard before placing
  the selected card, regardless of which player owns each card. A same-stadium
  record is retained with zero batches. The newly reachable stadium can then be
  used by the already admitted stable-source movement actions. Reset removes an
  incumbent only when that resetting player owns it. Stale/unresolved sources
  and numeric targets return no candidate; and
- target-free active/bench bundles execute one canonical `MoveCardToPlay` for a
  stable-resolved source-zone card on that card owner's board. Each action
  allocates one deterministic new stack, reveals and normalizes the card to
  Pokémon as v1 does, and appends bench placements. An active placement
  atomically demotes an existing active stack to the bench. Empty and occupied
  active, self/opponent board, original non-Pokémon category, stadium source,
  exact event mapping, retry, rollback, and owner-only reset cases are pinned.
  Every stack/work-area source outside the separately bounded bare-stack
  relocation below returns no candidate; and
- numeric active/bench targets from a stable source zone reconstruct the exact
  refreshed v1 flat coordinate across board-ordered stacks. Each evolution
  stack is counted top-first and followed by its canonical v1 attachment order;
  only a current stack top resolves. The candidate derives mode from current
  category and executes one atomic `PlaceCardOnPlayStack`, preserving evolution
  order and Energy-before-Trainer attachment order. Rich target offsets, exact
  events, deterministic retry, lower/attachment target rejection, and whole-
  candidate rollback are pinned. Lower-card stack sources are handled by the
  numeric reattachment path below; work-area origins remain closed;
  and
- active/bench stack-top sources are resolved through the same rich flat order,
  snapshot the exact board order, and execute `MovePlayStack`. Target-free
  promotion, demotion with zero or multiple benches, lone-bench automatic
  promotion, and non-tail bench append each produce one layout batch.
  Active-to-active and an already-tail bench-to-bench action preserve their
  exported source mapping with zero batches. A numeric opposite-slot top target
  atomically swaps the two stacks. Rich source/target offsets, retry, and exact
  layout events are pinned. Lower evolution and attachment coordinates with a
  valid numeric top target execute atomic `PlaceCardOnPlayStack`, including
  same-stack reattachment and lower-Pokémon attachment classification. Exact
  source offsets, events, retry, invariants, and missing-target rollback are
  pinned. A target-free top or attachment moving to a loose destination executes
  `MoveCardFromStack`: attachments depart independently, while a top removes its
  stack and stages ordered dependents with a deterministic work-area ID and
  restoration slot. Exact events, cover normalization, concealed destinations,
  an occupied work area plus independent singleton departure, retry, and
  lower-evolution rollback are pinned; out-of-range coordinates return no
  candidate; and
- direct prize shuffle executes `ShuffleZone` for the record's target player
  using the recorded permutation as the action-scoped resolved outcome. Its
  length must match the exact current prize zone, so conversion neither creates
  a random order nor applies an outcome to different source state; and
- move-to-top resolves a currently representable player-zone, cover, or stadium
  coordinate to a stable card ID and executes `MoveCardToDeckTop`. A deck card
  already at index zero is a genuine source no-op and retains a zero-batch
  record rather than forcing game-core to accept an invalid live command.
  Missing/out-of-range cards and stale discard/Lost Zone cover indices fail the
  whole attempt. Active, bench, attachment-resolution, and inspection origins
  remain fail-closed until legacy flattened-array order is mapped explicitly to
  canonical stack/work-area locations; and
- shuffle-into-deck uses the same stable source resolution, requires the
  recorded permutation length to equal the exact deck size after insertion,
  and executes `ShuffleCardIntoDeck` with that resolved outcome. For an
  in-deck source, v1 first moves the selected array entry to the tail, whereas
  the canonical command's shuffle input is the original deck; conversion
  translates the positional permutation between those two bases before
  execution. The final card order therefore matches v1 without replaying its
  mutable intermediate implementation or generating randomness; and
- switch-with-deck-top resolves the selected zone card and snapshots the prior
  deck top. It executes `MoveCardToDeckTop`, then, only when that snapshot
  exists, a normal `MoveCard` that appends the prior top to the source zone.
  This two-batch mapping is intentional: canonical `SwapCardWithDeckTop`
  restores the prior top at the selected card's old index, while v1 appends it
  to the source tail. With an empty deck only the first batch is emitted.
  Missing/stale coordinates and unresolved stack/work-area origins fail the
  whole candidate; and
- shuffled-prizes-to-deck-bottom requires the recorded non-empty permutation to
  match the exact current prize count, then executes one atomic
  `MovePrizesToDeckBottom` using that order as its one-shot resolved outcome.
  The prize zone becomes empty, the unchanged deck prefix is followed by the
  shuffled prizes, and every moved identity is concealed. Empty or mismatched
  source state fails before command execution and returns no candidate.

One source record may therefore map to multiple canonical event batches. The
result retains the exact record-to-batch mapping, validates invariants after
normal game-core application, replays every batch from a fresh target shell,
and requires byte-identical stable serialization before returning the private
candidate. No partial batches escape on failure.

The closed lifecycle/draw/discard-and-draw/both hand-shuffle-and-draw forms/
direct-prize-shuffle/target-free-loose/stadium/new-play-stack-move/
source-zone-attach-evolve/stack-card-reattachment/
stack-top-and-attachment-departure/move-to-top/
rich-whole-stack-move-and-swap/move-to-bottom/
shuffle-into-deck/deck-top-switch/
prizes-to-deck-bottom subset can now create ordinary loose-board, singleton
stadium, and active/bench stack state, enrich those stacks with zone-backed
evolutions and attachments, move or swap those rich stacks, reattach lower
stack members, and depart stack tops or attachments into loose zones. Tests prove
that a later take-turn discards both players' loose boards in
source order before drawing, and that an owner reset clears only that owner's
reachable loose state, owned stadium, and play stacks before rebuilding its
deck. Opponent-owned stadium and play state remain. The subset still cannot
resolve direct lower-evolution departures or work-area origins, inspections,
staged work, markers,
face-down play state, or cross-owner play placements, so take-turn in-play
reveal and reset behavior for those shapes remain gated on their dedicated
movement/state decoders.

## Next conversion slices

1. Continue source-backed positional schemas for direct lower-evolution
   departure and work areas after the
   transactionally applied draw/discard-and-draw/both hand-shuffle-and-draw
   forms, target-free loose/stadium/new-play-stack/rich-whole-stack movement,
   numeric stack switching,
   source-zone attach/evolve,
   direct prize-shuffle, and zone-backed move-to-top/move-to-bottom/
   shuffle-into-deck/deck-top-switch/prizes-to-deck-bottom atoms.
   Map stack/work-area coordinates only after their producing families make
   those states reachable in the closed transaction.
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
