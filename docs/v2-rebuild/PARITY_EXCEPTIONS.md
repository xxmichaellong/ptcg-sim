# V2 parity exceptions

- Status: **accepted seed register; expand when a newly discovered behavior is
  classified**
- Last reviewed: 2026-09-23
- Scope: intentional v2 departures from observable v1 behavior

## Rule

V2 preserves the existing UI, controls, gestures, and outcomes unless a row here
or a dedicated ADR authorizes a difference. `APPROVED_FIX` applies only when the
legacy result is a demonstrable correctness or lifecycle defect and the intended
visible workflow remains unchanged. `SECURITY_EXCEPTION` applies only when
preserving v1 would disclose or grant unauthorized state. Deferred compatibility
must have product-owner approval.

Every new exception requires reproducible v1 evidence, a v2 regression test,
security and persistence review where relevant, and release-note disposition.

## Accepted exceptions

| ID     | V1 behavior                                                                                                                                 | V2 disposition                                                                                                                                               | Class                | Evidence                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| PX-001 | A replay/lifecycle shortcut guard references the Alt helper rather than invoking it, allowing historical state to reach mutation routing.   | Replay remains read-only; the affected shortcuts submit nothing while replaying.                                                                             | `APPROVED_FIX`       | `ADR-004-BOARD-RENDERER.md`; shortcut bridge and browser replay tests                                           |
| PX-002 | A drag self-target check compares an element with `draggedImage[0]`, so a logically inert self/same-container drop can enter mutation code. | Semantic drop resolution rejects self, same-zone, and unsupported-source no-ops before command submission.                                                   | `APPROVED_FIX`       | `packages/interaction-controller`; `tests/multiplayer/client-server-session.test.ts`; native drag browser tests |
| PX-003 | Preview/counter paths can install repeated global and resize listeners.                                                                     | One route/lifecycle owner installs bounded listeners and removes them deterministically, including StrictMode remount and active-gesture teardown.           | `APPROVED_FIX`       | `packages/interaction-controller`; `apps/web/src`; lifecycle, churn, and browser teardown tests                 |
| PX-004 | Failed image preloads can leave stale nodes or requests coupled to the board.                                                               | Native image failure is contained in a stable neutral surface; stale asynchronous completion cannot change logical state or retarget a reused node.          | `APPROVED_FIX`       | `packages/renderer-dom/src/ReactDomBoardRenderer.test.tsx`; asset lifecycle/browser tests; ADR-013              |
| PX-005 | `refreshBoard()` can reorder/move logical arrays to repair visual hierarchy.                                                                | Layout and refresh are pure projections. They preserve characterized geometry without mutating domain state, identity, or order.                             | `APPROVED_FIX`       | ARCH-003; `packages/renderer-contract`; `LEGACY_BOARD_LAYOUT_ORACLE.md`; renderer parity suites                 |
| PX-006 | UI, package, action-export, and saved data versions can disagree.                                                                           | Build, wire protocol, authority snapshot, match state, event/replay, and file formats use separate explicit versions and migrations.                         | `APPROVED_FIX`       | Protocol constants; durable/file migrations; health endpoint; schema compatibility tests                        |
| PX-007 | V1 save import applies positional actions incrementally and has unreliable version gating.                                                  | The quarantined converter is bounded, allowlisted, version-selected, invariant-checked, and all-or-nothing; ADR-021 keeps it unwired in the first release.   | `SECURITY_EXCEPTION` | `packages/legacy-import`; `LEGACY_IMPORT.md`; ADR-021                                                           |
| PX-008 | Four-character save keys can collide and overwrite data.                                                                                    | V2 never preserves this key space or overwrite behavior. Future continuation uses distinct high-entropy, digest-stored, expiring capabilities under ADR-012. | `SECURITY_EXCEPTION` | PERSIST-004; ADR-012; collision and credential-boundary tests                                                   |
| PX-009 | A default administrative password can create a production authority boundary.                                                               | V2 inherits no default admin credential and fails closed when required deployment configuration is absent or invalid.                                        | `SECURITY_EXCEPTION` | SEC-001/SEC-003; server configuration, bundle-boundary, and telemetry redaction tests                           |
| PX-010 | Solo undo derives from two client-side action histories, so interleaved shared changes have no single reliable last-command order.          | V2 keeps the same visible Undo control but uses authoritative whole-match order and exact resolved outcomes, reading the bounded replay history (ADR-026).   | `APPROVED_FIX`       | ADR-014; ADR-026; game-core and room-authority undo tests                                                       |

## Product-requested departures

These change v1's look or behaviour on purpose, at the owner's request during
play testing. Each one sits behind a single named constant or guard, so
restoring v1 exactly is a one-line change.

| ID     | V1 behavior                                                                                                                                    | V2 disposition                                                                                                                                                                                              | Class             | Evidence                                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------- |
| PX-014 | `#bench div { margin-right: 1% }` sets the whole gap between bench groups.                                                                     | `LEGACY_BENCH_GROUP_GAP_BONUS_RATIO` adds half of itself to each side of every bench container, so the gap between neighbours grows by that ratio of the bench row while a centred row keeps v1's position. | `PRODUCT_REQUEST` | `layout.test.ts` pins v1's own spacing with the bonus off and the delta on                                  |
| PX-015 | `.full-view img { height: 24% }` paints every card of a stack expansion at one size, leaving a short stack adrift in an otherwise empty popup. | `legacyStackPreviewCardHeightRatio` picks the largest size that still fits the set, capped so one card cannot fill the panel and floored at v1's 24%, past which rows spill exactly as v1's do.             | `PRODUCT_REQUEST` | `layout.test.ts` covers the fit, the monotonic shrink and the v1 floor                                      |
| PX-016 | Undo exists only in Solo; v1 removed `p2UndoButton` and the two-player `u` keybind.                                                            | A multiplayer player has `#p2UndoButton` and `u`, and instantly takes back their own move while it is still the newest one standing. Restoring v1 is one guard in `resolveWireCommand`.                     | `PRODUCT_REQUEST` | ADR-026; `process-command.test.ts`; `client-server-session.test.ts`; `remote-room-lobby-full-stack.spec.ts` |

### Departures for real card mechanics (2026-10-13)

The owner accepted these after an independent review flagged them against
ADR-027's behaviour rule. They follow how the physical game works, and none
is a single toggle; restoring v1 means reverting the named resolver.

| ID     | V1 behavior                                                                                        | V2 disposition                                                                                                                                                  | Reason            | Evidence                                                                       |
| ------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| PX-017 | Q/E attach targeting highlights only the source player's Active and Bench.                         | Attachment targets include both boards, for Tools played onto the opponent's Pokémon (Head Ringer, Jamming Net). Evolution still targets only the source board. | `PRODUCT_REQUEST` | `resolveAttachEvolveTargeting.test.ts`                                         |
| PX-018 | A card owned by the other player enters the zone of the player moving it (work-area bulk buttons). | It keeps its owner and goes to its owner's matching zone, as a foreign Tool returns to its owner in the TCG; bulk staged moves split by owner.                  | `PRODUCT_REQUEST` | `staged-bulk-commands.test.ts`, `resolveCardZoneMoveAction.test.ts`            |
| PX-019 | G (with or without Shift) replaces the Stadium.                                                    | G replaces it, or joins a matching missing piece of a two-card Legendary Stadium; Shift+G adds another piece for manual layouts, up to four.                    | `PRODUCT_REQUEST` | `resolveLegacyBoardShortcutAction.test.ts`, `stadium-movement-command.test.ts` |
| PX-020 | A card dropped from play or a work area onto an occupied Stadium is refused.                       | It replaces the Stadium, as G does; the displaced pieces go to their owners' discards in the same revision.                                                     | `PRODUCT_REQUEST` | `resolveBoardDrop.test.ts` (PX-020 case), `stadium-movement-command.test.ts`   |
| PX-021 | An overflowing hand keeps full-size cards and scrolls (`#hand { overflow-x: auto }`).              | On the redesigned table (geometry v2) the hand fans its cards, overlapping them evenly so all stay on screen; a hovered card rises. Owner informed 2026-10-09.  | `PRODUCT_REQUEST` | `layout-table.test.ts` ("overlaps it when crowded")                            |

### The Board view panel (2026-10-13)

The owner asked to replace the split's drag handles with one place that sets
how the table is shown. It applies to the redesigned table (geometry v2);
v1's geometry and its handles are unchanged.

| ID     | V1 behavior                                                                                                            | V2 disposition                                                                                                                                                                                                                       | Reason            | Evidence                                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------- |
| PX-022 | The split between the halves is dragged by `#selfResizer` / `#oppResizer`.                                             | No handles. The split is a slider (a third to two thirds, as before) in the Table section of Settings (ADR-030; first a Board view panel).                                                                                           | `PRODUCT_REQUEST` | `LegacyBoardChrome.test.tsx`, `TableViewControls.test.tsx`, `board-view.spec.ts`, `dev-room-full-stack.spec.ts` |
| PX-023 | Both halves always show.                                                                                               | Either half can be hidden ("Mine" is the bottom half, "Theirs" the top). The other half fills the table, as large as its width allows; the hidden half's zones and cards leave the scene, and its coin lands on the half that shows. | `PRODUCT_REQUEST` | `layout-table.test.ts`, `CoinFlipOverlay.test.tsx`, `board-view.spec.ts`                                        |
| PX-024 | Hide containers and Hide opponent's hand (Solo mode) are Settings checkboxes, forgotten on reload, and shown in rooms. | They move to the Table section of Settings as Zone outlines and Hide opponent's hand, kept on this device with the split, the halves and the depth. Hide opponent's hand is offered only in Solo, the only place it ever applied.    | `PRODUCT_REQUEST` | `board-view-settings.test.ts`, `RemoteRoomRoute.test.tsx`, `remote-room-lobby-full-stack.spec.ts`               |

The redesign's large hover preview beside the table (not in v1) is off by
default and can be turned on in the same panel.

### Keyboard shortcuts (2026-10-13)

The owner asked for a button and a clearer dialog in place of the hold-Shift
sheet, and for players to choose their own keys (ADR-028).

| ID     | V1 behavior                                                                                              | V2 disposition                                                                                                                                                                                                     | Class             | Evidence                                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| PX-025 | Holding Shift shows the keybind reference (`#keybindModal`) until Shift is released; the keys are fixed. | `?` (or the menu's Keyboard shortcuts, Settings or the welcome card) opens a shortcuts dialog with a keyboard map and search. Players may move any shortcut but the number keys and Esc, and reset them (ADR-028). | `PRODUCT_REQUEST` | `ShortcutsDialog.test.tsx`; `keymap.test.ts`; `LegacyBoardKeyboardShortcuts.test.tsx`; `keyboard-shortcuts.spec.ts` |

### The table-first shell and phones (2026-10-14)

The owner asked for the table to have the screen, for the controls on it to
be the game's, for an empty deck to offer a deck, for an optional Lost Zone,
and for phones and touch screens to work (ADR-030). It applies to the
redesigned table; v1's geometry harnesses keep v1's shell.

| ID     | V1 behavior                                                                                                                                                 | V2 disposition                                                                                                                                                                                                                                                                                                                                                                                    | Reason            | Evidence                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| PX-026 | A permanent right sidebar: Solo, Multiplayer, Deck and Settings tabs, the battle log and chat, and the lifecycle buttons.                                   | The table fills the window. An app menu (rail, left) reaches Play online, Deck, Settings, saves and replays, full screen and help; the activity log (rail, right) opens the log and chat, docked beside the table on a wide screen and over it elsewhere, with an unread count and the other side's newest lines while closed. Deck is a full-window screen; Settings and Play online are sheets. | `PRODUCT_REQUEST` | `RemoteRoomRoute.test.tsx`, `RemoteRoomLobby.test.tsx`, `ActivitySheet.test.tsx`, `remote-room-solo-full-stack.spec.ts` |
| PX-027 | Turn, Coin, Flip board, Refresh images and Full screen on the board; Attack, Pass, Undo, Set Up, Reset, Set Up Both, Reset Both and Options in the sidebar. | One rail at the seam holds the turn's actions by seat stage (Load a deck or Set up first, then Turn, Attack, Pass, Coin, Undo, Switch side), the rarer ones behind More, replay's transport in replay. Full screen moves to the menu.                                                                                                                                                             | `PRODUCT_REQUEST` | `LegacyBoardChrome.test.tsx`, `RemoteSessionBoard.test.tsx`, `RemoteRoomRoute.test.tsx`                                 |
| PX-028 | Refresh images re-assigns every board image's address; nothing retries on its own.                                                                          | A failed card image retries by itself with backoff and when the browser comes back online; R and Reload card images retry every failed image now. No toolbar button.                                                                                                                                                                                                                              | `PRODUCT_REQUEST` | `card-image-retry.test.ts`, `RemoteSessionBoard.test.tsx`                                                               |
| PX-029 | The Lost Zone always shows.                                                                                                                                 | Optional, off by default: an empty Lost Zone leaves the table; `+ Lost Zone` under the discard adds it, an empty one can be hidden again, and Settings has the switch. One holding cards always shows.                                                                                                                                                                                            | `PRODUCT_REQUEST` | `layout-table.test.ts`, `scene.test.ts`, `TableZoneAffordances.test.tsx`                                                |
| PX-030 | An empty deck pile is an empty slot; decks load from the Deck tab.                                                                                          | Before a seat has cards its deck pile shows `+`, which opens the deck screen for that seat.                                                                                                                                                                                                                                                                                                       | `PRODUCT_REQUEST` | `TableZoneAffordances.test.tsx`, `RemoteRoomRoute.test.tsx`                                                             |
| PX-031 | A phone or tablet is told on load to use a desktop; the board needs right-click and double-click.                                                           | Phones and touch are supported: a portrait table on upright phones, a tapped card's Read and Actions bar, tap-again to read, 44px targets, bottom sheets. The notice is gone and ADR-023's desktop minimum is superseded.                                                                                                                                                                         | `PRODUCT_REQUEST` | `layout-table.test.ts`, `TouchCardBar.test.tsx`, `RemoteSessionBoard.test.tsx`                                          |
| PX-032 | A flower button beside the chat field posts 🌺 as an unnamed player line.                                                                                   | Removed at the owner's request. A 🌺 typed into chat is a named line like any other.                                                                                                                                                                                                                                                                                                              | `PRODUCT_REQUEST` | `RemoteRoomLiveControls.test.tsx`, `PresentationEffects.test.ts`, `remote-room-lobby-full-stack.spec.ts`                |
| PX-033 | A held shortcut key repeats with the system's key repeat (holding Alt+N sets up again many times a second).                                                 | A held key acts once; its repeats are kept from the browser and do nothing. Let go and press again to repeat.                                                                                                                                                                                                                                                                                     | `PRODUCT_REQUEST` | `LegacyBoardKeyboardShortcuts.test.tsx`                                                                                 |

## Open differences awaiting a product decision

The [2026-09-23 file review](reviews/2026-09-23-v1-transfer-review.md) records
differences beyond PX-013. These are **open findings, not approved
exceptions**, and the review's inventory supersedes earlier broad SAME claims.
Carried since it was written: decklist-versus-alphabetical sorting (F-01),
live-session leave warnings (F-02), popup ingress (PX-013/F-05), loose-board
sizing and append scrolling (F-03) and prize card sizing (F-07, whose
default-background half turned out not to be a difference) are implemented and
closed, as are the flipped-seat ephemeral announcements (F-10) and the
source-data maintenance gap (F-09). No finding from that review is open.

PX-013 was the only row in this section and is now closed. The review keeps
the original findings and records their later resolution separately.

## Resolved after the 2026-09-23 review

PX-013 is closed. `zones.js` registers the open `viewCards` / `attachedCards`
popups as drop targets, and v2 now does the same: `MoveCardToWorkArea` takes a
card from a zone, a play stack, or the other popup into the open work area,
restoring its out-of-play look (original category, face up, upright, marker
cleared) and inheriting the inspection's viewers, and the battle log prints
v1's line ("moved X from hand to deck", "to attached cards"). A loaded host
takes its stack with it exactly as v1's `relocateAttachedCards` does. Its
dependents open the attached-card window or join that window when it is already
open, whether the host moves into either popup or an ordinary zone. Evidence:
`work-area-arrival-commands.test.ts`, `movement-departures.test.ts`,
`resolve-work-area-arrival.test.ts`, `resolveBoardDrop.test.ts`,
`predictWireCommand.test.ts`, `narration-events.test.ts`.

Review qualification: [F-05](reviews/2026-09-23-v1-transfer-review.md#f-05--medium--open-popup-ingress-is-only-partially-restored)
raised the top-card-with-dependents refusal as an open parity gap, because
legacy `relocateAttachedCards` stages those dependents. That compound move is
now implemented and covered by `work-area-arrival-commands.test.ts`. A later
review also removed the remaining occupied-window refusal; source departures
append to the existing attached-card work area and preserve its ID. F-10 was
also closed after the original review.

## Resolved after the 2026-09-17 audit

The two behaviours the file-by-file audit left open were carried on the
owner's decision the same day: a flipped board now acts for the seat at the
bottom (Solo, or a room where both players enabled board flip), with the
actor-bound wire commands naming that seat; and an overflowing hand keeps its
cards full size and scrolls, as v1's `#hand { overflow-x: auto }` does. (The
redesigned table later fans the hand instead: PX-021.)

## Approved compatibility deferral

ADR-021 defers v1 saved-game/action-history files and old `/import?key=` share
links from the first v2 release. Deck import and v2 perspective replay import
remain in scope. This deferral is not permission to drop any other workflow.

## Rollback and review

An exception can be removed by restoring parity only when doing so does not
reintroduce the recorded correctness, security, or lifecycle failure. If a fix
changes a visible workflow beyond the row above, pause that slice and obtain a
new product decision rather than broadening the exception in implementation.
