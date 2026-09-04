# Legacy synchronized action map

Status: preliminary architectural mapping. Phase 1 adds exact positional schemas,
preconditions, event sequences, messages, visibility, undo/replay behavior,
fixtures, and preserve/fix decisions from executable characterization.

The dispatcher in `client/src/setup/general/accept-action.js` contains 50 named
entries. Every one is accounted for below so a rewrite cannot accidentally omit
a hard-to-find behavior. Proposed names are not final APIs.

## Session, deck, and lifecycle

| v1 action        | Proposed v2 responsibility                                                         | Critical characterization                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `exchangeData`   | Admission/session configuration plus `ConfigureSeat`; not a peer game-action relay | Username, deck/card-back exchange, coaching consent, side perspective, log reset                                       |
| `loadDeckData`   | Privileged/pre-match `LoadDeck` transaction                                        | Deck replacement, instance creation, self/alternate data, covers, reset/export boundary                                |
| `changeCardBack` | Seat/render asset setting through validated catalog/policy                         | Self/opponent selection, old saves, failed/custom URL                                                                  |
| `reset`          | Atomic `ResetSeat` or `ResetMatch` command                                         | Which zones/markers/work areas/log/turn fields reset; current shared-turn side effect                                  |
| `setup`          | Atomic `SetupSeat` resolved events                                                 | Reset, authority shuffle, seven-card hand, up to six prizes, short deck, message                                       |
| `takeTurn`       | Atomic `StartTurn` resolved events plus safe timeline                              | Clears loose board cards, resets ability markers, reveals in-play face-down cards, turn increment, draw/no-deck branch |

## Card movement, inspection, and zone batches

| v1 action                   | Proposed v2 responsibility                                                                                                 | Critical characterization                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `draw`                      | `DrawCards` using authority-resolved deck top                                                                              | Count validation/clamp, empty/short deck, hidden identities, message grammar                                   |
| `moveCardBundle`            | Intent resolves to `MoveCard`, `MoveStack`, `AttachCard`, `EvolveCard`, `ReplaceStadium`, or active/bench swap event batch | Every source/destination, target, cover, stack/work-area/counter/face/category effect and message              |
| `shuffleIntoDeck`           | Atomic `ShuffleCardIntoDeck`                                                                                               | Source removal/stack policy, full authority permutation, concealment generation                                |
| `moveToDeckTop`             | `MoveCardToDeckTop`                                                                                                        | v1 index-zero top convention, visibility clearing, stack policy                                                |
| `moveToDeckBottom`          | `MoveCardToDeckBottom`                                                                                                     | v1 last-index bottom convention, visibility clearing, stack policy                                             |
| `switchWithDeckTop`         | Atomic `SwapCardWithDeckTop`                                                                                               | Empty/one-card deck, original destination, concealment, message                                                |
| `viewDeck`                  | `ExtractDeckCardsForInspection`                                                                                            | Top/bottom selection, count clamp, target's deck, inspection viewer, ordered holding work area                 |
| `shuffleAll`                | `ResolveStagedCards(shuffleIntoDeck)` or `ResolveInspectionCards(shuffleIntoDeck)`                                         | Supported sources (deck/discard/view/detached), messages, popup close, no-op                                   |
| `shuffleBottom`             | `ResolveStagedCards(shuffleToDeckBottom)` or `ResolveInspectionCards(shuffleToDeckBottom)`                                 | Shuffle only selected source cards, bottom order relative to existing deck, visibility generation              |
| `discardAll`                | `ResolveStagedCards(discard)` or `ResolveInspectionCards(discard)`                                                         | Detached/viewed source semantics, order, card category reset, message                                          |
| `lostZoneAll`               | `ResolveStagedCards(lostZone)` or `ResolveInspectionCards(lostZone)`                                                       | Same dimensions as discard, label/message differences                                                          |
| `handAll`                   | `ResolveStagedCards(hand)` or `ResolveInspectionCards(hand)`                                                               | Hidden owner view, opponent projection, order, message                                                         |
| `leaveAll`                  | `RestoreStagedStack`                                                                                                       | Reconstruct evolution order and attachments into active/bench, selected destination, marker/rotation semantics |
| `discardAndDraw`            | Atomic `DiscardHandAndDraw`                                                                                                | Zero count, clamps, order, hidden data, message                                                                |
| `shuffleAndDraw`            | Atomic `ShuffleHandIntoDeckAndDraw`                                                                                        | Authority permutation, requested count, empty/short cases, concealment handles                                 |
| `shuffleBottomAndDraw`      | Atomic `PutHandOnDeckBottomAndDraw`                                                                                        | Which subset is shuffled, bottom/top convention, draw after placement                                          |
| `shufflePrizesToDeckBottom` | Atomic `MovePrizesToDeckBottom`                                                                                            | Prize ordering/randomization, concealment, empty prizes                                                        |
| `shuffleZone`               | `ShuffleZone` resolved permutation event                                                                                   | Every allowed zone, deterministic legacy indices, new handle generation, safe timeline                         |

## Markers and card/stack state

| v1 action                | Proposed v2 responsibility                          | Critical characterization                                                                        |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `useAbility`             | `SetAbilityUsed(true)` plus projected timeline fact | Which zones/cards allow it, marker placement, visible card name, repeated use                    |
| `removeAbilityCounter`   | `SetAbilityUsed(false)`                             | Missing marker/no-op and move/reset behavior                                                     |
| `addDamageCounter`       | `SetDamage(default-or-value)`                       | Default 10, editable text coercion, allowed target, rendering only after acceptance              |
| `updateDamageCounter`    | `SetDamage(value)`                                  | Empty/non-numeric/negative/current loose behavior and approved bounded v2 policy                 |
| `removeDamageCounter`    | `SetDamage(null/0)`                                 | Blur/automatic move cleanup and message behavior                                                 |
| `addSpecialCondition`    | `SetSpecialCondition(default)`                      | Default poison, active-only shortcut rules, marker/color mapping                                 |
| `updateSpecialCondition` | `SetSpecialCondition(value)`                        | P/B/Pa/C/A cycle, free-form content today, normalization/bounds decision                         |
| `removeSpecialCondition` | `SetSpecialCondition(null)`                         | Empty/zero/Alt behavior and automatic move/evolution cleanup                                     |
| `rotateCard`             | `RotateStack` or `SetCardOrientation`               | Whole stack versus individual/BREAK orientation, quarter-turn convention, face/zone restrictions |
| `changeType`             | `ChangeCardCategory`                                | Pokémon/Energy/Trainer shortcuts, atomic loose-board departure, original category restoration    |
| `VSTARGXFunction`        | `SetOncePerGameMarker`                              | Independent VSTAR/GX state, used styling, policy-gated self/opponent control, reset              |

## Loose board batches

| v1 action       | Proposed v2 responsibility                | Critical characterization                                      |
| --------------- | ----------------------------------------- | -------------------------------------------------------------- |
| `discardBoard`  | `ResolveLooseBoardCards(discard)`         | Both-board turn cleanup, ownership destination, order/messages |
| `handBoard`     | `ResolveLooseBoardCards(hand)`            | Ownership versus board placement, hidden projection            |
| `shuffleBoard`  | `ResolveLooseBoardCards(shuffleIntoDeck)` | Per-board deck, authority permutation, message batching        |
| `lostZoneBoard` | `ResolveLooseBoardCards(lostZone)`        | Ownership destination and ordering                             |

## Visibility and per-card shortcuts

| v1 action                | Proposed v2 responsibility                                           | Critical characterization                                                                   |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `lookAtCards`            | `BeginZoneInspection` grant; view-only unless a work area is created | Viewer/target combinations, hand/prize zones, coaching, relay timing                        |
| `stopLookingAtCards`     | `EndPrivateInspection(inspectionId)`                                 | What becomes concealed, reconnect lifetime, movement/reset invalidation                     |
| `revealCards`            | `RevealZonePublicly`                                                 | Exact audience, card faces/names, logs, later move/hide cleanup                             |
| `hideCards`              | `EndZoneReveal`                                                      | Handle generation and destination/default face behavior                                     |
| `revealShortcut`         | `RevealCardPublicly(viewCardId)`                                     | Selected hidden card, prize/hand/board constraints, logs                                    |
| `hideShortcut`           | `HideCard(viewCardId)`                                               | Who may hide, face-down in-play versus zone concealment, public flag cleanup                |
| `lookShortcut`           | `BeginCardInspection(viewCardId)`                                    | Exact source, private viewer, opponent card capability, asset/catalog lifecycle             |
| `stopLookingShortcut`    | `EndPrivateInspection(inspectionId)`                                 | Viewer-scoped close, re-conceal timing, and stale handle behavior                           |
| `playRandomCardFaceDown` | `PlayRandomCardFaceDown`                                             | Authority chooses source card; destination/position; no identity leak in public event/error |

## Timeline and history

| v1 action | Proposed v2 responsibility                                     | Critical characterization                                                                                                     |
| --------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `attack`  | Atomic `DeclareAttack` plus safe timeline event                | Reset all ability markers, discard the acting loose board, preserve turn/faces, announcement                                  |
| `pass`    | Atomic `PassTurn` plus safe timeline event                     | Reset all ability markers, discard the acting loose board, preserve turn/faces, announcement                                  |
| `undo`    | Solo `ApplySoloUndo` to previous checkpoint plus `UndoApplied` | Implemented bounded stackable solo-only history; deck-load boundary; exact resolved randomness; unchanged announcement target |

## Mapping rules

- One v1 action may map to several **internal event variants**, but one submitted
  v2 command is one atomic accepted batch/revision.
- A v1 action that mixed UI and domain behavior maps to both a command/timeline
  fact and local presentation reaction; the presentation part is never persisted
  as canonical state unless reconnect requires the work area/grant.
- Legacy `user`, `initiator`, zone/index, and supplied shuffle indices are not
  copied into public v2 payloads. Actor comes from the connection; cards use view
  IDs; authority resolves semantic/random selectors.
- The legacy converter alone accepts recorded positional parameters and resolved
  shuffle arrays. Live v2 never does.
- Exact prompt validation, announcements, target permissions, and edge behavior
  remain blocking characterization fields even where the architectural mapping
  is clear.

### Implemented movement subset

The v2 core now distinguishes zone-to-play, stack-to-zone, inspection-work-area,
and attachment-resolution-work-area movement. An individual attachment can
leave a live stack directly. When the top evolution card leaves play, the old
stack is removed atomically and every lower evolution and attachment is staged
in separate ordered sequences. This also handles a base leaving attachments
without orphaning them.

`RestoreStagedStack` implements the logical `leaveAll` transition. It consumes
the exact work-area version, preserves evolution and attachment classification,
creates a fresh stack in active or bench, and validates the complete prior board
layout. The new `StagedStackRestoredToPlayStack` event additionally freezes the
full-list attachment ordering version, exact staged input, and computed output.
For a fully supported Energy/Trainer list it stable-partitions Energy before
Trainer, matching `leaveAll`'s replay through ordinary attachment behavior;
unsupported membership remains in recorded order. Historical
`StagedStackRestored` events retain exact-order replay. `MoveStagedCard` resolves
staged cards individually when no Pokémon remains to restore. An occupied work
area rejects another dependent-producing departure but does not block an
independent single-card stack departure.

Ordinary direct non-Pokémon ingress onto an existing live stack now emits the
versioned `CardAttachedToPlayStack` event. `attachmentOrderVersion: 1` freezes
the observed incoming-card rule: Trainer appends; incoming Energy stable-
partitions only a fully supported Energy/Trainer result, preserving relative
arrival order inside both categories; unsupported membership retains append
order. The event carries and validates the exact prior and destination lists.
Older `CardMovedToPlay` attachment events remain append-only during replay, so
historical reverse order is not rewritten merely by loading it.

`SetCardCategory` is prohibited while the target is an evolution or attachment
member of a live stack or its attachment-resolution work area. Such a category
change must first perform a semantic departure. Work-area/deck-top swaps retain
the v2 exact-position replacement policy and otherwise preserve the staged
list; this deliberately differs from the legacy implementation's remove,
deck-rotation, and old-top append sequence. A subsequent current restore runs
the versioned full-list rule, while the old restore event, whole-stack
active/bench movement, snapshots, and undo preserve recorded order. Reverse and
unsupported histories remain valid outside the v1 normalized transition
subset. Renderer eligibility remains a separate, fail-closed decision: only the
exact canonical `[Energy, Trainer]` current-state shape and characterized
active/sole-bench placements enter the strict mixed geometry path.

Whole-stack active/bench movement uses a separate atomic layout command for
promotion, demotion, swapping, and bench reordering, including v1's asymmetric
no-target append behavior and automatic swap when active moves onto a lone
bench. `ResolveStagedCards` now covers the staged-work-area forms of
`discardAll`, `handAll`, `lostZoneAll`, `shuffleAll`, and `shuffleBottom` in one
atomic revision. It preserves flat work-area order for visible/hand moves,
shuffles the full combined deck for `shuffleAll`, and shuffles only staged cards
before appending them for `shuffleBottom`. Cross-owner cards retain immutable
ownership while entering the work-area player's destination zone.

A Chromium source oracle and bounded React comparison confirm that legacy
whole-stack movement refreshes a reverse-restored mixed Energy/Trainer stack to
canonical settled bench and active geometry, and that Energy/Trainer
current-category cycles settle identically after semantic departure and
reattachment. This evidence does not change the domain contract: movement
preserves exact evolution and attachment arrays and card categories, and no DOM
reflow provenance enters state or projection. Its existing placement semantics
still clear special conditions from stacks moved onto the bench. Pixi
descriptor-consumption and real cross-view projection tests cover stable
identities without broadening the native-paint claim.

A separate sole-bench marker oracle now independently pins that
canonical boundary: bench exposes damage and ability controls but not special
conditions, and movement cleanup removes an existing active condition when the
destination is bench. It also records the q0→q1→q2→q3→q0 geometry and observer
lifecycle without changing domain state. Only its strict pristine-q0
clean-active-plus-sole-bench current shape enters production; rotated/history-
dependent geometry, additional bench siblings, and editing remain deferred.

`ResolveInspectionCards` applies the same bounded, authority-resolved semantics
to the active inspection work area and retires its visibility grant atomically.
An ordinary inspection close now also retires persisted grants and public
reveal metadata while normalizing temporary face and category state. The
renderer does not infer legacy relative-image behavior.

`MoveCardToDeckTop`, `MoveCardToDeckBottom`, `ShuffleCardIntoDeck`, and
`SwapCardWithDeckTop` now resolve the source container from an opaque card
handle plus an exact expected source ID. Index zero remains the deck top. All
four actions support ordinary zones, top evolution cards, attachments,
inspection cards, and staged cards without publishing an intermediate state.
Moving a card already in the deck reorders it to the requested edge, while a
swap returns the prior deck top to the selected card's exact zone index or
logical stack/work-area position. Shuffle-into-deck validates the complete
source departure before requesting randomness, then shuffles the selected card
and existing deck as one authority-chosen permutation. Stack dependents remain
transactionally staged, concealed handles rotate on entry to the deck, and
temporary face/category/rotation state is normalized. `MovePrizesToDeckBottom`
shuffles only the prize cards on the authority and appends them after the
unchanged deck; an empty prize zone fails without creating a revision.

### Implemented in-play stack-state subset

The active/bench forms of damage, special-condition, ability-used, and group-
rotation controls now resolve a selected projected stack card to bounded target-
value commands. Damage uses a positive integer or `null`, with zero and negative
UI outcomes normalized to removal. Conditions trim outer whitespace, normalize
empty or `0` to removal, retain the legacy `P`/`B`/`Pa`/`C`/`A` cycle, and may
only be added to the active stack. Duplicate target values fail without creating
a revision.

These markers survive authoritative publication and reconnect. Evolution keeps
damage while clearing the old condition, ability marker, and group rotation.
Any transition from active to bench clears the special condition, including
direct movement, swaps, active replacement, and staged-stack restoration.

### Implemented card-annotation subset

The legacy whole-stack and single-card rotation paths are now distinct target-
value commands. `RotateStack` changes the play aggregate, while
`SetCardOrientation` changes one evolution/BREAK card, attachment, or stadium
card. The scene projection composes stack and per-card quarter turns, so a BREAK
rotation remains attached to the exact card without losing group rotation.

The split compound-rotation source oracle now bounds what that model does not
yet prove. Legacy single rotation reads the selected card's effective inline
angle, while v2 toggles the projected per-card field independently of stack
rotation. Legacy wrapper margins also depend on selected-card and refresh
history: fresh and returned active BREAK-q0 states can expose identical stack/
card turns but different geometry. The q0/q2 refresh oracle now additionally
proves zero/two replay turns and three distinct active q0 inline-margin
histories for the same final card turns. Exact x values form two anchor clusters
whose largest difference is 1.9375 px, still within the 2 px parity tolerance.
The separate q3 oracle confirms that the negative count executes no replay
iterations and collapses `[q0,q3,q3]` to `[q1,q0,q0]` during refresh. V2 does
not make viewport/layout refresh mutate canonical state to reproduce that
defect. The nonzero-group Alt-R oracle now pins the clean top-selected
ordinary/BREAK q1/q2/q3 entry matrix: five reset only the selected top to
absolute q0 and clear BREAK, while BREAK q3 advances its effective-q0 top to q1
and retains BREAK. Both lower cards keep the group angle, and active/bench
margins follow the intermediate attempted angle. Keyboard and clicked-card
ingress are source-pinned but not executed. V2 deliberately retains explicit
group and per-card target values rather than adopting this ambiguity. Repeated
Alt-R, group rotation or refresh after divergence, attachment timing, and lower-
card initiators remain compatibility hazards; no production BREAK layout
predicate is authorized until command ingress and history are normalized or
represented.

Lower-evolution whole-stack initiation is now pinned separately. Middle and
base resolve to logical indices 1 and 2 even though their DOM ordinals are 2
and 1, then produce the same coherent ordinary/BREAK group turns as top
selection. Wrapper margins still derive from the selected lower card's
tentative angle, so BREAK q1 begins with empty active and `3%`/`2%` bench
margins before top-driven refresh normalizes them to `1%`/`0%`. This is another
source-only reason not to derive exact layout from turns alone. Lower-card
single/Alt-R and mixed-initiator histories remained explicitly unmodeled at
that checkpoint; the v2 target-value commands and canonical state are
unchanged.

The clean group-q0 lower-card single branch is now pinned separately. Alt-R on
logical middle/base index 1/2 sets that attached evolution to q1 and assigns its
own legacy `PokémonBreak=true` flag while leaving both siblings untouched. A
top-BREAK composition consequently retains the top flag and adds a second flag
to the selected lower card. Active margins remain unwritten; ordinary bench
writes `3%`/`2%`, while top-BREAK bench already has those margins. Lower-specific
painted/authored native hit regions prove the selected rotated card rather than
borrowing top-only probes. This source-only evidence exposes behavior that the
legacy boolean conflates with single-card orientation; it does not change the
explicit v2 target-value commands or add a per-evolution BREAK flag to canonical
state. Nonzero and returned-q0 entries, repeated/mixed actions, divergent
refresh, and attachment timing remain compatibility hazards.

The clean nonzero-group lower-card branch is now pinned as its own forty-eight-
history matrix. From group q1, q2, or q3, Alt-R on logical middle/base index
1/2 resets only that selected evolution to absolute q0 and leaves its
`PokémonBreak` flag false. Its sibling keeps the group angle. In top-BREAK
composition the top remains flagged and preserves its effective angle, including
the q3 history where the top is already q0 while both lower cards begin q3.
The wrapper margin is still written from the selected lower card's attempted
next angle before the q0 snap, so active/bench history remains observable even
when q2→q0 has the same rectangular footprint. The action capture records the
exact `processAction` call payload index; keyboard/click ingress is source-
pinned but not executed, and opponent coverage proves only physical frame
mapping. V2 retains explicit target-value orientation and does not add this
legacy per-evolution flag/history ambiguity to canonical state.

The clean returned-q0 lower-card branch is pinned independently from pristine
and nonzero entry. A homogeneous top-, middle-, or base-initiated whole-stack
cycle uses the established q1 reconstruction before returning to coherent q0;
Alt-R then advances only logical middle/base index 1/2 to q1 and assigns its
own `PokémonBreak=true` flag. The chosen prior initiator matters at top-BREAK
bench: top-driven return retains `3%`/`2%`, whereas middle/base-driven return
has `1%`/`0%` before the final action; every bench result converges to
`3%`/`2%`. Wrapper replacement belongs to the earlier q1 reconstruction, while
wrapper/card identity is stable across the measured final action. This remains
source-only and does not combine refresh-free four-turn cycles, repeated lower
Alt-R, mixed group initiators, post-return refresh, or divergent states.

The same-card repeated lower Alt-R branch is now distinct as well. Two setup
single-card actions take the selected middle/base evolution
q0/false→q1/true→q0/false; the second attempt computes q2, writes
`1%`/`0%`, then the source fallback snaps to q0 and clears BREAK. A third,
measured Alt-R advances that same card to q1/true. Active retains `1%`/`0%`;
bench changes from `1%`/`0%` to `3%`/`2%`. Its visible result matches a
lower-initiated group-returned history, but the operation trace contains no
post-construction refresh and owns only three observer pairs. V2 does not
encode this ambiguous history. Alternating cards, additional repeats, and
interleaved group/refresh actions remain separate source-only cases.

The immediate follow-up branch after a clean nonzero-group lower Alt-R is also
pinned independently. Its pre-state is exactly the prior branch's post-state:
the selected middle/base evolution is q0 and non-BREAK, while the top and other
lower card retain their group-relative turns. Repeating Alt-R on that same
selected card advances only it to q1 and assigns `PokémonBreak=true`. Active
margins remain `1%`/`0%`; sole-bench q1/q3 changes from `1%`/`0%` to
`3%`/`2%`, while q2 remains `3%`/`2%`. The measured transition performs no
refresh or wrapper replacement. Different selected targets, later repeats,
intervening group/refresh actions, and imported state remain separate source-
only histories rather than new canonical fields.

The immediate top-initiated whole-group R after that first lower divergence is
captured separately from the same-card Alt-R follow-up. Plain R sends logical
top index 0 with `single=false`; the source advances all three Pokémon turns but
does not change any `PokémonBreak` flag. The divergent lower card therefore
moves q0→q1 while remaining non-BREAK. Active margins stay `1%`/`0%` and
ordinary bench margins retain the inherited value. Top-BREAK bench margins are
rewritten from the top card's new angle: q1/q3 change `1%`/`0%`→`3%`/`2%`,
while q2 changes `3%`/`2%`→`1%`/`0%`. Further group turns, a lower-card group
initiator, refresh, movement, markers, and attachments remain distinct source-
only histories.

Plain R on that same divergent lower card is now pinned as a separate branch.
The selected q0 middle/base at logical index 1/2 advances to q1, while every
other Pokémon also advances one quarter-turn. Because this is the whole-group
branch, no `PokémonBreak` flag changes: the lower initiator remains false and
only an existing top BREAK stays true. The resulting turns and flags equal the
top-initiated branch exactly, but its wrapper margins do not always do so.
Active stays `1%`/`0%`; every bench case becomes `3%`/`2%` because margin
selection is based on the lower initiator's q0→q1 transition. Ordinary q1/q3
and top-BREAK q2 are therefore `-0.015625px` left of their top-initiated
counterparts; all other placements coincide. V2 must treat initiator-sensitive
margin history as source compatibility evidence, not canonical game state.
Different-lower and repeated group actions, intervening inputs or refresh,
alternate state origins, attachments, and candidate parity remain separate.

Plain R on the other lower evolution is now pinned independently. After a
middle Alt-R divergence, base is logical index 2 / DOM ordinal 1; after a base
divergence, middle is logical index 1 / DOM ordinal 2. The different lower card
still carries the original q1/q2/q3 group angle, so its whole-group action
advances all cards and preserves flags but leaves the existing bench margin
unchanged: compact `1%`/`0%` for q1/q3, spread `3%`/`2%` for q2. Post turns and
flags collide with both prior group-action checkpoints. Ordinary geometry
equals the top-initiated branch; top-BREAK bench x differs by
`+0.015625px`/`-0.015625px`/`+0.015625px` for q1/q2/q3. Against the same-lower
branch, bench q1/q3 is `+0.015625px` and q2 is exact. These are frame-local
differentials with separately verified local/opponent physical mappings. V2
must not encode this initiator history into canonical state. Repeated group
actions, intervening operations, alternate origins, attachments, and candidate
parity remain separate.

Repeating plain R immediately on the same lower card is now pinned separately.
The checkpoint-twenty-four post-state is inherited exactly; the second
whole-group action advances the selected lower q1→q2 and advances both siblings
without changing any `PokémonBreak` flag. Active remains `1%`/`0%`. Every
sole-bench wrapper changes from `3%`/`2%` to `1%`/`0%`, moving the wrapper and
authored card boxes `+0.015625px` frame-local x. Painted boxes are not a uniform
translation because all three turn parities flip. Q1/q3 post geometry and probe
sets collide internally, while q2 collides with the clean pre-divergence
checkpoint subject to the recorded top-BREAK bench displacement. Third/later
group turns, top/different-lower followups, intervening inputs, alternate
origins, attachments, and candidate parity remain separate source-only
histories rather than new canonical fields.

Repeating plain R on checkpoint twenty-five's same other lower initiator is now
pinned independently. Its q2→q3, q3→q0, or q0→q1 `single=false` transition
advances both siblings and preserves all `PokémonBreak` flags. Active stays at
`1%`/`0%`. Sole-bench q1/q3 changes compact→spread with a `-0.015625px`
frame-local x displacement; q2 changes spread→compact with `+0.015625px`.
Every post turn/flag vector equals the matching repeated-same-lower checkpoint;
active geometry and bench q2 are exact, while bench q1/q3 differs by
`-0.015625px`. Painted boxes and probes are independently pinned across the
parity change. This collision does not make initiator or margin history
canonical state. A different second initiator, third/later actions,
intervening inputs, alternate origins, attachments, and candidate parity remain
separate source-only histories.

Repeating plain R immediately on checkpoint twenty-two's same top/index-zero
initiator is now pinned independently. The second top whole-group action advances
every raw turn once and preserves every `PokémonBreak` flag; the top-BREAK trace
therefore records true→true rather than normalizing the flag. Active remains
`1%`/`0%`. Ordinary bench q1/q3 changes compact→spread and q2 spread→compact;
top-BREAK takes the inverse margin branches, producing the corresponding signed
`0.015625px` wrapper/authored x shifts. Every post turn/flag vector equals the
matching repeated-other-lower checkpoint. Ordinary geometry is exact; top-BREAK
active geometry is exact and its bench retains the explicitly bounded signed
difference. Q1/q3 also collide internally and q2 exactly matches its clean
checkpoint-eighteen pre-divergence geometry. These initiator-sensitive margin
histories remain source compatibility evidence, not canonical state. Lower or
different initiators, third/later actions, intervening inputs, alternate origins,
attachments, and candidate parity remain separate.

A mixed top→prior-lower sequence is now pinned separately. After checkpoint
twenty-two's first top whole-group action, the lower card that caused the
single-card divergence is always q1/non-BREAK. Its immediate `single=false`
action advances q1→q2 at logical index 1/2 and DOM ordinal 2/1, advances both
siblings, and preserves all `PokémonBreak` flags. Active stays compact. Every
post bench is compact: ordinary q2 and top-BREAK q1/q3 move `+0.015625px`
frame-local, while the complementary cases do not move. The complete post
geometry equals the repeated-same-lower checkpoint twenty-six even though the
first group initiator and full trace differ. This is further evidence that v2
must not infer initiator history from converged layout or encode it as canonical
game state. A top→other-lower sequence, later/intervening actions, alternate
origins, attachments, and candidate parity remain separate source histories.

The complementary mixed top→other-lower sequence is pinned independently.
Checkpoint twenty-two's post-state and trace prefix are inherited exactly, then
the other lower card acts with `single=false`: prior middle selects base at
logical index 2 / DOM ordinal 1, while prior base selects middle at logical index
1 / DOM ordinal 2. That selected card advances q2→q3, q3→q0, or q0→q1; all
sibling turns advance and no `PokémonBreak` flag changes. Active remains compact.
Ordinary bench q1/q3 changes compact→spread and q2 spread→compact, with signed
`-0.015625px`/`+0.015625px` frame-local wrapper/authored displacement;
top-BREAK bench margins remain unchanged. Its complete post state equals
checkpoint twenty-seven. Relative to checkpoint twenty-nine, post geometry and
probes carry only the bounded q1/q3 bench translation; margin selection, action,
and trace history remain deliberately distinct. These converged states remain
compatibility evidence, not canonical initiator history. Top/prior-lower actions,
third/later or intervening actions, alternate origins, attachments, and
candidate parity remain separate source histories.

An immediate third plain-R action by checkpoint twenty-eight's same top/index-
zero initiator is now pinned independently. Its `single=false` transition
advances every raw turn once without changing any `PokémonBreak` flag. Active
stays compact. Ordinary sole-bench q1/q3 changes spread→compact with a
`+0.015625px` frame-local wrapper/authored x displacement and q2 changes
compact→spread with `-0.015625px`; top-BREAK takes the inverse branches and
signed deltas. Every pre-state and trace prefix equals checkpoint twenty-eight.
Every post margin, geometry, and ten-probe tuple plus every BREAK vector equals
checkpoint twenty-two, while each raw turn is two quarter-turns ahead modulo
four. Q1/q3 post geometry also collides internally despite different raw turns.
This periodic rendering collision is compatibility evidence, not permission to
discard raw turns or initiator history from legacy import diagnostics. Fourth/
later top actions, lower-initiated third actions, intervening inputs, alternate
origins, attachments, and candidate parity remain separate source histories.

The immediate refresh branch after the same lower divergence is now captured
independently. Reconstruction preserves the three image nodes but replaces the
wrapper, briefly leaving two wrappers until the empty original is removed by
its observer. Ordinary q1/q2/q3 is rebuilt as a homogeneous group, erasing the
selected lower-card reset. Top-BREAK q1/q2 rebuilds to top q2/q3 with lower
q1/q2. Top-BREAK q3 is destructive: the raw q0 BREAK top produces a replay
count of `-1`, the loop executes zero times, and the group collapses to top q1
plus lower q0. V2 must neither infer action history from the converged layout
nor reproduce this refresh-driven mutation in canonical state. The source-only
oracle directly transcribes reconstruction; real KeyR image reload, cache,
network, and global-zone scanning remain outside its claims.

Ability markers likewise have explicit ownership. The top evolution card maps
to the stack-level marker; attachment, discard, and stadium cards use
`SetCardAbilityUsed` and render a marker on that exact card. Attachment markers
survive attachment staging/restoration. A marked discard card promoted to a new
host transfers the marker to its new stack, while ordinary movement and card
normalization clear transient per-card markers.

`ChangeCardCategory` replaces the unsafe client sequence of mutating and then
moving a card. It carries an opaque card handle, exact expected source, and
one of Pokémon/Trainer/Energy. The authority resolves the source and owner, then
publishes the legal departure to that player's loose board and category change
as one revision. Lower evolution cards, stale handles, foreign targets, board
capacity overflow, and exact no-ops fail without an intermediate state.

### Implemented once-per-game marker subset

GX and VSTAR are independent player-level booleans, matching the two legacy
buttons rather than treating them as mutually exclusive. The application
boundary converts toggle clicks into explicit target values using the current
projected player state. The wire command names the intended player board; room
authority verifies that target exists and permits opponent-board changes only
under the same public-interaction policy used by other tabletop controls.

Accepted changes publish one `OncePerGameMarkerSet` event and survive projection,
reconnect, and durable room restoration. Duplicate target values are rejected
without a revision. Reset clears both markers only for the reset player. The
existing UI can continue to render its VSTAR and GX buttons from projected
player state; this slice does not alter their labels, placement, or styling.

### Implemented loose-board batch subset

The four legacy loose-board batch actions now map to one bounded
`ResolveLooseBoardCards` command with discard, hand, lost-zone, and full-deck
shuffle destinations. The command names the target board player and carries the
complete ordered opaque card list seen by the submitter. Authority resolves
those handles against that recipient only, requires an exact current board
match, and policy-gates opponent-board interaction before producing canonical
IDs. Empty, stale, oversized, foreign-policy, and malformed-randomness requests
fail without a revision.

Each accepted action publishes one `LooseBoardCardsResolved` event. Visible
destinations append the board's current order after existing cards; shuffle
combines the existing deck followed by the board and asks authority randomness
for a full permutation. Cards leaving the loose board restore printed category,
face-up state, zero orientation, and no per-card ability marker. Public reveal
grants are retired. Hand-bound cards rotate their opaque identities; a deck
shuffle rotates identities for the entire shuffled pool. Immutable card owner
IDs survive even when a cross-owned card enters the board player's destination.

Generic whole-zone commands are explicitly forbidden from using the loose board
as source or destination, so clients cannot bypass these preconditions or
normalization rules. The application boundary produces one command rather than
the legacy loop of individually visible moves.

### Implemented table-action subset

`StartTurn`, `DeclareAttack`, and `PassTurn` are explicit target-aware commands.
Because they reset markers across the table, authority requires the submitting
client's complete view revision to be current; a stale declaration is consumed
as a typed rejection and cannot clear a newly added marker. Opponent targeting
uses the existing public-interaction room policy.

All three reset stack-level and legal per-card ability markers. Attack and pass
discard only the target player's loose board and leave turn state and card faces
unchanged. Start-turn discards both players' loose boards, reveals every
face-down evolution and attachment card in play, then draws from the target
player's deck and advances the shared turn. Matching legacy behavior, an empty
deck still commits cleanup and an `emptyDeck` fact but does not increment the
turn or draw a card. GX and VSTAR markers are independent and are not reset.

This intentionally fixes one clear v1 call-site defect: `takeTurn` invokes
`discardBoard(initiator, ...)` twice while changing only the message initiator,
so it clears the acting board twice. The surrounding loop and prior blueprint
show that the intended behavior is one cleanup per player board; v2 performs
that intended atomic cleanup.

Each command produces one replayable event batch and one bounded, typed
recipient-safe presentation event. Publications carry `TurnStarted`,
`TurnStartFailedNoDeck`, `AttackDeclared`, or `PassDeclared` at the resulting
revision. The client retains a bounded timeline, ignores stale publications,
and does not replay presentation events for duplicate command recovery. No
labels, layout, or visible interaction have changed in this under-the-hood
slice.

The parameterless `FlipCoin` wire intent is resolved for the trusted session
player; the persisted `CoinFlipped` fact now carries both that actor and the
authority-provided result. The shared presentation mapper can therefore produce
the legacy "name flipped result" activity text and one standalone coin
animation without guessing an actor or rerolling during live or replay
delivery. This adds no canonical board state.

The local activity store appends live facts, but replay treats the complete
timeline through the selected frame as replaceable state, matching the legacy
clear-and-replay behavior on restart/previous without rerunning game logic.
Only newly crossed forward facts enqueue screen-reader announcements and coin
animation. Backward seek, replay replacement, and mode changes cancel queued
one-shot work so effects from a future frame cannot appear after rewind.
The consumer layer projects keyed activity rows and processes each one-shot
queue serially. It aborts work removed by overflow or lifecycle reset, ignores
late completion by exact entry identity, and drains past handler errors. The
mounted legacy presentation surface retains each polite live-region message for
a bounded dwell and reproduces the existing row color and scroll behavior.
Direct inspection of `flip-coin.js` confirms that legacy has no coin visual, so
the legacy surface drains the already-resolved animation request without motion;
it never rerolls or changes command timing.

### Implemented deck and lifecycle subset

`LoadDeck`, `SetupPlayer`, and `ResetPlayer` now share one authoritative seat-
reset boundary. Existing actor-only wire commands remain valid; the application
boundary sends an explicit target player so the unchanged solo controls can
operate either side. Authority verifies the target, applies the configured
opponent-interaction policy, and requires the submitter's full snapshot revision
to be current because these actions can affect cards spread across the table.

Reset retrieves every card owned by the target player from every zone, stack,
stadium, or work area, restores the exact loaded deck baseline, normalizes card
annotations, rotates hidden identities once, clears only that player's GX/VSTAR
and stack/card markers, closes their work areas, removes their owned stadium,
sets the shared turn to zero, and returns lifecycle to `lobby`. Setup performs
the same cleanup, asks authority randomness for one full baseline permutation,
deals up to seven cards to hand and then up to six prizes, leaves the remainder
in deck, and enters `playing`. Decks of 0–6, 7–12, and 13+ cards retain the
legacy clamped hand/prize behavior.

Deck replacement also performs this cleanup before atomically installing new
definitions and instances. This matches the legacy `loadDeckData -> reset`
sequence without exposing an intermediate empty board or rebuilt deck. Obsolete
unreferenced definitions are pruned, while a conflicting definition ID still
used by the other seat is rejected instead of silently changing its cards.

Two v1 data-loss/duplication defects are intentionally fixed. Resetting a seat
while one of its cards sits on the other side now retrieves that same canonical
instance instead of rebuilding a duplicate. Conversely, foreign cards cleared
from the reset seat—including attachments—are normalized and returned to their
owners' discard piles rather than disappearing. Destination capacity is checked
before acceptance, and the resolved batch is replay deterministic.

Accepted lifecycle commands publish typed `DeckLoaded`, `PlayerSetup`, or
`PlayerReset` presentation facts at the exact snapshot revision. Setup includes
safe hand/prize counts but no identities. The client applies the facts once,
retains them in its bounded timeline across reconnect, and rejects a mismatched
event revision. This slice changes no button, layout, label, or interaction.

### Implemented public reveal/hide subset

`revealShortcut` and `hideShortcut` now map to one source-relative
`SetPublicReveal` command carrying an opaque card handle and its exact zone,
stack, or work-area ID. `revealCards` and `hideCards` map to one atomic
`SetZonePublicReveal` transaction for the complete ordered prize zone rather
than the legacy loop of six separately observable mutations. Both command
families require the submitter's current revision. Empty, stale, duplicate,
wrong-source, unsupported-zone, and exact no-op requests fail without a
revision.

Reveal makes the selected cards face-up and explicitly public. Hide removes the
public grant, rotates each newly concealed opaque identity exactly once, and
turns ordinary public-zone/in-play cards face-down. Hand and prize cards retain
their legacy canonical face-up state because their zone itself provides
concealment. The projector exposes only a `publiclyRevealed` boolean alongside
recipient-safe card views; hidden definitions, names, image URLs, and canonical
IDs remain absent.

Either seat may reveal or hide a complete opponent prize zone when the existing
room public-interaction policy permits it. Selectively revealing a still-unknown
opponent card remains forbidden: this intentional privacy hardening prevents an
opaque positional handle from becoming a private-information oracle. Once a
card is already known, ordinary opponent interaction follows the existing
policy.

Accepted batches persist the authority-derived actor and card-versus-zone scope.
Their recipient-safe presentation facts add the target player and a fixed
semantic source. A single-card reveal also carries its bounded display name only
after the resulting state proves it spectator-public; whole-zone reveals and all
hides contain no card identity. This restores the exact legacy reveal/hide
wording and actor styling in live and projected replay paths without canonical
IDs, definition IDs, or image URLs. The facts are applied once and never replayed
during duplicate recovery. No visible control, label, placement, or styling
changes in this slice.

### Implemented private-look subset

The legacy `lookAtCards`/`stopLookingAtCards` and
`lookShortcut`/`stopLookingShortcut` pairs now map to persisted, viewer-scoped
inspection grants. A whole-zone request carries the exact ordered projected
handles for one hand or prize zone; a per-card request carries one opaque handle
and its exact zone, stack, or work-area source. Authority resolves those handles
to canonical cards, rejects stale sources/order/revisions, and the domain emits
one replay-validatable `InspectionGrantOpened` or `InspectionGrantClosed` batch.
Known cards and repeated opens are explicit no-ops rather than new revisions.

The draft permission rule allows a player to inspect their own private cards.
Inspecting an opponent-private card requires both seats' persisted
`coachingConsent`; the broader public opponent-interaction switch does not grant
private access. This is the auditable engineering default while ADR-017 remains
open for product ratification.

An active grant survives disconnect, reconnect, authority restoration, and
event replay. It ends when its named viewer closes it. Cards are removed from a
grant as soon as they leave the exact source recorded by the grant, and the
grant disappears when none remain; setup/reset movement therefore invalidates
it without a second client command. This bounds the lifetime while avoiding a
reconnect flash or client-owned secrecy state.

Only the named viewer receives the grant metadata and known definitions. Every
other player and spectator continues to receive concealed cards and an empty
`privateInspections` list. Starting and ending publish typed facts containing
revision, source player, viewer player, card-versus-zone scope, fixed semantic
source, and count. They restore the legacy whole-zone and generic per-card
wording without ever carrying canonical card IDs, definition IDs, names, image
URLs, or recipient-only handles. Closing rotates the viewer's known handle back
to a fresh concealed handle. The web layer now provides UI-neutral toggle
resolvers for the existing menu/shortcut behavior; no control, label, layout,
or styling was changed.

### Implemented authority-random face-down subset

`playRandomCardFaceDown` now submits only the explicit target player; authority
derives the actor from the authenticated session. The client sends no card
handle, position, random index, hand order, or random result. Authority requires
the actor's current revision,
applies the existing public opponent-interaction policy, and requests one
bounded cryptographic index only after confirming that the target hand is
nonempty and its loose board has capacity.

The resolved `RandomHandCardPlayedFaceDown` event persists the exact pre-action
hand/board orders and selected canonical card for deterministic replay inside
the trusted authority boundary. Application validates those snapshots, appends
the card to the target's loose board, forces the legacy face-down/reset state,
removes public/private visibility, and rotates its visibility generation once.
An invalid randomness adapter, empty hand, stale revision, missing player, or
full board fails without a state revision.

Unauthorized players and spectators see only the hand count decrease and a new
fresh concealed board handle; the old hand handle, definition, name, image URL,
and canonical ID are absent. The typed `RandomCardPlayedFaceDown` presentation
fact retains the legacy-safe actor and target player IDs but contains no chosen
card data. It is delivered once, survives as state across reconnect, and is not
replayed as a new presentation signal. A UI-neutral resolver maps the existing
hand-menu button to this command without changing its label, placement, or
interaction.

### Implemented solo undo subset

The existing solo Undo control now maps to strict `ApplySoloUndo` intent that
contains only the target player used by the unchanged announcement. The
authenticated session supplies the actor, the client cannot select a revision,
checkpoint, event, or random result, and the authority requires the exact
current revision. An explicit persisted `solo`/`multiplayer` authority mode is
the permission boundary; a multiplayer authority rejects the command even when
only one player happens to be connected.

Solo history is a bounded checkpoint plus resolved-event tail rather than v1's
growing arrays of executable action names and positional parameters. The
authority retains one canonical base state and at most 128 active-branch event
batches. Each entry records the exact pre-command revision/hash, resolved
events, command ID, and resulting revision. Trimming advances the base through
the oldest resolved event, so retained depth stays bounded without storing 128
complete match snapshots. `LoadDeck` and first-time seat metadata changes clear
history because they replace identities or mutate state outside the gameplay
revision stream; setup, reset, and ordinary accepted commands remain undoable.

Undo materializes the last approved checkpoint by replaying persisted resolved
events, verifies every hash/precondition, pops that branch entry, and applies a
single durable `UndoApplied` event in a new monotonically increasing revision.
It never re-executes a command or invokes randomness, and the prior command and
undo event both remain in the audit journal. Empty history is a safe typed
rejection. Stackable undo after branch changes and after bounded-tail compaction
is covered by authority tests.

Because undo can return to a pre-shuffle or pre-concealment generation, the
authority discards all recipient alias registries before projecting the restored
state. Every active recipient receives a fresh safe view, while reconnect keeps
the new branch's aliases stable and does not replay the announcement. No card
identity, definition, name, image URL, hidden order, checkpoint, or history
depth appears in the wire command or `UndoApplied` presentation fact. No label,
layout, shortcut, or visible interaction changed in this slice.

V1 kept separate `selfActionData` and `oppActionData` arrays even though many
entries could mutate shared or opposite-seat state. Replaying one lane after
interleaved moves can therefore erase or repeat unrelated shared effects. The
provisional v2 integrity rule defines “last move” as the most recent accepted
canonical whole-match command. `targetPlayerId` preserves the current
bottom-seat announcement; it does not select an independent history lane. This
rare interleaved/flip-board distinction is recorded under ADR-014 for parity
review rather than hidden in implementation code.
