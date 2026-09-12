# Migration and delivery plan

## Strategy

Use a strangler migration around complete sessions, not around individual
in-match modules.

- v1 and v2 are separate application routes/builds and separate room protocol
  namespaces.
- A room is created as v1 or v2 and remains that version for its whole lifetime.
- v1 clients never send positional actions to a v2 room; v2 clients never import
  live v1 runtime modules.
- Existing v1 rooms finish on v1 during rollout.
- The only bridge is transactional one-way conversion of deck/save/replay data
  into normalized v2 state.
- Rollback directs new sessions back to v1. It never tries to convert an active
  v2 room back into a live v1 action stream.

This avoids the highest-risk failure mode: two authorities or identity models
mutating the same match.

## Delivery principles

- Characterize before replacing.
- Build vertical slices through core, authority, projection, client, and renderer
  before implementing every action horizontally.
- Keep changes reviewable and package-owned; no phase-long integration branch.
- Persist each accepted multiplayer command/event transaction before publishing
  acceptance. PTCG command volume is low and a lost acknowledged move is highly
  visible; write-behind is not the default.
- Instrument from the first slice, not after feature completion.
- Re-estimate after characterization and both architecture spikes.
- A phase can stop or change technology without invalidating completed domain,
  protocol, fixture, and parity work.

## Phase 0 — Blueprint audit and decision closure

Goal: make the plan safe to implement.

Work:

- Audit every document using `AUDIT.md`.
- Resolve all `BLOCKING` questions in the decision register.
- Decide top-level workspace location and deployment constraints.
- Define browser, viewport, hardware, and supported legacy-version matrices.
- Approve privacy behavior for multiplayer saves/replays and coaching/spectators.
- Confirm ownership/license terms for any direct MagicCircle code extraction;
  otherwise permit only clean reimplementation of documented patterns.
- Identify product owner, architecture owner, security reviewer, parity owner,
  and rollback authority.
- Write ADRs for renderer spike, room runtime, state snapshot strategy, guest
  identity/capabilities, and persistence durability.

Artifacts:

- accepted blueprint revision and decision log;
- risk owners and audit disposition;
- release/non-goal statement; and
- implementation issue hierarchy with dependency links.

Exit gate:

- no unowned blocking issue;
- explicit approval to proceed to characterization only; and
- no production v2 code merged before the gate.

Rollback: documentation-only; revise or stop.

## Phase 1 — Legacy characterization and safety net

Goal: make “same UI/UX and behavior” executable.

Work:

- Inventory every visible control, context-menu item, shortcut, action dispatch,
  socket event, zone transition, message, setting, and import/export format.
- Create the parity classifications and exceptions register.
- Add deterministic card/image/font fixtures and seeded randomness hooks usable
  by tests without changing production behavior.
- Build Playwright workflows/screenshots/geometry capture against v1.
- Capture v1 network traces and state/export fixtures for complex sessions.
- Add smoke tests around the known fragile paths and security probes against the
  relay/save endpoints.
- Profile representative workflows and record reference hardware.
- Freeze v1 feature work. Only critical/security/parity-harness changes continue.

Artifacts:

```text
tests/legacy-fixtures/
tests/e2e/legacy-baselines/
tests/e2e/legacy-workflows/
docs/v2-rebuild/parity-matrix.*
docs/v2-rebuild/legacy-action-catalog.*
docs/v2-rebuild/parity-exceptions.md
```

Exit gate:

- all dispatch actions in `accept-action.js` and relayed events in
  `server/server.js` are classified;
- every key shown by the existing keybind UI has a passing characterization
  test;
- protected workflows have deterministic baselines;
- at least ten representative v1 saves/replays, including attachments,
  inspection/reveal, undo, flip, spectator, and reconnect, are captured;
- known bugs are classified rather than accidentally enshrined; and
- baseline performance and payload/memory trends are recorded.

Rollback: remove/disable test hooks only if they affect production; fixtures and
findings remain useful.

## Phase 2 — Workspace, contracts, and continuous integration

Goal: create enforced boundaries without replacing user flows.

Current status (2026-09-05): substantially implemented but not exited. The
workspace, strict production project references, renderer/authority contracts,
strict Playwright project, scoped formatter and TypeScript-aware lint gate,
generated-output-free cycle check, compiler-resolved public API baseline,
source/bundle boundary checker, and required quality/Chromium CI jobs now
exist. The boundary and API checkers fail closed on unexpected workspace
exports, missing source maps,
legacy/deep imports, workspace cycles, authority code in the web artifact,
developer-only route leaks, test-fixture leaks, and drift in the canonical v2
card-back bytes. A development-only creator route now joins the actual room
creation, ticket exchange, remote runtime, presentation, and selected renderer;
its 20-cycle StrictMode integration test proves one creation and exact teardown
per mount. A complementary Chromium gate now traverses the live Vite → Wrangler
→ Durable Object HTTP/WebSocket path for one creator session and validates safe
transport URLs and clean closure. Remaining Phase 2 evidence includes production
route isolation in a real deployment and the broader ratified browser/viewport
matrix.

Work:

- Add TypeScript workspace packages and project references.
- Configure formatting, linting, strict type checking, unit/contract/browser
  test lanes, cycle checks, bundle reports, and import-boundary rules.
- Establish schema version constants and branded IDs.
- Build deterministic adapters for clock, randomness, IDs, and state hashing.
- Define the renderer-neutral `BoardRenderer` and transport-neutral
  `RoomAuthority` contracts.
- Add a v2 route shell and feature flag that is inaccessible to normal traffic.
- Retain the implemented structured diagnostic schema, no-store health probe,
  and secret-redaction/failure-isolation tests as later producers are added.

Exit gate:

- CI rejects cycles, forbidden imports, schema drift, lint/type/test failure, and
  unexpected public-package exports;
- every package builds in isolation;
- web/server test bundles do not accidentally include canonical secret helpers;
- a skeleton v2 page and in-memory test room can exchange a versioned welcome;
- production `/` remains behaviorally unchanged.

Rollback: remove the hidden v2 route; package work does not affect v1.

## Phase 3 — Normalized game core and legacy converter

Goal: prove all tabletop state can exist without DOM/image properties.

Current status (2026-09-09): the normalized core, stable identities, projection,
invariants, and all 50 live action responsibilities have substantial vertical
coverage. The isolated `legacy-import` package now admits only the frozen 1.5
and 1.5.1 action-export envelope through an exact 50-action allowlist, required
deck bootstraps, structural bounds, and typed diagnostics without executing an
action. Its first private semantic layers now validate lifecycle tuples,
materialize bounded deck definitions with deterministic order-preserving IDs,
and provide import-wide monotonic identities plus one-shot source-resolved
outcome adapters. A first all-or-nothing candidate builder now applies the
closed lifecycle/draw/discard-and-draw/shuffle-hand-and-draw/
shuffle-hand-to-deck-bottom-and-draw/direct-prize-shuffle/direct-loose-board-bulk/target-free-loose/
stadium/new-play-stack/rich-whole-stack-movement-and-swap/stack-card-reattachment/
stack-card-departure/
source-zone-targeted-play/
work-area-target-free-play/
zone-backed-deck-action/
prizes-to-deck-bottom/once-per-game-marker/ability-marker/damage-marker/special-condition-marker/rotation/category-change/resolved-random-face-down/safe-whole-match-undo/parameterless-attack-and-pass subset
through normal game-core commands and verifies exact event replay; it rejects every
unconverted family before constructing state, rejects recorded draws that exceed
the exact current source-state deck, applies only direct prize shuffles
whose recorded permutation matches the current prize zone, and resolves legacy
zone indices to stable card IDs before bottom-mode bundled movement,
target-free loose/stadium/play movement, targeted attach/evolve placement,
move-to-top, shuffle-into-deck, or switch-with-deck-top. The bottom helper is
represented by its real `moveCardBundle` export rather than a fabricated
standalone action; it moves the resolved card to canonical deck bottom and
preserves an already-bottom source as a zero-batch legacy record. Target-free
`move` bundles now append stable-resolved cards across loose player zones,
normalize supported discard/Lost Zone cover aliases, preserve same-zone tail
behavior, and accept both explicit false and JSON-serialized null targets. The
deck cover remains in move-to-top. Stadium destinations now use atomic
`MoveCardToStadium`, displacing an incumbent to its actual owner's discard and
preserving same-stadium records as zero-batch transactions. Target-free active
and bench destinations now execute `MoveCardToPlay`, creating deterministic
stacks, coercing v1's arbitrary card category to Pokémon, and atomically moving
an occupied active to the bench. Active/bench top coordinates now resolve across
rich flattened stacks and apply canonical `MovePlayStack`. Target-free
promotion, demotion, lone-bench auto-promotion, bench tail reordering, and
same-slot no-ops match v1; numeric cross-slot top targets atomically swap the
two stacks. Numeric lower-evolution and attachment sources resolve through the
same newest-to-oldest evolution order followed by versioned attachment order;
an exact stack-top target applies atomic `PlaceCardOnPlayStack`, including
same-stack reattachment and v1's lower-Pokémon-to-attachment behavior. Targeted
active/bench destinations from stable source zones now recover v1's flattened
top-card coordinate across rich stacks and apply atomic `PlaceCardOnPlayStack`
events. Lower-evolution, attachment, missing, and out-of-range targets fail the
whole candidate. Target-free top, lower-evolution, and attachment moves into
loose zones use canonical `MoveCardFromStack`; a top departure removes its stack
and stages the ordered dependents in a deterministic attachment-resolution work
area, while a lower evolution or attachment departs independently and leaves
the stack plus its marker state in place. The exact staged flat order now
supports individual moves to loose zones and numeric existing-stack targets via
`MoveStagedCard` and `PlaceCardOnPlayStack`; changing indices and empty-area
cleanup are pinned. Those same current staged coordinates now feed
`MoveCardToDeckBottom`, `MoveCardToDeckTop`, `ShuffleCardIntoDeck`, and
`MoveCardToStadium`. Deck-edge moves conceal the selected identity; single-card
shuffle passes through the exact remaining-deck-plus-selected-card V1 basis;
stadium replacement atomically displaces the incumbent to its owner's discard.
Exact event classification, residual and final cleanup, retry, replay,
concealment generations, and stale coordinate/permutation rollback are pinned.
Target-free active/bench play now composes `MoveStagedCard` to the owner's loose
board with `MoveCardToPlay` in the same closed import record. This preserves
V1's individual-card behavior, category-to-Pokémon normalization, deterministic
new-stack identity, occupied-active demotion, and residual work area without a
new core or wire shape. Staged `switchWithDeckTop` now resolves the exact current
flat coordinate. An empty deck moves only the selected card; a non-empty deck
uses a versioned internal tail-return mode that rebuilds V1's post-swap popup
order. Attachment-resolution state now carries that exact flat order alongside
its semantic evolution and attachment lists. The event carries both the exact
returned flat list and the right-to-left V1 `leaveAll` classification, while
omitted historical events retain positional replacement. Category-interleaved
tails therefore remain coordinate-, replay-, and reconnect-safe. Exact
`leaveAll` tuples now consume a compatible staged
stack through `RestoreStagedStack`, snapshot the full board layout, allocate a
deterministic replacement stack, and preserve v1 active/bench placement,
including occupied-active demotion. Missing, attachment-only, and category-
ambiguous staged shapes fail the whole transaction. Exact staged `discardAll`,
`lostZoneAll`, and `handAll` records now drain stable IDs through bounded
`MoveStagedCard` batches in V1's newest-lower-to-base-then-attachment flat
order; the candidate remains all-or-nothing, and hand concealment is preserved.
Exact staged `shuffleAll` and `shuffleBottom` records now translate their
recorded permutations by stable card identity from that V1 flat basis to the
canonical evolution-then-attachment command basis. `shuffleAll` includes the
existing deck in both bases; `shuffleBottom` permutes only staged cards before
the unchanged deck prefix. Both execute through atomic `ResolveStagedCards`.
Exact `viewDeck` records now execute `ExtractDeckCardsForInspection` against the
recorded current-deck-count witness. Source `user` remains the deck owner, the
decoded initiator is the sole viewer, and `targetIsOpp` must agree with that
relationship. Top views preserve deck order; bottom views preserve V1's
edge-first descending order. A repeated positive view carries the exact active
inspection card order and per-card viewer map into replay-safe
`InspectionExtended`, appending the newly selected edge cards without allocating
another work area or inspection ID. The same viewer retains prior visibility;
a different viewer conceals prior cards, rotates their opaque identities, and
sees only the new batch. The historical zero-card export remains a zero-batch
record for the same viewer and emits `InspectionVisibilityCleared` for a
different viewer. Exact
`viewCards` forms of `discardAll`, `lostZoneAll`, and `handAll` now resolve the
entire inspection through one atomic `ResolveInspectionCards` batch, preserving
the V1 popup order and closing the work area. The corresponding `shuffleAll`
and `shuffleBottom` forms validate their complete recorded basis and pass it
through unchanged because canonical inspection order now matches V1 order:
full-deck shuffle uses the remaining deck followed by inspected cards, while
bottom shuffle permutes only inspected cards after the unchanged deck prefix.
Missing work areas and stale permutations fail the whole candidate. Individual
`viewCards` move bundles now resolve the card at its exact current inspection
index after every prior mutation. Loose destinations execute
`MoveInspectedCard`; a numeric active/bench stack-top target executes
`PlaceCardOnPlayStack` with evolution versus attachment derived from the card's
current category. A target-free active/bench destination composes
`MoveInspectedCard` to the owner's loose board with `MoveCardToPlay`; the second
batch creates a deterministic normalized singleton stack and preserves
occupied-active demotion. The temporary loose-board hop is consumed inside the
same private import record. The last departure closes the inspection and
retires its viewer grant. Missing/stale coordinates and targets fail the whole
candidate.
The same current-coordinate resolver now admits V1's inspection-origin deck
bottom, deck top, shuffle-into-deck, stadium, and deck-top-swap paths. Deck-edge
moves conceal the selected identity; shuffle validates and passes through the
exact basis of the remaining deck plus selected card; stadium replacement
atomically displaces the incumbent to its owner's discard. Inspection-origin
`switchWithDeckTop` opts into source-tail return on the existing atomic swap:
the selected card becomes deck top and the prior deck top is appended after the
remaining popup cards. The empty-deck branch moves only the selected card to
deck top. Native callers and historical events retain source-position return by
default, so no wire shape changes. Exact events, inspection/grant order,
cleanup, retry, replay, concealment generations, stale-coordinate rollback, and
stale-permutation rollback are pinned.
Reachable tests now prove both-player
loose-board take-turn cleanup plus owner-scoped loose/stadium/play reset/rebuild
behavior.
Exact empty-tuple `attack` and `pass` records now reuse the canonical atomic
table commands. The source record owner selects the target player; the command
resets all ability markers, discards only that player's loose board, preserves
turn/card-face state, and emits one replayable table declaration. Strict
decoder, self/opponent candidate, retry/replay/hash/invariant, malformed-tuple,
and real-V1 button/export/browser coverage are pinned without a schema change.
Exact `discardBoard`, `handBoard`, `lostZoneBoard`, and `shuffleBoard` tuples now
reuse `ResolveLooseBoardCards`. Nonempty records snapshot the exact current
board; shuffle additionally validates and consumes the recorded permutation
over the current deck-plus-board basis. Empty records preserve V1's exported
no-op as zero batches, including the JSON-serialized null shuffle sentinel.
Destination order, concealment, self/opponent targeting, deterministic retry,
replay, and stale-permutation rollback are pinned without a schema change.
Exact `VSTARGXFunction` records now decode only shipped `GX`/`VSTAR` tuples and
derive the explicit target boolean from the preceding candidate state before
executing `SetOncePerGameMarker`. Repeated toggles, marker/player independence,
exact events, deterministic retry/replay/hash/invariants, malformed rollback,
and real-V1 control/export behavior are pinned without a schema change.
Exact `useAbility` and `removeAbilityCounter` records now decode the four
source-accessible zones and current flat card coordinates. Stack tops reuse
`SetAbilityUsed`; attachments, discard cards, and owned stadium cards reuse
`SetCardAbilityUsed`. Already-matching use/removal records retain zero batches,
while stale, cross-owner stadium, and lower-evolution coordinates fail the
whole candidate. Exact events, deterministic retry/replay/hash/invariants,
malformed rollback, and existing real-V1 marker/export behavior are pinned
without a schema change.
Exact damage add/update/remove records now decode only active/bench coordinates
and bounded values under the approved V2 input policy. Serialized-null add
defaults to `10`; positive decimal edit strings map through `SetDamage`, while
empty/zero/negative updates remove. Existing-add, duplicate-update, and
missing-remove state no-ops retain zero batches; missing-update and non-top
coordinates fail the whole candidate. Both players/zones, exact events,
deterministic retry/replay/hash/invariants, malformed/free-form input, and the
existing real-V1 editor/export behavior are pinned without a schema change.
Exact special-condition add/update/remove records now decode only current active
stack-top coordinates. Add defaults to `P`; bounded edit strings reuse the
approved trim/empty-or-zero-removal policy and `SetSpecialCondition`. Existing
add, duplicate update, and missing removal remain zero-batch source records;
markerless updates fail closed. A private exact-top presence map preserves
transient null edits while recognizing V1's automatic cleanup on evolution or
active-slot departure. Both players, exact events, deterministic
retry/replay/hash/invariants, malformed rollback, and existing real-V1
editor/movement behavior are pinned without a schema change.
Exact rotation records now decode only the shipped active/bench group-or-single
and stadium group modes. Current flat play coordinates resolve an exact stack
card; group records advance `RotateStack`, single records toggle that card's
q0/q1 `SetCardOrientation`, and stadium records advance the exact owned card's
orientation modulo four. This reuses the production V2 keyboard normalization
and intentionally excludes hidden V1 DOM angle/margin/BREAK history. Exact
events, top/lower/attachment/stadium targeting, evolution cleanup,
deterministic retry/replay/hash/invariants, malformed/stale rollback, static
source locks, and existing real-runtime oracles are pinned without a schema or
UI/UX change.
Exact `changeType` records now decode the exported
`[initiator, zone, index, category]` tuple for every card-selectable source:
deck, hand, prizes, discard, Lost Zone, loose board, active, bench, staged
attachments, inspection cards, and stadium. The source record's `user` owns
the target; the exported initiator remains presentation provenance only. Exact
current coordinates feed the existing atomic `ChangeCardCategory` command,
which moves the selected card to the owner's loose-board tail, applies the
current Pokémon/Trainer/Energy category, and clears transient orientation and
ability state while retaining the original category for later movement
normalization. Stack tops stage their dependents; attachments, staged cards,
and inspection cards depart through their canonical paths. An already-matching
board-tail record remains a zero-batch source no-op. Zone-cover aliases, lower
evolutions, stale or cross-owner coordinates, and malformed categories fail
the complete candidate. Exact events and order, both-player provenance,
deterministic retry/replay/hash/invariants, rollback, and static source behavior
are pinned without a core, protocol, renderer, route, UI, or UX change.
Exact `playRandomCardFaceDown` records now decode only
`[initiator, randomIndex]`. V1 saves the already-resolved hand index; the
importer supplies it exactly once through the existing action-scoped random
adapter instead of choosing a new card. Record `user` selects the target hand
and board, while the exported initiator selects the canonical actor. The
existing `PlayRandomCardFaceDown` command snapshots current hand/board order,
moves that exact card to the board tail face down, clears transient orientation
and ability state, retires visibility, and emits the replay-safe
identity-bearing event only inside the trusted candidate. Empty/depleted hands,
out-of-range or later-stale indices, capacity failures, and malformed tuples
reject the whole candidate. Exact events, changing indices, cross-player actor/target pairs,
deterministic retry/replay/hash/invariants, and static source behavior are
pinned without a core, protocol, authority, state, renderer, route, UI, or UX
change.
Native `undo` records now decode only the single JSON-null placeholder produced
when V1 serializes the wrapper's untouched `undefined` history argument. The
candidate retains at most 128 private checkpoints for admitted source records and maps a
safe undo to the existing `ApplySoloUndo` command, producing one replayable
`UndoApplied` event without rerunning a shuffle, random selection, or prior
command. Export perspective supplies the actor as `self`, while record `user`
retains the board-flipped announcement target. Consecutive same-player undos pop the active branch; source no-ops pop
without inventing a revision. Because V1 kept independent per-player action
arrays while V2 deliberately uses authoritative whole-match ordering, an undo
fails the complete import when the active checkpoint belongs to the other
player. Private source marker-presence metadata is restored with the checkpoint
so later edits cannot bypass source preconditions. Static source locks and the
real-runtime shortcut oracle pin the null serialization, deck boundary,
duplicate suppression, and unchanged UI behavior. No core, protocol,
authority, state, renderer, route, UI, or UX change is required.
Shuffle-into-deck translates v1's in-deck tail-move
permutation basis to the canonical input order. Switch-with-deck-top preserves
v1's source-tail return and empty-deck branch through one or two canonical
batches instead of using the old-index-replacing live swap command.
Shuffled-prizes-to-deck-bottom requires the recorded non-empty permutation to
match the current prize count and applies one atomic canonical batch that
preserves the deck prefix, appends prizes in recorded order, and conceals them.
Discard-and-draw validates v1's already-clamped count against the exact current
deck, then atomically appends the ordered hand to discard and draws/conceals from
deck index zero; zero remains a valid discard-only branch.
Shuffle-hand-and-draw validates the recorded count and complete permutation
against the exact current deck-plus-hand source, then consumes that deck-first,
hand-tail order directly through one atomic canonical command. Zero-draw and
completely empty shuffles remain valid, and all shuffled identities are
concealed.
Shuffle-hand-to-deck-bottom-and-draw validates the already-clamped count against
the exact deck-plus-hand total and the recorded hand-only permutation against
the exact current hand. It preserves the existing deck prefix, appends the
shuffled hand, and draws from index zero through the matching atomic canonical
command. Zero-draw, empty-hand/non-empty-deck, and completely empty records all
remain valid.
The public byte-oriented conversion transaction now copies and bounds source
bytes, hashes bounded input exactly with SHA-256, performs fatal UTF-8 admission,
and returns either complete canonical state/records plus a versioned report or a
path-specific report with no partial state. Target integrity is separately
defined as SHA-256 over UTF-8 `stableSerialize(state)` bytes. Reports count
records/batches/events/no-ops and enumerate intentionally omitted V1 transport
and presentation metadata. The transaction remains unwired from routes. The
source boundary rejects any production, optional, or peer runtime dependency on
`@ptcgsim/legacy-import`, and both production bundle provenance policies reject
emitted importer modules. Route activation must deliberately revise those gates
after compatibility evidence is approved.
An operator-only corpus runner now processes private exports sequentially under
the same transaction and a fixed anonymous target. It emits deterministic
digest-keyed conversion, action-family, and failure evidence without source
paths, filenames, raw JSON, deck/card names, image URLs, or diagnostic messages;
raw in-repository input is allowed only below an ignored private directory.
Synthetic tests prove its privacy and fail-closed boundaries. No real-user
corpus or approved baseline is present, so representative evidence remains an
open Phase 3 exit gate.
The eight reveal/look dispatcher names are transient socket/UI operations and
never enter native V1 export history; `exchangeData` is explicitly filtered by
the exporter. They remain allowlisted at the frozen envelope boundary but fail
semantic conversion with `non_exported_action` if injected. The final genuine
saved family, `changeCardBack`, now retains its exact bounded URL and emits an
ordered canonical card-back event; replay and whole-match undo preserve the
prior/final values without any server or importer fetch. Unprovable cross-owner
play remains fail-closed; that correction, representative real-user corpus
evidence, and route installation remain before Phase 3 can exit.

Work:

- Implement state schema, constructors, serializers, stable IDs, zone ordering,
  relationship graph, work areas, markers, and invariants.
- Implement command decisions/event application in vertical families: lifecycle
  and movement; play stacks; markers/properties; inspection/visibility; randomized/bulk;
  history/table signals.
- Implement role projections and concealed-handle epochs.
- Port the pure deck-builder core and strengthen CSV/dirty/unload behavior.
- Maintain the isolated v1 interpreter/converter and versioned conversion
  reports while corpus evidence expands.
- Differentially run characterized action scenarios through v1 fixtures and v2
  reducers, comparing semantic normalized outcomes rather than DOM details.

Exit gate:

- every cataloged v1 domain action maps to a v2 command, local presentation
  intent, chat/presence message, approved exception, or explicit deferred item;
- invariant/property tests cover arbitrary valid command sequences;
- canonical serialization/hash is deterministic across Node and browser;
- projection leak/differential tests pass for every zone and role;
- 100% of supported valid legacy fixtures convert to their expected semantic
  states; invalid fixtures fail without partial state;
- no core package imports browser/network/storage/rendering code.

Rollback: none required; the package is unused by production v1.

## Phase 4 — Renderer and room-runtime decision spikes

Goal: retire the two biggest technology uncertainties before full investment.

### Renderer spike

Implement the same representative fixture behind the renderer-neutral interface
using:

1. normalized keyed React DOM/CSS; and
2. raw imperative PixiJS with React DOM overlays.

Include active/bench/hand/prizes, covers, free board, stadium, attachments,
evolution, rotation, counters, selection, drag/drop, flip, split resize, one zone
browser, image failures/custom CORS behavior, context loss for Pixi, and
accessibility test hooks.

Choose against the gates in the client and verification documents. Pixi must
materially improve consistency/performance enough to justify CORS, texture,
context-recovery, and canvas-accessibility costs. Record the decision; do not
choose based on preference alone.

ADR-004 now selects normalized stable-keyed React DOM for the first production
renderer. The raw Pixi implementation remains an unwired comparison and does
not block renderer-neutral domain/session work. The remaining visual,
accessibility, asset, churn, and physical-device evidence gates production
wiring rather than reopening the technology choice by default.

### Room-runtime spike

Implement hello/welcome, guest seat capability, one command, durable commit,
per-recipient projection, publication-before-result ordering, duplicate command,
disconnect/reconnect, room hibernation/restart, and a spectator in:

- the preferred Worker + Durable Object runtime; and
- a narrowly scoped Colyseus comparison only if hosting/team constraints keep it
  viable.

Measure operational complexity, local development, persistence guarantees,
latency, cost model, observability, deployment rollback, and MagicCircle pattern
reuse.

Exit gate:

- one renderer and room runtime are accepted by ADR;
- every spike success criterion passes on reference environments;
- custom/external image policy and fallback are decided;
- no unresolved context-loss/private-texture leak issue;
- durable recovery proves no acknowledged command loss; and
- estimates and remaining phases are recalibrated.

Rollback: discard spike implementations after preserving measurements and
contracts. A failed Pixi spike may select React DOM without changing the core or
server architecture.

## Phase 5 — Complete solo/local parity

Goal: replace the internal tabletop for single-player use behind `/v2`.

Work in vertical slices:

1. Application shell and exact legacy layout/styles.
2. Deck load, card instances, setup/reset.
3. Select/preview/context/keyboard.
4. Move/drop, covers, zone viewers and sorting.
5. Active/bench, evolution, attachments, temporary work areas.
6. Counters, conditions, abilities, rotation/category/face state.
7. Shuffle/draw/bulk moves, turn/coin/attack/pass, VSTAR/GX.
8. Board flip, split resize, full screen, settings/themes.
9. Solo undo/replay and complete accessibility bridge.

Implemented opt-in entry checkpoint: the existing Solo tab behind
`?room-lobby=1` now creates the persisted one-player authority and enters the p1
shell. Undo and both-side lifecycle controls reuse the existing authority
commands; both-side actions wait for the first acknowledged projection before
submitting the second. Multiplayer navigation parks and restores that same Solo
runtime, and session-aware Deck custody prevents a clean parked deck from being
destructively reinstalled. This is still an opt-in slice, not the broader v2
rollout or a claim that every Phase 5 interaction is complete.

Every slice includes reducer, render model, renderer/UI, event/message mapping,
tests, fixtures, instrumentation, and parity review. Do not create a separate
“testing phase” for missing slice tests.

Exit gate:

- all Solo-mode `MUST_MATCH` behaviors and visual/geometry tests pass;
- no logical mutation exists in React/Pixi/DOM code;
- repeated setup/reset and long solo soak meet resource budgets;
- forced reload/restoration of local authority loses no committed state where
  persistence is promised;
- manual parity review passes in the browser matrix.

Rollback: hide `/v2`; v1 remains default.

## Phase 6 — Authoritative multiplayer and spectator parity

Goal: replace peer replication with safe room authority.

Work:

- Extend the implemented room/session/seat capability lifecycle and version
  negotiation. The current boundary already provides digest-only 30-second
  socket tickets, atomic one-time redemption, resume rotation, same-origin
  no-store HTTP exchange, a strict durable room-creation exchange, immediate
  creator bootstrap, non-serializing master-credential custody, and bounded
  digest-only 15-minute guest invitations. Invitation-to-ticket retries rotate
  the prior ticket; final socket admission atomically consumes both records.
  Schema v7 additionally persists a mode-bound one-player ceiling for solo
  rooms. The first claim retires all losing-seat credentials; every player
  session must be the durable claim for its seat; and the persistence adapter
  validates each admission kind against the exact predecessor before writing.
  Retain accepted ADR-020 foreground clipboard transfer: strict branded text is
  written without returning the bearer to UI code, native paste prevents DOM
  insertion, private guest custody survives a retry and clears on success, a
  room code alone never authorizes, player copies rotate, and spectator copies
  are distinct. The unchanged lobby shape is now wired behind the isolated
  production-built `?room-lobby=1` flag with bounded Room ID input, safe status,
  role reflection, initial coaching-consent submission, and lifecycle ownership;
  its direct-custody and visible-control multi-context browser gates must remain
  green before broader rollout. The connected portion now binds the unchanged
  Attack, Pass, flower, chat, Set Up, Reset, and Leave Room controls to
  authenticated session APIs, with spectator mutation controls absent, replay
  isolation, failed-chat retention, the exact leave confirmation, durable leave,
  and fresh post-leave custody. The live Solo header tab also retains its
  distinct source confirmation and delegates to that same teardown without
  affecting Replay. The local live/replay Options subset additionally
  exports the recipient-safe effective battle log and requests browser full
  screen; Clear remains live-only and resets only local presentation.
  Perspective replay export and an unwired byte-safe, atomically installed
  replay-file import transaction are implemented; browser file selection and
  server-held continuation remain later work. Deck navigation is live behind the same
  opt-in query-gated route, with first-use chunk isolation and retained
  deck/card-back custody across lobby/live/Leave. The first
  Settings slice restores tab ownership plus page-local Dark mode and Hide
  containers across lobby/live/replay without authority or storage traffic;
  the follow-on slice restores the source Solo-only hand checkbox as an explicit
  multiplayer no-op plus static keybind/contact content without disclosure or a
  third-party image request. Accepted ADR-013 restores Change background through
  a direct player-selected, preloaded, page-local DOM/CSS image. The URL is never
  synchronized or persisted; the selecting browser's direct contact with that
  host is an explicitly accepted parity tradeoff. The broadened ADR binds the
  active Deck route to direct arbitrary custom-card faces and public custom card
  backs through native DOM loading; it rejects a mandatory allowlist, proxy, or
  CORS opt-in. Exact URL, publication, recipient-visibility, and hidden-face
  request gates cover that route.
- Retain the implemented layered abuse controls: a coarse location-local edge
  creation budget plus exact persisted per-room invitation, ticket, upgrade, and
  `Hello` budgets. Retain the atomic five-minute unclaimed lifecycle/alarm,
  first-admission cancellation, and retry-safe deletion tombstone. Preview load
  evidence and alert thresholds remain required before the lobby can target v2.
- Implement schema validation, role authorization, rate limits, idempotency,
  client sequencing, durable transaction pipeline, projection publication, and
  typed rejection.
- Integrate the implemented `packages/client-session` controller, which owns
  bounded gap-free commands, byte-identical ambiguity retries, heartbeat,
  authoritative replacement, generation-safe reconnect, and supersession.
  Add stale presentation-intent cancellation at the application boundary.
- Implement opponent-action request semantics, coaching/flip behavior, presence,
  chat, spectator projection, and hidden inspection/reveal. Preserve the current
  absence of multiplayer undo unless a separate product ADR authorizes it.
- Build deterministic two/three-client simulations and browser contexts.
- Connect the implemented closed server telemetry/health boundary to operational
  dashboards, destinations, and alerts before external beta use. Ratify the
  provisional thresholds and rehearse `apps/server/OPERATIONS.md`; add
  client/renderer/import/save events only with their owning slices.

Exit gate:

- multi-client state hashes never diverge under reordered/duplicated/dropped
  transport tests;
- no unauthorized role can mutate state or receive secret fixture values;
- reconnect/restart meets recovery objectives with no acknowledged loss;
- pending interactions recover cleanly from rejection/disconnect;
- spectator and coaching parity matrices pass;
- rate/size/abuse tests pass without harming a normal room.
- solo replay disclosure is reachable only through a durably single-player room
  and a second human cannot claim the other canonical board.

Rollback: disable v2 multiplayer room creation; solo v2 may remain available if
approved. Active v2 rooms may finish or receive a maintenance close with a v2
save; they are never silently moved to v1.

## Phase 7 — Saves, replay, sharing, and compatibility

Goal: make v2 sessions durable and legacy data safe to carry forward.

Current status (2026-09-12): ADR-012 is accepted. The first bounded archive
slice serializes only the authority-produced role projection into a
deterministic, SHA-256 integrity-checked, version/size-bounded file explicitly
marked non-canonical and non-resumable. The existing Export game state control
works in live and replay mode; live export requests a fresh artifact without
changing the effective board. The unwired import boundary now owns bounded raw
bytes before asynchronous work, rejects malformed UTF-8, validates the exact
file-v1 envelope/integrity/privacy/semantics, and installs playback atomically
only if its initiating live identity is still current. A checked-in spectator
artifact pins compatibility. File-selection/import UI stays disabled pending
its browser gate. Canonical multiplayer continuation remains server-held and
unwired pending its encryption,
role-capability, retention, recovery, quota, and abuse slices.

Work:

- Implement versioned snapshots, journal chunks, recovery, retention, and
  integrity verification.
- Implement high-entropy share/save capabilities, TTL/limits/revocation, and
  encrypted/server-hosted multiplayer continuation policy.
- Extend the implemented authoritative replay ledger, role-projected streaming,
  client artifact assembly, renderer-neutral playback controller, and
  live/replay application coordinator/board guard and implemented
  `RemoteRoomRuntime`/`RemoteRoomRoute` by completing save/replay import-export,
  navigation, and focus/keyboard/visual parity. Authenticated connected chat,
  the player/spectator action boundary, and the local live/replay
  battle-log/fullscreen Options subset are already mounted in the isolated lobby
  route.
  Reuse the implemented ADR-018 browser ticket bootstrap, mounted legacy chrome,
  presentation surface, bounded stores, keyed feed, serial consumers, and
  live-region dwell.
  The legacy coin action is log-only, so retain the implemented no-motion
  acknowledgement adapter; adding a separate coin visual requires an approved
  parity exception. Preserve the
  implemented recipient-safe actor/scope/source facts and spectator-public
  single-reveal names while adding long-retention journal chunks and remaining
  import formats. The v1-shaped export control now writes the accepted
  perspective replay format.
- Expose v1 conversion through an isolated upload/import transaction.
- Add storage migration rehearsal, corrupt/truncated data recovery, quotas, and
  cleanup jobs.

Exit gate:

- all persistence and legacy compatibility contract tests pass;
- a saved match resumes to the same canonical hash and role projections;
- restore from newest snapshot plus journal tail survives injected interruption;
- corrupt/oversized/decompression-bomb inputs fail safely;
- public or role-projected replay contains no hidden data;
- share tokens cannot be feasibly guessed and expired/revoked links fail closed.

Rollback: disable new saves/imports separately; existing v2 data remains readable
by the previous compatible server deployment.

## Phase 8 — Hardening, parity closure, and release candidate

Goal: demonstrate the rebuild is faster and more reliable, not merely newer.

Work:

- Close all non-deferred parity differences or approve explicit exceptions.
- Run performance tuning based on traces, not architectural rewrites.
- Conduct security review/threat modeling of rooms, hidden info, direct external
  images, chat, imports, saves, admin/observability, and dependencies.
- Run browser/device checks, accessibility audit, load/fault tests, two-hour CI
  soaks, and 24-hour pre-release soak.
- Exercise deploy/rollback, mixed build/protocol, storage restore, and incident
  runbooks in staging.
- Produce user-neutral release notes: internal changes and any security-required
  behavior exceptions only.

Exit gate: every release criterion in the verification document passes with
attached evidence and named sign-off.

Rollback: deploy the last compatible v2 build or stop new v2 cohorts; v1 remains
available until Phase 10.

## Phase 9 — Cohort rollout and cutover

Goal: increase v2 traffic without risking all sessions at once.

Suggested stages:

1. Maintainers and automated synthetic rooms.
2. Opt-in local/solo users.
3. Opt-in multiplayer rooms with a visible beta flag outside the in-game UX.
4. Sticky 5%, 25%, 50%, then 100% of **new** room creation.
5. Make v2 default while retaining an explicit v1 fallback window.

Cohort assignment is sticky for the complete room and both participants. Pause
automatically/manual on error, reconnect, invariant, latency, memory, hidden-data,
or save-failure thresholds. Compare v1/v2 operational metrics, but never mirror
real hidden commands into an unauthorized shadow client.

Cutover gate:

- at least two stable release cycles at full new-room traffic;
- no unresolved severity-1/2 incident or data/privacy issue;
- success/error/reconnect/resource metrics meet budgets;
- save/replay compatibility and rollback are still exercised; and
- product owner explicitly approves v1 deprecation.

## Phase 10 — Legacy retirement

Goal: remove v1 only after v2 has proven stable.

- Stop creating v1 rooms, then wait beyond maximum room/save compatibility
  window.
- Archive a tagged v1 build and immutable fixtures.
- Keep the supported legacy converter, not the live v1 action runtime.
- Remove legacy client/server dependencies, iframe HTML, relay handlers, and v1
  deployment configuration in separately reviewable commits.
- Re-run dependency, license, security, and dead-code scans.
- Document the last supported v1 import version and retention deadline.

Rollback after final data deletion may be impossible, so deletion/retention is a
separate explicitly approved operation.

## Effort and staffing model

Until Phase 1/4 evidence exists, use a planning range rather than a deadline:

| Workstream                            | Rough engineer-weeks | Main uncertainty                                  |
| ------------------------------------- | -------------------: | ------------------------------------------------- |
| Characterization and foundations      |                  4–6 | Hidden behaviors and deterministic legacy harness |
| Core, projection, conversion          |                  4–6 | Attachment/work-area/undo semantics               |
| Renderer spike and full parity        |                 6–10 | DOM-vs-Pixi result, CORS, browser parity          |
| Authority, persistence, compatibility |                  6–9 | Hosting and multiplayer save/undo policy          |
| Hardening and rollout                 |                  4–6 | Defect rate and real-world assets/devices         |

Total planning range: roughly **24–37 engineer-weeks**, with parallelism between
domain/network and renderer/parity after contracts stabilize. Two experienced
engineers plus review support should plan for approximately four to six calendar
months; one engineer should expect substantially longer. These are confidence
ranges, not commitments, and are re-estimated at both explicit gates.

## Work-in-progress limits

- Only one change at a time may alter a given state or wire schema.
- At most one unintegrated vertical slice per workstream.
- Every slice lands behind a disabled flag with tests and migration notes.
- Avoid long-lived branches that duplicate schema or fixture edits.
- Parallel reviewers may propose changes, but one named owner resolves each
  decision and updates all affected contracts atomically.
