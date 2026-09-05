# Headless board session controller and adapter

Status: additive review candidate. The headless controller is exercised by an
exported opt-in React DOM composition, but no production route, legacy board,
or renderer-spike route imports that composition.

## Purpose and ownership

`apps/web/src/board/BoardSessionController.ts` is the renderer-neutral state
machine between one recipient-projected view and a board renderer. It owns:

- acceptance and ordering of effective live/replay board projections;
- the exact installed `{view, scene}` pair;
- local selection, hover, drag, opened-zone, context-menu, card-preview, and
  expanded-stack state;
- reconciliation of those ephemeral aliases on forward scene changes; and
- one-shot reset, cancellation, scene, presentation, rejection, and
  protocol-safe command effects.

It imports only public `MatchViewState`/`ViewCardId`, renderer-contract types,
session phase, and `WireGameCommand`. It has no canonical state,
`CardInstanceId`, event journal, capability, socket, React, DOM, or Pixi
dependency. The scene factory receives the exact projected view, and the
controller rejects a scene with a different match/revision or card/marker
aliases absent from that view.

`apps/web/src/board/BoardSessionAdapter.ts` is the concrete, still-unwired
composition over public `RemoteGameSession` and `ReplaySessionCoordinator`
interfaces. The adapter:

- converts the replay coordinator's effective view into controller frames;
- defers a live handshaking/reconnecting view until the session is ready;
- derives replacement/seek boundaries from the controller's last **accepted**
  cursor, never a speculative observation;
- binds the real `resolveBoardDrop` path and rechecks live role/readiness/replay
  gates immediately before `RemoteGameSession.submit`; and
- converts `queued: false` into local rejection cleanup without an outbox.

`RemoteGameSession` continues to own transport generations, stale socket
rejection, validation, reconnect, command queueing, retry, and authoritative
view publication. `ReplaySessionCoordinator` continues to own effective
live/replay selection and its public monotonic `generation`.

`GamePresentationCoordinator` remains the sole exact-once owner of protocol
presentation events. It subscribes to live/replay sources in parallel with the
board adapter. Presentation events are intentionally absent from
`BoardProjectionFrame`, controller state, and controller effects. This avoids
losing the live session's view-then-event split publication and avoids a second
event cursor.

`apps/web/src/board/BoardSessionRuntime.ts` is the executable, renderer-neutral,
uninstantiated composition root. Thin React DOM and Pixi wrappers select a
factory; ADR-004 selects the React DOM wrapper for eventual production use and
keeps the Pixi wrapper experimental. The runtime borrows already-owned live and
replay sources, constructs only one `BoardSessionAdapter` and one renderer, and
disposes only those objects. It neither accepts nor constructs a presentation
owner. The route's existing presentation runtime and
`GamePresentationCoordinator` subscribe in parallel and retain their own
lifecycle.

## Projection and cursor contract

Every `BoardProjectionFrame` has:

- a globally monotonic `frameToken`, supplied from
  `ReplaySessionCoordinatorState.generation`;
- `source: {kind: "live"}` or replay source containing `replayId`, monotonic
  `playbackGeneration`, and current `frameIndex`;
- an explicit `advance | resync | seek` boundary;
- the public session phase and command-submission gate; and
- an optional recipient-safe effective view.

The reducer runtime-validates these discriminants even if untyped input is cast
across the boundary. It applies the following rules:

| Publication                                     | Result                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| equal/older `frameToken`                        | ignored, no effects                                                                         |
| ordinary live strict revision advance           | scene `advance`; surviving local aliases reconcile                                          |
| equal live view object, phase/gate-only change  | no scene reinstall                                                                          |
| equal live revision with replacement object     | requires `resync`                                                                           |
| lower live revision                             | rejected, including a purported resync                                                      |
| replay forward step                             | newer playback generation, increasing frame index, strict revision advance                  |
| replay backward step                            | newer playback generation, decreasing frame index, explicit `seek`                          |
| replay equal-index publication                  | unchanged same-generation phase/gate update, or newer-generation explicit `resync`          |
| live/replay, replay-ID, match, or viewer change | explicit `resync`; reset before replacement install                                         |
| reconnect/non-ready live publication            | keep last safe scene, cancel renderer interaction, clear local transients, disable commands |
| no-view source transition                       | rejected without changing the accepted cursor                                               |
| terminal phase                                  | purge scene/aliases; the route-owned controller remains absorbing                           |
| new recipient whose scene cannot be built       | reject/purge: retain prior cursor, remove old view/scene/aliases, reset renderer            |
| same recipient whose scene cannot be built      | reject and retain the last-safe view/scene/cursor                                           |

The adapter compares against the controller's accepted source, frame index,
phase, and recipient. A rejected scene factory or invalid alias projection
therefore cannot wedge later valid replay frames. Reentrant publications are
serialized by the controller and cannot let an older completion overwrite a
newer accepted cursor.

The explicit `purged` reducer outcome distinguishes a rejected recipient
projection that nevertheless commits privacy cleanup from a successfully
installed frame. Because its prior accepted cursor remains unchanged, the same
upstream generation can be retried after local scene configuration is fixed.

Within one replay ID, `revision - frameIndex` is invariant. A newer generation
at the same index is a replay reload/replacement and the adapter labels it
`resync`; it is never treated as an ordinary advance. A source or replay-ID
replacement may establish a different offset at its replacement boundary.

Terminal recovery requires a new route/session owner and controller instance;
an in-place higher-revision callback cannot resurrect a closed, failed, or
superseded controller.

## Local presentation and commands

Selection, preview, and zone browsing remain renderer-local and may be used by
spectator/replay views. Forward publications retain an alias only if the exact
interactive card/zone remains in the new scene. A stack preview additionally
requires its focus card to remain an interactive child of the same rendered
stack. A drag survives only while its card and exact rendered zone/stack target
remain live.

Context actions remain player-only in this characterized slice. Drop commands
are additionally limited to a live, ready, idle-request, player view. The
controller captures one installed `{view, scene}` pair before resolving a drop.
The concrete adapter performs the mode/phase/role checks again immediately
before submit, so a reentrant or stale readiness change fails closed.

`BoardResizeRequested` remains unsupported here. The opt-in DOM runtime exposes
the complete renderer-neutral layout bridge. Sidebar/fullscreen width,
bottom-player perspective, independent upper/lower frame positions and heights,
both resize handles, shared placement, stadium/control anchors, region border
boxes, and region content boxes all flow from the source-characterized snapshot
into `BoardScene`. Valid characterized gaps, overscan, asymmetric frames, and
handle-midpoint placement are retained; invalid oracle state and a layout player
tuple that differs from the projected view still fail closed.
The runtime clones and recursively freezes retained layout input and returns a
fresh frozen characterization snapshot, so untyped caller mutation cannot
change later scene generation.

Changing local layout calls `RefreshScene`: it cancels interaction,
re-runs the scene factory on the exact installed safe view, validates the
result, and replaces it without advancing source/playback cursors. The adapter
then synchronizes once so a previously rejected upstream generation can retry.
Repeating an equivalent complete layout is a no-op and does not duplicate
effects or presentation work.

## Effects and renderer cancellation

The pure reducer returns effects for one reduction and never stores them.
`BoardSessionController` installs state, attempts effects serially, and only
then notifies subscribers. Reentrant actions are queued. Disposal between
effects stops the remaining effects. Sink failures are reported as at-most-once
attempts; diagnostics cannot interrupt later deterministic work.

`CancelRendererInteraction` exists separately from scene reset and maps to
`BoardRenderer.cancelInteraction()`. It clears pointer capture, active gesture,
and suppressed-click state without changing the scene. `ResetRenderer` maps to
the additive `BoardRenderer.clearScene()`: synchronously cancel, clear retained
scene/private presentation, and empty board children while keeping a healthy
renderer mounted for a later replacement install. DOM destroy still cancels
synchronously before deferred React unmount. Pixi clear releases card views and
private texture bindings; its texture registry reuses a zero-reference pending
load only when it is reacquired before completion and verifies the exact entry
is still unused before unloading. Renderer-originated WebGL context loss during
an active drag emits one drag-null update, clears retained drag presentation,
releases capture, and then rebuilds. If context is lost while reset has
intentionally left no scene, Pixi tears down once and defers recovery without
consuming retries; the next replacement triggers one generation-guarded rebuild
from the latest scene.

If `clearScene()` itself throws, the opt-in runtime is deliberately fatal and
fail-closed: it disposes its adapter, destroys the bad renderer, synchronously
empties the host as a final privacy boundary, suppresses subsequent install
effects, reports one stable reset failure, and requires a new runtime instance.
A mount superseded by disposal similarly rejects with a stable aborted error;
late completion cannot revive the renderer. A lazy mount that fails after a
viewless runtime has already attached uses the same fatal cleanup and stable
error policy.

None of these paths is instantiated by a production route in this slice.

## Evidence and limits

Legacy behavioral evidence includes:

- `client/src/setup/image-logic/click-events.js` and
  `client/src/actions/general/close-popups.js` for selection/preview/cleanup;
- `client/src/setup/image-logic/drag.js` plus card/cover setup for drag and
  interaction surfaces;
- replay/keybind source for read-only availability;
- `packages/client-session/src/session.ts` and `replay-playback.ts` for public
  view, reconnect, submission, and playback semantics;
- `apps/web/src/replay/ReplaySessionCoordinator.ts` and
  `apps/web/src/presentation/GamePresentationCoordinator.ts` for effective
  projection and exact-once presentation ownership; and
- renderer-contract `model.ts`, `drag.ts`, and `scene.ts` for the current
  semantic renderer boundary.

This headless slice does not claim browser parity for menu geometry/items,
click/double-click timing, focus trapping, marker editors, keyboard suppression,
expanded-stack transforms, preview intrinsic sizing, coaching flip, stadium
readability, hand concealment, fullscreen chrome, resize handles, accessibility
focus order, or equal-z browser hit order. These remain Playwright/manual parity
gates before any production switch.

## Acceptance gates

Focused executable coverage:

```sh
corepack pnpm exec vitest run \
  apps/web/src/board/BoardSessionController.test.ts \
  apps/web/src/board/BoardSessionAdapter.test.ts \
  apps/web/src/board/ReactDomBoardSessionRuntime.test.ts \
  apps/web/src/RendererSpikeBoard.test.tsx \
  packages/renderer-contract/src/drag.test.ts \
  packages/renderer-dom/src/ReactDomBoardRenderer.test.tsx \
  packages/renderer-pixi/src/PixiBoardRenderer.test.ts \
  packages/renderer-pixi/src/CardTextureRegistry.test.ts
corepack pnpm --filter @ptcgsim/web run typecheck
corepack pnpm run check:v2
```

The adapter tests use real `RemoteGameSession`, `ReplaySessionCoordinator`, and
`GamePresentationCoordinator` instances. They pin deferred Welcome install,
view-then-event publication, remount seeding, reconnect/equal-revision resync,
stale socket rejection, replay next/fast-forward/previous/exit, silent live
event consumption during replay, non-ready replay exit, submit-time stale gates,
`queued: false`, rejected-scene recovery, reentrant observation ordering,
recipient replacement, and disposal.

The DOM runtime suite additionally composes those real session/replay sources
through a real DOM renderer while an externally owned
`GamePresentationCoordinator` runs in parallel. Mutable-source cases pin exact
pointer, reset, privacy-failure retry, unsupported-layout, replay suppression,
factory/mount race, and fatal clear-failure behavior without altering any route.
The same suite verifies that the thin Pixi wrapper selects its candidate factory
while preserving the generic runtime's borrowed-source and teardown ownership.
