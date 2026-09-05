# Current system and parity contract

## Purpose

The rebuild is successful only if it removes the present architectural hazards
without making users relearn PTCG Sim. This document describes the legacy system
as an external behavior contract, not as an implementation pattern to preserve.

## Current architecture

The browser uses native ES modules and begins at `client/src/front-end.js`. That
entry point initializes global state, same-origin iframe documents, socket
listeners, document listeners, mutation observers, and saved-state import.

The play surface is split among:

- the parent `client/index.ejs` document;
- a self iframe from `client/self-containers.html`;
- an opponent iframe from `client/opp-containers.html`; and
- a shared parent-document stadium and side panel.

Game state is currently distributed across four coupled representations:

1. zone arrays returned through `client/src/setup/zones/get-zone.js`;
2. DOM element order and hierarchy;
3. custom properties placed on card `<img>` nodes, including ownership,
   attachment, face-down/public state, layer and counter references; and
4. positional action arrays used for multiplayer, undo, replay, and exports.

`client/src/actions/move-card-bundle/move-card.js` is the central state mutation.
It also manipulates rendering, visibility, attachments, evolution, cover images,
counters, stadium behavior, popups, sorting, and messages. Conversely,
`client/src/setup/sizing/refresh-board.js` can mutate arrays to repair visual
order. This two-way state/render relationship is the main source of fragility.

Multiplayer is a peer-replicated positional action log relayed by
`server/server.js`. The server does not own match state, authorize individual
actions, or calculate hidden-information views. Client counters and periodic
resync try to keep peer logs aligned. Spectator/export data repeatedly transmits
large action arrays.

The current client import graph contains 98 modules in one strongly connected
component, so apparently local changes can depend on initialization order and
global re-exports. The synchronized dispatcher exposes 50 action names with
positional parameters. The repository's 79 passing automated tests cover the
native deck-builder core; no current test exercises tabletop state, rendering,
multiplayer, spectator, reconnect, replay, save/import, or UI parity.

## Hazards the rebuild must remove

- Card identity depends on player, zone, and mutable array index.
- A single user action can update arrays, DOM, image properties, logs, and remote
  counters independently.
- The client module graph is circular and effectively one large component.
- Unknown or malformed action names/positional arguments can fail at runtime.
- Peers may diverge because there is no authoritative reducer or state hash.
- Room relays do not consistently prove that a sender has joined that room or
  holds the role needed for the action.
- Reconnect, spectator sync, undo, and saved games depend on growing action logs.
- Private information is enforced largely by how cards are drawn, not by what
  payloads an unauthorized client receives.
- Saved-state links use short random keys without robust collision, expiry,
  ownership, or payload controls.
- Card image fetching and browser image nodes lack a bounded, observable cache.
- DOM mutation observers and full-board refreshes do work unrelated to the
  logical change that occurred.
- UI version text and exported package version can drift.

These are architectural findings, not a mandate to alter visible behavior.

## UI/UX compatibility contract

The following are protected unless a separately approved product change says
otherwise.

### Layout and appearance

- Preserve the two-player tabletop composition: local player at the bottom,
  opponent at the top, shared stadium, play zones, counters, side panel, and
  board action buttons.
- Preserve zone placement, relative card sizing, overlap/fan behavior, board
  flipping, full-screen playmat behavior, theme/settings effects, and current
  self/opponent colors.
- Preserve the current side-panel tabs and content: Solo, Multiplayer, Deck, and
  Settings.
- Preserve context-menu labels, grouping, availability, and placement behavior.
- Preserve existing card backs, backgrounds, counters, markers, text, tooltips,
  chat styles, and loading/error feedback unless an asset cannot legally or
  reliably be served.
- The iframe boundary itself is not a feature and will be removed. Its visual
  result is the reference.

### Interaction

- Preserve drag targets, drop semantics, target highlighting, card selection,
  double-click behavior, right-click menus, card preview, zone opening/closing,
  sorting toggles, attached-card handling, and board flip/coaching behavior.
- Preserve all keyboard shortcuts and modifier behavior. Phase 1 must record
  them from `client/src/actions/keybinds/keybinds.js` in a machine-readable
  parity matrix before replacement begins.
- Preserve one-player control of both sides, two-player ownership behavior,
  spectator behavior, replay controls, undo outcomes, and chat announcements.
- Preserve existing deck import/build/setup/reset/export/import workflows and
  their accepted input formats.
- Pointer movement during drag is local-only; matching the gesture does not mean
  streaming pointer coordinates over the network.

### Product semantics

- PTCG Sim remains a permissive manual tabletop. The rebuild must not reject a
  legal testing shortcut merely because a full Pokémon rules engine would not
  infer it.
- Existing composite actions such as setup, take turn, shuffle-and-draw, move
  attached cards, and board-wide moves must retain their observable result.
- Server-side validation protects state integrity and player authority; it does
  not attempt to judge Pokémon card rules.

### Explicit non-goals

- A visual redesign, new component library, altered navigation, or restyled
  board.
- A mobile-responsive redesign. The current desktop experience is the parity
  target; basic safe operation at smaller sizes may be improved later.
- A Pokémon card-effects or turn-rules engine.
- Accounts, matchmaking, rankings, monetization, or social features.
- Rebuilding the card database/provider unless required to make asset delivery
  reliable.
- Reusing MagicCircle wholesale or forcing PTCG Sim into Quinoa's complete ECS,
  movement loop, or account/release infrastructure.

## The characterization baseline

Before implementation, Phase 1 records the legacy system as evidence:

1. A feature inventory linking each control and gesture to its current handler.
2. A command/action catalog for every dispatch entry in `accept-action.js`, with
   preconditions, state effects, visibility, messages, and undo behavior.
3. Golden v1 save/export, deck, replay, and action-log fixtures, including old
   versions still expected to import.
4. Playwright workflows for each protected user journey.
5. Fixed-viewport screenshots for empty, setup, mid-game, popup, menu, dark-mode,
   flipped, spectator, reconnect, and replay states.
6. Geometry captures for every zone and representative card stack.
7. Network recordings for join, action, request-opponent-action, resync,
   spectator, reveal/look, export, disconnect, and reconnect flows.
8. Performance profiles for startup, setup, shuffle, large discard/deck views,
   board refresh, drag, reconnect, and a long session.

The baseline is versioned under `tests/legacy-fixtures/` and
`tests/e2e/legacy-baselines/`. Tests must use controlled card images and fonts so
external asset changes do not invalidate comparisons.

## Parity classification

Every legacy behavior receives one of these labels:

| Label                             | Meaning                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `MUST_MATCH`                      | User-visible behavior must match before v2 release.                                                |
| `MATCH_WITH_TOLERANCE`            | Canvas/font differences are allowed within a recorded visual or timing tolerance.                  |
| `BUG_COMPATIBLE_PENDING_DECISION` | Existing behavior may be a bug, but changing it requires an explicit decision and regression test. |
| `SECURITY_EXCEPTION`              | Legacy behavior is intentionally blocked because it leaks data or permits unauthorized mutation.   |
| `DEFERRED`                        | Not required for first v2 release and approved as such by the product owner.                       |

No behavior may disappear merely because it was difficult to discover in the
legacy code. Any exception must be visible in the parity matrix and release
notes.

## Definition of UX preservation

“No UI/UX change” does not require identical implementation or every pixel to
be mathematically equal. It requires:

- the same controls and information in the same places;
- the same action available through the same gesture/shortcut;
- the same logical outcome and feedback;
- no new latency that changes the feel of interaction;
- no loss of accessibility already available through DOM controls; and
- screenshots and geometry within the thresholds in the verification plan.

Security fixes may change what a user can learn or mutate only when the old
behavior was unauthorized. Those exceptions must be tested and documented.
