# Legacy import boundary

- Status: **bounded v1 conversion transaction, canonical card-back policy, report, and private-corpus evidence runner implemented**
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

### Conversion transaction and integrity report

`convertLegacyExportBytes` is the first public all-or-nothing conversion
boundary. It accepts a `Uint8Array`, snapshots it and the target seat identity
and display-name metadata before its first asynchronous operation, and admits at
most 4,194,304 bytes. Card-back URLs are deliberately not accepted as caller
target metadata: every imported seat starts with the integrity-gated canonical
`/v2/assets/cardback.png` asset, then valid saved `changeCardBack` records
replace it through ordered canonical events.
Oversized input is rejected before hashing or decoding. Bounded input is
identified by SHA-256 over the exact source bytes and decoded as fatal UTF-8
before the existing JSON parser runs. Invalid
UTF-8, invalid JSON, unsupported records, stale source coordinates, canonical
command rejection, or invariant failure returns a rejected report and no state
or event records.

A successful report uses the explicit
`ptcgsim-legacy-conversion-report-v1` format and includes:

- exact source byte length and `sha256:<hex>` identity;
- source version and action, converted-record, batch, event, and zero-batch
  counts;
- the exact record index, JSON path, stage, code, and safe message for every
  failure (currently fail-fast, so one issue);
- warnings for V1 transport metadata that is intentionally not persisted;
- exact paths and reasons for validated presentation-only initiator, message,
  and redundant target-relationship fields; and
- a separate target identity computed as SHA-256 over the UTF-8 bytes of
  `stableSerialize(state)`, named
  `ptcgsim-match-state-stable-json-v1` and pinned to the current match-state
  schema version.

The source and target identities have deliberately different meanings: JSON
whitespace changes the source hash while leaving the canonical target hash
unchanged. The existing `fnv1a32` game-core hash remains useful for deterministic
diagnostics but is not treated as an integrity credential. Rejected conversions
list no dropped fields because no target was installed. The package and report
remain unwired from upload, save, or `/import?key=` routes.

That unwired state is enforced rather than conventional. The source-boundary
gate rejects `@ptcgsim/legacy-import` from every workspace `dependencies`,
`optionalDependencies`, and `peerDependencies` section even if unused;
`devDependencies` remain available for isolated verification. Production web
and Worker source-map provenance independently reject any emitted importer
module. Activating a route therefore requires an explicit reviewed gate change
after the representative real-user corpus evidence is approved.

### Privacy-safe corpus evidence runner

`pnpm run check:legacy-corpus` is an operator-only tool around the public byte
transaction. It recursively reads lowercase `.json` files from an explicitly
provided directory, converts them sequentially against the fixed anonymous
`ptcgsim-anonymous-legacy-corpus-target-v1` profile, and emits a deterministic
`ptcgsim-legacy-import-corpus-report-v1` JSON document. The output is sorted by
exact source SHA-256 rather than filename and contains only:

- source digests and byte lengths;
- source version and action-family counts;
- conversion/target identities and aggregate event counts;
- warning and dropped-field reason counts; and
- failure stage, code, record index, and JSON path without diagnostic messages.

It never emits source paths, filenames, card/deck names, image URLs, or raw JSON.
Exact source digests, byte lengths, and action distributions are nevertheless
pseudonymous metadata and still require privacy review before a report is
committed or shared.

Raw private exports must stay outside the repository or below the ignored
`.private/legacy-import-corpus/` directory. The CLI rejects any other
in-repository input, any symbolic link in the tree, duplicate exact artifacts,
an empty corpus, more than 1,000 cases, a source above the transaction's 4 MiB
limit, or more than 256 MiB in total. Non-JSON regular files are ignored. Input
is processed one artifact at a time; the tool does not retain raw contents.

Generate a review artifact outside the input tree:

```bash
corepack pnpm run check:legacy-corpus -- \
  --input .private/legacy-import-corpus/reviewed \
  > /tmp/ptcgsim-legacy-corpus-report.json
```

After the redacted artifact itself is approved and stored in a controlled
location, compare later runs semantically (JSON whitespace and object-key order
do not matter):

```bash
corepack pnpm run check:legacy-corpus -- \
  --input .private/legacy-import-corpus/reviewed \
  --expect /approved/ptcgsim-legacy-corpus-report.json
```

The expected report must be a regular, non-symlink, valid-UTF-8 JSON file no
larger than 8 MiB and must live outside the input directory. A rejected
conversion or baseline drift exits nonzero. Ten synthetic tooling tests prove
determinism, content/path redaction, action coverage, duplicate refusal, limits,
symlink refusal, input isolation, and baseline behavior. No raw or redacted
real-user corpus is currently present, so this infrastructure does not satisfy
the representative-corpus exit gate by itself.

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
`shuffleZone`, exact staged `leaveAll`, `discardAll`, `lostZoneAll`, `handAll`,
`shuffleAll`, and `shuffleBottom`, plus `moveToDeckTop`, `shuffleIntoDeck`,
`switchWithDeckTop`, and `shufflePrizesToDeckBottom` records.
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
lower Pokémon is reclassified as an attachment, matching v1. Target-free top,
lower-evolution, and attachment moves into loose zones use canonical
`MoveCardFromStack`. A lower evolution or attachment leaves independently and
preserves the source stack plus its marker state. A top card removes its stack
and stages every lower evolution plus attachment in one deterministically
identified attachment-resolution work area, preserving the canonical
base-to-top and versioned attachment sequences plus the source-slot hint.
Attachment-resolution work-area sources now resolve their exact V1 flat order:
newest-to-oldest staged evolutions followed by versioned attachments. A staged
card can move individually to a loose zone through `MoveStagedCard`, or onto an
exact numeric active/bench stack top through `PlaceCardOnPlayStack`; current
category derives evolution versus attachment and an empty work area closes. An
individual staged card can also move to deck bottom, deck top, an exact recorded
single-card deck shuffle, or stadium through existing source-relative commands.
The resolver uses the current V1 flat coordinate; the shuffle basis is the
remaining deck followed by that selected card, and stadium replacement keeps
the incumbent-owner discard rule. Exact source classification, remaining and
empty work-area state, concealment generations, retry, replay, invariants, and
stale coordinate/permutation rollback are pinned. A target-free active/bench
destination composes `MoveStagedCard` to the owner's loose board with
`MoveCardToPlay` in two batches under the same import record. This preserves
V1's individual-card new-stack normalization and does not restore unrelated
staged members. Staged `switchWithDeckTop` resolves the same current flat
coordinate. An empty deck uses one deck-top move; otherwise an internal
versioned swap reconstructs V1's selected-card removal and prior-top tail
append, normalizes the returned card to its original category, then records the
exact returned flat order plus its semantic evolution and attachment sequences.
V2 persists the flat order as an exact permutation of those semantic lists, so
category-interleaved popup coordinates survive later individual actions,
snapshots, replay, and reconnect. The classifier reproduces V1 `leaveAll`:
Pokémon are consumed right-to-left into the evolution stack while non-Pokémon
retain their relative attachment order. An
exact `leaveAll` record carries `[initiator, "attachedCards", destinationSlot]`;
conversion accepts only `active` or `bench`, requires staged evolution members
to remain Pokémon and staged attachments to remain non-Pokémon, snapshots the
complete board, and executes `RestoreStagedStack`. The event consumes the work
area, allocates a deterministic stack, and preserves occupied-active demotion.
Missing, attachment-only, or category-ambiguous work areas fail closed.
The exact `[initiator, "attachedCards"]` forms of `discardAll`, `lostZoneAll`,
and `handAll` drain the same current V1 flat order through one stable-ID
`MoveStagedCard` batch per card. The private candidate still commits nothing
unless every batch succeeds, and replay preserves destination append order,
category reset, public discard/lost-zone state, and concealed hand identities.
Exact staged-source `shuffleAll` and `shuffleBottom` add a complete permutation.
For `shuffleAll`, V1's basis is current deck followed by the V1 flat staged
order; for `shuffleBottom`, it is only the V1 flat staged order. The candidate
resolves both V1 and canonical bases to stable IDs, translates every recorded
index by identity, and executes one atomic `ResolveStagedCards`. This preserves
the full-deck result, the deck-bottom prefix, and the correct concealed-identity
scope without conflating reversed-evolution popup order with canonical work-area
order.

The parallel `[initiator, "viewCards"]` forms now consume the exact active
deck-inspection work area with one `ResolveInspectionCards` command. Discard,
Lost Zone, and hand preserve inspection order. `shuffleAll` validates a
permutation over the remaining deck followed by the inspection cards;
`shuffleBottom` validates a permutation over only the inspection cards and
retains the existing deck prefix. Those bases already match V1 exactly, so no
staged-order translation is applied. Resolution closes the inspection and its
visibility grant atomically, applies destination normalization/concealment, and
rejects missing work areas or stale lengths without exposing partial state.
Individual `viewCards` move bundles now resolve the exact current inspection
coordinate after every prior departure. Loose destinations execute
`MoveInspectedCard`; numeric active/bench targets must identify an existing
stack top and execute `PlaceCardOnPlayStack`, with mode derived from current
category. Each command retires the moved card's inspection visibility, and the
last departure closes the work area. Missing/stale coordinates or targets
return no candidate. A target-free active/bench destination composes
`MoveInspectedCard` through the owner's loose board with `MoveCardToPlay`,
creating a deterministic normalized singleton stack and preserving
occupied-active demotion inside the closed import record. The same resolver now
admits bottom-mode deck movement,
move-to-deck-top, shuffle-into-deck, and stadium placement from `viewCards`.
Deck-edge commands conceal the selected identity, the shuffle validates the
exact remaining-deck-plus-selected-card basis before passing through its
recorded permutation, and stadium replacement atomically displaces the
incumbent to its owner's discard. Inspection-origin `switchWithDeckTop` opts
the atomic inspection swap into V1's source-tail return, updating the popup and
viewer grant in the same order after placing the selected card on deck top. An
empty deck instead performs the single selected-card move. The mode is internal
and optional, preserving source-position replacement for native commands and
older replay batches.

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

`discardBoard`, `handBoard`, and `lostZoneBoard` each carry exactly
`[initiator, message]`; `shuffleBoard` carries
`[initiator, message, permutationOrNull]`. Record `user` identifies the board
owner, the first parameter retains the saved initiator perspective, and the
message flag is presentation-only. V1 repeatedly moves board index zero, so
discard, hand, and Lost Zone preserve the board's ordered tail append.
`shuffleBoard` first appends the board to the existing deck and then applies a
complete permutation over that deck-plus-board basis. All four functions still
export a record for an empty board. In the empty shuffle branch no permutation
is created, so JSON serialization turns the third parameter's `undefined` into
the source-authentic `null` sentinel.

`VSTARGXFunction` carries exactly `[marker]`, where shipped controls emit only
`GX` or `VSTAR`. Record `user` identifies the affected player. V1 stores no
result boolean: each record toggles only the named player's named DOM class,
leaving the other marker and player untouched. Repeated records therefore must
derive their explicit canonical target from the preceding converted state, not
from UI defaults or a guessed final snapshot.

`useAbility` carries exactly `[initiator, zone, index]`, while
`removeAbilityCounter` carries `[zone, index]`. The source-accessible zones are
`active`, `bench`, `discard`, and `stadium`; indices are current V1 flat-array
coordinates. Record `user` selects the target board/card owner and the saved
initiator is message provenance only. V1 replaces an existing ability tab on
repeated use and still exports the record; removal likewise exports when the
card exists but no tab does. Conversion therefore retains either case as a
source-valid zero-batch record. Active/bench top cards map to the canonical
stack marker, while attachments, discard cards, and the owned stadium card map
to canonical per-card markers. Lower evolutions fail closed because canonical
state intentionally owns one ability marker on the current stack top and cannot
represent a distinct lower-card marker without loss.

`addDamageCounter` and `updateDamageCounter` each carry
`[zone, index, damage]`; `removeDamageCounter` carries `[zone, index]`. Only
`active` and `bench` are source-accessible. A context-menu add omits the value,
which JSON serializes to `null` and V1 renders as `10`; digit shortcuts and
edits export strings. The approved authoritative policy trims decimal strings,
accepts positive integers through `9990`, and normalizes empty, zero, or
negative update values to removal. Other free-form V1 text fails conversion
rather than entering canonical state. Adding over an existing source marker
only rebinds that DOM node and leaves its old value unchanged; removing a
missing marker is also an exported state no-op. Updates require an existing
source marker. A private conversion-only presence set distinguishes a transient
empty/zero/negative source node from canonical `null`, so another edit before
blur remains valid without admitting a markerless update. Conversion maps only
a current active/bench stack top to `SetDamage`. Lower-evolution and attachment
coordinates fail closed because V1 can place distinct damage nodes on those
cards while canonical state intentionally owns one stack-level value.

`addSpecialCondition` and `removeSpecialCondition` each carry `[active, index]`;
`updateSpecialCondition` carries `[active, index, value]`. The shipped context
menu and `Y` shortcut expose conditions only on the active card, and add creates
`P`. V1 accepts arbitrary editable text, colors recognized `P`/`B`/`Pa`/`C`/`A`
values, and removes the node on blur when trimmed empty or exactly `0`. The
approved authoritative boundary trims outer whitespace, maps empty or `0` to
null, preserves other strings through 16 characters, and rejects longer or
non-string values. Existing add and missing removal are exported source
no-ops; update requires a source node. A private conversion-only map records
the node's exact stack top, preserving an update after a transient canonical
null while pruning the node when evolution or active-slot departure triggers
V1's non-emitting automatic cleanup. Conversion maps only the current active
stack top through `SetSpecialCondition`; bench, lower-evolution, attachment,
missing, malformed, and over-bound coordinates fail closed.

`rotateCard` carries exactly `[zone, index, single]`. The shipped keyboard path
emits `single=false` for `active`, `bench`, or `stadium`, and `single=true` only
for `active` or `bench`. Play indices address the current V1 flat order:
newest-to-oldest evolutions followed by attachments, concatenated across bench
stacks. Record `user` selects the target player/card owner. Conversion applies
the already-approved production V2 normalization: nonsingle play records
advance the resolved stack's `RotateStack` target modulo four, single play
records toggle the resolved card's independent `SetCardOrientation` target
between q1 and q0, and nonsingle stadium records advance the exact owned card's
orientation modulo four. It intentionally does not reconstruct V1's
history-dependent inline angles, wrapper margins, or per-image `PokémonBreak`
flags; those DOM defects are not canonical game state and the same boundary is
already enforced by live V2 keyboard ingress. Stadium single mode plus missing,
stale, cross-owner, invalid-zone, malformed, and out-of-bound coordinates fail
closed.

`attack` and `pass` each carry an exact empty parameter array. Their record
`user` is the acting/target player in the saved perspective. Conversion emits
one canonical `DeclareAttack` or `PassTurn` batch, preserving the source's
global ability-marker reset, acting loose-board discard, unchanged turn/card
faces, and replayable table declaration without replaying its internal
`discardBoard(..., false, false)` helper call as another source record.

`changeCardBack` carries exactly one bounded nonempty string. V1 admits the local action
only after an `Image` load succeeds, replaces its mutable card-back fields and
matching image nodes, and then writes the arbitrary URL into saved history. The
private decoder retains the exact URL and conversion emits one ordered
`PlayerCardBackSet` event. Existing whole-match checkpoints restore the prior
URL on undo, deterministic replay reconstructs the final back for each side,
and the transaction report no longer misclassifies the retained value as a
dropped presentation field. The importer never fetches or proxies the URL.
Empty, oversized, non-string, or non-singleton tuples reject the complete
candidate.

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
`shuffleAndDraw`, `shuffleBottomAndDraw`, first or same-/cross-viewer repeated
`viewDeck` (including zero-card visibility revocation), inspection-source
`discardAll`/`lostZoneAll`/`handAll`/`shuffleAll`/`shuffleBottom`, individual
inspection-source loose-zone/targeted-play `moveCardBundle`, the bottom-mode, target-free
loose-zone/stadium/new-play-stack/rich-whole-stack, or source-zone-targeted
active/bench `moveCardBundle`, exact staged `leaveAll`, `discardAll`,
`lostZoneAll`, `handAll`, `shuffleAll`, and `shuffleBottom`, `moveToDeckTop`,
`shuffleIntoDeck`, `switchWithDeckTop`, `shufflePrizesToDeckBottom`, or the
direct prize form of `shuffleZone`; exact once-per-game, ability, damage, and
special-condition marker records; `rotateCard`, `changeType`,
`playRandomCardFaceDown`, `undo`, `attack`, and `pass`. Any other allowlisted family or
bundle subshape is rejected before state construction. Deck, lifecycle,
movement, marker, annotation, resolved-random, history, and table diagnostics are lifted
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
- view-deck requires the exact source tuple's already-clamped count to fit its
  bounded recorded deck count, and requires that count witness to equal the
  current target deck size. Record `user` selects the deck owner, the decoded
  initiator is the sole viewer, and `targetIsOpp` must agree with whether those
  perspectives differ. A positive first view executes
  `ExtractDeckCardsForInspection` with deterministic identity. Top views retain
  deck order; V1's descending bottom loop produces bottom-to-top edge order, so
  the canonical command now preserves that order while event application also
  accepts its earlier source-order form for replay compatibility. A positive
  same-viewer repeat supplies the exact inspection ID, work-area ID, prior card
  order, and per-card viewer map to the same command and emits
  `InspectionExtended`. Replay revalidates that snapshot plus the exact selected
  deck edge before appending. A different viewer reproduces V1's asymmetric DOM
  transition: every previously visible popup card becomes concealed to both
  players, its opaque visibility generation advances, and only the newly
  extracted batch is granted to the new viewer. The historical zero-card source
  defect remains a zero-batch record for a compatible viewer; for a different
  viewer it emits `InspectionVisibilityCleared`, revoking all remaining popup
  visibility without moving cards; and
- the bottom-mode move-card bundle resolves an ordinary player-zone, cover,
  stadium, exact current inspection, or exact current staged source coordinate
  to a stable card ID and executes `MoveCardToDeckBottom`. Its exact source tuple
  must retain deck destination, false target, and bottom mode. A card already at
  last-index deck bottom keeps a zero-batch source record instead of asking the
  live command to accept a no-op. Work-area departures update or close their
  source and conceal the returned identity. Stale coordinates and unresolved
  stack/work-area sources fail the whole candidate; and
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
  and numeric targets return no candidate. Exact inspection and staged
  coordinates use the same command through their source-relative work-area ID;
  and
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
  numeric reattachment path below. Attachment-resolution work-area origins use
  the matching newest-to-oldest evolution plus versioned-attachment flat order:
  loose destinations execute `MoveStagedCard`, while an exact numeric stack-top
  target executes `PlaceCardOnPlayStack`. Changing offsets, category-derived
  evolution/attachment mode, concealment, empty-area cleanup, retry, and
  rollback are pinned. Staged stadium destinations execute
  `MoveCardToStadium`, including atomic incumbent-owner displacement, and
  staged deck-bottom bundles execute `MoveCardToDeckBottom`. Inspection
  work-area origins use their exact current
  top/edge-first popup order: loose destinations execute `MoveInspectedCard`,
  while an exact numeric stack-top target executes `PlaceCardOnPlayStack`.
  Changing offsets, category-derived mode, concealment, viewer-grant retirement,
  empty-area cleanup, retry, replay, and rollback are pinned. Stadium
  destinations execute `MoveCardToStadium`, including atomic incumbent-owner
  displacement; deck-bottom bundles execute `MoveCardToDeckBottom` through the
  same source-relative work-area ID. Target-free active/bench destinations from
  either work area compose their existing individual departure through the
  owner's loose board with `MoveCardToPlay`. Both canonical batches remain
  attached to the same imported record; and
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
  pinned. A target-free top, lower evolution, or attachment moving to a loose
  destination executes `MoveCardFromStack`: attachments and lower evolutions
  depart independently, while a top removes its stack and stages ordered
  dependents with a deterministic work-area ID and restoration slot. Exact
  events, cover normalization, concealed destinations, preserved stack marker
  state, an occupied work area plus independent singleton departure, retry,
  event-source forgery rejection, and out-of-range rollback are pinned; and
- direct prize shuffle executes `ShuffleZone` for the record's target player
  using the recorded permutation as the action-scoped resolved outcome. Its
  length must match the exact current prize zone, so conversion neither creates
  a random order nor applies an outcome to different source state; and
- move-to-top resolves a currently representable player-zone, cover, stadium,
  exact current inspection, or exact current staged coordinate to a stable card
  ID and executes
  `MoveCardToDeckTop`. A deck card already at index zero is a genuine source
  no-op and retains a zero-batch record rather than forcing game-core to accept
  an invalid live command. Work-area departures update or close their work
  area and conceal the returned identity. Missing/out-of-range cards and stale
  discard/Lost Zone cover indices fail the whole attempt. Active and bench
  origins remain fail-closed in this specialized family; and
- shuffle-into-deck uses the same stable source resolution, requires the
  recorded permutation length to equal the exact deck size after insertion,
  and executes `ShuffleCardIntoDeck` with that resolved outcome. For an
  in-deck source, v1 first moves the selected array entry to the tail, whereas
  the canonical command's shuffle input is the original deck; conversion
  translates the positional permutation between those two bases before
  execution. Inspection and staged sources resolve their current popup
  coordinates; their canonical non-deck basis is already V1's remaining deck
  followed by the selected card, so the exact recorded permutation passes
  through unchanged.
  The final card order therefore matches v1 without replaying its mutable
  intermediate implementation or generating randomness; and
- switch-with-deck-top resolves the selected zone card and snapshots the prior
  deck top. It executes `MoveCardToDeckTop`, then, only when that snapshot
  exists, a normal `MoveCard` that appends the prior top to the source zone.
  This two-batch mapping is intentional: canonical `SwapCardWithDeckTop`
  restores the prior top at the selected card's old index, while v1 appends it
  to the source tail. With an empty deck only the first batch is emitted.
  Missing/stale coordinates and unresolved stack origins fail the whole
  candidate. Inspection sources use the optional atomic source-tail return mode
  and preserve the existing viewer grant; staged sources use a versioned
  returned-sequence mode carrying V1's exact flat tail and its right-to-left
  Pokémon evolution/non-Pokémon attachment classification. Empty work-area
  deck swaps use one move. Category-interleaved staged tails retain their exact
  later coordinates and restoration semantics; and
- shuffled-prizes-to-deck-bottom requires the recorded non-empty permutation to
  match the exact current prize count, then executes one atomic
  `MovePrizesToDeckBottom` using that order as its one-shot resolved outcome.
  The prize zone becomes empty, the unchanged deck prefix is followed by the
  shuffled prizes, and every moved identity is concealed. Empty or mismatched
  source state fails before command execution and returns no candidate; and
- direct discard/hand/Lost Zone board actions snapshot the target player's
  exact current loose-board order and execute one `ResolveLooseBoardCards`
  batch. Direct board shuffle additionally requires its recorded permutation
  to match the exact current deck-plus-board count and supplies that order as
  the action's one-shot resolved outcome. Empty boards retain the source record
  with zero batches; only the serialized `null` shuffle sentinel is valid in
  that branch. Stale or mismatched shuffle state returns no candidate; and
- each exact once-per-game marker record reads the target player's current GX
  or VSTAR boolean and executes one `SetOncePerGameMarker` with its inverse.
  This preserves ordered toggles and independent markers for both players while
  producing an explicit replay-safe event. Unknown marker strings fail before
  candidate construction; and
- each exact ability-use/removal record resolves its current source coordinate
  before applying `SetAbilityUsed` to a stack top or `SetCardAbilityUsed` to an
  attachment, discard card, or owned stadium card. An already-used `useAbility`
  and already-clear `removeAbilityCounter` retain zero batches, matching V1's
  exported state no-op. Missing, stale, cross-owner stadium, and lower-evolution
  coordinates return no candidate rather than targeting the wrong card; and
- each exact damage add/update/removal record resolves a current active/bench
  stack-top coordinate and applies the bounded target through `SetDamage`.
  Serialized-null add defaults to `10`; repeated add and remove-on-missing
  retain zero batches, update-on-missing fails as source-inaccessible, and
  duplicate or normalized-null updates remain source-node-aware no-ops. Invalid
  text plus missing, lower-evolution, or attachment coordinates return no
  candidate; and
- each exact special-condition add/update/removal record resolves the current
  active stack top and applies the bounded target through
  `SetSpecialCondition`. Add defaults to `P`; existing add, duplicate update,
  and missing removal retain zero batches, while markerless update fails. The
  private exact-host map preserves transient null edits and observes automatic
  evolution/active-departure cleanup. Invalid text plus bench, missing,
  lower-evolution, or attachment coordinates return no candidate; and
- each exact rotation record resolves a current active/bench flat card or the
  owned stadium card. Nonsingle play rotation advances `RotateStack`; single
  play rotation toggles that exact card's orientation q0/q1; stadium rotation
  advances its per-card orientation modulo four. This preserves stable semantic
  targets under the same normalization as production keyboard ingress while
  excluding V1's hidden DOM-only angle/margin/BREAK history. Evolution-reset
  progression is derived from current canonical state; malformed, stale,
  cross-owner, and source-inaccessible modes return no candidate; and
- each exact category-change record resolves the source record owner's card at
  a current card-selectable zone, flat stack, staged, or inspection coordinate.
  The exported initiator is retained as presentation provenance only. The
  existing atomic `ChangeCardCategory` path departs the exact card to its
  owner's loose-board tail, applies Pokémon/Trainer/Energy, and clears transient
  orientation and ability state; stack-top dependents are staged. Exact
  already-matching board-tail records retain zero batches. Covers, lower
  evolutions, stale/cross-owner coordinates, and malformed categories return no
  candidate; and
- each exact random-face-down record supplies V1's already-resolved hand index
  once to `PlayRandomCardFaceDown` through the action-scoped import context.
  Record ownership selects the target hand/board and the exported initiator
  selects the actor. Canonical order snapshots, face-down annotation reset,
  visibility retirement, and replay-safe trusted identity remain unchanged;
  no random value is regenerated. Empty/depleted hands, stale or out-of-range
  indices, capacity failures, and malformed tuples return no candidate; and
- attack and pass require exact empty parameter arrays and execute one
  `DeclareAttack` or `PassTurn` for the source record's target player. The
  canonical batch resets every ability marker, discards only that player's
  loose board, leaves turn and card-face state unchanged, and records the
  replayable table declaration.

One source record may therefore map to multiple canonical event batches. The
result retains the exact record-to-batch mapping, validates invariants after
normal game-core application, replays every batch from a fresh target shell,
and requires byte-identical stable serialization before returning the private
candidate. No partial batches escape on failure.

The closed lifecycle/draw/discard-and-draw/both hand-shuffle-and-draw forms/
direct-prize-shuffle/direct-loose-board-bulk/target-free-loose/stadium/new-play-stack-move/
source-zone-attach-evolve/stack-card-reattachment/stack-card-departure/
individual-staged-card-loose-and-targeted-play/
individual-staged-card-deck-edge-shuffle-and-stadium/exact-leave-all-restore/
individual-work-area-card-new-play-stack/
flat-ordered-staged-discard-lost-zone-hand/identity-translated-staged-shuffles/
first-deck-inspection/atomic-inspection-bulk-resolution/
individual-inspection-card-loose-and-targeted-play/
individual-inspection-card-deck-edge-shuffle-and-stadium/
move-to-top/
rich-whole-stack-move-and-swap/move-to-bottom/
shuffle-into-deck/deck-top-switch/once-per-game-marker/ability-marker/damage-marker/special-condition-marker/rotation/category-change/resolved-random-face-down/safe-whole-match-undo/parameterless-attack-and-pass/
prizes-to-deck-bottom subset can now create ordinary loose-board, singleton
stadium, and active/bench stack state, enrich those stacks with zone-backed
evolutions and attachments, move or swap those rich stacks, reattach lower
stack members, depart any stack card into loose zones, and individually resolve
staged cards into loose zones, existing stacks, either deck edge, an exact
single-card shuffle, stadium, or a normalized new active/bench stack. It can
also atomically restore an exact
compatible staged stack to active or bench with deterministic IDs and
full event replay, drain all staged cards to discard, Lost Zone, or hand in the
exact V1 flat order, or shuffle them into/to the bottom of the deck through an
identity-translated recorded permutation. It can also open or same-viewer-extend
a private deck inspection for the exact source viewer in top order or V1
edge-first bottom order, then atomically resolve the whole inspection to discard, Lost Zone,
hand, the shuffled deck, or the shuffled deck bottom with exact recorded bases
and replay, or resolve changing individual inspection coordinates into loose
zones, existing stack tops, either deck edge, an exact recorded shuffle, or
stadium, or normalized new active/bench stacks with exact events and visibility
cleanup. Parameterless attack and pass also resolve through one atomic
canonical table command, so their internal board cleanup is not double-counted
as a source record. Direct loose-board records resolve the current ordered
board to discard, Lost Zone, hand, or an exactly recorded full-deck shuffle;
source-authentic empty records remain zero-batch mappings. Ordered GX/VSTAR
records independently toggle explicit per-player canonical marker state.
Ability records now resolve stack tops and per-card attachment/discard/stadium
targets, including source-authentic repeated no-ops and fail-closed lower
evolutions. Bounded damage records resolve active/bench tops, preserve the
serialized default and source no-ops, and reject unrepresentable per-card
coordinates. Special-condition records now resolve only exact active tops,
preserve the default, bounded editor normalization, source node no-ops, and
automatic cleanup, and reject unrepresentable targets. Tests
prove that a later
take-turn discards both players' loose boards in
source order before drawing, and that an owner reset clears only that owner's
reachable loose state, owned stadium, and play stacks before rebuilding its
deck. Opponent-owned stadium and play state remain. Custom card-back history is
now retained under ADR-013's bounded arbitrary-URL policy. Cross-owner play
placements that the current source-coordinate model cannot prove remain
fail-closed rather than being guessed.

Native undo records contain exactly `[null]`: V1 builds its filtered history in
an inner function while the outer wrapper retains `undefined`, which JSON turns
into null. The candidate retains at most 128 private pre-record
state/source-marker checkpoints for active whole-match branch entries. A
same-player undo uses
the existing `ApplySoloUndo` transition and one `UndoApplied` event, so resolved
shuffle/random outcomes are restored rather than executed. Exporter `self` is
the actor and record ownership is the announcement target. Consecutive undos
pop stackably and source state no-ops pop without a fabricated revision. If the
latest active whole-match record belongs to the other player, conversion fails
closed: replaying V1's independent per-seat array would conflict with the
approved V2 whole-match ordering rule and could erase interleaved shared state.
The eight reveal/look dispatcher actions never call `processAction`, and
`exchangeData` is explicitly filtered from `exportActionData`; they remain
envelope-known but semantically unsupported if handcrafted into a save.
Those nine impossible records return `non_exported_action`. Every genuine native
saved action family now has a strict decoder and canonical transition or
source-authentic no-op normalization; malformed card-back tuples retain typed
`cardBack.*` diagnostics.

## Next conversion slices

1. Use the implemented private-corpus runner against a representative,
   privacy-reviewed real-user corpus and approve its redacted expected
   report/state identities as compatibility evidence.
2. Only after that corpus passes should the same reviewed change deliberately
   relax the source quarantine and let the route loader or old `/import?key=`
   reader call this package. Bundle provenance must remain closed until the
   intended production consumer is separately admitted.

No v1 module is imported, no save/replay route is enabled, and no visible UI or
UX changes in this checkpoint.
