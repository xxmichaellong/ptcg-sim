# Target architecture

## Architectural shape

PTCG Sim v2 is a collection of independently testable layers with one-way
dependencies:

```text
React DOM shell ----> client application ----> protocol types
      |                       |                       |
      v                       v                       v
board host ---------> selected renderer        room server
                              |                       |
                              v                       v
                         view state <---- projection/game core
                                                   |
                                                   v
                                           persistence adapters
```

The renderer receives immutable view state and presentation events. It never
owns domain state. The server receives typed commands and is the only multiplayer
writer. Local one-player mode uses the same game core through an in-process
authority adapter, so solo and multiplayer do not develop separate semantics.

## Proposed repository layout

```text
apps/
  web/
    src/app/                 React application and routes
    src/features/            room, chat, deck, settings, replay, imports
    src/game-client/         authority client, pending commands, view store
    src/legacy-parity/       temporary parity metadata, not v1 runtime imports
    src/replay/              React replay adapters; no playback ownership
  server/
    src/room/                room lifecycle and connection sessions
    src/authority/           command authorization and transaction pipeline
    src/persistence/         snapshots, event chunks, share links
    src/observability/       structured logs and metrics
packages/
  client-session/
    src/session.ts           connection, pending commands, authoritative view store
    src/replay-playback.ts   isolated projected-replay playback state machine
    src/transport.ts         browser-neutral socket boundary + native WebSocket adapter
  game-core/
    src/state/               canonical schema and constructors
    src/commands/            command union, decisions and preconditions
    src/events/              resolved event union and pure application
    src/invariants/          structural validation and state hashing
    src/visibility/          role-specific projections
    src/replay/              event/snapshot reconstruction and undo policy
  protocol/
    src/messages/            client/server wire messages
    src/schemas/             runtime validation and version negotiation
  renderer-pixi/
    src/board/               layout and scene roots
    src/systems/             render/input/animation/asset systems
    src/testing/             deterministic renderer harness
  deck-core/
    src/                     migrated pure deck parsing/search/sort/validation
  legacy-import/
    src/v1/                  isolated save/action/deck converters
tests/
  contracts/                 schema, projection, persistence compatibility
  e2e/                       Playwright workflows and visual baselines
  multiplayer/               deterministic multi-client/failure simulations
  fixtures/                  v2 canonical and projected state fixtures
  legacy-fixtures/           immutable v1 inputs and expected v2 states
docs/v2-rebuild/             this blueprint and subsequent decisions
```

The existing `client/` and `server/` remain the v1 application during the
strangler migration. The exact top-level path (`apps/` as shown, or a temporary
`v2/` workspace) is a Phase 0 decision; package boundaries and dependency rules
must remain the same either way.

## Technology choices

| Concern                    | Primary choice                                              | Reason                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Language                   | strict TypeScript                                           | Discriminated commands, explicit state, safe refactors, shared client/server contracts                                                        |
| Web build                  | Vite                                                        | Fast TypeScript/React development and straightforward static output                                                                           |
| DOM UI                     | React                                                       | Fits forms, tabs, dialogs, menus, chat, settings, and lifecycle orchestration                                                                 |
| Board                      | renderer-neutral contract; raw PixiJS provisional           | Pixi promises batching/transforms/resource control, but must beat normalized React DOM on real parity/performance/CORS/accessibility evidence |
| React/renderer integration | thin custom host                                            | Keeps the renderer transactional and independent of React render frequency                                                                    |
| Runtime schemas            | Valibot                                                     | Shared validation at every network and persistence boundary with small client cost                                                            |
| Client state               | small external/vanilla store; Zustand vanilla is acceptable | Separates authoritative view, pending commands, and local presentation without component-owned game state                                     |
| Unit/integration tests     | Vitest                                                      | TypeScript-friendly, fast package-level tests                                                                                                 |
| Browser tests              | Playwright                                                  | Multi-page/multi-context workflows, screenshots, input, and network failure tests                                                             |
| Primary room runtime       | Cloudflare Worker + Durable Object per room                 | Single-threaded room authority, natural room locality, WebSocket hibernation, and MagicCircle pattern reuse                                   |
| Backend alternative        | Colyseus                                                    | Viable if managed room abstractions and server portability outweigh shared MagicCircle infrastructure                                         |

Exact library versions are pinned only when implementation starts. Version
selection requires a short compatibility check against supported runtimes,
browser targets, and security advisories; the blueprint does not encode stale
version numbers.

## Package dependency rules

Allowed dependencies:

```text
game-core        -> no UI, renderer, server-runtime, storage, or network package
protocol         -> game-core public IDs/value types and schema library only
client-session   -> protocol + projected view hashing; no React or renderer dependency
deck-core        -> no DOM or application state
legacy-import    -> game-core + protocol version adapters
renderer-*       -> selected renderer + projected view/presentation types only
apps/web         -> client-session + protocol + renderer contract/selected adapter + deck-core
apps/server      -> protocol + game-core + storage/runtime adapters
tests            -> any public package API; internals only in package-local tests
```

Forbidden dependencies:

- `game-core` importing React, Pixi, browser globals, Socket.IO, Worker APIs, a
  database driver, or `Math.random()`.
- any renderer importing server or canonical secret-state types.
- `client-session` importing React, a renderer, server runtime, or canonical
  secret-state types.
- `apps/web` importing canonical state constructors or visibility internals.
- Any v2 runtime importing files from legacy `client/src/actions/` or
  `server/server.js`.
- Cross-feature deep imports that bypass a package's public entry point.
- Circular package or source-module dependencies.

CI enforces these rules with TypeScript project references, package exports, an
import-boundary linter, and a cycle detector.

## Runtime state separation

The web application holds three distinct stores:

1. **Authoritative view**: the newest accepted server projection and revision.
2. **Pending overlay**: commands submitted but not yet covered by an accepted
   state publication; only explicitly safe interactions may be optimistic.
3. **Presentation state**: hover, selection, drag preview, open popup/menu,
   preview card, animation progress, camera/board flip, and local preferences.

The board renderer reads a composed render model. It cannot write authoritative
view state. Input handlers emit semantic intents to the application controller,
which converts valid intents into commands. Drag motion updates presentation
state; drop emits at most one domain command.

## Command-to-screen flow

```text
pointer/key/menu intent
  -> local interaction policy
  -> typed command with recipient-safe view IDs, command ID, last revision and entity preconditions
  -> room authority validation/authorization
  -> pure command decision with authority-provided randomness
  -> apply resolved event batch to a candidate + invariant check
  -> durable event/idempotency transaction + checkpoint policy
  -> install canonical state
  -> per-connection visibility projection
  -> StatePublication(revision, view state, presentation events)
  -> CommandResult after the sender's publication covers the command
  -> client reconciles pending overlay
  -> React/Pixi update only affected views
```

Rejected commands return a typed error and current revision metadata. They never
partially mutate state and never cause a compensating client action.

## MagicCircle reuse boundary

MagicCircle is a reference implementation and a source of extractable patterns,
not a direct runtime dependency.

Patterns worth adapting:

- React owning an imperative Pixi engine lifecycle;
- resize tracking, pointer capture, renderer context recovery, and typed system
  lifecycle;
- room welcome/snapshot, heartbeat, reconnect, command IDs/sequences, and the
  rule that accepted state reaches a client before its command is acknowledged;
- runtime message schemas, identity validation, rate limiting, and a single room
  authority boundary; and
- monorepo layering between common messages, client, and server.

Patterns not to copy directly:

- Quinoa's full ECS, continuous simulation/game loop, movement streams, server
  clock, or prediction fences;
- a large atom graph containing cloned room state;
- account, release, router, and database infrastructure unrelated to PTCG Sim;
- common same-frame state broadcast to all clients.

That last exclusion is critical: PTCG Sim needs a distinct projection for every
player/spectator role. MagicCircle components may only be extracted after their
hidden-information assumptions are reviewed.

Relevant reference locations at the time of this blueprint include:

- `client/src/games/Quinoa/components/QuinoaCanvas/QuinoaCanvas.tsx`
- `client/src/connection/RoomConnection.ts`
- `server/src/games/Room/RoomManager.ts`
- `server/src/RoomDurableObject.ts`
- `common/types/messages.ts`

All paths above are in the separate `magiccircle.gg` repository and must not be
turned into relative production imports.

## Architectural enforcement

Each package must provide:

- a narrow public entry point;
- a README defining ownership and invariants;
- package-local unit tests;
- no hidden singleton initialized at import time; and
- explicit adapters for time, randomness, storage, transport, and assets.

Changes to canonical state, wire schemas, persistence, parity behavior, or the
package graph require a decision record and migration notes. A build succeeding
is not sufficient; the verification gates define architectural completion.
