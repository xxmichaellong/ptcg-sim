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
| `rotateCard`             | `RotateCardOrStack`                                 | Whole stack versus individual/BREAK orientation, quarter-turn convention, face/zone restrictions |
| `changeType`             | `SetCategoryOverride`                               | Pokémon/Energy/Trainer shortcuts, original category restoration when leaving play                |
| `VSTARGXFunction`        | `SetOncePerGameMarker`                              | VSTAR/GX mutual/individual state, used styling, self/opponent control, reset                     |

## Loose board batches

| v1 action       | Proposed v2 responsibility                     | Critical characterization                                      |
| --------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| `discardBoard`  | Atomic `MoveLooseBoardContents(discard)`       | Both-board turn cleanup, ownership destination, order/messages |
| `handBoard`     | Atomic `MoveLooseBoardContents(hand)`          | Ownership versus board placement, hidden projection            |
| `shuffleBoard`  | Atomic `MoveLooseBoardContents(deck, shuffle)` | Per-owner deck/permutation and message batching                |
| `lostZoneBoard` | Atomic `MoveLooseBoardContents(lostZone)`      | Ownership destination and ordering                             |

## Visibility and per-card shortcuts

| v1 action                | Proposed v2 responsibility                                           | Critical characterization                                                            |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `lookAtCards`            | `BeginZoneInspection` grant; view-only unless a work area is created | Viewer/target combinations, deck/hand/prize/public zones, coaching, relay timing     |
| `stopLookingAtCards`     | `EndZoneInspection`                                                  | What becomes concealed, popup state, reconnect/expiry policy                         |
| `revealCards`            | `RevealZonePublicly`                                                 | Exact audience, card faces/names, logs, later move/hide cleanup                      |
| `hideCards`              | `EndZoneReveal`                                                      | Handle generation and destination/default face behavior                              |
| `revealShortcut`         | `RevealCardPublicly(viewCardId)`                                     | Selected hidden card, prize/hand/board constraints, logs                             |
| `hideShortcut`           | `HideCard(viewCardId)`                                               | Who may hide, face-down in-play versus zone concealment, public flag cleanup         |
| `lookShortcut`           | `BeginCardInspection(viewCardId)`                                    | Private viewer, opponent card capability, asset/catalog lifecycle                    |
| `stopLookingShortcut`    | `EndCardInspection(viewCardId)`                                      | Re-conceal timing and stale handle behavior                                          |
| `playRandomCardFaceDown` | `PlayRandomCardFaceDown`                                             | Authority chooses source card; destination/position; no identity leak in event/error |

## Timeline and history

| v1 action | Proposed v2 responsibility                                     | Critical characterization                                                                         |
| --------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `attack`  | Structured safe timeline event `AttackDeclared`                | Exact text/user color/sound/announcement; no board mutation                                       |
| `pass`    | Structured safe timeline event `PassDeclared`                  | Exact text/user color/sound/announcement; no board mutation                                       |
| `undo`    | Solo `ApplySoloUndo` to previous checkpoint plus `UndoApplied` | Stackable solo-only UX, reset/setup boundary, replay mode, log text, hidden random outcome policy |

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
layout. `MoveStagedCard` resolves staged cards individually when no Pokémon
remains to restore. An occupied work area rejects another dependent-producing
departure but does not block an independent single-card stack departure.

Whole-stack active/bench movement uses a separate atomic layout command for
promotion, demotion, swapping, and bench reordering, including v1's asymmetric
no-target append behavior and automatic swap when active moves onto a lone
bench. `ResolveStagedCards` now covers the staged-work-area forms of
`discardAll`, `handAll`, `lostZoneAll`, `shuffleAll`, and `shuffleBottom` in one
atomic revision. It preserves flat work-area order for visible/hand moves,
shuffles the full combined deck for `shuffleAll`, and shuffles only staged cards
before appending them for `shuffleBottom`. Cross-owner cards retain immutable
ownership while entering the work-area player's destination zone.
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
Per-card BREAK orientation and the legacy discard/stadium ability-marker forms
remain explicitly assigned to the later card-annotation slice; this stack-state
checkpoint does not claim those actions as complete.
