# Attach/evolve target-selection blueprint

Status: V2 vertical slice implemented and locally verified.

This document freezes the selected-card `Q`/`E` interaction before the V2
implementation changes renderer, controller, wire, domain-event, and authority
contracts together. The goal is behavioral parity for valid play while replacing
DOM classes, mutable zone indices, and multi-step client mutation with recipient-
safe IDs and one atomic authority transition.

## Scope and non-goals

In scope:

- non-Alt `Q` and `E` while a card is selected;
- entering and dismissing the local target-selection mode;
- highlighting the top card of every eligible active/bench stack on the selected
  card's board side;
- evolving a Pokémon from a non-stack source;
- attaching a non-Pokémon from a non-stack source;
- reattaching an existing stack attachment or lower evolution;
- resolving a card from the private inspection or attached-card work area;
- same-stack targets, opponent-public interaction policy, replay rejection,
  stale references, reconnect, projection replacement, and privacy.

Out of scope:

- changing shortcut labels, target color, card geometry, active/bench layout, or
  any other UI/UX;
- validating Pokémon TCG evolution legality, turns, or attachment limits that V1
  deliberately leaves to the players;
- making target selection optimistic canonical state;
- using renderer display objects, DOM nodes, array indices, or card names as
  authority inputs;
- changing `A`/`B` whole-stack placement or pointer-drag behavior.

## Frozen V1 source contract

The executable oracle is
`tests/browser/legacy-runtime-attach-evolve-shortcuts.spec.ts`. It imports and
runs the unchanged V1 `Card`, `moveCardBundle`, keybind, click, attachment,
evolution, and refresh modules in Chromium.

### First stage

`Q` and `E` are identical when Alt is not held. The selected source is eligible
when it is outside active/bench, or when its V1 image has `attached === true`.
Consequently an active/bench top Pokémon is ineligible, while an attachment and
a lower evolution are eligible. Card category does not control first-stage
eligibility.

An eligible keydown:

1. consumes the selected non-spectator key event;
2. closes full view and zone popups;
3. removes the blue selected-card paint;
4. adds `selectHighlight` only to every unattached active/bench card belonging
   to `mouseClick.cardUser`; and
5. records no action, export, counter increment, or socket message.

After refresh there is one unattached image per play stack: its current top
evolution. The source therefore exposes one target per active/bench stack, in
active-then-bench order, and never highlights the other board side. Chromium
computes the target paint as
`rgba(143, 215, 153, 0.863) 0px 0px 0px 4px` from the source CSS value
`rgba(143, 215, 153, 0.864)`.

The selected source's user, zone, and index remain in mutable V1 globals after
the visible selection clears. V2 must not reproduce that hidden pointer.

### Second stage

Clicking a highlighted top card sends one `moveCardBundle` using the retained
source tuple and the clicked destination zone/index. The move is then refreshed
and logged once. Export rewrites only the first initiator parameter between
`self` and `opp`.

The resulting semantic mode is:

| Source placement                               | Current card category | Result                                    |
| ---------------------------------------------- | --------------------- | ----------------------------------------- |
| zone, inspection, or `attachedCards` work area | `Pokémon`             | new top evolution                         |
| zone, inspection, or `attachedCards` work area | any other category    | attachment                                |
| active/bench attachment                        | any category          | attachment                                |
| active/bench lower evolution                   | `Pokémon`             | removed from evolution order and attached |
| active/bench top evolution                     | any                   | cannot enter targeting                    |

Evolution prepends the new top in V1's refreshed flat DOM array while every
prior evolution and attachment points at that top. The canonical equivalent is
to append the source to `PlayStack.evolutionCardIds` and retain the existing
attachment sequence. Attachment retains the target evolution sequence and uses
the already versioned V1 category-ordering function. Moving an existing
attachment removes only that card from its former stack before adding it to the
target; its former stack does not move.

Clicking Escape or a non-card surface clears the targets without mutation.
Clicking a non-target card clears the targets and selects that card normally.
Clicking a target on the source stack is legal in V1 and must be handled as one
atomic remove-and-reinsert operation, not rejected merely because source and
target stack IDs match.

### Guard behavior and deliberate correction

- editable targets own the key and retain selection;
- a two-player spectator receives native behavior and cannot enter targeting;
- an ineligible active/bench top retains selection, although the enclosing V1
  selected-card branch still prevents the default;
- Alt-`E` remains the independent category-change shortcut;
- replay should be read-only, but V1's top-level guard tests the
  `isAltKeyPressed` function object instead of invoking it, so Q/E incorrectly
  enters targeting during replay.

V2 deliberately fixes the replay leak. A replay request returns the existing
typed `read_only` rejection before target state or renderer paint changes.

## Chosen V2 flow

```text
Q/E keydown
  -> selected-card request { action: beginAttachOrEvolve, cardId }
  -> controller live/ready/player + exact-selection guard
  -> pure target resolver over one installed MatchViewState
  -> controller stores a local pending descriptor
  -> renderer receives ordered targetableCardIds and paints source-green shadows

target card click
  -> existing stable CardSelected intent
  -> controller recognizes the exact pending target
  -> pure second-stage resolver emits one PlaceCardOnPlayStack wire command
  -> controller clears pending state and target paint
  -> authority resolves aliases, actor, source, and target preconditions
  -> game core decides and applies one atomic CardPlacedOnPlayStack event
  -> normal authoritative publication reconciles both renderers
```

A non-target card click first cancels the pending descriptor and then follows the
ordinary selection path. `Escape`, background press, rejection, reconnect,
terminal state, renderer reset, recipient change, replay seek, and disposal all
clear the descriptor and paint. No pending targeting state survives a newer
authoritative revision; the user can press Q/E again against the new projection.

## Contract additions

### Local/controller contract

Add a controller-owned `BoardPlayTargetingState`:

```ts
interface BoardPlayTargetingState {
  readonly kind: 'attachOrEvolve';
  readonly sourceCardId: ViewCardId;
  readonly expectedSourceId: string;
  readonly mode: 'attachment' | 'evolution';
  readonly targets: readonly {
    readonly stackId: string;
    readonly topCardId: ViewCardId;
  }[];
}
```

This is local, recipient-safe, revision-bound interaction state. It is not a
domain object and is never serialized, replayed, persisted, or sent wholesale.
The first-stage resolver derives `expectedSourceId`, mode, source board, and the
ordered active/bench targets from the same immutable view.

Extend `BoardPresentation` with an immutable ordered
`targetableCardIds: readonly ViewCardId[]`. Empty is the default. Both renderers
consume the same field; they never infer eligibility. DOM uses the existing
green source shadow without changing layout. Pixi draws the equivalent outline
without changing sprite alpha, hit area, or z-order. Selection remains a
separate state.

Add a renderer-neutral background intent so DOM and Pixi can cancel local
targeting on a non-card/non-overlay press. The controller, not either renderer,
owns the dismissal semantics.

### Wire and authority contract

Add the closed wire command:

```ts
interface PlaceCardOnPlayStack {
  readonly type: 'PlaceCardOnPlayStack';
  readonly cardId: string; // recipient-visible card alias
  readonly expectedSourceId: string; // zone, stack, or work-area ID
  readonly targetStackId: string;
  readonly expectedTargetTopCardId: string; // recipient-visible card alias
  readonly mode: 'attachment' | 'evolution';
}
```

The client supplies no actor, owner, board player, slot, array index, category,
or final ordering. Authority must:

1. resolve both card aliases in the installed recipient projection;
2. find the canonical source and require `expectedSourceId` to match;
3. derive the source-placement player and apply `canControlCard` plus the
   existing opponent-public-interaction policy;
4. require inspection/attachment-resolution work areas to belong to the actor;
5. require the target stack to belong to the source-placement player's board;
6. require the target's current top evolution to equal the resolved
   `expectedTargetTopCardId`;
7. derive the current semantic mode and require it to equal the requested mode;
   and
8. emit one canonical `PlaceCardOnPlayStack` game command.

Unknown/concealed identities, foreign private work areas, missing aliases,
changed source placement, changed top card, invalid source top, mismatched mode,
or a target on another board fail closed without a domain revision.

### Game-core/event contract

The canonical command uses branded IDs and includes the authority-derived
source-placement player. The decision reuses the existing card-source locator
and V1 attachment-order function. It accepts zones, attachments, lower
evolutions, inspections, and either staged sequence; a top stack evolution is
rejected.

Add one versioned `CardPlacedOnPlayStack` domain event. It records:

- canonical card/source/player/target IDs;
- the expected target top and target evolution/attachment sequences;
- the derived mode and attachment-order version;
- the resulting target evolution/attachment sequences.

Application re-locates and validates the exact source, validates the target's
pre-state, removes the card from its source, and adds it to the target in one
state transition. Source removal covers zone, stack attachment, arbitrary lower
evolution, inspection, staged evolution, and staged attachment. An emptied work
area closes. A same-stack move is computed from one pre-state and installed once
so it cannot duplicate or lose the card.

Evolution reuses existing `CardMovedToPlay` normalization: face up, public-
visibility grants retired, new top appended, stack rotation reset, special
condition cleared, damage retained, and ability ownership transferred to the
new top. Attachment retains stack markers/rotation, makes the card face up,
retires stale visibility grants, and installs V1 category ordering.

The event applier must recompute and validate the declared final sequences,
reject duplicate placement, and pass all match invariants. Replay, snapshots,
undo, hashing, persistence, projection, and presentation facts then work through
the normal event batch without a special client path.

## File-by-file implementation map

| Area                              | Files                                                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Source oracle                     | `tests/browser/legacy-runtime-attach-evolve-shortcuts.spec.ts`                                                                    |
| Protocol                          | `packages/protocol/src/schemas.ts`, protocol fixtures/tests and public API baseline                                               |
| Domain types/decision/application | `packages/game-core/src/commands.ts`, `events.ts`, `decide-command.ts`, `apply-events.ts`, invariants and movement tests          |
| Authority alias/policy boundary   | `packages/room-authority/src/resolve-command.ts` and focused authority/client-server tests                                        |
| Client resolution                 | new `apps/web/src/board/resolveAttachEvolveTargeting.ts` plus focused tests; integrate with `resolveLegacyBoardShortcutAction.ts` |
| Controller lifecycle              | `apps/web/src/board/BoardSessionController.ts`, adapter/runtime tests                                                             |
| Keyboard bridge                   | `apps/web/src/board/LegacyBoardKeyboardShortcuts.tsx` and tests                                                                   |
| Shared renderer contract          | `packages/renderer-contract/src/model.ts`, defaults, public API baseline, renderer contract tests                                 |
| DOM renderer                      | `packages/renderer-dom/src/BoardSurface.tsx` and tests                                                                            |
| Pixi renderer                     | `packages/renderer-pixi/src/PixiBoardRenderer.ts` and tests                                                                       |
| Browser candidate                 | `tests/browser/react-dom-protected-input.spec.ts`                                                                                 |
| Architecture/evidence             | this document, `LEGACY_ACTION_MAP.md`, `QUALITY_GATES.md`, and draft PR evidence                                                  |

## Implemented V2 result

The implementation follows the chosen flow without adding a second mutable
board model. `resolveAttachEvolveTargeting.ts` derives a revision-bound pending
descriptor from one recipient projection, `BoardSessionController` owns its
lifecycle, and both renderers consume only the ordered `targetableCardIds`.
DOM uses the source-green shadow; Pixi uses a non-interactive green outline and
does not alter card alpha, hit areas, or canonical z-order.

One strict wire variant crosses the client/server boundary. Room authority
resolves both card aliases, derives the source player and semantic mode, applies
the existing opponent-public policy, protects private work areas, and produces
one branded core command. Core decision/application emits and validates one
`CardPlacedOnPlayStack` event for the atomic source departure and target
placement. The server model-fuzz registry includes the command, so protocol
union growth cannot silently leave the path ungenerated.

Focused tests cover all source classifications and same-stack behavior, forged
or stale facts, V1 attachment ordering, marker transfer, cleanup, both renderer
adapters, controller cancellation/replacement, and replay denial. The in-memory
multiplayer gate carries projected aliases through the real client queue,
authority, durable commit, new projection, and replay history. Native Chromium
drives Q and E, exact target paint, cancellation, hand attachment/evolution,
existing-attachment and lower-evolution reclassification, exactly-once submit,
and the deliberate replay correction.

## Required verification

The slice is not complete until all of the following pass:

- first-stage resolver: Q/E identity, target ordering, source-side isolation,
  top-source rejection, attachment/lower-evolution acceptance, and no card-name
  or zone-index dependence;
- domain: zone Pokémon evolution, zone Energy/Trainer attachment, cross-stack
  attachment, lower-evolution reclassification, same-stack reorder, inspection,
  both staged sequences, empty-work-area cleanup, V1 ordering, marker transfer,
  and invariants;
- authority: own and policy-enabled opponent-public sources, denied opponent
  policy, spectator denial, foreign private work area denial, opaque alias
  resolution, stale source, stale target top, forged mode, and malformed IDs;
- replay/persistence: exact event replay, snapshot round trip, solo undo, and
  role-projected replay without private identity leakage;
- controller: first-stage local-only transition, target/non-target click,
  background/Escape cancellation, rejection cleanup, revision/reconnect/seek/
  identity/terminal cleanup, and zero command on rejected first stage;
- DOM/Pixi: identical target ID consumption, exact green paint, unchanged card
  geometry/z/hit areas, and cleanup on replacement/destruction;
- native Chromium: hand Pokémon evolution, hand Energy attachment, existing
  attachment reattach, staged source, target cancellation, protected input,
  spectator, replay, one command per accepted target, no leaked source names or
  face URLs, and zero page/runtime/network errors;
- repository gates: format, lint, TypeScript, unit/characterization suites,
  source oracle, candidate browser suite, production topology, public API,
  source-map provenance, and clean generated artifacts.

The visible acceptance criterion is intentionally simple: a legal Q/E sequence
looks and behaves like V1. The under-the-hood acceptance criterion is stricter:
there is one revision-safe local interaction followed by at most one validated,
atomic, replayable authority command, with no DOM-owned game state.
