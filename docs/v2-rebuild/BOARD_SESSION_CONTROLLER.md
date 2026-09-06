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

Renderer-originated `BoardResizeRequested` remains unsupported here. The opt-in
runtime exposes the complete renderer-neutral layout bridge plus an explicit
`resizeBoard(handleId, clientY)` entry point. `ReactDomBoardSessionRuntime` can
now enable a trusted route-owned pointer bridge with
`enableLegacyResizeInteraction`; it is disabled by default and no current route
enables it.
Sidebar/fullscreen width,
bottom-player perspective, independent upper/lower frame positions and heights,
both resize handles, shared placement, stadium/control anchors, region border
boxes, and region content boxes all flow from the source-characterized snapshot
into `BoardScene`. Valid characterized gaps, overscan, asymmetric frames, and
handle-midpoint placement are retained; invalid oracle state and a layout player
tuple that differs from the projected view still fail closed.
The runtime clones and recursively freezes retained layout input and exposes the
same stable frozen characterization snapshot until layout changes, so untyped
caller mutation cannot change later scene generation. `subscribeLayout` is the
route-composition boundary for visible chrome: equivalent replacement is
silent, a changed snapshot is installed before notification, one throwing
subscriber is reported without blocking the rest, unsubscribe is idempotent,
and disposal clears the listener set.

Changing local layout calls `RefreshScene`: it cancels interaction,
re-runs the scene factory on the exact installed safe view, validates the
result, and replaces it without advancing source/playback cursors. The adapter
then synchronizes once so a previously rejected upstream generation can retry.
Repeating an equivalent complete layout is a no-op and does not duplicate
effects or presentation work.

Physical resize calls run through the renderer contract's pure
`resizeBoardLayoutState` implementation. It retains the four distinct
normal/flipped legacy branches, independent handles/frames, source clamps,
collision and edge-growth rules, and midpoint shared placement. The runtime
then follows the same `RefreshScene` path as any other local layout change; no
game command, revision, replay cursor, or presentation fact is created.

The optional DOM bridge leaves renderer handle sentinels non-painting and
pointer-transparent. A capture listener on the mounted host hit-tests their
renderer-neutral bounds before card/zone bubbling, gives the later upper handle
source-equivalent priority when expanded rectangles overlap, and retains the
physical handle ID after flip. Window-level move/up/cancel plus blur, viewport
resize, and runtime disposal own cleanup; host scaling is converted back to the
characterized play-area coordinate system before `resizeBoard` runs. In addition
to focused runtime tests, a development-only Chromium harness drives real
pointer events through translated/scaled coordinates, normal and flipped
physical ownership, overlapping-handle priority, every edge clamp, DOM refresh,
capture isolation, and disposal during an active gesture. No application route
enables the option. The harness's route-owned resize listener also proves the
composition order in Chromium: the bridge cancels active ownership first, the
runtime adopts the new outer viewport, held movement cannot reuse stale
coordinates, normal/flipped state and DOM dimensions survive later changes, and
fresh gestures scale against the new surface.

`LegacyBoardChrome` is the first consumer of that subscription. It remains
outside `BoardRenderer`, takes the local player ID for flip-stable source colors,
and delegates the unchanged turn, coin, flip, refresh, and fullscreen controls
to route callbacks. Its development-only composition paints over an invisible
real DOM candidate so native resize ownership still traverses the actual
runtime. Chromium compares real-v1 and candidate light, light-hover, dark,
dark-hover, sequential-resize, flipped-resize, and fullscreen screenshots with
an absolute 1,536-pixel fringe cap over 921,600 pixels, separate 512-pixel
handle and 1,280-pixel control caps, and a maximum 128/255 channel delta across
Chromium builds. Source and
candidate images plus per-state metrics are attached. No production route
imports this component yet; the callbacks do not claim complete game workflow
parity.

`tests/browser/react-dom-protected-input.spec.ts` now crosses the complete
native DOM → renderer intent → controller policy → adapter submission boundary.
A same-zone hand drop and a lower attached evolution dropped on discard both
animate through real drag presentation, then return to authoritative geometry,
suppress the follow-up click, emit exact `no_op` and `unsupported_source`
effects, and submit nothing. A legal hand-to-discard drop emits exactly one
preconditioned `MoveCard` plus one queued result. Native click, card
double-click, zone double-click, and right-click install selection, preview,
opened-zone, and context state without a mutation. The development-only harness
is removed idempotently.

`BoardSessionRuntime.subscribeBoard()` is the failure-isolated route-composition
seam for DOM outside the renderer. `LegacyBoardOverlays` uses it for context,
card/stack preview, and zone-browser paint, while dismissal and semantic input
return through runtime methods. The renderer channel continues to require
`card.interactive`; the separate `OpenedZoneCardIntent` channel additionally
requires the submitted card to belong to `presentation.openedZoneId`. Unit and
browser tests prove closed-zone and cross-zone forgery rejection, safe hidden
zone-card context, exact duplicated IDs, keyboard traversal/Escape/outside
dismissal, focus restoration, zone-card anchoring, and dark paint. A real-v1
browser comparison pins ordered context rows/computed paint and full-card
preview metrics with screenshot/JSON attachments.

The typed context/zone callbacks now return through
`LegacyOverlayActionRequested`. The controller first requires the exact card to
own the currently open context menu, or the exact zone to own the currently open
zone browser; it then requires an installed ready live-player projection. Only
after those checks does `resolveLegacyBoardOverlayAction` read that same view.
Accepted actions reuse the existing card-annotation, public-visibility,
private-inspection, random-face-down, prize-bottom, and loose-board resolvers or
construct the already authoritative owner-zone shuffle intents. The resulting
command uses the existing serialized `SubmitCommand` effect and the adapter
rechecks live/replay/session/role immediately before calling
`RemoteGameSession.submit`.

The resolver exhaustively classifies the unchanged controls:

| Ownership          | Actions                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| complete command   | ability toggle; own prize/deck shuffle; prize reveal/look/bottom; opponent-hand look/random; four loose-board destinations; per-card reveal; own opened-deck shuffle; own discard-to-deck shuffle |
| complete input     | damage/condition create-edit-remove; three hand-and-draw counts; direct draw count; top/bottom inspection counts                                                                                  |
| complete choice    | card category (`Energy`, `Trainer`/visible `Tool`, or `Pokémon`)                                                                                                                                  |
| missing choice     | move destination/submenu                                                                                                                                                                          |
| local presentation | zone sort                                                                                                                                                                                         |

Damage and special condition share one complete marker-input workflow. Their
value-less forms are admitted only for the exact open context card and install a
typed, kind-discriminated editor in `BoardOverlayState`; they emit the
characterized defaults `SetDamage(10)` or `SetSpecialCondition(P)` only when the
corresponding marker is absent. Submission must match both the open editor kind
and card, reuses `resolveStackStateAction`, and clears the editor before emitting
one `SubmitCommand`. Condition input is additionally active-stack-only and its
legacy palette follows the local draft. Invalid drafts cannot leave the UI,
while runtime-forged invalid values produce `invalid_value`; missing, wrong-card,
and cross-kind editor submissions produce `stale_card`. No-op and Escape drafts
dismiss locally. Reconnect, resync, timeline/recipient replacement, card
departure, active-slot departure, and terminal state purge or reconcile input
with the rest of the local overlay state.

The six count actions install a separate descriptor bound to the exact menu
action, card, and source zone. React invokes the same native prompt text and
`0`/`1` default as v1 exactly once—even through a StrictMode effect probe—then
submits only a complete nonnegative integer. Hand operations permit zero;
direct draw and inspection require one. The resolver rechecks ownership/source,
clamps against the current deck or combined hand/deck capacity and the 200-card
wire ceiling, and maps own inspection to private visibility and opponent
inspection to public interaction. Cancel and malformed values submit nothing;
the latter retains the source alert instead of v1's permissive `parseInt`
prefix coercion. Cross-action/card submission and source-zone departure fail
closed or clear the descriptor.

The category parent without a selection still emits `requires_choice`. Its
three source-ordered submenu rows supply one closed-union value, and the
resolver revalidates that value before delegating to the stale-safe card
annotation resolver. A valid row emits one `ChangeCardCategory` with the open
card's expected stack source; a forged value, lower evolution, loose card, or
closed/wrong context cannot reach the submitter. The remaining incomplete move
action never invents a destination. Zone sort remains entirely inside the mounted zone
browser: checking it creates a stable sorted copy from disclosed scene labels,
equal labels keep authoritative scene order, and unchecking restores that order.
The checkbox dispatches no controller request, effect, or command. The resolver
retains a `local_only` rejection for forged `sortZone` requests as a fail-closed
boundary. Replay remains strictly non-submitting. V1's replay-only local
disclosure exceptions are explicitly pinned to prize reveal, prize look, and
opponent-hand look, but V2 continues to expose an empty replay mutation menu
until it owns a separate local disclosure projection. Even a forged replay
request is rejected as `read_only` before the resolver runs. Native Chromium
now proves exact accepted `SetDamage`, `SetSpecialCondition`, both removals,
`SetAbilityUsed`, all six count submissions, and all three category choices;
native prompt text/defaults, capacity clamps, zero hand draws, and
private/public inspection policy; local rejection of malformed marker/count
drafts; the typed zero-command move-choice rejection; and reversible sorting
with zero routed actions or effects.

Deck-list ordering is not present in recipient projections: unlike v1, the
safe fallback orders disclosed labels and never obtains the opponent's hidden
deck list. Move-card submenu composition, replay-local disclosure paint, source
stack/zone raster parity, complete accessibility focus trapping, reconnect
snap-back, production wiring, and non-Chromium approval remain separate.

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

Current browser evidence covers source menu/category-submenu rows and computed
paint, card-preview intrinsic sizing, native menu traversal, Escape/outside
dismissal, focus return, command-backed ability/damage/condition/category
actions, both marker edit/removal flows, and typed zero-command incomplete/local
actions.
It does not claim complete focus trapping/screen-reader behavior,
move-card submenu workflows, replay-local disclosure behavior, source stack/zone raster
parity, keyboard suppression in every editable context,
coaching flip, reconnect reconciliation, or the non-Chromium matrix. These
remain Playwright/manual parity gates before any production switch.

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
