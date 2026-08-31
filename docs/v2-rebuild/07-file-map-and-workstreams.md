# File map and workstreams

## Mapping principle

Legacy files are behavioral evidence, not modules to mechanically translate.
Many mix domain, rendering, transport, and messages; their responsibilities must
land in several target packages. Conversely, a target reducer often replaces
pieces scattered across multiple legacy files.

The paths below are proposed and may be renamed by a Phase 0 ADR, but ownership
and dependency direction are required.

## Repository and application shell

| Current files                                        | Target files                                                                 | Treatment                                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| root `package.json`, `pnpm-workspace.yaml`, packages | root workspace/tool configs plus `apps/*`, `packages/*`                      | Expand workspace; preserve v1 scripts until retirement.                                              |
| `client/index.ejs`                                   | `apps/web/index.html`, `src/main.tsx`, `src/app/App.tsx`, feature components | Recreate the same DOM chrome and styles; remove EJS data injection after compatibility route exists. |
| `client/self-containers.html`, `opp-containers.html` | selected renderer layout/scene plus React overlays                           | Remove iframe implementation only after visual/interaction parity.                                   |
| `client/src/css/index.css`, self/opp CSS             | `apps/web/src/styles/*`, `src/board/layout/boardGeometry.ts`                 | Preserve style tokens/geometry; consolidate duplicate transforms after baseline extraction.          |
| static assets under `client/src/assets`              | `apps/web/public/assets` or imported assets                                  | Preserve visible assets and add deterministic test copies/license inventory.                         |

## Client composition and state

| Current files                                         | Target files                                                                                    | Treatment                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `client/src/front-end.js`                             | `apps/web/src/main.tsx`, `src/app/createApplication.ts`                                         | Replace global import-time initialization with explicit lifecycle composition.       |
| `initialization/global-variables/global-variables.js` | `src/session/*`, `src/state/gameViewStore.ts`, `presentationStore.ts`, settings/identity stores | Split connection, view, presentation, deck, and preference state; no DOM references. |
| `initialization/document-event-listeners/**`          | React component handlers, `src/board/input/*`, feature controllers                              | Bind through component/engine lifecycle with teardown; preserve the handler matrix.  |
| `initialization/mutation-observers/**`                | domain selectors + renderer/React subscriptions                                                 | Delete; state publications explicitly drive view changes.                            |
| `setup/settings/settings.js` and settings listeners   | `src/features/settings/*`                                                                       | Preserve controls/storage/appearance without writing game state through DOM.         |
| `setup/home-header/*`, sidebox tab/header files       | `src/app/navigation/*`, feature components                                                      | React DOM port with parity tests.                                                    |

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

Implemented competitive renderer-spike files (the winner remains provisional):

```text
packages/renderer-contract/src/
  model.ts
  geometry.ts
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
```

If Pixi wins, split the compact spike adapter into the following production
systems as those responsibilities gain behavior. Do not create empty structure
before it has real ownership to contain:

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
  BoardController.ts
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

| Current files                                            | Target files                                                                               | Treatment                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `setup/general/accept-action.js`                         | exhaustive command/event unions, schema-validated dispatch                                 | No function-name lookup; compiler and runtime reject unknown variants.       |
| `setup/general/process-action.js`, add/clean action data | client session/outbox + server command pipeline/journal                                    | Remove peer logs/counters as authority.                                      |
| catch-up/resync/sync/replay-block files                  | `ReliableRoomConnection.ts`, snapshot install/reconcile, server session frontiers          | Full projected snapshots replace client action replay for sync.              |
| socket event listeners                                   | `apps/web/src/session/RemoteGameSession.ts`, protocol client codec                         | Runtime-validate every message and explicitly manage reconnect/supersession. |
| `setup/spectator/**`                                     | server spectator role/projector + client session view                                      | Spectator never receives player action log/deck data.                        |
| reveal/look relay events                                 | visibility commands and per-recipient publications                                         | Role-scoped server truth.                                                    |
| `server/server.js` room relay                            | `apps/server/src/do/MatchRoom.ts`, admission, ingress, persistence, projection publication | Replace username sets/generic relay with authoritative room service.         |
| Socket.IO CDN in `index.ejs`                             | typed native WebSocket transport adapter                                                   | Exact transport selected by backend ADR; no global `io`.                     |

Proposed authority/server files:

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

apps/web/src/session/
  GameSessionPort.ts
  LocalGameSession.ts
  RemoteGameSession.ts
  ReliableRoomConnection.ts
  PendingCommandOutbox.ts
```

## Import, export, replay, and decks

| Current files                                         | Target files                                                     | Treatment                                                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `setup/deck-builder/core/*.mjs`                       | `packages/deck-core/src/*.ts`                                    | Port pure behavior and existing tests; fix only approved issues with fixtures.           |
| deck-builder tests                                    | package tests plus React/E2E adapter tests                       | Preserve 79 passing cases and extend boundary/CSV/self-alt cases.                        |
| `setup/deck-constructor/import.js`, find-type files   | `deck-core` input adapters and card catalog service              | Break large module into bounded parsers/resolvers; preserve supported formats/languages. |
| native deck-builder listener/render/sync files        | `apps/web/src/features/deck/*`                                   | React DOM, independent main/alternate state, unchanged visible workflow.                 |
| `initialization/load-import-data/load-import-data.js` | route loader + `legacy-import` transaction                       | Validate completely, convert once, install only on success.                              |
| sidebox import/export/replay handlers                 | `features/saves/*`, `features/replay/*`, server save/replay APIs | Separate save, replay, public projection, and opaque continuation concepts.              |
| legacy action arrays/version                          | `packages/legacy-import/src/v1/*`                                | Frozen allowlisted interpreter only; never imported by live v2 core.                     |

## Files added during characterization

```text
docs/v2-rebuild/parity-matrix.*
docs/v2-rebuild/legacy-action-catalog.*
docs/v2-rebuild/parity-exceptions.md
tests/legacy-fixtures/{decks,saves,replays,network}/
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
