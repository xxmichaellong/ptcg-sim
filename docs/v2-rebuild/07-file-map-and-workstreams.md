# File map and workstreams

## Mapping principle

Legacy files are behavioral evidence, not modules to mechanically translate.
Many mix domain, rendering, transport, and messages; their responsibilities must
land in several target packages. Conversely, a target reducer often replaces
pieces scattered across multiple legacy files.

The paths below are proposed and may be renamed by a Phase 0 ADR, but ownership
and dependency direction are required.

## Repository and application shell

| Current files                                        | Target files                                                                 | Treatment                                                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| root `package.json`, `pnpm-workspace.yaml`, packages | root workspace/tool configs plus `apps/*`, `packages/*`                      | Expand workspace; preserve v1 scripts until retirement.                                                                                         |
| `client/index.ejs`                                   | `apps/web/index.html`, `src/main.tsx`, `src/app/App.tsx`, feature components | Recreate the same DOM chrome and styles; remove EJS data injection after compatibility route exists.                                            |
| `client/self-containers.html`, `opp-containers.html` | selected renderer layout/scene plus React overlays                           | Remove iframe implementation only after visual/interaction parity.                                                                              |
| `client/src/css/index.css`, self/opp CSS             | `apps/web/src/styles/*`, `src/board/layout/boardGeometry.ts`                 | Preserve style tokens/geometry; consolidate duplicate transforms after baseline extraction.                                                     |
| static assets under `client/src/assets`              | `apps/web/public/v2/assets` or imported assets                               | Preserve visible assets and add deterministic test copies/license inventory. The default card back is copied byte-for-byte and integrity-gated. |

Implemented repository enforcement files:

```text
.github/workflows/ci.yml
eslint.config.mjs
tsconfig.browser.json
scripts/check-v2-boundaries.mjs
scripts/check-v2-boundaries.test.mjs
scripts/check-v2-public-api.mjs
scripts/check-v2-public-api.test.mjs
scripts/check-legacy-import-corpus.ts
scripts/check-legacy-import-corpus.test.ts
scripts/tsconfig.json
docs/v2-rebuild/PUBLIC_API_SURFACE.json
```

The root `check:ci` command is the non-browser merge gate. It covers the frozen
legacy unit suite, scoped formatting and linting, source/workspace boundaries,
reviewed compiler-resolved public exports, cycle detection without generated
output, strict production/model/runtime/browser type checks, tooling self-tests,
v2 unit/runtime tests, both production builds, source-map provenance,
fixture-leak detection, and canonical card-back integrity. `check:browser` owns
the sequential Chromium lane. The exact contract and residual limitations are
in [`QUALITY_GATES.md`](./QUALITY_GATES.md).

## Client composition and state

| Current files                                         | Target files                                                                                                              | Treatment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/src/front-end.js`                             | `apps/web/src/main.tsx`, `src/app/createApplication.ts`                                                                   | Replace global import-time initialization with explicit lifecycle composition.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `initialization/global-variables/global-variables.js` | `src/session/*`, `src/state/gameViewStore.ts`, `presentationStore.ts`, settings/identity stores                           | Split connection, view, presentation, deck, and preference state; no DOM references.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `initialization/document-event-listeners/**`          | React component handlers, `src/board/input/*`, feature controllers                                                        | Bind through component/engine lifecycle with teardown; preserve the handler matrix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `initialization/mutation-observers/**`                | domain selectors + renderer/React subscriptions                                                                           | Delete; state publications explicitly drive view changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `setup/settings/settings.js` and settings listeners   | `apps/web/src/session/{RemoteRoomSettings,browser-room-background,useRoomBackground}.ts*`, then `src/features/settings/*` | The isolated lobby owns page-local Settings across lobby/live/replay: Dark mode and Hide containers update renderer/chrome without remount or traffic; the source Solo-only hand checkbox is an explicit multiplayer no-op; static keybind/contact content is restored with an inline mark. Default-visible zone/stadium paint preserves every hit region. Accepted ADR-013 preserves `blank`, randomized `theme`, and arbitrary player-pasted backgrounds through a direct preloaded route-only browser image; no setting writes game state or sends the URL through protocol, authority, replay, storage, telemetry, or Pixi. |
| `setup/home-header/*`, sidebox tab/header files       | `src/app/navigation/*`, feature components                                                                                | React DOM port with parity tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Domain state and actions

| Current files                                                     | Target files                                                                      | Treatment                                                                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `setup/zones/get-zone.js`                                         | `packages/game-core/src/model/zones.ts`, selectors/location index                 | Ordered stable IDs replace arrays tied to iframe elements.                                    |
| `setup/deck-constructor/card.js`, `cover.js`, `build-deck.js`     | core card/stack factories + render model + renderer view/texture registry         | Separate definition/instance construction from all display objects.                           |
| `actions/move-card-bundle/move-card.js`                           | `game-core/src/commands/movement/*`, events/apply, stack/work-area policies       | Split into pure atomic transitions; no renderer/message/DOM work.                             |
| remaining `actions/move-card-bundle/**`                           | movement/stack event decisions + presentation event formatting + renderer layouts | Preserve stadium, active/bench swap, counter migration, stack departure semantics explicitly. |
| `actions/zones/**`                                                | `game-core/src/commands/zones/*`, `events/*`                                      | Stable-ID ordered-zone operations; authority resolves random/top/bottom selectors.            |
| `actions/counters/**`                                             | `game-core/src/commands/markers/*`, render marker views, React editor overlay     | Bounded canonical marker values; one shared UI editor/lifecycle.                              |
| `actions/general/setup.js`, `reset.js`, `take-turn.js`            | lifecycle/turn command decisions and atomic event batches                         | Characterize all side effects before modeling.                                                |
| `actions/general/reveal-and-hide.js`                              | visibility commands, inspection/reveal state, projector, safe timeline            | No client relay or visual-only secrecy.                                                       |
| `actions/general/rotate-card.js`, `change-type.js`, `VSTAR-GX.js` | card/stack annotation commands and views                                          | Model current/BREAK rotation and category override explicitly.                                |
| `actions/general/board-actions.js`, zone bulk actions             | transactional bulk command/event batches                                          | One accepted command/revision, no intermediate publication.                                   |
| `actions/general/flip-coin.js`                                    | authority-resolved random event + timeline/UI                                     | Persist result; no client-chosen randomness.                                                  |
| `actions/general/flip-board.js`                                   | presentation perspective/layout/settings                                          | Remains local except characterized coaching consent/visibility effects.                       |
| `actions/general/close-popups.js`                                 | presentation reducer/React overlay controller                                     | Purely local cleanup reconciled against current view IDs.                                     |
| `actions/general/undo.js`                                         | solo checkpoint/history command and replay service                                | Preserve current solo-only availability; multiplayer undo is a separate future decision.      |
| `actions/chat-buttons/**`, chatbox files                          | safe timeline events and `features/chat/*`                                        | Structured attack/pass and bounded safe chat; retain labels/messages.                         |

## Input and rendering

| Current files                                          | Target files                                                    | Treatment                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `setup/image-logic/click-events.js`                    | `apps/web/src/board/input/BoardInputController.ts`, overlays    | Stable recipient-safe view IDs and semantic intents.                                            |
| `setup/image-logic/drag.js`                            | pointer-capture drag controller, renderer drag/highlight views  | Local movement, one stable-ID command on drop, explicit cancel/rejection behavior.              |
| `setup/image-logic/reset-image.js`                     | pure render descriptor defaults + renderer sync                 | No custom properties on images/views as logical state.                                          |
| `actions/keybinds/keybinds.js`, `keybindSleep.js`      | `src/board/input/KeyboardController.ts`, declarative keymap     | Preserve every characterized mapping; remove timing-based global suppression where unnecessary. |
| context-menu listener directory                        | `src/board/overlays/CardContextMenu.tsx`, availability selector | React DOM and one permission/presentation matrix.                                               |
| `setup/sizing/refresh-board.js`, `adjust-alignment.js` | pure `BoardLayout` and scene synchronizer                       | Delete any visual repair that mutates zone order.                                               |
| `setup/sizing/resizer.js`, table resizer listeners     | `BoardViewport.tsx`, pure layout, persisted presentation split  | Pointer-safe, frame-coalesced, flip-aware parity behavior.                                      |
| mutation observers                                     | explicit render/app selectors                                   | Entire mechanism retired.                                                                       |

Implemented renderer decision files (React DOM is selected; Pixi remains
unwired evidence):

```text
packages/renderer-contract/src/
  model.ts
  geometry.ts
  layout.ts
  scene.ts
  spike-fixture.ts
packages/renderer-dom/src/
  ReactDomBoardRenderer.tsx
  BoardSurface.tsx
packages/renderer-pixi/src/
  PixiBoardRenderer.ts
  CardTextureRegistry.ts
apps/web/src/
  RendererSpikeBoard.tsx
  board/BoardSessionRuntime.ts
  board/ReactDomBoardSessionRuntime.ts
  board/PixiBoardSessionRuntime.ts
```

The implemented marker boundary is intentionally narrower than the eventual
`MarkerViewSystem`: renderer-contract owns canonical active-q0 current-state geometry,
side/presentation descriptors, and stable marker diffs; React DOM consumes the
source-backed circle/tab paint; Pixi reuses keyed marker views without texture
churn. Real owner/opponent/spectator coverage protects recipient aliases and
geometry. Rotated/history-dependent, bench, BREAK/compound, attachment/
transfer, editing, and Pixi-native paint/hit cases remain generic or deferred.

If ADR-004 is reopened and Pixi later wins, split the compact spike adapter into
the following production systems as those responsibilities gain behavior. Do
not create empty structure before it has real ownership to contain:

```text
packages/renderer-pixi/src/
  host/PixiRendererHost.ts
  scene/BoardScene.ts
  scene/layers.ts
  sync/syncBoardScene.ts
  views/CardView.ts
  views/PlayStackView.ts
  views/ZoneView.ts
  views/MarkerView.ts
  views/DragView.ts
  assets/CardTextureManager.ts
  assets/TextureLease.ts
  scheduler/RenderScheduler.ts

apps/web/src/board/
  BoardViewport.tsx
  BoardSessionController.ts # additive headless reducer/store implemented; not production-wired
  BoardSessionAdapter.ts    # additive public live/replay composition; not production-wired
  BoardSessionRuntime.ts         # additive renderer-neutral composition; uninstantiated by routes
  ReactDomBoardSessionRuntime.ts # selected thin wrapper; still uninstantiated by routes
  PixiBoardSessionRuntime.ts     # experimental thin wrapper; uninstantiated by routes
  model/createBoardRenderModel.ts
  layout/boardGeometry.ts
  input/BoardInputController.ts
  input/KeyboardController.ts
  overlays/CardContextMenu.tsx
  overlays/ZoneViewer.tsx
  overlays/CardPreview.tsx
  overlays/CounterEditor.tsx
  a11y/BoardAccessibilityBridge.tsx
```

If React DOM wins, it implements the same `BoardRenderer` contract under a
separate package; core, protocol, view-model, input-intent, fixture, and parity
work do not change.

## Dispatch, networking, and multiplayer

| Current files                                            | Target files                                                                                   | Treatment                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `setup/general/accept-action.js`                         | exhaustive command/event unions, schema-validated dispatch                                     | No function-name lookup; compiler and runtime reject unknown variants.       |
| `setup/general/process-action.js`, add/clean action data | client session/outbox + server command pipeline/journal                                        | Remove peer logs/counters as authority.                                      |
| catch-up/resync/sync/replay-block files                  | `packages/client-session/src/session.ts`, snapshot install/reconcile, server session frontiers | Full projected snapshots replace client action replay for sync.              |
| socket event listeners                                   | `packages/client-session/src/session.ts`, `transport.ts`, protocol client codec                | Runtime-validate every message and explicitly manage reconnect/supersession. |
| `setup/spectator/**`                                     | server spectator role/projector + client session view                                          | Spectator never receives player action log/deck data.                        |
| reveal/look relay events                                 | visibility commands and per-recipient publications                                             | Role-scoped server truth.                                                    |
| `server/server.js` room relay                            | `apps/server/src/do/MatchRoom.ts`, admission, ingress, persistence, projection publication     | Replace username sets/generic relay with authoritative room service.         |
| Socket.IO CDN in `index.ejs`                             | typed native WebSocket transport adapter                                                       | Exact transport selected by backend ADR; no global `io`.                     |

Implemented authority/admission boundaries include
`packages/room-authority/src/admission.ts`,
`apps/server/src/browser-json-http.ts`, `room-creation-http.ts`,
`room-invitation-http.ts`, `admission-ticket-http.ts`, `session-handshake.ts`,
`session-hub.ts`, `room-chat.ts`, `durable-storage.ts`, `room-rate-limit.ts`,
`request-rate-limit.ts`, `server-health.ts`, `server-telemetry.ts`,
`OPERATIONS.md`, and `worker.ts`. Lifecycle and per-room limits share the Durable
Object transaction boundary; only coarse creation allocation uses the platform
edge binding. Telemetry is a non-throwing, closed adapter outside authority
state. The strict client-side
creation/admission/invitation composition lives in
`apps/web/src/session/RemoteRoomCreation.ts` and `RemoteRoomBootstrap.ts`.
Accepted ADR-020 adds the strict protocol text codec plus
`browser-invitation-clipboard.ts` and `RemoteRoomInvitationHandoff.ts`: creator
copy returns only safe metadata, native paste prevents DOM insertion, and guest
bootstrap owns the private claim through exchange. `RemoteRoomLobby.tsx` now
wires those boundaries to the unchanged visible controls behind the isolated
`?room-lobby=1` route, bounds manual Room ID state, submits initial coaching
consent only from a ready player view, and owns creator/guest teardown.
`RemoteRoomLiveControls.tsx` preserves the connected sidebox IDs while mapping
ready-player actions to existing atomic resolvers, mapping shared chat/flower
through the authenticated ephemeral session API, withholding player mutations
from spectators, hiding live controls during replay, and returning confirmed
leave to fresh lobby custody after runtime disposal. The later production split
also now includes `browser-room-options.ts`, which derives the legacy numbered
battle-log file from recipient-safe activity, performs a foreground bounded-text
download with object-URL revocation, and starts document full screen from both
live and replay menus. Clear log uses the route-owned presentation reset and
remains hidden in replay. No canonical-state serializer or file import is
implied. The later production split remains:

```text
apps/server/src/
  do/MatchRoom.ts
  do/MatchPersistence.ts
  do/MatchSocketSession.ts
  do/CommandExecutionQueue.ts
  ingress/readEnvelope.ts
  ingress/parseCommand.ts
  ingress/rateLimit.ts
  admission/roomTickets.ts
  admission/seatTokens.ts
  authority/executeCommand.ts
  authority/permissionMatrix.ts
  publication/publishViews.ts
  saves/SavedMatch.ts
  observability/*

packages/client-session/src/
  model.ts
  replay-playback.ts
  session.ts
  transport.ts

apps/web/src/session/
  useGameSession.ts
  RemoteSessionBoard.tsx
  browser-json.ts
  RemoteRoomCreation.ts
  RemoteRoomBootstrap.ts
  RemoteRoomRuntime.ts
  RemoteRoomRoute.tsx
  RemoteRoomLobby.tsx
  LocalGameSession.ts

apps/web/src/replay/
  LegacyReplayControls.tsx
  ReplayModeShell.tsx
  ReplayPresentationDispatcher.ts
  ReplaySessionCoordinator.ts
  useReplayPlayback.ts
  useReplaySession.ts

apps/web/src/presentation/
  AccessibilityAnnouncementDrain.ts
  ActivityFeedModel.ts
  GamePresentationCoordinator.ts
  GamePresentationRuntime.ts
  ImmutableLogDispatcher.ts
  LegacyGamePresentationRuntime.ts
  LegacyPresentationSurface.tsx
  PresentationAnimationExecutor.ts
  PresentationConsumerRuntime.ts
  PresentationEffects.ts
  PresentationRuntime.ts
  SerialPresentationConsumer.ts
  SessionChatDispatcher.ts
  SessionPresentationDispatcher.ts
  usePresentationRuntime.ts
```

## Import, export, replay, and decks

| Current files                                         | Target files                                                                                                                                                                                                                                                       | Treatment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup/deck-builder/core/*.mjs`                       | `packages/deck-core/src/*.ts`                                                                                                                                                                                                                                      | Port pure behavior and existing tests; fix only approved issues with fixtures.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| deck-builder tests                                    | package tests plus React/E2E adapter tests                                                                                                                                                                                                                         | Preserve 79 passing cases and extend boundary/CSV/self-alt cases.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `setup/deck-constructor/import.js`, find-type files   | `packages/deck-core/src/pasted-decklist.ts`, `apps/web/src/features/deck/{pasted-decklist-import,limitless-decklist-*}.ts`                                                                                                                                         | The local parser/type/image resolver and bounded credential-free Limitless completion are isolated. Provider/image failures may expose bounded transient review rows but never publish a partial deck; supported formats, six languages, and direct native arbitrary-image behavior are retained.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| native deck-builder listener/render/sync files        | `apps/web/src/features/deck/{LegacyDeckBuilderSession,LegacyDeckBuilderWorkspace,LegacyDeckImportPanel,popular-decklists,card-back-custody}.*`, `apps/web/src/dev/LegacyDeckBuilderBrowserHarness.tsx`, `tests/browser/legacy-deck-builder-browser-parity.spec.ts` | React DOM with independent main/alternate state and the unchanged visible workflow. The exact 168-deck corpus from `sample.decklists.js` is provenance-pinned and dynamically imported only after book/wand use; the right panel holds imports in an editable Save/Cancel/Confirm review transaction. One unmounted session owner composes both surfaces, persistent offline deck and card-back custody, dynamic solo/multiplayer capability, fresh-session reinstallation, acknowledged card-back-before-deck drains, one combined unload guard, the catalog, and the foreground browser image-load gate. Exact bounded arbitrary card-back strings remain direct native image URLs without an application parser, allowlist, proxy, fetch, or CORS requirement. A direct-import-only Chromium harness now compares complete v1 and candidate controls, geometry, and paint and exercises arbitrary-image, acknowledged recovery, multiplayer denial, focus, inertness, and teardown. It exposed and closed the viewport-relative panel-padding, inline-control-gap, Linux textarea-font, and panel/tab overlap-stacking differences. Production entry points still import none of this surface; only route activation remains separate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `initialization/load-import-data/load-import-data.js` | route loader + `legacy-import` transaction                                                                                                                                                                                                                         | Validate completely, convert once, install only on success.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| sidebox import/export/replay handlers                 | `room-authority/{replay-history,projected-replay}.ts`, `client-session/{session,replay-playback}.ts`, `apps/web/src/{session,replay,presentation}/*`, `features/saves/*`, `features/replay/*`                                                                      | Bounded delivery/playback, board guarding, replay chrome, mode-gated effects, seek-synchronized activity, authenticated bounded chat transport/presentation, serial consumers, legacy activity/live-region mounting, ticket-safe bootstrap, remote-room composition, connected Attack/Pass/flower/chat/Setup/Reset/Leave controls, the confirmed live Solo-header teardown, local live/replay Options for battle-log export, browser full screen, and live-only log clearing, and complete page-local Settings ownership including the accepted direct custom-background path are implemented; visible create/join UI remains isolated behind `?room-lobby=1`; Deck navigation and canonical save/replay import-export/continuation remain later work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| legacy action arrays/version                          | `packages/legacy-import/src/*`, then versioned `src/v1/*` interpreters                                                                                                                                                                                             | The strict 1.5/1.5.1 parser, 50-action allowlist, positional decoders, deterministic deck/identity/outcome adapters, and closed canonical transaction/replay proof are implemented without route wiring. The converted subset covers lifecycle, draws, deck-inspection creation plus same- and cross-viewer extension/zero-card revocation, atomic whole-inspection bulk resolution, individual inspection-card loose/targeted-play/new-play/deck-edge/shuffle/stadium movement, loose/stadium/play movement, rich stack movement and placement, every stack-card departure, individual staged-card loose/targeted-play/new-play/deck-edge/shuffle/stadium movement plus exact flat-tail deck-top swaps, exact `leaveAll` restoration, flat-ordered staged discard/lost-zone/hand draining, identity-translated staged deck shuffles, prize shuffles, zone-backed deck actions, markers/properties, table signals, resolved random hand play, same-player whole-match undo checkpoints, and bounded ordered custom-card-back preservation. Play and staged coordinates use the work area's explicit flat interaction order alongside semantic evolution and attachment lists: top sources move or swap stacks, numeric lower sources reattach, target-free stack cards depart with canonical dependent staging or independent removal, and staged cards move individually to loose zones, stack tops, normalized new stacks, deck edges, an exact single-card shuffle, or stadium, drain in popup order, or translate recorded bulk-shuffle indices to canonical command order; a compatible staged stack restores against exact board preconditions. Inspection coordinates use the current top/edge-first popup order and per-card viewer map and move individually to loose zones, existing stack tops, normalized new stacks, either deck edge, an exact recorded deck shuffle, or stadium. Target-free work-area play composes the existing individual departure through the owner's loose board with `MoveCardToPlay`, retaining two canonical batches under one all-or-nothing source record. Inspection- and staged-origin deck-top swaps preserve V1 source-tail return through internal optional atomic-swap modes, including empty-deck single-move branches. The staged event carries the exact flat tail and its V1 right-to-left semantic classification, so category-interleaved tails, later coordinates, snapshots, replay, reconnect, and restoration stay exact. Match-state schema v3 migrates old whole-inspection viewer sets to aligned per-card entries and truncates incompatible persisted replay/undo tails. Reachable loose-board turn cleanup plus owner-scoped loose/stadium/play reset are pinned. Every genuine native exported action now has a strict decoder and canonical transition or approved zero-batch normalization; complete privacy-reviewed corpus evidence before route installation, and never import the live v1 runtime. |

The public legacy-import boundary now also provides an unwired byte conversion
transaction and versioned report. It hashes exact bounded source bytes and
canonical stable-serialized target state with separate SHA-256 identities,
returns no state on any parse/semantic failure, and inventories omitted V1-only
presentation fields. `decode-card-back-actions.ts` now retains each bounded
saved custom-back URL and the canonical transaction emits ordered
`PlayerCardBackSet` events. Whole-match undo restores the prior value, final
state/event replay remains exact, and the importer never fetches or proxies the
URL. Corpus evidence and route installation remain.

Route installation is now mechanically quarantined: no workspace may declare
the importer as a production, optional, or peer runtime dependency, and neither
the web nor Worker production source-map policy admits importer provenance.
Dev-only dependencies remain available for isolated tests. The eventual route
change must carry the approved corpus evidence and explicitly revise both
source and bundle admission rather than inheriting accidental reachability.

The operator-only corpus runner accepts raw exports only from outside the
repository or the ignored `.private/legacy-import-corpus/` tree, reads them
sequentially, rejects links/duplicates/boundary excess, and emits a deterministic
digest-keyed report with action-family coverage but no filenames, paths, raw
content, card/deck names, image URLs, or diagnostic messages. Its synthetic
self-tests are part of the tooling gate. It prepares—but does not claim—the
privacy-reviewed representative real-user corpus evidence still required before
route installation.

The same private interpreter now admits exact empty-tuple `attack` and `pass`
records through one canonical table-action batch, preserving acting-board-only
cleanup, unchanged turn state, deterministic replay, and source-authentic
timeline facts without widening any public package or production route.

It also admits exact direct `discardBoard`, `handBoard`, `lostZoneBoard`, and
`shuffleBoard` records through the existing atomic loose-board command. The
source record's player selects the board; nonempty shuffle permutations are
validated against the current deck-plus-board basis, while source-authentic
empty records retain zero batches and require the serialized null shuffle
sentinel. No state, command, event, wire, renderer, route, UI, or UX schema is
widened.

The marker interpreter begins with exact `VSTARGXFunction` records. It accepts
only the shipped `GX` and `VSTAR` strings, uses record ownership to select the
player, derives the next explicit boolean from preceding candidate state, and
executes the existing atomic once-per-game command. Ordered repeat toggles and
both players remain deterministic without importing DOM class state or
widening any public package, schema, renderer, route, UI, or UX.

The same private marker interpreter now accepts exact `useAbility` and
`removeAbilityCounter` tuples for active, bench, discard, and stadium. It maps
current flat top-card coordinates to the existing stack command and
attachments/discard/owned-stadium coordinates to the existing per-card command.
Repeated source state no-ops retain zero batches; stale, cross-owner stadium,
and lower-evolution coordinates fail closed. No public package, state, command,
event, wire, renderer, route, UI, or UX schema is widened.

Damage marker decoding now covers exact active/bench add, update, and removal
tuples. The saved null default maps to `10`; bounded decimal strings reuse the
existing `SetDamage` command, and empty/zero/negative updates map to removal.
Source-valid existing-add, duplicate-update, and missing-remove records retain
zero batches. A private source-node-presence set preserves updates after
transient values normalize to canonical `null`; updates without a marker and
missing/lower/attachment coordinates fail closed. The private package
duplicates only the approved bounded value normalization and does not import
any client/runtime module or widen a public schema.

Special-condition marker decoding now covers exact active-only add, update, and
removal tuples. Add maps to the source default `P`; bounded strings reuse the
existing `SetSpecialCondition` trim and empty/zero-removal policy. Source-valid
existing-add, duplicate-update, and missing-remove records retain zero batches.
A private stack-to-exact-top presence map preserves transient null edits and is
pruned after evolution, stack departure, or an active-to-bench transition,
matching the source's automatic DOM-node cleanup. Markerless updates plus
missing, bench, lower-evolution, attachment, malformed, and over-bound targets
fail closed without importing client/runtime code or widening a public schema.

Rotation decoding now covers exact active/bench group-or-single tuples and the
nonsingle stadium tuple. It resolves the frozen flat play coordinate to a stable
stack card, advances the containing `RotateStack` target for group mode, toggles
the exact card's q0/q1 `SetCardOrientation` target for single mode, or advances
the owned stadium card modulo four. This is intentionally the same normalized
target-value model as production keyboard ingress; the importer does not add
V1's hidden inline-angle, wrapper-margin, or per-image `PokémonBreak` history to
canonical state. Missing, cross-owner, source-inaccessible, and malformed
records fail closed without importing client/runtime code or widening a public
schema.

Category-change decoding now covers exact
`changeType [initiator, zone, index, category]` tuples from all eleven
card-selectable source containers. Record ownership resolves the target while
the exported initiator is retained only as provenance. The exact stable card is
passed to the existing atomic `ChangeCardCategory` command, preserving V1's
departure to the owner's loose-board tail and current-category override while
canonical movement clears transient orientation and ability state. Stack-top,
attachment, staged, and inspection departures reuse their existing paths; an
already-matching board-tail record retains zero batches. Covers, lower
evolutions, stale/cross-owner coordinates, and malformed categories fail
closed. No core, protocol, authority, state, public API, renderer, route, UI,
or UX schema is widened.

Resolved-random decoding now covers exact
`playRandomCardFaceDown [initiator, randomIndex]` records. The saved V1 index is
supplied once to the existing import command context, so the canonical
`PlayRandomCardFaceDown` command selects the historical card without sampling
new randomness. Record ownership identifies the target hand/board and the
exported initiator identifies the actor. The command preserves its existing
trusted order snapshots, face-down normalization, visibility retirement, and
replay-safe event. Empty/depleted hands, stale or out-of-range indices, capacity
failures, and malformed tuples fail the complete candidate. No core, protocol,
authority, state, public API, renderer, route, UI, or UX schema is widened.

History decoding now covers the native `undo [null]` record produced when JSON
serialization converts V1's untouched undefined wrapper argument. The private
candidate holds at most 128 checkpoints for admitted non-bootstrap source records,
restores the latest same-player whole-match checkpoint through existing
`ApplySoloUndo`, and pops consecutive undos without rerunning prior commands or
resolved randomness. Export `self` is the actor and record ownership remains the
announcement target. It restores importer-only marker-presence metadata too;
state no-ops pop with zero batches. A top checkpoint owned by the other player
fails closed because V1's independent seat logs cannot be reconciled safely
with the approved V2 whole-match history rule. The eight reveal/look names are
proven socket-only and `exchangeData` is exporter-filtered, so injected records
receive the distinct `non_exported_action` failure. `changeCardBack` now uses
the accepted bounded canonical card-back transition with exact event replay and
undo. This widens the core/protocol/authority/public API command surface but not
the production route or current UI/UX.

## Files added during characterization

```text
docs/v2-rebuild/parity-matrix.*
docs/v2-rebuild/legacy-action-catalog.*
docs/v2-rebuild/parity-exceptions.md
tests/legacy-fixtures/{decks,saves,replays,network}/
tests/legacy-fixtures/renderer/{board-layout-v1,card-stack-layout-v1,contained-card-layout-v1,evolution-reflow-v1,energy-attachment-reflow-v1,trainer-tool-attachment-reflow-v1,two-energy-attachment-compaction-v1,mixed-energy-trainer-tool-attachment-order-v1,mixed-stack-movement-category-cycle-v1,marker-rotation-v1,bench-marker-rotation-v1,compound-group-rotation-v1,compound-break-rotation-v1,compound-break-refresh-q0-q2-v1,compound-break-refresh-q3-v1,compound-nonzero-group-single-v1,compound-lower-group-rotation-v1,compound-lower-q0-single-v1,compound-lower-nonzero-group-single-v1,compound-lower-returned-q0-single-v1,compound-lower-history-authored-q0-single-v1,compound-lower-nonzero-group-single-followup-v1,compound-lower-nonzero-group-rotation-after-single-v1,compound-lower-nonzero-group-refresh-after-single-v1,compound-lower-nonzero-same-lower-group-after-single-v1,compound-lower-nonzero-different-lower-group-after-single-v1,compound-lower-nonzero-same-lower-second-group-after-single-v1,compound-lower-nonzero-different-lower-second-group-after-single-v1,compound-lower-nonzero-top-second-group-after-single-v1,compound-lower-nonzero-top-then-prior-lower-group-after-single-v1,compound-lower-nonzero-top-then-other-lower-group-after-single-v1,compound-lower-nonzero-top-third-group-after-single-v1,compound-lower-nonzero-top-fourth-group-after-single-v1,compound-lower-nonzero-same-lower-third-group-after-single-v1}.json
tests/characterization/{legacy-board-layout,legacy-card-stack-layout,legacy-contained-card-layout,legacy-evolution-reflow-layout,legacy-energy-attachment-reflow-layout,legacy-trainer-tool-attachment-reflow-layout,legacy-two-energy-attachment-compaction-layout,legacy-mixed-energy-trainer-tool-attachment-order-layout,legacy-mixed-stack-movement-category-cycle-layout,legacy-marker-rotation-layout,legacy-bench-marker-rotation-layout,legacy-compound-group-rotation-layout,legacy-compound-break-rotation-layout,legacy-compound-break-refresh-layout,legacy-compound-break-refresh-q3-layout,legacy-compound-nonzero-group-single-layout,legacy-compound-lower-group-rotation-layout,legacy-compound-lower-q0-single-layout,legacy-compound-lower-nonzero-group-single-layout,legacy-compound-lower-returned-q0-single-layout,legacy-compound-lower-history-authored-q0-single-layout,legacy-compound-lower-nonzero-group-single-followup-layout,legacy-compound-lower-nonzero-group-rotation-after-single-layout,legacy-compound-lower-nonzero-group-refresh-after-single-layout,legacy-compound-lower-nonzero-same-lower-group-after-single-layout,legacy-compound-lower-nonzero-different-lower-group-after-single-layout,legacy-compound-lower-nonzero-same-lower-second-group-after-single-layout,legacy-compound-lower-nonzero-different-lower-second-group-after-single-layout,legacy-compound-lower-nonzero-top-second-group-after-single-layout,legacy-compound-lower-nonzero-top-then-prior-lower-group-after-single-layout,legacy-compound-lower-nonzero-top-then-other-lower-group-after-single-layout,legacy-compound-lower-nonzero-top-third-group-after-single-layout,legacy-compound-lower-nonzero-top-fourth-group-after-single-layout,legacy-compound-lower-nonzero-same-lower-third-group-after-single-layout}.test.ts
tests/browser/{legacy-dom-geometry,legacy-card-stack-geometry,legacy-contained-card-geometry,legacy-evolution-reflow-geometry,legacy-energy-attachment-reflow-geometry,legacy-trainer-tool-attachment-reflow-geometry,legacy-two-energy-attachment-compaction-geometry,legacy-mixed-energy-trainer-tool-attachment-order-geometry,legacy-mixed-stack-movement-geometry,legacy-marker-rotation-geometry,legacy-bench-marker-rotation-geometry,legacy-compound-rotation-geometry,legacy-compound-break-refresh-geometry,legacy-compound-break-refresh-q3-geometry,legacy-compound-nonzero-group-single-geometry,legacy-compound-lower-group-initiator-geometry,legacy-compound-lower-q0-single-geometry,legacy-compound-lower-nonzero-group-single-ordinary-geometry,legacy-compound-lower-nonzero-group-single-break-geometry,legacy-compound-lower-returned-q0-single-ordinary-geometry,legacy-compound-lower-returned-q0-single-break-geometry,legacy-compound-lower-history-authored-q0-single-geometry,legacy-compound-lower-nonzero-group-single-followup-ordinary-geometry,legacy-compound-lower-nonzero-group-single-followup-break-geometry,legacy-compound-lower-nonzero-group-rotation-after-single-ordinary-geometry,legacy-compound-lower-nonzero-group-rotation-after-single-break-geometry,legacy-compound-lower-nonzero-group-refresh-after-single-ordinary-geometry,legacy-compound-lower-nonzero-group-refresh-after-single-break-geometry,legacy-compound-lower-nonzero-same-lower-group-after-single-ordinary-geometry,legacy-compound-lower-nonzero-same-lower-group-after-single-break-geometry,legacy-compound-lower-nonzero-different-lower-group-after-single-ordinary-geometry,legacy-compound-lower-nonzero-different-lower-group-after-single-break-geometry,legacy-compound-lower-nonzero-same-lower-second-group-after-single-ordinary-geometry,legacy-compound-lower-nonzero-same-lower-second-group-after-single-break-geometry,legacy-compound-lower-nonzero-different-lower-second-group-after-single-ordinary-geometry,legacy-compound-lower-nonzero-different-lower-second-group-after-single-break-geometry,legacy-compound-lower-nonzero-top-second-group-after-single-ordinary-geometry,legacy-compound-lower-nonzero-top-second-group-after-single-break-geometry,legacy-compound-lower-nonzero-top-then-prior-lower-group-after-single-ordinary-geometry,legacy-compound-lower-nonzero-top-then-prior-lower-group-after-single-break-geometry,legacy-compound-lower-nonzero-top-then-other-lower-group-after-single-ordinary-geometry,legacy-compound-lower-nonzero-top-then-other-lower-group-after-single-break-geometry,legacy-compound-lower-nonzero-top-third-group-after-single-ordinary-geometry,legacy-compound-lower-nonzero-top-third-group-after-single-break-geometry,legacy-compound-lower-nonzero-top-fourth-group-after-single-ordinary-geometry,legacy-compound-lower-nonzero-top-fourth-group-after-single-break-geometry,legacy-compound-lower-nonzero-same-lower-third-group-after-single-ordinary-geometry,legacy-compound-lower-nonzero-same-lower-third-group-after-single-break-geometry}.spec.ts
tests/legacy-fixtures/renderer/compound-lower-nonzero-different-lower-third-group-after-single-v1.json
tests/characterization/legacy-compound-lower-nonzero-different-lower-third-group-after-single-layout.test.ts
tests/browser/legacy-compound-lower-nonzero-different-lower-third-group-after-single-{ordinary,break}-geometry.spec.ts
tests/e2e/legacy-baselines/{screenshots,geometry}/
tests/e2e/legacy-workflows/
tests/fixtures/{canonical,views,assets}/
```

Do not store private community decks/saves without explicit permission and
redaction. Synthetic fixtures should use clearly fake card definitions when real
identities are irrelevant.

## Workstreams

### A. Domain and compatibility

Owns `game-core`, `deck-core`, `legacy-import`, semantic fixtures, state/command/
event schemas, invariants, projection policy, and stable hash.

First deliverable: state plus one vertical move/shuffle/inspection slice and a v1
conversion fixture. Last deliverable: all action mappings and schema migrations.

### B. Protocol, authority, and operations

Owns `protocol`, admission, room/session lifecycle, command transaction,
persistence, projection publication, saves, rate limits, telemetry, and runbooks.

Depends on public domain command/event/projection contracts, not renderer work.

### C. Renderer and performance

Owns renderer-neutral contract tests, React-DOM/Pixi spike, selected renderer,
layout/geometry, input/pointer layer, texture/resource lifecycle, and performance
harness.

Consumes projected render models only. Cannot edit canonical domain types to make
rendering convenient without an accepted cross-workstream proposal.

### D. React shell, features, parity, and accessibility

Owns application chrome, deck/chat/settings/saves/replay UI, DOM overlays,
keymap, presentation controller/store, accessibility bridge, Playwright workflows,
and visual baselines.

Works with C on overlay/layer/input contracts and with A on semantic intents.

### E. Quality, security, and release

Owns cross-package test infrastructure, generated/fault/soak suites, threat model,
dependency/security scans, traceability, canary metrics, and release evidence.
It reviews rather than authors product semantics.

## Dependency order

```text
characterization/parity inventory
       |
       v
IDs + state + command/event + view contracts
       |                       |
       v                       v
renderer/runtime spikes     protocol/room spike
       |                       |
       v                       v
solo vertical slices       authority vertical slices
       \                       /
        v                     v
        complete web/multiplayer integration
                     |
                     v
           compatibility + hardening
                     |
                     v
              cohort rollout
```

Renderer and backend may proceed in parallel only after the shared IDs, command,
view, and error contracts stabilize. Legacy converter implementation may proceed
with the core, but its production endpoint waits for persistence/security review.

## Reviewable change slices

Prefer small vertical PRs such as:

1. Requirement/parity row and fixture.
2. State/event schema addition with migration.
3. Command decision + event application + invariant/property tests.
4. Projection and leak tests.
5. Render-model selector and renderer/UI behavior.
6. Protocol/authority integration and failure tests.
7. Traceability/metrics update.

A schema-only PR may be appropriate for an accepted ADR, but no large untested
catalog should land and leave consumers broken for weeks.

## Parallel edit safety

- One integrator owns canonical blueprint and cross-package schema files.
- Review agents write isolated reports under `docs/v2-rebuild/reviews/`; they do
  not concurrently rewrite canonical documents.
- Each shared schema change has one author; other workstreams submit proposals or
  fixtures against the branch.
- Generated files and lockfiles have a named owner per integration window.
- Every PR lists affected requirement IDs, persisted/wire migration, parity rows,
  and rollback impact.
- No workstream may bypass a contract by deep-importing another package's
  internals.

## Retirement checklist

Only Phase 10 removes:

- iframe HTML and iframe document globals;
- mutation observers and DOM-driven state repair;
- legacy action dispatch/process/catch-up arrays;
- generic Socket.IO relay and CDN client;
- four-character save creation;
- v1 deck/image card classes and image custom logical properties; and
- production imports from `client/src/actions/**`.

The immutable characterization fixtures, supported legacy converter, tagged v1
source release, and migration documentation remain.
