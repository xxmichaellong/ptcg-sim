# Headless board session controller and adapter

Status: additive audited candidate; not connected to the production route,
legacy board, React DOM spike, or Pixi spike.

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

The adapter compares against the controller's accepted source, frame index,
phase, and recipient. A rejected scene factory or invalid alias projection
therefore cannot wedge later valid replay frames. Reentrant publications are
serialized by the controller and cannot let an older completion overwrite a
newer accepted cursor.

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

`BoardResizeRequested` remains unsupported here. Legacy flip, fullscreen, and
the two independent resize handles are owned by the layout oracle and later
viewport controller, not reduced to the spike contract's provisional
`splitRatio`.

## Effects and renderer cancellation

The pure reducer returns effects for one accepted action and never stores them.
`BoardSessionController` installs state, attempts effects serially, and only
then notifies subscribers. Reentrant actions are queued. Disposal between
effects stops the remaining effects. Sink failures are reported as at-most-once
attempts; diagnostics cannot interrupt later deterministic work.

`CancelRendererInteraction` exists separately from scene reset. A future host
maps it to `BoardRenderer.cancelInteraction()`, now implemented by the shared
drag controller and both spike renderers. It clears pointer capture, active
gesture, and suppressed-click state without changing the scene. DOM destroy
cancels synchronously before deferred React unmount. Pixi destroy cancels
silently; renderer-originated WebGL context loss during an active drag emits one
drag-null update, clears retained drag presentation, releases capture, and then
rebuilds.

This method remains unwired in production in this slice.

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
  packages/renderer-contract/src/drag.test.ts \
  packages/renderer-dom/src/ReactDomBoardRenderer.test.tsx \
  packages/renderer-pixi/src/PixiBoardRenderer.test.ts
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
