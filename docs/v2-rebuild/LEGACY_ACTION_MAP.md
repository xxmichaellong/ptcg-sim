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

A separate source-only sole-bench marker oracle now independently pins that
canonical boundary: bench exposes damage and ability controls but not special
conditions, and movement cleanup removes an existing active condition when the
destination is bench. It also records the q0→q1→q2→q3→q0 geometry and observer
lifecycle without changing domain state or enabling a production bench-marker
layout.

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
