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

The private closed conversion candidate executes lifecycle through game-core.
Both deck bootstraps use `LoadDeck`; `setup` uses a
fresh `LoadDeck` plus `SetupPlayer` because v1 rebuilds the source deck before
applying its recorded permutation; `reset` loads the original source entries or
an empty deck according to its `build` flag; and `takeTurn` uses `StartTurn`.
The legacy `clean` and `invalidMessage` reset flags are presentation-only. The
candidate retains source-record-to-event-batch mappings and proves exact replay.
It now also admits the bounded `draw`, `discardAndDraw`, `shuffleAndDraw`,
`shuffleBottomAndDraw`, direct prize `shuffleZone`, zone-backed `moveToDeckTop`,
the bottom-mode, target-free loose-zone/stadium/new-play-stack/rich-whole-stack,
source-zone-targeted active/bench, and individual work-area new-stack
`moveCardBundle`, resolved
`shuffleIntoDeck`, source-authentic `switchWithDeckTop`, and
`shufflePrizesToDeckBottom` atoms below, but rejects any other action before
constructing state. This is intentionally not yet a complete import
compatibility claim: reachable loose-board take-turn cleanup and owner reset are
now proven alongside owned-stadium and play-stack reset, while face-down in-play
reveal, cross-viewer repeated-inspection visibility, category-interleaved staged
tail returns, and cross-owner play state remain gated on their dedicated
canonical designs.

## Card movement, inspection, and zone batches

| v1 action                   | Proposed v2 responsibility                                                                                                    | Critical characterization                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `draw`                      | `DrawCards` using authority-resolved deck top                                                                                 | Count validation/clamp, empty/short deck, hidden identities, message grammar                                   |
| `moveCardBundle`            | Intent resolves to `MoveCard`, `MoveStack`, `AttachCard`, `EvolveCard`, `MoveCardToStadium`, or active/bench swap event batch | Every source/destination, target, cover, stack/work-area/counter/face/category effect and message              |
| `shuffleIntoDeck`           | Atomic `ShuffleCardIntoDeck`                                                                                                  | Recorded post-tail-move permutation, in-deck basis translation, concealment generation, stack policy           |
| `moveToDeckTop`             | `MoveCardToDeckTop`                                                                                                           | v1 index-zero top convention, visibility clearing, stack policy                                                |
| `moveToDeckBottom`          | `MoveCardToDeckBottom`                                                                                                        | v1 last-index bottom convention, visibility clearing, stack policy                                             |
| `switchWithDeckTop`         | Zone transaction or atomic work-area swap with source-tail return                                                             | Empty deck, exact flat tail, compatibility partition, concealment, stack policy                                |
| `viewDeck`                  | `ExtractDeckCardsForInspection`                                                                                               | Top/bottom selection, count clamp, target's deck, inspection viewer, ordered holding work area                 |
| `shuffleAll`                | `ResolveStagedCards(shuffleIntoDeck)` or `ResolveInspectionCards(shuffleIntoDeck)`                                            | Supported sources (deck/discard/view/detached), messages, popup close, no-op                                   |
| `shuffleBottom`             | `ResolveStagedCards(shuffleToDeckBottom)` or `ResolveInspectionCards(shuffleToDeckBottom)`                                    | Shuffle only selected source cards, bottom order relative to existing deck, visibility generation              |
| `discardAll`                | `ResolveStagedCards(discard)` or `ResolveInspectionCards(discard)`                                                            | Detached/viewed source semantics, order, card category reset, message                                          |
| `lostZoneAll`               | `ResolveStagedCards(lostZone)` or `ResolveInspectionCards(lostZone)`                                                          | Same dimensions as discard, label/message differences                                                          |
| `handAll`                   | `ResolveStagedCards(hand)` or `ResolveInspectionCards(hand)`                                                                  | Hidden owner view, opponent projection, order, message                                                         |
| `leaveAll`                  | `RestoreStagedStack`                                                                                                          | Reconstruct evolution order and attachments into active/bench, selected destination, marker/rotation semantics |
| `discardAndDraw`            | Atomic `DiscardHandAndDraw`                                                                                                   | Zero count, clamps, order, hidden data, message                                                                |
| `shuffleAndDraw`            | Atomic `ShuffleHandIntoDeckAndDraw`                                                                                           | Authority permutation, requested count, empty/short cases, concealment handles                                 |
| `shuffleBottomAndDraw`      | Atomic `ShuffleHandToDeckBottomAndDraw`                                                                                       | Hand-only recorded permutation, preserved deck prefix, count clamp, empty-hand draw, concealment               |
| `shufflePrizesToDeckBottom` | Atomic `MovePrizesToDeckBottom`                                                                                               | Prize ordering/randomization, concealment, empty prizes                                                        |
| `shuffleZone`               | `ShuffleZone` resolved permutation event                                                                                      | Every allowed zone, deterministic legacy indices, new handle generation, safe timeline                         |

The private movement decoder and candidate now admit the exact `draw`,
`discardAndDraw`, `shuffleAndDraw`, `shuffleBottomAndDraw`, the bottom-mode,
target-free loose-zone/stadium/new-play-stack/rich-whole-stack, and
source-zone-targeted active/bench `moveCardBundle`, direct prize
`shuffleZone`, exact staged-stack `leaveAll`, `moveToDeckTop`,
staged/inspection `discardAll`/`lostZoneAll`/`handAll`, `shuffleIntoDeck`,
staged/inspection `shuffleAll`/`shuffleBottom`, `switchWithDeckTop`, and
`shufflePrizesToDeckBottom` tuples.
Record `user` selects the target player's zones, while the exported initiator
remains independent provenance. Draw counts are already clamped by v1 before a successful action is
exported; conversion accepts only positive integers
through the shared 200-card bound and requires the recorded count to fit the
current candidate deck exactly. This prevents game-core's live short-deck clamp
from accepting an inconsistent legacy record. Locally applied empty or invalid
source draws use `emit=false` and are not valid exported records.

Discard-and-draw is admitted as exact `[initiator, count]`. V1 clamps the
prompted count to the current target deck before exporting, accepts zero, moves
the full hand to the discard tail in order, then draws from deck index zero.
Conversion requires the recorded safe integer from zero through 200 to fit the
exact current deck and executes one atomic `DiscardHandAndDraw`. The event keeps
the discard prefix, preserves hand order, conceals drawn identities, and retains
the valid zero-draw discard branch; an unclamped or stale count returns no
candidate instead of relying on the live command's short-deck clamp.

Shuffle-and-draw is admitted as exact `[initiator, count, permutation]`. V1
clamps the prompted count to the combined current deck and hand, appends hand
index zero repeatedly to the deck tail, generates and applies a complete
permutation to that deck-first/hand-tail array, and only then draws from index
zero. That shuffle basis exactly matches canonical
`ShuffleHandIntoDeckAndDraw`, so the candidate supplies the recorded order
directly as its one-shot resolved outcome. Decoding rejects a count above the
recorded permutation length; conversion also requires the count to fit the exact
current deck-plus-hand state and the permutation length to equal it. One atomic event
conceals the entire shuffled set and preserves positive, zero-draw, and
completely empty branches; malformed or stale input returns no candidate.

Shuffle-bottom-and-draw is admitted as exact
`[initiator, count, handPermutation]`. V1 clamps the count to the combined deck
and hand, but generates and applies the recorded permutation only to the current
hand. It then appends hand index zero repeatedly to the existing deck tail and
draws from deck index zero. That hand-only basis exactly matches canonical
`ShuffleHandToDeckBottomAndDraw`, so conversion supplies the recorded order
directly. Unlike shuffle-and-draw, the count may exceed permutation length when
the original deck provides some or all drawn cards. Conversion instead requires
the count to fit exact deck-plus-hand state and the permutation length to equal
the exact hand count. One atomic event preserves the deck prefix, conceals the
shuffled hand and drawn identities, and retains positive, zero-draw,
empty-hand/non-empty-deck, and completely empty branches. Stale counts or orders
return no candidate.

Move-to-deck-bottom is not a standalone synchronized action. Its context-menu
and Arrow-Down helper delegates to `moveCardBundle`, which exports exact
`[initiator, sourceZone, "deck", sourceIndex, false, "bottom"]`. The decoder
admits that source-authentic bundle subshape. The candidate resolves the legacy
source coordinate and cover aliases to a stable current card, then uses
canonical `MoveCardToDeckBottom`. A source already at the deck's last-index
bottom is retained as a genuine zero-batch record because v1 still exports the
unchanged splice-and-append result while the live canonical command correctly
rejects an already-bottom request. External and in-deck moves conceal the card;
stale or currently unrepresentable stack/work-area sources return no candidate.

Target-free ordinary movement is admitted as exact
`[initiator, sourceZone, destinationZone, sourceIndex, false|null, "move"]`.
`false` is produced by keyboard/context-menu paths; `null` is the saved JSON
form of an undefined drag target. The destination is restricted to the loose
player zones plus discard/Lost Zone cover aliases, excluding `deckCover`
because that drop is separately exported as move-to-top, and excluding active,
bench, attachments, and inspection. Conversion resolves the source to a stable
card, normalizes supported aliases, and executes canonical `MoveCard`, whose
default append matches v1's splice-and-push order. Normal concealed-zone rules
apply to deck, hand, and prizes. A same-zone non-tail card moves to the tail; an
already-tail record retains its source mapping with zero batches. Targeted,
stack/play, stale, and unresolved work-area shapes fail the entire attempt. This
slice also makes loose-board state reachable: candidate tests prove later
take-turn cleanup for both owners and owner-scoped reset/rebuild parity.

The stadium destination is admitted separately under that same exact target-free
move-mode tuple. V1 appends the selected card, then moves the prior index-zero
incumbent to its actual owner's discard; `G` exports `false` and an untargeted
drag serializes as `null`. Conversion snapshots the current zero-or-one
incumbent and executes canonical `MoveCardToStadium`, producing one atomic batch
with incumbent displacement first. Empty, self-incumbent, opponent-incumbent,
and same-stadium zero-batch cases are pinned. Newly reachable stadium sources
also pass through ordinary movement, whole-attempt retry stays byte
deterministic, and reset removes only an incumbent owned by the resetting
player. Stack/work-area origins remain fail-closed.

Target-free active and bench destinations are admitted as new-play-stack moves
under the same exact move-mode tuple. The `A`/`B` shortcuts export `false`, while
an untargeted drag may serialize as `null`. Conversion stable-resolves only a
currently representable source-zone card and executes canonical
`MoveCardToPlay` on that card owner's board. This preserves v1's new stack,
face-up and Pokémon-category normalization for every original category,
append-to-bench order, and atomic occupied-active demotion to the bench. The
import-wide stack factory makes retry identities deterministic. Self/opponent
boards, stadium-to-bench movement, exact event fields, replay, retry, and
owner-scoped reset are pinned.

Numeric active/bench destinations are admitted for the same stable source-zone
cards. The number is the v1 refreshed flat-array coordinate, so conversion
walks board-ordered stacks as reversed evolution order (top first) followed by
the versioned attachment order. Only a coordinate naming the first unattached
top card of a current stack resolves; a lower evolution, attachment, gap, or
out-of-range value rejects the whole candidate. The source card's current
category derives attachment versus evolution, and one canonical
`PlaceCardOnPlayStack` event preserves evolution and Energy-before-Trainer
ordering. Repeated rich-target placement, exact events, retry, and rollback are
pinned. Top-to-top numeric stack sources use the separate switching path below.

The same tuple resolves active/bench source stack tops through that exact rich
flat-array order. It snapshots the complete board layout and executes
`MovePlayStack`. Target-free bench-to-active promotion, active demotion with zero
or multiple benches, v1 lone-bench automatic promotion, and non-tail
bench-to-bench append are atomic. Active-to-active and an already-tail
bench-to-bench export retain zero-batch mappings. A numeric top target on the
opposite slot atomically swaps the two resolved stacks; same-zone top-target
drops are excluded because the v1 drag guard never exports them. Source-backed
relocation/auto-move call order, rich source/target offsets, exact layout events,
retry, invariants, and late out-of-range rollback are pinned. Lower evolutions
and attachments with a numeric top target instead execute atomic
`PlaceCardOnPlayStack`. Source resolution uses newest-to-oldest evolution order
followed by versioned attachment order. It preserves exact source-stack
membership, makes lower Pokémon attachments as v1 does, and admits same-stack
reattachment. Exact events, evolving source offsets, retry, invariants, and a
missing-target rollback are pinned. An attachment-resolution work-area origin
uses its source-authentic newest-to-oldest staged evolution order followed by
the versioned attachment order. A numeric top target executes the same atomic
`PlaceCardOnPlayStack` path, deriving evolution versus attachment from the
staged card's current category.

Target-free top-card, lower-evolution, and attachment sources paired with a
loose destination use canonical `MoveCardFromStack`. An attachment or lower
evolution leaves only itself and preserves its stack, including stack marker,
rotation, and slot state. A top card removes the complete stack, moves only that
top to the destination, and places its base-to-top lower evolutions plus
versioned attachments in one deterministic attachment-resolution work area with
the source slot as its restoration hint. A later independent singleton top may
still depart while that area is occupied. Cover normalization, concealed-zone
identity retirement, exact events, deterministic work-area IDs, retry,
invariants, event-source forgery rejection, and unresolved-coordinate rollback
are pinned. A subsequent target-free `attachedCards` source can now move one
exact staged card to a loose zone through `MoveStagedCard`; the refreshed flat
coordinate is resolved after every prior mutation and an empty work area closes.
That coordinate also supports deck bottom, deck top, exact single-card shuffle,
and stadium through existing source-relative commands. A target-free
active/bench destination moves that one staged card through the owner's loose
board and into `MoveCardToPlay`, preserving V1's detached-card behavior and
new-stack normalization across two canonical batches in the same closed import
record. Staged `switchWithDeckTop` uses the same exact flat coordinate. With an
empty deck it performs one deck-top move. Otherwise a versioned internal swap
rebuilds the V1 flat tail result, carries its exact returned sequences, and
accepts only a lossless Pokémon-prefix/non-Pokémon-suffix partition. This keeps
later `leaveAll` restoration exact; category-interleaved results fail closed.
An individual `viewCards` source uses the active inspection's already-matching
V1 popup order. Each current coordinate can move to a loose zone through
`MoveInspectedCard` or onto an exact numeric active/bench stack top through
`PlaceCardOnPlayStack`; current category again selects evolution versus
attachment, and the last departure closes the work area and retires its viewer
grant. A target-free active/bench destination similarly composes
`MoveInspectedCard` through the owner's loose board with `MoveCardToPlay`,
creating a normalized deterministic singleton stack without widening core or
wire schemas. Missing/stale coordinates or targets return no candidate state.
The same current inspection coordinate now feeds source-relative
`MoveCardToDeckBottom`, `MoveCardToDeckTop`, `ShuffleCardIntoDeck`, and
`MoveCardToStadium`. The shuffle basis is exactly V1's remaining deck followed
by the selected card; stadium replacement keeps the incumbent-owner discard
rule. Inspection-origin `switchWithDeckTop` uses the same exact coordinate and
opts `InspectionCardSwappedWithDeckTop` into source-tail return: the selected
card becomes deck top while the old deck top is appended after the remaining
inspection cards and viewer grant. With an empty deck, `MoveCardToDeckTop`
moves only the selected card. The optional internal mode leaves native callers
and historical events on source-position replacement.

Deck inspection creation is admitted as the exact exported
`[initiator, count, top, selectedDeckCount, targetIsOpp]` tuple. The record
`user` owns the target deck; the decoded initiator is the sole inspection
viewer; and the relationship flag must equal whether those source perspectives
differ. The already-clamped count may be zero, but cannot exceed the bounded
recorded deck count. Conversion requires that count witness to equal the exact
current deck size before doing anything. A positive first view executes
`ExtractDeckCardsForInspection` with a deterministic inspection ID. Top cards
retain source order, while V1's descending bottom loop appends the physical
bottom first, so the canonical command now records a bottom selection in that
same edge-first order. Event application continues accepting the earlier
bottom source-order representation for replay compatibility. The source's
accidental zero-card export changes no model state and is retained with zero
batches for the same viewer. V1 can append another positive view into an
existing `viewCards` array; a same-viewer record now supplies the exact active
inspection snapshot to `ExtractDeckCardsForInspection` and emits one
`InspectionExtended` event. Replay validates the work-area and inspection IDs,
source deck, prior cards and viewers, and exact top or edge-first-bottom
selection before appending. A cross-viewer repeat remains fail-closed because
V1 can retain different visibility for older and newly appended popup cards,
while the canonical work area currently has one viewer set. Whole- and
individual-inspection resolution are admitted below.

The direct shuffle is restricted to exact
`[initiator, "prizes", permutation, true]` records produced by the prize
context menu. Its complete permutation must match the current prize count and
is supplied to game-core as a resolved outcome; conversion never generates a
replacement order. Setup and the composite board, deck, hand, prize, and
staged-zone actions call the legacy helper internally with `message=false` and
`emit=false`, so those calls remain part of their enclosing action instead of
being double-applied as standalone shuffles.

Move-to-top is admitted as exact
`[initiator, sourceZone, sourceIndex]`. Context-menu, Arrow-Up, and drop ingress
all preserve the legacy array coordinate; `deckCover` selects zero while
discard/Lost Zone covers select the current last card. The current closed
candidate resolves ordinary player zones, those aliases, stadium, and the exact
current `viewCards` coordinate to a stable card ID before executing
`MoveCardToDeckTop`; missing/stale coordinates fail the whole attempt. Selecting
an already-top deck card is a genuine v1 no-op and is retained as a zero-batch
source record. An `attachedCards` source resolves the exact current staged flat
coordinate and uses its work-area ID. Active and bench sources remain
fail-closed in this deck-relative action family.

Shuffle-into-deck is admitted as exact
`[initiator, sourceZone, sourceIndex, permutation]`. V1 moves the selected card
to deck tail before generating and applying the recorded permutation. The
candidate requires that permutation to match the exact post-move deck size and
supplies it as a one-shot resolved outcome to `ShuffleCardIntoDeck`. External
zone sources share the same input order. For an existing deck card, conversion
translates the indices from v1's tail-moved intermediate order to game-core's
original-deck shuffle input, preserving the exact final order. A `viewCards`
source resolves its current inspection coordinate and already has the same V1
basis as the canonical non-deck command: remaining deck followed by the selected
card. Its recorded indices therefore pass through unchanged. An `attachedCards`
source likewise resolves its current staged coordinate and already matches that
canonical remaining-deck-plus-selected-card basis. Stale coordinates and
outcome lengths roll back the attempt; active/bench sources remain fail-closed.

Switch-with-deck-top is admitted as exact
`[initiator, sourceZone, sourceIndex]`, with `deck` and `deckCover` rejected
because the local v1 branch exports nothing for those sources. For an ordinary
zone or stadium source, conversion snapshots the prior deck top, moves the
selected card to canonical deck index zero, and appends the prior top to the
source through a second command. It does not use the existing atomic swap
command because that command replaces at the selected card's former index,
whereas v1 removes the selected card before appending the return card. An empty
deck emits only the move-to-top batch. Stable-ID resolution, normal concealment,
final invariant checks, and whole-attempt replay cover both branches; stale and
currently unrepresentable stack/work-area sources return no candidate. In
particular, `viewCards` remains closed because the existing canonical
inspection swap replaces the selected popup position instead of reproducing
V1's tail append. `attachedCards` also remains closed: an arbitrary old deck-top
category appended to the V1 popup tail cannot always preserve the canonical
evolution/attachment sequence classification.

Shuffled-prizes-to-deck-bottom is admitted as exact
`[initiator, permutation]`. The source exports nothing when prizes are empty;
conversion therefore requires a non-empty complete permutation whose length
matches the exact current prize count. V1 reorders prizes, then appends index zero
to the deck until prizes are empty; its optional deck sort changes only DOM
presentation, not array order. One canonical `MovePrizesToDeckBottom` reproduces
that result atomically with the recorded one-shot outcome, an unchanged deck
prefix, concealed moved identities, final invariant/replay proof, and no partial
state on mismatch. Every other row above remains undecoded and cannot enter the
transactional candidate yet.

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

### Executable marker-control characterization

The real legacy modules now run unchanged in a deny-by-default Chromium
harness for both context-menu editing and keyboard shortcuts. On one selected
active Pokémon, the three visible controls create damage `10`, condition `P`,
and an empty ability-used tab in that order. Damage and condition use the
original `contenteditable` nodes: every input event logs an update, blur keeps
the same node for a positive damage value or nonzero condition, and a trimmed
empty value or `0` logs the update followed by removal. The source accepts
arbitrary damage text and free-form condition text; this is compatibility
evidence, not permission to put unbounded strings into authoritative state.

The same direct runtime replay pins the keyboard sequence. Digits add damage in
tens, Alt-digits subtract it, `0` removes it, `Y` cycles
`P → B → Pa → C → A → P`, Alt-Y removes the condition, and `W` toggles the
ability marker. The condition palette remains green/red/blue/yellow/purple for
`P`/`B`/`A`/`Pa`/`C`, with the source fallback for other text. Action and export
logs are checked separately because `processAction` swaps a leading
`self`/`opp` owner only in its replay/export copy.

One source defect is now explicit. When Alt-digit removes the selected card's
last damage, removal deselects the card inside the selected-card branch; the
same keydown then enters the unselected Alt-digit branch and emits `viewDeck`
for zero cards. V2 deliberately maps that gesture to one typed
`SetDamage(null)` command. The existing application resolver also rejects
non-finite, non-integer, string, and over-limit damage and bounds condition
text. This checkpoint characterizes source behavior and the safe command
boundary. The route-owned React overlay completes both marker text workflows.
Choosing either unchanged menu item binds one kind-discriminated temporary
editor to the exact safe stack card. A missing marker submits the characterized
default `10` or `P`; an existing marker opens without a command. Unchanged or
Escape drafts cancel. Damage accepts positive integers through `9990`; condition
text is trimmed and capped at 16 characters with its source palette updated
locally while typing. Zero/empty text removes either marker. Malformed input
remains local and visibly invalid, while forged non-string input is rejected by
the resolver. The controller clears editors on reconnect/recipient replacement,
restricts conditions to active, and rejects missing, wrong-card, or cross-kind
submissions. The selected-card shortcut bridge is completed by the later
protected keyboard checkpoint.

The same protected overlay now completes the category submenu around
`changeType`. It preserves the exact parent and ordered labels `Change type...`,
`to Energy`, `to Tool`, and `to Pokémon`; the Tool label intentionally carries
the legacy `Trainer` state value. Each choice is bound to the exact currently
open top stack card, then reuses the stale-safe `ChangeCardCategory` resolver
with its expected source stack. Missing and forged categories, lower
evolutions, loose cards, stale targets, and requests after dismissal cannot
submit. Native Chromium proves all three choices and continuous client
sequences 12–14; source-versus-candidate paint metrics pin the unchanged nested
menu. The adjacent move destinations and selected-card shortcut path are
completed by the following protected checkpoints.

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
and attachment-resolution-work-area movement. An individual attachment or lower
evolution can leave a live stack directly without changing that stack's marker,
rotation, or slot state. When the top evolution card leaves play, the old stack
is removed atomically and every lower evolution and attachment is staged in
separate ordered sequences. This also handles a base leaving attachments without
orphaning them.

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

The private v1 converter now applies the exact exported
`leaveAll` tuple `[initiator, "attachedCards", destinationSlot]` through that
command. It admits only active/bench destinations and category-compatible staged
membership, snapshots the full board order, consumes the work area, and uses the
deterministic import ID adapter for the replacement stack. Occupied active
restoration demotes the incumbent exactly once. Missing work areas,
attachment-only work areas, and Pokémon attachments or non-Pokémon evolution
members return no candidate rather than guessing how v1's category scans would
reclassify them.

The same converter admits only the exact staged-source forms of `discardAll`,
`lostZoneAll`, and `handAll`. V1 repeatedly drains popup index zero, so the
candidate resolves the full current flat order—newest lower evolution through
base, then attachments—to stable IDs before applying one bounded
`MoveStagedCard` batch per card. No intermediate state escapes if a later batch
fails. Destination append order, category/face/orientation reset, and hand
identity concealment are event-replay exact; missing and non-same-owner work
areas return no candidate.

An individual staged coordinate can also follow V1's Arrow-Down deck-bottom,
Arrow-Up deck-top, `S` shuffle-into-deck, or generic stadium path. The candidate
resolves the exact current V1 flat index to a stable card and supplies the same
work-area ID to the existing source-relative command. The shuffle basis is the
remaining deck followed by that selected card and therefore passes through
unchanged; stadium replacement preserves incumbent-owner discard. The work area
retains its canonical classification for remaining cards and closes when empty.
`switchWithDeckTop` removes that exact current card, places it at deck top, and
appends the prior top to V1's flat popup tail. The importer derives and records
the only canonical sequence partition that round-trips that flat order. If a
returned Pokémon would follow a non-Pokémon card, no such partition exists and
the whole candidate is rejected.

Target-free active/bench placement from either work-area family is represented
without a new command. `MoveInspectedCard` or `MoveStagedCard` first departs the
exact selected card to its owner's loose board, then `MoveCardToPlay` consumes
that card into a deterministic singleton stack. Both batches stay under the
same imported source record and the overall candidate remains all-or-nothing.
The composition reproduces V1's arbitrary-category-to-Pokémon coercion,
occupied-active demotion, bench append, current-coordinate removal, grant/work-
area cleanup, and empty intermediate loose board. Staged members were reset to
`relative = 0` and `attached = false` before entering `attachedCards`, so this
individual path does not accidentally restore dependents; `leaveAll` remains
the separate whole-stack restoration action.

Exact staged-source `shuffleAll` and `shuffleBottom` records add a complete
zero-based permutation. V1 `shuffleAll` first appends popup cards to the current
deck in flat order and records a permutation over that combined sequence. V1
`shuffleBottom` records a permutation over the popup alone before appending it
to the unchanged deck. The converter maps each recorded V1 position to its
stable card ID and then to the canonical evolution-then-attachment position
expected by `ResolveStagedCards`; it never applies legacy indices directly to a
different basis. Length/set mismatches, missing work areas, and capacity
failures return no candidate. Full-deck shuffles conceal the entire result,
while bottom shuffles rotate only the staged identities.

The exact `viewCards` source forms of those same five bulk actions resolve the
current same-owner deck-inspection work area atomically through
`ResolveInspectionCards`. Non-random destinations preserve the inspection's V1
popup order and close its viewer state. For `shuffleAll`, the recorded basis is
the remaining deck followed by inspection cards; for `shuffleBottom`, it is the
inspection cards alone after the unchanged deck prefix. Because first-view top
order and edge-first bottom order are now identical in V1 and canonical state,
these complete permutations pass through unchanged. Missing/non-deck
inspection work areas, ownership mismatches, capacity failures, and stale
permutation lengths return no candidate state. Full-deck shuffle conceals every
result identity; hand and bottom-shuffle resolution conceal only the inspected
cards.

Individual inspection movement is admitted only through exact
`moveCardBundle` tuples. The converter resolves `sourceIndex` against the
current inspection list after every earlier departure. A loose destination
executes `MoveInspectedCard`; a numeric active/bench target must resolve the
current top of one existing stack and executes `PlaceCardOnPlayStack`. That
atomic placement derives evolution or attachment from current category. Both
commands remove only the selected card, preserve remaining inspection order,
retire that card's viewer grant, and close the work area on its final member.
Bottom-mode deck movement, `moveToDeckTop`, and stadium movement reuse that
same current coordinate with source-relative canonical commands. Stadium
replacement includes incumbent-owner discard. `shuffleIntoDeck` validates the
exact remaining-deck-plus-selected-card V1 basis and passes its permutation
through unchanged. `switchWithDeckTop` selects the same exact current card,
uses atomic source-tail return when a prior deck top exists, and falls back to a
single deck-top move when none exists. Target-free active/bench inspection
sources remain fail-closed rather than borrowing different placement
semantics.

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
atomic revision. It preserves canonical evolution-then-attachment work-area
order for visible/hand moves, shuffles the full combined deck for `shuffleAll`,
and shuffles only staged cards before appending them for `shuffleBottom`.
Cross-owner cards retain immutable ownership while entering the work-area
player's destination zone. The legacy importer does not mislabel that canonical
sequence as V1's reversed-evolution popup order: its non-shuffle bridge drains
stable IDs explicitly, while its shuffle bridge translates each permutation by
stable identity before invoking the atomic command.

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
damage, clears the old condition and group rotation, and replaces the host's
ability state with the incoming card's pre-existing per-card ability state. An
unmarked incoming card does not inherit the old host's ability marker. Any
transition from active to bench clears the special condition, including direct
movement, swaps, active replacement, and staged-stack restoration.

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
margins follow the intermediate attempted angle. Clicked-card ingress remains
source-pinned but not executed. The keyboard path is now executed separately;
v2 deliberately retains explicit group and per-card target values rather than
adopting this ambiguity. Repeated Alt-R, group rotation or refresh after
divergence, attachment timing, and lower-card initiators remain compatibility
hazards; no production BREAK layout predicate is authorized until command
ingress and history are normalized or represented.

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

An immediate third plain-R action by checkpoint twenty-six's same divergent
middle/base initiator is now pinned independently. The selected lower at logical
index 1/2 and DOM ordinal 2/1 advances q2→q3, both siblings advance once, and no
`PokémonBreak` flag changes. Every pre-state and trace prefix equals checkpoint
twenty-six. Active stays compact; every sole bench changes compact→spread with a
`-0.015625px` frame-local wrapper/authored x displacement. Every post margin,
geometry, probe tuple, and BREAK vector equals checkpoint twenty-four while each
raw turn is two quarter-turns ahead. Post turns and flags also equal checkpoint
thirty-one, but ordinary q1/q3 and top-BREAK q2 bench geometry differs, proving
that equal projected rotation state cannot recover initiator history. Q1/q3
also collide internally. These relationships remain source compatibility
evidence rather than canonical game state. Fourth/later, top/different-lower,
intervening, alternate-origin, attachment, and candidate-parity paths remain
separate.

An immediate third plain-R action by checkpoint twenty-seven's same other lower
initiator is now pinned independently. The selected base/middle card at logical
index 2/1 and DOM ordinal 1/2 advances q3→q0, q0→q1, or q1→q2, advances both
siblings, and preserves all `PokémonBreak` flags. Every pre-state and trace
prefix equals checkpoint twenty-seven. Active remains compact. Sole-bench q1/q3
changes spread→compact with `+0.015625px` frame-local wrapper/authored x; q2
changes compact→spread with `-0.015625px`. Every post margin, geometry, probe
tuple, and BREAK vector equals checkpoint twenty-five, while each raw turn is
two quarter-turns ahead. Post turns and flags also equal checkpoint thirty-two;
active and q2 geometry is exact, while q1/q3 carries the bounded `+0.015625px`
bench displacement caused by the different initiator history. Q1/q3 collide
internally. These relationships remain source compatibility evidence rather
than canonical game state. Fourth/later, top/prior-lower, intervening,
alternate-origin, attachment, and candidate-parity paths remain separate.

An immediate fourth plain-R action by checkpoint thirty-one's same top/index-
zero initiator is now pinned independently. Its `single=false` transition
advances every raw turn once and preserves all `PokémonBreak` flags. Every
pre-state and trace prefix equals checkpoint thirty-one. Active remains compact.
Ordinary sole-bench q1/q3 changes compact→spread with `-0.015625px` frame-local
wrapper/authored x and q2 changes spread→compact with `+0.015625px`; top-BREAK
takes the inverse branches. Every post margin, geometry, and ten-probe tuple
equals checkpoint twenty-eight while the raw turns are two quarter-turns ahead.
Turns and flags complete a full cycle back to checkpoint eighteen, but ordinary
bench geometry retains its bounded historical displacement; top-BREAK bench
geometry closes exactly. Q1/q3 also collide internally. This separates
canonical orientation from source-only wrapper-margin history. Later or lower-
initiated actions, intervening inputs, alternate origins, attachments, and
candidate parity remain separate.

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
to stack state rendered under that card's stable recipient alias; attachment,
discard, and stadium cards use `SetCardAbilityUsed` on the exact card.
Attachment markers survive attachment staging/restoration. When a marked card
becomes an evolution host, its per-card ability state becomes the stack ability
state and the card-level field is cleared. Ordinary movement and card
normalization clear transient per-card markers.

Ordinary stack-marker movement is now pinned end to end. The legacy source keeps
the same card plus damage/ability DOM nodes while replacing wrappers across
active→bench, same-bench refresh, and bench→active; it removes the special
condition on demotion. Its refresh-time ghost wrapper produces a synchronous
4.765625 px bench-marker shift, then the old wrapper's `MutationObserver` and
the native bench `ResizeObserver` restore the prior geometry during settlement.
V2 deliberately does not serialize that transient DOM history. The authority
preserves damage and ability on the stable `PlayStack`, clears the condition,
and publishes current-state geometry under marker IDs derived from the stable
top-card alias.
Owner, opponent, and spectator retain distinct stable card aliases and observe
the same normalized transition.

Evolution-host marker transfer is now pinned separately against the shipped v1
runtime. A real discard-to-active `moveCardBundle` copies the old host's damage
value into a newly created marker on the incoming evolution, removes the old
damage and condition nodes after setting them to `0`, and removes the old host
ability node. If the incoming discard card already owns an ability node, the
same node is reparented to active; otherwise the incoming card does not inherit
the old host's ability state. The source produces one live action with
`['opp', 'discard', 'active', 0, 0, 'move']` and one export action whose leading
owner is rewritten to `self`. The oracle mounts the real discard cover required
by the legacy move path and rejects caught `moveCardBundle` errors.

The v2 command performs the same logical transition atomically: the stable
`PlayStack` keeps damage, clears the condition, and takes only the incoming
card's ability state. Projection preserves the incoming card's distinct private
alias for owner, opponent, and spectator, while the renderer removes the old
host marker IDs and emits the new damage/ability IDs from that incoming alias.
A visible stadium-to-stack integration phase additionally proves that an
incoming ability marker is updated under the same renderer identity rather than
removed and re-added. Evolution cards cannot emit independent per-card ability
markers, preventing duplicate scene IDs. No context menu, label, shortcut, or
layout behavior changes in this slice.

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

### Implemented route-owned overlay dispatch subset

`LegacyBoardOverlays` now sends one typed context-card or opened-zone request
back through `BoardSessionController`. The controller admits only the exact
currently open target on a ready live-player projection. The pure overlay
resolver then composes the already implemented annotation, public reveal,
private inspection, random face-down, prize-bottom, and loose-board resolvers;
own prize/deck and discard-to-deck shuffles use their existing narrow wire
commands. An accepted request becomes the same serialized `SubmitCommand`
effect as a renderer drop, and `BoardSessionAdapter` repeats the live mode,
request phase, session readiness, and player-role checks immediately before the
real submitter.

The unchanged menu's protected compound interactions are now complete. Damage,
special-condition editing, all three hand-and-draw counts, direct draw, and
top/bottom inspection bind their input to the exact menu action, card, and
source zone. Count inputs retain v1's native prompt text/default while complete
integers clamp against current safe capacity and the 200-card wire ceiling;
hand actions permit zero, draw/inspection require one, own inspection is
private, and accepted opponent inspection is public. Cancel submits nothing.
Malformed prefixes such as v1's permissive `2cards`/`2.5` `parseInt` cases show
the source alert and remain local. Category and move parents still return
`requires_choice` without a command, while their closed, source-ordered rows
submit one typed value. Category reuses the stale-safe annotation resolver;
move-to-board selects the card owner's loose-board zone and emits the existing
source-specific command, while deck top/bottom/switch/shuffle reuse the deck-
relative resolver. Forged values, stale targets, lower evolutions, no-op board
moves, and invalid deck operations fail closed. Zone sorting is paint-only
controlled state in the mounted browser: it sorts a copy by disclosed label,
uses canonical scene order for equal labels, reverses immediately when
unchecked, and never invokes the controller. A forged `sortZone` request still
returns `local_only`. V1 used the exchanged full deck list as its sort rank;
because that data is intentionally absent from protected opponent projections,
V2 uses the disclosed-label order without leaking hidden definitions. V1
replay's prize reveal/look and opponent-hand look are the scoped zone-level
local-disclosure exceptions; its context menu also exposes local `Reveal/hide
card`. They now appear only for a solo player's validated projected replay.
Authority emits a separately bounded catalog whose card keys are the current
concealed frame aliases and whose definition keys are fresh opaque replay
aliases; multiplayer and spectator artifacts omit it. Playback validates the
exact two prize zones plus opponent hand, exact concealed-card coverage,
ownership, uniqueness, definition references, and collision/bounds rules before
publishing. The controller keeps the historical view immutable and derives a
transient display view. Prize menus expose reveal/look plus per-card reveal;
opponent-hand menus expose look plus per-card reveal. Zone operations set one
zone override and clear its per-card overrides; card reveal sets one catalog-
backed alias override. Both translate only into local `InstallScene` and never
create a command. Visibility persists only on forward replay, then resets on
seek, resync, reconnect, exit, identity change, or terminal state. A non-catalog
card/zone or missing/forged catalog keeps the prior `read_only` result. This
slice changes no source label, placement, styling, or production route.

### Implemented selected-card keyboard subset

The route-owned document bridge now converts only the characterized selected-
card marker/category/visibility/deck-movement keys into a closed request:
digits and Alt-digits adjust damage in tens, `0` removes damage, `Y` cycles or
creates a condition, Alt-`Y` removes it, `W` toggles ability,
Alt-`E`/`T`/`P` changes category, `C` toggles private card inspection,
`Z`/Alt-`Z` requests public hide/reveal, `R` rotates the selected stack/stadium,
Alt-`R` rotates only the selected stack card, and
ArrowUp/ArrowDown/ArrowRight/`S` moves to deck top/bottom, swaps with deck top,
or shuffles into the deck. `H`/`D`/`L`/Space moves to the current board-side
hand/discard/lost zone/loose board, `A`/`B` places on active/bench, `G`
replaces the shared stadium, and non-Alt `P` moves to the current board-side
prizes. Alt-`P` remains the Pokémon category shortcut. The
source's missing-marker rules remain exact:
Alt-digit creates the positive damage value and Alt-`Y` creates `P` when no
corresponding marker exists.

Raw DOM events never enter controller logic. The key/code/Alt mapper attaches
the currently selected stable card ID, and the controller rechecks that exact
identity on a ready live-player projection before reusing the bounded stack,
annotation, inspection, public-visibility, deck-relative, or per-card
zone-movement, play-placement, or atomic stadium-placement resolver. Ability,
category, accepted removal, and accepted move
gestures clear selection as v1 does; additive damage, condition cycling, and visibility retain it. A `C` close
is accepted only for a matching single-card grant, so it cannot accidentally close a whole-zone look;
a normally known card has no grant to close. `Z` and Alt-`Z` carry explicit
false/true targets and duplicate values are no-ops. Forged, stale, unsupported,
invalid, replay, and post-dismissal requests cannot submit. The bridge ignores
unselected, composing, already-consumed, input, textarea, select, table-cell,
contenteditable, textbox-role, and legacy marker/tab targets. Native Chromium
proves all twenty-six exact commands and zero traffic from an editable target
without adding a visible control or enabling the production route. A separate
real-v1 Chromium measurement pins the original local `C`/Alt-`C` source swap
and `Z`/Alt-`Z` face/public flags behind the deny-by-default network boundary.
Another four-scenario runtime measurement pins exact top/bottom/swap ordering,
action payloads, selection cleanup, and deterministic shuffle permutations. It
also records the source `S` fallthrough defect: `shuffleIntoDeck` deselects and
the same keydown immediately invokes global `shuffleAll`. V2 intentionally
keeps the intended operation atomic and submits no redundant second shuffle.
A further four-page runtime measurement pins exact `moveCardBundle` hand,
discard, lost-zone, and board payloads, destination arrays, selection cleanup,
asset service, and export owner rewriting. V2 shares one source-specific zone
resolver with the existing context-menu board move, preserves stale/work-area
preconditions, with active/bench and stadium kept outside that bounded generic-
zone group. Prize placement now joins the group because the existing domain
zone policy already forces concealment and rotates visibility identity.
A two-page runtime measurement pins `A` active replacement and `B` bench
placement from hand, including arrays, the single outer `moveCardBundle`
payload, selection cleanup, incumbent-active movement, asset service, and
export owner rewriting. The protected resolver emits `MoveCardToPlay`,
`MovePlayStack`, or `RestoreStagedStack` with exact source and board-order
preconditions; attachments, lower evolutions, inspections, invalid staged work,
and active no-ops fail closed.
Three additional fresh pages pin `G` against an empty stadium, a self-owned
incumbent, and an opponent-owned incumbent. V1 emits one outer
`moveCardBundle`, sends the incumbent to its card owner's discard internally,
installs the selected card, and clears selection. V2 makes that composite
transition explicit as `MoveCardToStadium`: the wire payload contains exact
recipient-safe source and incumbent-or-null preconditions, authority resolves
both opaque aliases and derives source ownership, and one domain revision emits
the discard event before the selected-card departure. Zone, top evolution,
attachment, viewer-owned inspection, and staged sources are supported; stale,
lower-evolution, foreign-work-area, multi-card-stadium, and same-stadium inputs
fail closed.
A final two-page runtime measurement selects self- and opponent-owned public
board cards before pressing non-Alt `P`. V1 sends each card to the prizes on its
own board side, forces card-back paint with `faceDown` and `public` cleared,
emits one outer `moveCardBundle`, clears selection, and rewrites only the export
owner perspective. V2 reuses the source-specific zone resolver and its existing
move commands; entering prizes sets `concealIdentity`, increments visibility
generation, and yields distinct fresh concealed aliases to owner and opponent
projections. Same-prize, stale, lower-evolution, and foreign-work-area inputs
retain the generic fail-closed gates.

### Implemented global loose-board keyboard subset

Enter, Alt-Enter, and Slash now cross the route-owned keyboard bridge without a
selected card. They carry only the closed destination `discard`, `hand`, or
`shuffleIntoDeck`; the resolver derives the viewer's player ID and exact ordered
loose-board aliases from the installed recipient projection, then reuses
`ResolveLooseBoardCards`. Ready/live-player and submit-time policy remain
controller/adapter-owned. A selected card is retained because these are
board-wide actions; editable, composing, consumed, replay, spectator, empty,
stale, and forged input cannot submit. The unselected branch retains v1's lack
of default suppression, while a selected-card keydown retains v1's suppression.
A deny-by-default three-page Chromium oracle runs the unchanged source modules
and pins discard/hand arrays, deterministic combined-deck shuffle and indices,
one outer action, export owner rewriting, local assets, and a clean error
boundary. Candidate Chromium proves the three exact semantic commands and
focused-input silence. No new protocol or domain command is introduced.

### Implemented unselected deck keyboard subset

Digits 1–9 now map to viewer-owned draws, Alt-digits to private top-deck
inspection, Control-digits to private bottom-deck inspection, and non-Alt `S`
to deck shuffle. The requests contain only a bounded digit and closed edge (or
no payload for shuffle); the resolver finds the viewer's current deck, clamps
the count to its disclosed size, and reuses `DrawCards`,
`ExtractDeckCardsForInspection`, and `ShuffleZone`. Missing/empty deck,
spectator, stale viewer, forged counts/edges, replay, editable, composing, and
consumed input fails before submission. Selected-card requests retain
precedence, preserving the existing damage and card-to-deck gestures.

A deny-by-default five-page Chromium oracle executes the unchanged source
modules and pins draw/hand/view/deck order, private top/bottom selection,
deterministic shuffle indices, outer/export records, local assets, and the exact
dual-modifier failure. V1's independent Alt and Control branches both execute
for Alt-Control-digit: the second branch mutates the already-shortened deck,
only the first branch reaches the action log, and the second throws a DOM
`removeChild` error. V2 intentionally emits nothing for this ambiguous chord.
Candidate Chromium proves one semantic command for each intended path and zero
traffic for the rejected chord or a focused input. No new wire or domain
command is introduced.

### Implemented global coin-flip keyboard subset

Non-Alt `F` now crosses the route-owned keyboard bridge with or without a
selected card. The request is payload-free: it cannot name an actor or supply a
random result. The resolver verifies that the installed recipient view belongs
to a current player and emits the existing parameterless `FlipCoin` wire
intent. Authority derives the authenticated actor, selects the result with its
randomness adapter, persists `CoinFlipped`, and publishes the existing activity
and presentation fact. A current card selection remains intact.

A five-page deny-by-default Chromium oracle executes the unchanged v1 modules
and pins both deterministic heads/tails messages, exactly one client-side
random call, selected-card fallthrough, replay and spectator silence, and the
Alt-`F` board-flip boundary. It also records that v1 changes neither action
counter nor live/export action log for a coin flip. Candidate Chromium proves
one parameterless command with selection retained, editable-input silence, and
a typed read-only rejection in replay. V2 intentionally
moves randomness and replayability behind authority without changing the
visible message or shortcut. No new protocol, domain, or UI/UX surface is
introduced.

### Implemented local Alt-F board-flip subset

Alt-`F` now invokes the existing renderer-neutral board-perspective swap before
selected-card routing. The keyboard bridge consumes the chord outside editable
or overlay content, including Control/Shift variants and ordinary multiplayer,
but calls the runtime only for a spectator or an explicitly enabled solo/
coaching player. A selected card stays selected, and replay may still change
the local perspective because no historical or authoritative state changes.

Seven fresh deny-by-default v1 pages pin reversible container/view orientation,
modifier handling, selection retention, the ordinary-multiplayer consumed
no-op, coaching/spectator eligibility, replay, and editor behavior with empty
action/export history. They also expose two legacy hand-visibility relay calls
when an eligible two-player surface flips. Candidate Chromium deliberately
creates no equivalent traffic: recipient-safe projection owns disclosure, not
which player frame is physically lower. It proves the same visible side swap
and restoration through `BoardSessionRuntime`, retained selection, replay-local
behavior, and zero submission/action/rejection traffic. No wire, domain,
authority, control, geometry, style, visible UI, or UX changed.

### Implemented global Escape presentation subset

`Escape` now invokes the existing renderer-local all-scope presentation
dismissal before selected-card or global action routing. Outside editable and
overlay-owned content, it clears selection, hover/drag, open zone, context menu,
preview, and input while deliberately retaining v1's non-consumed browser
default. Focused semantic overlays still own scoped Escape and focus return.
The path remains available to players, spectators, and replay because it cannot
mutate authoritative or historical state.

Six fresh deny-by-default v1 pages pin simultaneous zone/context/key-reference/
selection/target-highlight cleanup, full-stack closure, modifier handling,
replay and spectator behavior, editor silence, and empty action/export/socket
history. Candidate Chromium proves all-scope cleanup for selection, context,
zone, preview, and replay, plus protected-editor silence and zero command,
action, or rejection traffic. No wire, domain, authority, renderer contract,
visible control, key reference, geometry, style, UI, or UX changed.

### Implemented Shift shortcut-reference presentation subset

Either physical Shift key now holds open a route-owned React reconstruction of
the existing shortcut reference. It retains all six source headings, 53
ordered entries, 52 code tokens, the macOS note, exact 1600×900 outer bounds,
and light/dark paint. The surface is local presentation only: it cannot create
an action request, controller action, renderer intent, command, rejection,
authority revision, replay mutation, export record, or socket message.

The bridge preserves v1's target and default boundaries. Editable, overlay,
composing, and already-consumed keydowns remain ignored; selected player
keydown is consumed after opening, while unselected and spectator keydown is
native. Keyup remains unguarded so a release closes the surface even after
focus enters an editor. Escape closes through the adjacent dismissal path, and
an additional blur cleanup prevents a missed release from leaving it visible.
Six deny-by-default source pages and one candidate case pin the complete content,
geometry, theme, player/spectator/replay behavior, focus migration, dismissal,
and zero game traffic. This restores the existing visible reference without
changing its labels, layout, styling, or UX.

### Characterized selected Q/E attach/evolve targeting subset

Nine fresh deny-by-default Chromium cases now execute the unchanged V1
keybind, click, `moveCardBundle`, attach, evolve, and refresh modules. They pin
Q/E equivalence; source-side active/bench top targets; the exact green computed
shadow; Pokémon evolution and Energy attachment topology/order; live/export
records; Escape, outside, and non-target dismissal; input, spectator, and
active-top boundaries; cross-stack and same-stack reattachment; lower-evolution
reclassification; and the `attachedCards` work-area path. They also expose the
same top-level replay-guard defect seen by other legacy shortcuts: V1 enters
target mode during replay
because it does not invoke its Alt predicate.

The V2 vertical slice is now implemented across renderer, controller, protocol,
authority, core event replay, server model generation, and native Chromium. Q/E
creates only a revision-bound local target descriptor; a target click emits one
strict `PlaceCardOnPlayStack` wire command, and authority converts it into one
atomic `CardPlacedOnPlayStack` event after alias, ownership, policy, source,
target-top, and semantic-mode checks. DOM and Pixi consume the same ordered
target IDs. Reconnect, replacement, dismissal, rejection, and replay clear or
deny targeting without mutation. The complete contract, file map, deliberate
replay correction, and verification matrix are in
[`ATTACH_EVOLVE_TARGETING.md`](./ATTACH_EVOLVE_TARGETING.md). No V1 source,
visible layout, labels, or UX changed.

### Implemented unselected lifecycle keyboard subset

Alt-`N`, Alt-`R`, and Alt-`T` now produce payload-free setup, reset, and
start-turn requests only when no card is selected. A dedicated unselected-key
mapper is separate from the always-global Enter/Slash/`F` mapper, so selected
Alt-`N`/Alt-`R` cannot become lifecycle mutations and selected Alt-`T` retains
its existing Trainer-category precedence. The resolver derives the current
viewer player ID and reuses `resolveLifecycleAction`/`resolveTableAction` to
emit `SetupPlayer`, `ResetPlayer`, or `StartTurn`. A caller cannot nominate the
affected seat.

A nine-page deny-by-default Chromium oracle executes the unchanged v1 modules
against empty-deck fixtures. It pins exact setup/reset/take-turn live and export
records, invalid/no-deck messages, the turn value, selection boundaries,
spectator silence, and export owner rewriting. It also exposes a v1 defect: all
three Alt lifecycle keys still execute while replay is active because the
top-level replay guard tests the helper function object instead of calling it,
and none of the three inner branches adds its own replay guard. V2
intentionally rejects each replay request as read-only before resolution or
submission. Candidate Chromium proves the three exact viewer-derived commands,
selected Alt-`N`/Alt-`R` silence, editable silence, and individual exactly-once
replay rejections. No new wire/domain/authority schema or visible UI/UX is
introduced.

### Implemented unselected hand keyboard subset

Alt-`D`, Alt-`S`, and Alt-ArrowDown now open the existing native `Draw how many
cards?` prompt with its zero default, then map valid input to the existing
`DiscardHandAndDraw`, `ShuffleHandIntoDeckAndDraw`, or
`ShuffleHandToDeckBottomAndDraw` command. The first shortcut request carries no
seat or count and installs a controller-owned prompt bound to the current viewer
and hand. Only a matching second-stage request may carry the string draft; the
resolver reparses it and clamps it to the current recipient-safe capacity and
wire ceiling. Authority owns both shuffle permutations.

A ten-page deny-by-default Chromium oracle executes the unchanged v1 modules
and pins exact deck/hand/discard order, shuffle indices and random-call counts,
prompt/default/cancel alert behavior, the Alt-`D`-only default suppression,
messages, action/export records, selected-card and spectator silence, and v1's
replay mutation leak. Candidate Chromium proves the exact two-stage request and
one-command path, invalid/canceled silence, selected/editable boundaries, and
one typed replay rejection per key before any prompt opens; focused controller
coverage rejects a forged second stage. No new wire/domain/authority schema or
visible UI/UX is introduced.

### Implemented solo-undo keyboard subset

Plain `U` now maps to the existing `ApplySoloUndo` path only when route
composition explicitly marks the surface solo-capable. The closed shortcut
request carries no player, revision, checkpoint, event list, or random result;
the resolver derives the current viewer. Replay fails before resolution, and
authority mode plus its private bounded history remain definitive.

A six-page deny-by-default Chromium oracle executes the unchanged v1 modules
and pins successful reset-boundary reconstruction, exact announcement and
action/export records, `Loading...`→`Undo` state, synchronous double-key
suppression, selected-card default prevention, multiplayer/spectator/editable
silence, and v1's replay mutation leak. Candidate Chromium queues only one
viewer-derived command for a synchronous double press and proves selected,
editable, and pre-resolution replay boundaries. The real client session rejects
a second pending `ApplySoloUndo` as `command_pending` without consuming a
sequence or socket frame, then permits retry after a settled authority result.
No wire/domain/authority schema or visible UI/UX is introduced.

### Implemented mulligan-announcement keyboard subset

Plain or modified `M` now invokes an ephemeral declaration only from an
unselected, ready live player surface. It does not enter the game-command
resolver: `DeclareMulligan` contains no player identity or free-form text, the
server derives the player from the bound active session, and one typed
`MulliganAnnouncement` is delivered to every active room connection. The
delivery does not update authority state, client command sequence, audit
journal, undo checkpoints, or replay history.

Seven deny-by-default source pages pin the exact `Blue/Azure mulligans` text,
neutral class, solo/multiplayer feed host, modifier behavior, relay envelope,
empty action/export state, selected default prevention, spectator/editable
silence, and the v1 replay leak. Client semantic validation requires the
announcement revision and player to match its installed view before appending
the event to the bounded presentation stream. Candidate Chromium proves repeat,
selection, editable, and replay boundaries; a real local Worker/browser path
proves the resulting unchanged announcement row. General chat remains separate.

### Implemented refresh and rotation R-key subset

Unselected plain, Control-, or Shift-`R` now rebuilds the current renderer scene
from the already-installed recipient-safe view through `BoardSessionRuntime`.
It creates no command, revision, socket frame, or canonical-state change.
Unselected Alt-`R` preserves the source collision and performs that local
refresh before continuing through the existing viewer-derived `ResetPlayer`
request. With a selected card, `R` instead emits the existing `RotateStack`
target-value command (or `SetCardOrientation` for stadium), while Alt-`R` emits
`SetCardOrientation` for that exact stack card. Both retain selection.

Ten fresh deny-by-default v1 pages execute the shipped keyboard and rotation
modules. They pin refresh-icon/loading order, refresh-before-reset ordering,
top/lower evolution group rotation, single-card BREAK toggling, stadium rules,
exact source action indices, replay/full-view suppression, spectator default
behavior, and focused-editor input. Candidate Chromium proves the corresponding
local refresh counts and exact semantic commands. The controller revalidates
the selected stable ID against the current projection; replay rejects rotation
as read-only, and a full-card preview consumes both R forms without action.
V2 intentionally stores explicit quarter-turn targets and does not reproduce
v1's hidden inline-angle, margin, or per-evolution `PokémonBreak` history.
Clicked-card rotation ingress and production BREAK-layout authorization remain
separate work. No visible control, label, layout, styling, UI, or UX changed.

### Implemented deck and selected-card V-key subset

Unselected plain or modified `V` now opens the viewer's interactive deck through
the renderer-neutral `ZoneOpened` intent. That local operation happens before a
separate player-only declaration seam sends parameterless `DeclareDeckView`.
The server derives the actor from the active bound session and broadcasts a
typed, current-revision `DeckViewDeclared` fact without allocating a command,
changing authority/revision state, or entering persistence, undo, or replay
history. Spectators may retain the legacy local bottom-deck view but cannot send
or forge an announcement.

Selected `V` instead emits `CardPreviewRequested`, which resolves to the existing
whole-stack preview for active/bench cards and single-card preview elsewhere.
It never opens the deck or emits the declaration. Eleven fresh deny-by-default
v1 pages execute the shipped keyboard, card, zone, and chat modules and pin the
exact solo/multiplayer row, class, host and relay envelope; modifier behavior;
selected stack/single previews; spectator/default behavior; focused input; empty
action/export state; and the v1 replay announcement leak. Candidate Chromium
keeps safe local replay inspection but the live-player adapter blocks its
announcement. The real local Worker/browser path proves the server-derived row
end to end. No label, geometry, style, visible UI, or UX changed.

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
