# Renderer decision spike

- Status: `DECIDED`; production parity gates remain
- Implementation branch: `codex/v2-engine-rebuild`
- Decision: ADR-004 selects normalized stable-keyed React DOM for first production
  use; raw Pixi remains an unwired comparison

## Research result

The viable client boundary is React for application chrome and DOM overlays,
with a renderer-neutral board adapter beneath it. React's
`useSyncExternalStore` is explicitly intended for subscribing to non-React
external stores, while Strict Mode deliberately repeats effect setup/cleanup in
development. The renderer host therefore has to be externally owned,
idempotently destructible, and safe when an asynchronous mount is superseded.

PixiJS v8 fits the imperative side of that boundary:

- `Application` uses asynchronous `init()` and exposes explicit renderer,
  ticker, resize, and destroy ownership;
- WebGL is the documented production recommendation; WebGPU is still described
  as susceptible to browser inconsistencies and Canvas is not an available v8
  fallback;
- v8 federated pointer events require explicit event modes and distinguish
  object-local from global pointer movement;
- accessibility is opt-in and implemented through DOM overlays; and
- `Assets` is promise-based and URL-cached, with explicit `unload()` for memory
  release. Automatic frame-count texture GC cannot be the only policy for this
  app because the board intentionally has no permanent ticker.

Primary sources:

- [PixiJS Application](https://pixijs.com/8.x/guides/components/application)
- [PixiJS renderers](https://pixijs.com/8.x/guides/components/renderers)
- [PixiJS events](https://pixijs.com/8.x/guides/components/events)
- [PixiJS accessibility](https://pixijs.com/8.x/guides/components/accessibility)
- [PixiJS Assets](https://pixijs.com/8.x/guides/components/assets)
- [PixiJS texture lifecycle](https://pixijs.com/8.x/guides/components/textures)
- [React external-store subscription](https://react.dev/reference/react/useSyncExternalStore)
- [React Strict Mode](https://react.dev/reference/react/StrictMode)

Versions used by the spike are pinned through the lockfile:

- React / React DOM `19.2.8`;
- PixiJS `8.20.1`;
- Vite `8.2.2`; and
- `@vitejs/plugin-react` `6.1.1`.

MagicCircle currently uses React 18.3.1 and PixiJS 8.20.0 at source commit
`39f871cd63800e2317326425345a26e4d61846de`. Its
`QuinoaCanvas.tsx`/`PixiAppHost.ts` establish the reusable operational pattern:
React owns a small imperative mount, every async continuation is scoped to a
renderer generation, startup and context recovery are bounded, resize/listener
ownership is explicit, and teardown precedes application destruction. PTCG Sim
adapts those behaviors without copying Quinoa's simulation ticker, layout/ECS,
Rive, or game-specific systems.

## Implemented common contract

`packages/renderer-contract` now contains:

- the `BoardRenderer` lifecycle used by both candidates;
- immutable recipient-safe scene nodes for zones, cards, stacks, markers, and
  work areas;
- semantic intents rather than legacy action names or network payloads;
- versioned geometry transcribed from the v1 self/opponent CSS;
- board flip/opponent rotation, the asymmetric legacy free-board placement, and
  deck-first versus discard/lost-zone-last cover ordering;
- stable-ID scene diffing and topmost deterministic hit testing;
- one shared drag gesture state machine with a five-pixel threshold, preserved
  grab offset, stable parent/zone target resolution, cancellation, and
  click-after-drag suppression;
- a renderer-independent, fail-closed drop resolver that validates the current
  recipient view and scene revision before producing a typed protocol command
  with an explicit source-zone precondition;
- face/back URL selection that cannot request a definition image for a
  concealed or face-down card; and
- a deterministic 61-card competitive fixture with covers, hands, prizes,
  free-board cards, active evolution/attachments, damage, condition, ability
  marker, group and BREAK rotation, per-card markers, and stadium.

It also exports a source-pinned ideal-CSS-pixel layout state and executable
legacy oracle for every primary player region, shell mode, physical frame,
resize handle, and shared anchor. This is additive and is not wired into either
renderer yet. Its coordinate spaces, source hashes, tolerances, known gaps, and
required browser comparison are recorded in
[`LEGACY_BOARD_LAYOUT_ORACLE.md`](./LEGACY_BOARD_LAYOUT_ORACLE.md).

The contract rejects invalid viewport/split inputs and any projection that puts
one recipient-safe card ID in more than one render location.

## Candidate A: normalized React DOM

`packages/renderer-dom` is a real stable-keyed React renderer, not a throwaway
HTML mock. It:

- mounts behind the same imperative lifecycle;
- synchronously clears scene/private presentation children without destroying
  the mounted root, allowing privacy-safe replacement;
- reuses card elements across scene revisions;
- memoizes stable card, zone, and marker nodes so a one-card descriptor change
  does not require rebuilding every unchanged child;
- uses native buttons and images for board card semantics;
- rejects older revisions and mismatched presentation events;
- emits the shared semantic interaction intents;
- uses Pointer Events and pointer capture while keeping drag position entirely
  in presentation state;
- validates every mount/install/resize viewport before mutation;
- reports actual committed recipient-safe IDs and retains teardown diagnostics
  until the deferred React unmount physically removes nodes;
- has automated repeated mount/destroy coverage under React Strict Mode.

This is the lower-complexity fallback and is expected to have the closest image,
CORS, browser-menu, and native accessibility behavior to v1.

## Candidate B: raw PixiJS

`packages/renderer-pixi` deliberately does not use `@pixi/react`. It:

- uses a raw v8 `Application` with WebGL, a private stopped ticker, and explicit
  one-shot renders;
- maintains stable sprites keyed by recipient-safe card ID;
- creates separate playmat/card/marker/interaction layers;
- deduplicates URL loads across renderer instances while visible and guards
  every asynchronous completion against card reuse/removal;
- issues opaque, broker-bound, idempotent leases so one renderer cannot release
  another renderer's reference, including during unload/reload races;
- releases a no-longer-referenced URL so a private face texture is not retained
  after concealment or a role/room transition;
- clears scene card views and bindings at recipient/reset boundaries while
  safely reusing only a still-pending zero-reference URL load reacquired before
  completion;
- renders a safe placeholder on load failure;
- counts and reports synchronous/asynchronous unload failures without hiding a
  failed teardown behind zero resource diagnostics;
- emits the same card/zone intents as the DOM candidate for mouse, touch, pen,
  accessibility activation, exact double-click boundaries, and secondary-button
  filtering;
- uses one stage-level global move listener plus canvas pointer capture for drag,
  avoiding per-card global work while sharing the DOM candidate's gesture
  semantics;
- reconstructs the display tree from the current immutable scene after WebGL
  context loss, with a three-attempt recovery ceiling;
- defers a context-loss rebuild when reset has left no scene, then rebuilds once
  from the next replacement instead of exhausting retries against an
  intentionally empty renderer; and
- coalesces asynchronous texture completions into one scheduled render turn;
- distinguishes renderer-local bindings from global asset-cache metrics and
  reports actual display-tree IDs; and
- has idempotent teardown of listeners, sprites, layers, application, and asset
  bindings, including terminal recovery-failure diagnostics.

The implementation is intentionally smaller than MagicCircle's host. Browser
testing must decide which additional recovery workarounds are necessary for the
supported PTCG device matrix instead of importing every Quinoa-specific branch.

## Runnable harness and build evidence

`apps/web` is an isolated decision harness; it does not replace the production
v1 route. It keeps the v1 75.5% board / 24% sidebar split and mounts the same
61-card scene with either:

- `?renderer=pixi`; or
- `?renderer=dom`.

The renderer candidates are dynamically imported, so loading one does not force
the other candidate into the initial route. Current production build evidence:

- initial application chunk: approximately 65.7 KiB gzip;
- shared drag controller chunk: approximately 0.9 KiB gzip;
- normalized DOM adapter chunk: approximately 2.5 KiB gzip; and
- raw Pixi adapter entry chunk: approximately 78.8 KiB gzip, plus lazily loaded
  Pixi implementation chunks.

These are build outputs, not a final route-size accounting; the full transitive
chunk graph will be measured in the browser evidence run.

## Automated evidence currently passing

- common geometry, privacy, ordering, identity, diff, and hit-test tests;
- DOM stable-key reuse, intent, stale-revision, mismatched-event, and repeated
  teardown tests;
- Pixi texture deduplication, final-reference unloading, stale face-to-back
  completion, and post-destroy completion suppression tests;
- React external-store subscription/cleanup and authoritative view replacement
  without renderer remount;
- an in-memory vertical multiplayer test covering admission, deck setup,
  projected scene creation, semantic drop resolution, client sequencing,
  authority commit, reconciled stack publication, bench-to-active promotion,
  explicit stack-to-zone departure, dependent-card staging across a resumed
  session, staged-stack restoration, and an atomic resumed bulk move to the
  deck bottom, plus inspection extraction across a resumed session and an
  atomic bulk move to hand, plus resumed deck-top swapping, moving cards to both
  deck edges, shuffling a selected card into the full deck, and shuffling prizes
  to the deck bottom, plus damage, condition, ability-used, and group-rotation
  targets that survive reconnect and follow the characterized evolution cleanup,
  plus stadium/BREAK orientation, exact-card ability markers, and an atomic
  category-change departure that survive the same projection/reconnect path,
  plus independent, explicitly targeted GX/VSTAR state across reconnect and
  per-player reset, plus an exact-source loose-board shuffle that normalizes
  cards, rotates hidden identities, and survives reconnect as one revision,
  plus atomic opponent-targeted prize reveal/hide that publishes safe counts,
  rotates re-concealed handles, and survives reconnect without replaying facts;
- TypeScript project boundaries and circular-dependency check;
- Vite production build; and
- the repository-wide v2 and 79-test legacy gates.

The drop resolver also refuses spectator submissions, stale scenes/cards/targets,
same-zone no-ops, lower-evolution departures, foreign staged work areas, and
transitions for which the core does not yet expose an explicit command. Safe
top-evolution/attachment stack departures, individual inspection/staged-card
departures, and staged-stack restoration have dedicated commands, resolved
events, authority checks, and source preconditions. A staged work area projects
its source stack, suggested slot, ordered evolution cards, and separately
ordered attachments, so neither renderer guesses classification from artwork or
current card category. Renderers never infer or mutate logical state; the
application boundary accepts either the harness recorder or
`RemoteGameSession.submit`. Runtime-validated wire snapshots regain their
compile-time view-ID brands at one explicit protocol boundary before entering
the external client store.

The side-panel command boundary maps the five legacy attached-card and viewed-
card bulk buttons to bounded `ResolveStagedCards` and `ResolveInspectionCards`
commands through one shared application path. The authority derives the player
and destination zone, validates the exact work-area ID, resolves random ordering
server-side, retires inspection visibility grants, and publishes the whole
result as one revision. No bulk operation loops through transient client-visible
card moves.

The same semantic boundary now maps all four legacy per-card deck controls to
`MoveCardToDeckTop`, `MoveCardToDeckBottom`, `ShuffleCardIntoDeck`, and
`SwapCardWithDeckTop`, carrying only an opaque card handle and its expected
source ID. The authority derives the deck owner and rejects stale, foreign,
lower-evolution, empty-deck, edge no-op, and self-swap cases. Zone and stack
swaps reuse existing movement events; inspection and staged swaps use narrow
work-area events with exact old-order preconditions. Shuffle-into-deck validates
the complete source departure before using authority randomness and publishes
the departure plus full-deck permutation in one revision.
`MovePrizesToDeckBottom` takes no client-selected zone or permutation and keeps
the existing deck prefix unchanged.

Whole-stack movement is also explicit: the top evolution card may represent a
stack for active/bench promotion, demotion, swapping, or bench reordering. The
resolved event replaces the complete board stack layout with exact old-layout
preconditions, while attachment drags and lower evolution cards cannot
accidentally move the stack.

The card-annotation boundary now separates stack rotation from BREAK/per-card
orientation and stack-host ability state from exact-card markers. It maps
category shortcuts to one `ChangeCardCategory` command instead of exposing a
low-level property mutation over the wire. The renderer composes card and stack
quarter turns and creates marker nodes from recipient-safe projected state; it
does not retain annotation state locally.

The projected player model also carries independent GX and VSTAR target state.
A UI-neutral action resolver derives explicit set/reset commands for either
board, while authority validates the target and opponent-interaction policy.
The existing side-button UX can consume this state directly; no renderer-local
toggle or new visible control is introduced.

Loose-board bulk controls now use one semantic resolver for discard, hand, lost
zone, and shuffle-into-deck. It snapshots the ordered projected card handles;
authority rejects any stale list and publishes one normalized event. Generic
zone commands cannot target the loose board, preventing an alternate path around
identity rotation and leaving-play cleanup. Both renderers consume only the
resulting recipient-safe zone projection, so no batch loop or transient card
location is visible locally.

Turn, attack, and pass controls now have a UI-neutral semantic boundary as
well. The commands preserve the legacy cleanup behavior in a single authority
revision and publish typed presentation facts through the remote session's
bounded timeline. This adds no renderer-owned state and does not alter the
existing controls, labels, or board geometry.

Deck load, setup, and reset now use a matching UI-neutral boundary. Each legacy
per-side control submits one explicit seat target and renders only the resulting
recipient-safe snapshot. Hidden setup cards remain concealed for the other
player; lifecycle announcements travel through the bounded presentation stream,
not renderer-owned state.

The random-hand control now has a selector-free UI-neutral boundary as well.
Authority chooses the card, while both renderers receive only the resulting
recipient-safe hand and loose-board projection. A newly played hidden card uses
a fresh opaque handle, and reconnect restores that handle without rerunning the
random choice or presentation signal.

The UI-neutral solo Undo boundary now submits the same semantic intent from
either renderer without carrying history. Authority restores and publishes one
recipient-safe checkpoint view, so neither renderer replays legacy actions or
repairs board state locally. No renderer component, geometry, label, shortcut,
or asset lifecycle changed in the slice.

The repository-wide gate passes 680 v2 tests across 104 files. A separate suite
passes 14 Playwright checks across seven Chromium 151 browser files:

1. React DOM mounts all 61 stable card nodes, preserves the measured v1 board and
   hand geometry, emits card and pointer-captured stable-target drag intents,
   resolves the drop to `MoveCardToPlay` with the expected source zone,
   resolves an active-to-bench stack drag to `MovePlayStack`,
   produces a screenshot, and has no runtime errors.
2. Pixi creates one live WebGL canvas with 61 card views, handles a real pointer
   click and pointer-captured drag, resolves the drop through the same command
   boundary including whole-stack movement, loses its actual WebGL2 context
   through `WEBGL_lose_context`,
   rebuilds to a later renderer generation with all 61 views, produces a
   post-recovery screenshot, and has no runtime errors.
3. Three Pixi → DOM → Pixi transitions leave exactly one selected renderer each
   time with no runtime errors or accumulated DOM/canvas views.
4. Native rapid clicks produce the same selection/preview boundary in DOM and
   Pixi, Pixi ignores secondary zone activation, and a touch-enabled browser
   context selects a card through the actual Pixi event boundary.
5. A synthetic quarter-turned card fixture verifies in both candidates that
   native selection and shared drag/drop use the painted center-rotated
   footprint: painted-only points select/target the card while points found
   only in its pre-transform layout box fall through to the underlying zone.
   Shared containment covers all four quarter turns; Pixi uses native
   inverse-transformed sprite containment and no longer double-scales a
   CSS-pixel explicit hit area.
6. Both candidates install an identical synthetic 120-card/17-zone/4-marker
   scene, settle asset diagnostics, record paired single/full reconciliation
   evidence, and schedule zero additional commits across five idle frames. The
   JSON attachment records environment and p50/p95 observations; it is
   diagnostic rather than a portable physical-device release result.
7. The checked-in v1 HTML/CSS is served through a deny-by-default, inert-module
   browser harness. Its default 1600×900 shell, frames, handles, shared anchors,
   opponent rotation, and all 16 region border boxes match the independently
   pinned oracle. The React DOM candidate's 16 visible region border boxes and
   stadium match that measured source; structural content boxes, opponent
   rotation, and non-painting frame/handle/control projection anchors match the
   pinned layout within the 2 CSS px gate. The sidebar content rectangle is
   derived from measured shell/tab edges, not a corresponding content element.
8. A second source-only fixture pins all relevant text and binary digests, then
   measures portrait and nonstandard square cards in both hands and benches
   plus controlled five-card active stacks in both frames. It verifies
   intrinsic-aspect sizing under authored constraints, measured frame rotation,
   integer-rounded width/15 and width/6 attachment offsets,
   expanded-container centering, negative z order,
   `base.after()` DOM reversal, and browser overlap hit order. This does not yet
   claim candidate-renderer card parity or ordinary `evolveCard` reflow parity.
9. A separate digest-pinned contained-card fixture measures six player cover
   images and both owner-readable stadium states from the inert legacy source.
   The live DOM candidate matches both players' deck/discard/lost-zone cards and
   the bottom-owner stadium within 2 px / 1% / 0.1 degrees, exposes only deck
   first or discard/lost-zone last to input/top-paint priority, suppresses
   closed-cover markers, and fails closed for foreign stadium owners or more
   than one stadium card. The source-measured top-owner candidate branch is
   unit-tested but not browser-compared; cover-open UX, opened zones, undersized
   assets, retained covered nodes, Pixi geometry, and quarter-turn hit regions
   are not claimed.
10. A fourth digest-pinned fixture isolates ordinary second
    evolution across local/opponent active and bench slots. It records the
    transient `evolveCard` result, the synchronous ghost wrapper created by
    `refreshBoard`, and the stable two-animation-frame result after observer
    cleanup. It pins top/middle/base logical and hit order, top/base/middle DOM
    order, integer `clientWidth / 15` offsets despite fractional painted widths,
    negative lower-layer z order, transient margins, and opponent-direction
    reversal. A narrowly gated renderer-contract helper now handles only the
    measured three-card, face-up, marker-free, unrotated, attachment-free,
    single-stack state at the captured default 1600×900 DPR-1 sidebar layout,
    even split, and unflipped bottom identity. Chromium directly matches all 12
    React DOM boxes, rotations, and common/exposed-strip hit order to the source
    within 2 px / 1% / 0.1 degrees. Attachments, markers, BREAK/rotation,
    multi-stack flex shrink/overflow, history-dependent restoration, alternate
    layout states, and input behavior are not claimed and retain the prior scene
    path. Pixi consumes the qualifying renderer-neutral geometry, but its paint
    and hit parity remain unverified.
11. A fifth, source-only digest-pinned fixture isolates one face-up Energy on
    one unrotated active Pokémon in both physical frames. It separates the
    immediate attach diagnostic from stable post-refresh reconstruction and
    pins `[base, energy]` logical/DOM order, target/relative/energy-layer state,
    integer `clientWidth / 6` offset, the `adjustCards` wrapper width, z/hit
    order, opponent mirroring, and two-to-one ghost-wrapper cleanup. A strict
    renderer-contract path uses the public 63:88 ratio and selects only the
    exact one-base/one-Energy, marker-free active state at the captured default
    layout. Chromium directly matches all four React DOM boxes, rotations,
    mapped z ranks, and common/Energy-only hit order within 2 px / 1% / 0.1
    degrees. Trainer-as-Tool, multiple/reordered attachments, departure,
    evolution combinations, bench/overflow, rotation, markers, alternate
    layouts, candidate wrapper/DOM-order identity, Pixi paint/hit behavior, and
    input are not claimed and retain the prior scene path.
12. A sixth source-only, digest-pinned card fixture isolates one current-category
    Trainer attached as a Tool to one active Pokémon in each legacy frame. It
    pins the shared integer non-Pokémon offset/width path plus Tool-specific
    90-degree rotation and `2%` wrapper margin, and distinguishes each
    pre-transform layout box from its swapped painted bounding box. The oracle
    covers opponent-effective 270-degree rotation, rotated wrapper overflow,
    common/Tool-only/base-only/empty-layout hit regions, attachment state and z
    order, and transient-to-stable wrapper cleanup. Shared rotation-aware input
    is now independently verified, but production DOM/Pixi Tool geometry parity
    remains deferred; multiple/mixed attachments, category history, removal,
    BREAK/compound rotation, and alternate layouts remain excluded.
13. The selected DOM implementation completes 100 mount → clear/reset → destroy
    cycles on one warmed route-owned host with the exact status sequence,
    complete scene IDs at mount, zero rendered scene children/IDs after clear and
    destroy, zero non-DOM diagnostic resources, and post-GC Chromium
    document/node/listener counts no higher than the warmed baseline. The React
    root/host is intentionally retained across clear/reset; heap sizes are
    attached as observations, not asserted as a portable retention budget.

The first browser run exposed a React integration defect that DOM emulation did
not: the nested renderer root used `flushSync()` and synchronous `unmount()`
inside its parent React lifecycle. The adapter now resolves mount from a real
layout-effect commit, uses scheduled React updates, resolves superseded mounts,
and queues unmount outside the parent lifecycle. The same tests then passed with
a clean console. This is retained as evidence for keeping browser tests separate
from happy-DOM lifecycle tests.

The suites live in `tests/browser/renderer-spike.spec.ts`,
`tests/browser/legacy-dom-geometry.spec.ts`, and
`tests/browser/legacy-card-stack-geometry.spec.ts`, plus the contained-card
comparison in `tests/browser/legacy-contained-card-geometry.spec.ts` and the
source-backed evolution comparison in
`tests/browser/legacy-evolution-reflow-geometry.spec.ts` and the source-backed
single-Energy comparison in
`tests/browser/legacy-energy-attachment-reflow-geometry.spec.ts`, plus the
source-only Trainer-as-Tool checkpoint in
`tests/browser/legacy-trainer-tool-attachment-reflow-geometry.spec.ts`. Standard
Linux CI can install Playwright's pinned Chromium build. This NixOS workspace
used the Nix Chromium 151 package through `PTCGSIM_CHROMIUM_PATH`, because Playwright's
Debian/Ubuntu dependency installer requires `apt-get` and downloaded generic
ELF binaries cannot directly resolve Nix store libraries.

## Decision and remaining production gates

ADR-004 records the evidence, consequences, and revisit triggers. React DOM is
selected because it preserves native UI/image/accessibility behavior, remains
within the provisional full-scene budget in the controlled 120-card harness,
and avoids making Pixi's additional asset, overlay, and WebGL failure surface a
production dependency. Pixi's lower synthetic full-update latency does not
override the parity-first decision rule without a measured protected-workflow
bottleneck and the full cross-browser matrix.

The following still require controlled browser/device runs before production
wiring:

- expand the source-driven default geometry checkpoint to painted/interactable
  frames, handles and controls, cards/stacks, screenshots, every declared
  viewport, split/flip state, and the structured 2 px / 1% thresholds;
- full double-click, right-click, flip, split resize, zone browser, keyboard,
  DOM-overlay anchor parity, and drag rejection/reconnect snap-back behavior;
- actual external card/image hosts, redirects, CORS failures, oversized/corrupt
  images, and the proxy/hybrid policy in ADR-013;
- background resume, 0x0 host, DPR changes, and resize coalescing; WebGL-only
  recovery/eviction cases remain gates for any future Pixi rollout;
- complete the resource gate beyond the green warmed-host Chromium lifecycle:
  route-host churn, 120 distinct cacheable network assets, decoded-image/request
  accounting, and retained heap on the ratified profile; display-object/GPU
  counters remain required only for a future Pixi rollout;
- the p95 reconciliation/input/drag budgets from the verification plan on the
  ratified four-core reference profile;
- keyboard and screen-reader audit of the selected semantic DOM surface; and
- Chromium automation plus Firefox and Safari approval.

The renderer-neutral core, protocol, authority, scene, and runtime remain valid
if a future measured bottleneck satisfies ADR-004's narrow revisit triggers.
