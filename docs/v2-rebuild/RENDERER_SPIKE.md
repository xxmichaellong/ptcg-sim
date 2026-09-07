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

The repository-wide gate passes 1021 v2 tests across 154 files. A separate suite
passes 149 Playwright checks across 72 Chromium 151 browser files:

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
   both stadium-owner states within 2 px / 1% / 0.1 degrees, exposes only deck
   first or discard/lost-zone last to input/top-paint priority, suppresses
   closed-cover markers, and fails closed for foreign stadium owners or more
   than one stadium card. The top-owner candidate is built from fixed projected
   state, independently of source output, and proves q2 paint, lower-edge
   alignment, native center hit, and complete teardown. Cover-open UX, opened
   zones, undersized assets, retained covered nodes, Pixi geometry, and q1/q3
   hit regions are not claimed.
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
12. A sixth digest-pinned card fixture isolates one current-category
    Trainer attached as a Tool to one active Pokémon in each legacy frame. It
    pins the shared integer non-Pokémon offset/width path plus Tool-specific
    90-degree rotation and `2%` wrapper margin, and distinguishes each
    pre-transform layout box from its swapped painted bounding box. The oracle
    covers opponent-effective 270-degree rotation, rotated wrapper overflow,
    common/Tool-only/base-only/empty-layout hit regions, attachment state and z
    order, and transient-to-stable wrapper cleanup. A strict renderer-contract
    path now selects only the one-base/one-Trainer marker-free active state at
    the exact default layout, using the public ratio, a rounded 90 px base, 15 px
    offset, 105 px wrapper, `2%` active-region margin, and z ranks `300/299`.
    Chromium matches all four pre-transform scene and painted React DOM boxes,
    effective rotations, z ranks, and four native hit regions within 2 px / 1% /
    0.1 degrees. Shared rotated input is independently verified in both
    candidates. Multiple/mixed attachments, category history, removal/stale
    margins, evolution combinations, BREAK/compound rotation, alternate
    layouts, wrapper/sibling identity, and Tool-specific Pixi paint parity
    remain excluded.
13. A seventh digest-pinned source fixture independently constructs
    local/opponent two-Energy active stacks and removes either the inner/first
    or outer/second attachment. It pins the stable `[base, E1, E2]` logical,
    `[base, E2, E1]` sibling and `[0, -1, -2]` layer orders; integer-width
    wrapper growth and contraction; inner-removal `parseInt` drift; survivor
    and removed-card identity; overlap hit order; synchronous ghost wrapper;
    and MutationObserver-settled cleanup. Both histories normalize to the same
    one-Energy source geometry. A strict renderer-contract helper selects only
    the stable one-base/two-Energy, active-only state at the exact default
    layout, using the public ratio, a rounded 90 px base, 15/30 px offsets, a
    120 px wrapper, and z ranks `300/299/298`. Chromium matches all six scene
    and React DOM boxes, rotations, z ranks, and four native hit regions to the
    stable source within 2 px / 1% / 0.1 degrees. Immediate departure and ghost
    phases remain source-only diagnostics; canonical inner/outer removal enters
    the existing one-Energy path. Mixed/Tool attachments, three or more Energy,
    category-history interactions, evolution/base departure, restore,
    bench/flex variants, rotation, alternate layouts/assets, Pixi paint/hit,
    and network behavior remain excluded.
14. An eighth source-only Chromium capture constructs four independent mixed
    attachment histories—both Energy/Trainer ingress orders in both physical
    frames—and four independent departure histories—remove either attachment
    in both frames. Both orders settle to logical `[base, Energy, Trainer]`, DOM
    `[base, Trainer, Energy]`, z `[0, -1, -2]`, 91/6 and 2×91/6 px source
    offsets, a 121.333 px wrapper, and the Tool's 90-degree local turn plus `2%`
    right margin. It also records native hit order, the Trainer-first recursive
    detach/reattach and 14.8333 px Energy drift, survivor compaction, stale
    departure margin, synchronous ghost wrapper, removed-card reset, and real
    observer cleanup. Departure settles to the existing single-Energy or
    single-Tool source geometry. Six additional staged histories cover reversed
    two-card and interleaved four-card `leaveAll` plus a multi-card staged
    deck-top swap on both sides. `leaveAll` normalizes the supported lists by
    replaying them through the incoming-Energy rule. The legacy swap removes and
    appends while v2 deliberately keeps exact-position atomic replacement, so
    their later within-Trainer orders are recorded as an explicit exception.
    Historical/transient phases remain source-only. The stable canonical
    `[Energy, Trainer]` output now supplies evidence for the strict path in item
    15; unsupported membership, base-only restore, broader multi-card restore,
    and overflow remain generic or deferred.
15. A ninth Chromium capture runs native canonical and current-
    category-cycle histories, plus a whole-stack round trip seeded from the
    prior oracle's exact reverse-restored checkpoint, independently in both
    physical frames. It does not replay `leaveAll`. Whole-stack movement
    refreshes the reverse 14.8333 px Energy drift into canonical sole-bench
    13.5/27 px and returned-active 15.1667/30.3333 px offsets.
    Energy→Trainer→Energy and Trainer→Energy→Trainer departure/reattachment also
    settle to the canonical active geometry while retaining semantic original
    categories. Exact arrays, DOM/wrapper identity, synchronous ghost and
    observer-settled cleanup, bounds, rotations, z/hits, reset/harness-operation
    traces, source digests, and denied requests are pinned. Its bounded React
    comparison mounts only the settled sole-bench and returned-active phases on
    both sides. All mixed-card scene/painted boxes, Tool q1/q3, z
    `300/299/298`, back-to-front order, and four native hit regions match within
    2 px / 1% / 0.1 degrees. The strict current-state gate fails closed outside
    one clean Pokémon base plus `[Energy, Trainer]` and the characterized
    active/sole-bench control shapes; no DOM-history field enters game state.
    Stable-ID scene diffs, Pixi descriptor/sprite reuse without texture churn,
    and owner/opponent/spectator projection privacy cover downstream consumers.
16. A tenth source-backed Chromium capture isolates one ordinary active Pokémon
    with damage, special-condition, and ability-used markers in both physical
    frames. It pins marker paint, palette, editability, hit order, live and
    post-removal resize callback counts, marker/card-pointer/wrapper cleanup,
    and the synchronous q0→q1→q2→q3→q0 rotation history.
    The first q2 writes a `1%` active-wrapper right margin, so returned q0 is
    about 1.92 px from pristine q0. Only canonical active-q0 current-state
    geometry enters the strict renderer-contract path. Its public-ratio card/
    marker geometry matches the pristine source phase within 2 px anchors / 1%
    sizes; React DOM palette is exact, typography remains proportional, and
    marker z is exactly card z plus one. The candidate's intentional
    non-interactive boundary is asserted separately. Eligible returned q0 is
    canonicalized because no DOM history is projected. Marker scene diffs,
    keyed Pixi view lifecycle without asset churn, and owner/opponent/spectator
    alias privacy are covered. q1/q2/q3 and source-history layout,
    bench/BREAK/compound and attachment rotation, marker transfer/editor
    integration UX, and Pixi-native paint/hit remain deferred.
17. An eleventh Chromium source capture isolates one ordinary Pokémon in
    the sole bench wrapper on both physical sides, with damage and ability-used
    markers and no canonical special condition. It pins q0→q1→q2→q3→q0,
    bench-specific `3%`/`2%` rotated margins, CSS-equivalent pristine and
    returned-q0 geometry, direct-zone marker ordering, and ability-over-damage
    native hit order in the q1/q3 overlap. Window listeners and native bench
    `ResizeObserver` deliveries are counted independently. The observer remains
    live before an explicit harness-only disconnect, so no source teardown is
    claimed. Only the strict pristine-q0 composition of one clean active
    control and one clean sole-bench base enters production. Its public-ratio
    card remains fixed while markerless; damage and ability use the separate
    `legacyBenchQ0` presentation and source append order. React geometry/paint
    matches source within the declared tolerances and preserves display-only
    hit-through. Keyed DOM/Pixi lifecycle and owner/opponent/spectator privacy
    tests cover updates, cleanup, resource stability, recipient-equivalent
    geometry, distinct stable opaque card aliases, and the shared canonical
    public stack ID. q1/q2/q3, observer/history reconstruction,
    additional bench contention, marker-editor integration, and Pixi-native
    paint/hit remain deferred.
18. A twelfth source checkpoint uses one shared Chromium harness but two
    digest-pinned contracts: ordinary compound group rotation and BREAK plus
    group rotation. Four fresh three-Pokémon cases per contract span both
    physical frames and active/sole bench. Top-selected q0→q1→q2→q3→q0,
    BREAK's `[1,0,0]` per-card offset composition, final toggle-off, and the
    valid q1 refresh reconstruction pin authored/painted/physical bounds,
    wrapper margins, logical/DOM/z order, golden phase rectangles and hit
    coordinates, identity, synchronous ghost wrappers, native observer delivery,
    and harness-only observer-handle cleanup. No candidate mounts: equal
    projected BREAK tuples retain different active margin histories, so the
    generic renderer remains the safe production path. Nonzero-group Alt-R,
    BREAK q0/q2/q3 refresh, lower-card initiators, and attachment timing are
    explicit semantic hazards excluded from this checkpoint.
19. A thirteenth source-only checkpoint isolates fresh BREAK q0, returned BREAK
    q0 after four group turns, and BREAK q2 after two group turns in twelve
    independent local/opponent active/sole-bench cases. It pins pre-refresh,
    synchronous two-wrapper, and settled geometry; exact operation and replay
    traces; retained card-node identity; observer delivery and harness-only
    observer cleanup; margins; authored, painted, and physical rectangles;
    topology; and six native hit regions.
    q0 refresh replays zero turns while q2 replays two and returns to its prior
    geometry. The same active `[q1,q0,q0]` card turns expose three distinct
    inline-margin histories and two exact anchor clusters, though the largest
    anchor difference is 1.9375 px and remains inside the 2 px parity tolerance.
    Bench histories converge. q3 negative-count collapse, lower-card
    initiators, attachments, and candidate parity remain excluded;
    production and domain state are unchanged.
20. A fourteenth source-only checkpoint isolates q3 BREAK refresh in four
    independent local/opponent active/sole-bench cases. Subtracting the BREAK
    quarter-turn from the selected top's effective q0 derives
    `numberRotations=-1`; the replay loop executes zero times after same-zone
    reconstruction, so `[top q0, lower q3, q3]` synchronously collapses to
    `[top q1, lower q0, q0]` and stays collapsed. The BREAK flag and card nodes
    survive. Exact geometry, before/after hit classes, operation traces,
    wrapper settlement, native observer delivery, harness-only cleanup, and the
    recursive source dependency chain are pinned. V2 does not reproduce this
    state-changing refresh defect; no candidate, production, domain, or schema
    path changes.
21. A fifteenth source-only checkpoint captures twenty-four independent clean
    nonzero-group Alt-R entry histories: ordinary/BREAK q1/q2/q3 across both
    physical sides and active/sole bench. Keyboard/click ingress is source-
    pinned but not executed. Five paths snap only the selected top to absolute
    q0 and clear BREAK while lower cards retain their group angle; BREAK q3
    instead advances its effective-q0 top to q1 and retains BREAK. Complete
    traces, action evidence, margins, geometry, native hit regions, observer
    ownership, cleanup, and recursive compound dependencies are pinned.
    Repeated post-divergence actions remain excluded. V2 keeps explicit group/
    per-card orientation; no production, domain, or schema path changes.
22. A sixteenth source-only checkpoint pins sixteen middle/base-initiated
    ordinary/BREAK group cycles across both slots and physical sides. Turns,
    BREAK flags, topology, and dependency-relative painted/hit geometry stay
    coherent, but lower-selected tentative angles shift margin history. BREAK
    q1 starts empty/`3%`-`2%` in active/bench before top-driven refresh
    normalizes both to `1%`/`0%`. Logical indices 1/2, reversed DOM ordinals,
    actions, traces, wrapper identity, observers, and cleanup are pinned. Lower-
    card single/Alt-R and mixed initiators remain separate; production/domain/
    schema paths are unchanged.
23. A seventeenth source-only checkpoint pins sixteen pristine group-q0 lower-
    card Alt-R histories across middle/base, ordinary/top-BREAK, active/bench,
    and both physical sides. The selected attached lower card alone changes
    q0→q1 and receives `PokémonBreak=true`; top-BREAK composition therefore ends
    with two flagged evolutions. Exact action indices, reversed DOM ordinals,
    margins, topology/links, physical geometry, and lower-specific painted/
    authored native hit probes are checked. No refresh occurs across the
    measured pre-single→post-single transition. Nonzero or history-authored q0
    entries and later divergence remain separate; no production/domain/schema
    path changes.
24. An eighteenth source-only checkpoint pins forty-eight independently built
    nonzero-group lower-card Alt-R histories across middle/base, q1/q2/q3,
    ordinary/top-BREAK, active/sole bench, and both physical sides. The selected
    lower evolution alone resets from q1/q2/q3 to absolute q0 and remains
    non-BREAK; its sibling retains the group angle, and a BREAK top retains its
    flag and effective orientation. Exact logical indices versus DOM ordinals,
    action traces, history-sensitive margins, authored/painted/physical bounds,
    ten native hit probes, wrapper identity, observers, and cleanup are pinned
    in two bounded 24-case Chromium runs. Keyboard/click ingress is digest-
    pinned but not executed, and no measured-transition refresh occurs.
    Returned/history-authored q0 and later divergence remain separate; no
    production/domain/protocol/schema path changes.
25. A nineteenth source-only checkpoint pins forty-eight clean returned-q0
    lower-card Alt-R histories. Ordinary/top-BREAK composition, homogeneous
    prior top/middle/base group initiator, final middle/base selection,
    active/sole bench, and both physical sides are exhaustive. Setup retains
    the established q1 reconstruction in its q0→q1→q2→q3→q0 cycle; the
    measured final action alone is refresh-free. The selected lower card changes
    q0→q1 and gains BREAK while siblings stay fixed. Exact history-sensitive
    margins, traces, dependency inheritance, authored/painted/physical bounds,
    ten hit probes, q1 wrapper replacement, measured identity, observers, and
    cleanup are pinned in two 24-case Chromium runs. Other q0 origins,
    refresh-free cycles, mixed prior initiators, repeats, later divergence, and
    production/domain/protocol/schema/UI changes remain separate.
26. A twentieth source-only checkpoint pins sixteen same-card repeated lower
    Alt-R histories at history-authored q0. Two setup singles take the selected
    lower card q0/false→q1/true→q0/false; the measured third restores q1/true.
    The second action's tentative q2 writes `1%`/`0%`, so every pre-state has
    those margins; active retains them and bench post-state writes `3%`/`2%`.
    Exact pre/post geometry matches the same-role lower-initiated returned-q0
    dependency, while complete traces and a three-observer/no-refresh lifecycle
    prove the histories differ. Turns, flags, indices/DOM ordinals, authored/
    painted/physical bounds, ten probes, stable identity, cleanup, and recursive
    provenance are pinned. Alternating targets, later repeats, interleaved group
    actions/refresh, candidate parity, and production/domain/schema/UI changes
    remain separate.
27. A twenty-first source-only checkpoint pins forty-eight immediate same-card
    follow-up Alt-R histories after clean q1/q2/q3 lower-card divergence. Each
    pre-state exactly inherits the matching prior nonzero-group post-state; the
    measured action changes only the selected lower card q0/false→q1/true.
    Ordinary/BREAK, middle/base, active/sole bench, and both physical sides are
    exhaustive. Active retains `1%`/`0%`; bench q1/q3 moves from `1%`/`0%` to
    `3%`/`2%`, while q2 remains `3%`/`2%`. Exact traces, turns/flags, cross-
    fixture geometry, ten probes, stable identity, three-observer/no-refresh
    lifecycle, cleanup, and recursive provenance are pinned in two 24-case
    Chromium runs. Q2 active geometry/hits collide with history-authored q0 in
    both phases and q2 bench converges after the action; BREAK flags coincide,
    while turns and full setup traces differ. Different targets, later repeats,
    intervening group/refresh,
    imported q0, attachments, candidate parity, and production/domain/schema/UI
    changes remain separate.
28. A twenty-second source-only checkpoint pins forty-eight immediate top-group
    rotations after clean q1/q2/q3 lower-card divergence. Every pre-state equals
    the checkpoint-eighteen post-state; one top/index-zero `single=false` action
    advances all Pokémon turns while leaving every BREAK flag unchanged. The
    selected lower card therefore reaches q1/non-BREAK. Active and ordinary
    bench margins remain inherited; every BREAK bench wrapper shifts exactly
    `0.015625px` as q1/q3 writes `3%`/`2%` and q2 writes `1%`/`0%`. Exact
    cross-fixture state/geometry collisions, trace extension, authored/painted/
    physical bounds, ten probes, stable identity, three-observer lifecycle with
    no measured-transition refresh, cleanup, and recursive provenance are pinned
    in two 24-case
    Chromium runs. Further/lower-initiated group actions, intervening single or
    refresh, markers, attachments, candidate parity, and production/UI changes
    remain separate.
29. A twenty-third source-only checkpoint pins forty-eight immediate wrapper
    refreshes after clean q1/q2/q3 lower-card divergence. It records the exact
    checkpoint-eighteen post-single state as its pre-refresh payload, same-task two-wrapper reconstruction, and
    settled one-wrapper recentering. Ordinary histories normalize to homogeneous
    q1/q2/q3; top-BREAK q1/q2 normalize to top q2/q3 plus lower q1/q2. Top-BREAK
    q3 computes a `-1` replay count and destructively collapses to top q1 plus
    lower q0. Exact trace prefixes/suffixes, margins, topology, same card nodes
    with a replacement wrapper, authored/painted/physical bounds, ten probes,
    four-observer cleanup, and five recursive dependencies are pinned in two
    24-case Chromium runs. Real KeyR image reload/network behavior, later
    actions, candidate parity, and production/UI changes remain separate.
30. A twenty-fourth source-only checkpoint pins forty-eight immediate same-
    lower-card whole-group rotations after clean q1/q2/q3 divergence. The
    measured middle/base at logical index 1/2 and DOM ordinal 2/1 moves
    q0→q1 with `single=false`, advances both siblings, and leaves every BREAK
    flag unchanged. Post turns/flags equal the corresponding top-initiated
    checkpoint exactly. Active geometry is also exact; every bench result is
    `3%`/`2%`, producing a signed `-0.015625px` frame-local x delta from the
    top-initiated result for ordinary q1/q3 and top-BREAK q2. Exact checkpoint-
    eighteen pre-state inheritance, traces, lower action payloads, authored/
    painted rectangles, physical-frame mappings, ten probes, stable wrapper/
    card identifiers, three-observer/no-
    refresh lifecycle, cleanup, and recursive provenance are pinned in two
    24-case Chromium runs. Different-lower/repeated group actions, intervening
    operations, alternate q0 origins, attachments, candidate parity, and
    production/UI changes remain separate.
31. A twenty-fifth source-only checkpoint pins forty-eight immediate different-
    lower-card whole-group rotations after clean q1/q2/q3 divergence. Prior
    middle selection makes base logical index 2 / DOM ordinal 1 the measured
    initiator; prior base selection makes middle logical index 1 / DOM ordinal 2. The other lower's q1/q2/q3 turn advances to q2/q3/q0 with `single=false`;
    both siblings advance and every BREAK flag is preserved. Post turns/flags
    equal both prior group-action checkpoints. Bench margins remain compact for
    q1/q3 and spread for q2. Ordinary geometry equals the top-initiated result;
    top-BREAK bench x differs by signed `+0.015625px`, `-0.015625px`, and
    `+0.015625px`, while q1/q3 are `+0.015625px` from the same-lower result and
    q2 is exact. Exact checkpoint-eighteen inheritance, both collision tables,
    traces, cross-role action payloads, authored/painted rectangles, physical-
    frame mappings, ten probes, stable wrapper/card identifiers, three-observer/
    no-refresh lifecycle, cleanup, and recursive provenance are pinned in two
    24-case Chromium runs. Repeats, intervening operations, alternate origins,
    attachments, candidate parity, and production/UI changes remain separate.
32. A twenty-sixth source-only checkpoint pins forty-eight immediate second
    same-lower whole-group rotations after checkpoint twenty-four. Every
    pre-state and trace prefix equals its checkpoint-twenty-four post-state.
    The selected middle/base q1→q2 `single=false` action advances both siblings
    and preserves every BREAK flag. Active remains `1%`/`0%`; every bench
    changes `3%`/`2%`→`1%`/`0%`, moving the wrapper and authored cards exactly
    `+0.015625px` frame-local x. Painted rectangles are independently measured
    because every card parity flips. Q1/q3 post geometry and ten-probe sets
    collide internally despite different turns; q2 collides with checkpoint
    eighteen's pre-divergence geometry, subject to the explicit top-BREAK bench
    displacement. Exact inheritance, turns/flags, traces/actions, fresh
    authored/painted rectangles, physical-frame mappings, stable identifiers,
    three-observer/no-refresh lifecycle, cleanup, and recursive provenance are
    pinned in two 24-case Chromium runs. Third/later turns, top/different-lower
    followups, intervening operations, alternate origins, attachments,
    candidate parity, and production/UI changes remain separate.
33. A twenty-seventh source-only checkpoint pins forty-eight immediate second
    whole-group rotations by checkpoint twenty-five's same other lower
    initiator. Every pre-state and trace prefix equals checkpoint twenty-five.
    The selected q2/q3/q0 lower advances to q3/q0/q1; both siblings advance and
    all BREAK flags remain unchanged. Active stays `1%`/`0%`. Bench q1/q3
    changes compact→spread with a `-0.015625px` wrapper/authored x displacement;
    q2 changes spread→compact with `+0.015625px`. Painted rectangles and ten
    probes are freshly measured across every parity flip. Post turns/flags equal
    checkpoint twenty-six: active and bench q2 geometry collide exactly, while
    bench q1/q3 differs by `-0.015625px`. Q1/q3 also collide internally, and q2
    retains its checkpoint-eighteen reference. Exact predecessor inheritance,
    cross-role actions, traces, authored/painted rectangles, physical-frame
    mappings, stable
    identifiers, three-observer/no-refresh lifecycle, cleanup, and recursive
    provenance are pinned in two 24-case Chromium runs. Different second
    initiators, later/intervening actions, alternate origins, attachments,
    candidate parity, and production/UI changes remain separate.
34. A twenty-eighth source-only checkpoint pins forty-eight immediate second
    top-initiated whole-group rotations after checkpoint twenty-two. Every
    pre-state and trace prefix equals checkpoint twenty-two. The same top at
    logical/DOM index zero advances all three raw turns once and preserves every
    BREAK flag, including true→true for top-BREAK. Active stays `1%`/`0%`.
    Ordinary bench q1/q3 changes compact→spread and q2 spread→compact; top-BREAK
    takes the inverse branches, with signed `0.015625px` wrapper/authored x
    displacement. Painted rectangles and ten probes are freshly measured across
    every parity flip. Post turns/flags equal checkpoint twenty-seven: ordinary
    geometry is exact; top-BREAK active is exact and bench q1/q2/q3 differs by
    `+0.015625px`, `-0.015625px`, and `+0.015625px`. Q1/q3 also collide
    internally, while q2 exactly retains checkpoint eighteen's geometry. Exact
    predecessor inheritance, top actions, traces, authored/painted rectangles,
    physical mappings, stable identifiers, three-observer/no-refresh lifecycle,
    cleanup, and recursive provenance are pinned in two 24-case Chromium runs.
    Lower/different initiators, later/intervening actions, alternate origins,
    attachments, candidate parity, and production/UI changes remain separate.
35. A twenty-ninth source-only checkpoint pins 48 top→prior-divergent-lower
    mixed-initiator histories after checkpoint twenty-two. The measured middle/
    base is invariantly q1/non-BREAK at logical index 1/2 and DOM ordinal 2/1;
    its `single=false` q1→q2 action advances both siblings and preserves every
    BREAK flag. Active and every post bench stay/become compact. Ordinary q2 and
    top-BREAK q1/q3 bench wrapper/authored x move `+0.015625px`; complementary
    histories do not move. Fresh painted rectangles and ten probes cover every
    parity flip. Exact checkpoint-twenty-two pre-state/trace inheritance and
    exact checkpoint-twenty-six post turn/flag/margin/geometry/probe equality are
    pinned despite the different initiator history, alongside checkpoint-
    twenty-eight bounded comparisons and internal q1/q3 collisions. Two 24-case
    Chromium runs verify lower action selection, physical mappings, stable IDs,
    three-observer/no-refresh lifecycle, cleanup, and recursive provenance.
    Top/other-lower second initiators, later/intervening actions, alternate
    origins, attachments, candidate parity, and production/UI changes remain
    separate.
36. A thirtieth source-only checkpoint pins 48 top→other-lower mixed-initiator
    histories after checkpoint twenty-two. Prior-middle histories measure base
    at logical index 2 / DOM ordinal 1; prior-base histories measure middle at
    logical index 1 / DOM ordinal 2. The selected non-BREAK lower advances
    q2→q3, q3→q0, or q0→q1, advances both siblings, and preserves every BREAK
    flag. Active stays compact. Ordinary bench q1/q3 changes compact→spread by
    `-0.015625px` frame-local wrapper/authored x and q2 changes spread→compact by
    `+0.015625px`; top-BREAK margins remain unchanged. Fresh painted rectangles
    and ten probes cover every parity flip. Checkpoint thirty's pre-state and
    trace prefix exactly inherit checkpoint twenty-two's post-action phase, and
    exact checkpoint-twenty-seven post turn/flag/margin/geometry/probe equality
    is pinned alongside checkpoint-
    twenty-nine bounded comparisons and internal q1/q3 collisions. Two 24-case
    Chromium runs verify cross-role action selection, physical mappings, stable
    IDs, three-observer/no-refresh lifecycle, cleanup, and recursive provenance.
    Top/prior-lower second initiators, later/intervening actions, alternate
    origins, attachments, candidate parity, and production/UI changes remain
    separate.
37. A thirty-first source-only checkpoint pins 48 immediate third-top histories
    after checkpoint twenty-eight. The same top at logical/DOM index zero
    performs the measured `single=false` action; every raw turn advances once
    and every BREAK flag survives, including top's true→true transition. Active
    stays compact. Ordinary bench q1/q3 changes spread→compact by `+0.015625px`
    frame-local wrapper/authored x and q2 compact→spread by `-0.015625px`; top-
    BREAK takes the inverse branches. Fresh painted rectangles and ten probes
    cover every parity flip. Exact checkpoint-twenty-eight pre-state/trace
    inheritance is pinned. Every post margin/geometry/probe tuple and BREAK
    vector equals checkpoint twenty-two, while each raw turn is two modulo-four
    quarter-turns ahead; q1/q3 also collide internally. Two 24-case Chromium
    runs verify action selection, physical mappings, stable IDs, source
    fulfillment, three-observer/no-refresh lifecycle, cleanup, and recursive
    provenance. Fourth/later or lower-initiated actions, intervening operations,
    alternate origins, attachments, candidate parity, and production/UI changes
    remain separate.
38. A thirty-second source-only checkpoint pins 48 immediate third-same-lower
    histories after checkpoint twenty-six. The same divergent middle/base card
    acts at logical index 1/2 and DOM ordinal 2/1, advances q2→q3, advances both
    siblings, and preserves every BREAK flag. Active stays compact; every bench
    changes compact→spread by `-0.015625px` frame-local wrapper/authored x. Fresh
    painted rectangles and ten probes cover the parity flip. Exact checkpoint-
    twenty-six pre-state/trace inheritance is pinned. Every post margin,
    geometry, probe tuple, and BREAK vector equals checkpoint twenty-four while
    each raw turn is two modulo-four quarter-turns ahead. Post turns and flags
    also equal checkpoint thirty-one, but ordinary q1/q3 and top-BREAK q2 bench
    geometry differs; q1/q3 collide internally. Two 24-case Chromium runs verify
    lower selection, physical mappings, stable IDs, source fulfillment, three-
    observer/no-refresh lifecycle, cleanup, and recursive provenance. Fourth/
    later, top/different-lower, intervening, alternate-origin, attachment,
    candidate-parity, and production/UI paths remain separate.
39. A thirty-third source-only checkpoint pins 48 immediate third-other-lower
    histories after checkpoint twenty-seven. The same other middle/base card
    acts at logical index 2/1 and DOM ordinal 1/2, advances q3→q0, q0→q1, or
    q1→q2, advances both siblings, and preserves every BREAK flag. Active stays
    compact. Bench q1/q3 changes spread→compact by `+0.015625px` frame-local
    wrapper/authored x; q2 changes compact→spread by `-0.015625px`. Fresh
    painted rectangles and ten probes cover each parity flip. Exact checkpoint-
    twenty-seven pre-state/trace inheritance is pinned. Every post margin,
    geometry, probe tuple, and BREAK vector equals checkpoint twenty-five while
    each raw turn is two modulo-four quarter-turns ahead. Post turns and flags
    also equal checkpoint thirty-two; active and q2 geometry is exact, while
    q1/q3 has a bounded `+0.015625px` bench history displacement. Q1/q3 collide
    internally. Two 24-case Chromium runs verify lower selection, physical
    mappings, stable IDs, source fulfillment, three-observer/no-refresh
    lifecycle, cleanup, and recursive provenance. Fourth/later, top/prior-
    lower, intervening, alternate-origin, attachment, candidate-parity, and
    production/UI paths remain separate.
40. A thirty-fourth source-only checkpoint pins 48 immediate fourth-top
    histories after checkpoint thirty-one. The same top at logical/DOM index
    zero performs the measured `single=false` action; every raw turn advances
    once and every BREAK flag survives, including top's true→true transition.
    Active stays compact. Ordinary bench q1/q3 changes compact→spread by
    `-0.015625px` frame-local wrapper/authored x and q2 spread→compact by
    `+0.015625px`; top-BREAK takes the inverse branches. Fresh painted
    rectangles and ten probes cover every parity flip. Exact checkpoint-thirty-
    one pre-state/trace inheritance is pinned. Every post margin/geometry/probe
    tuple equals checkpoint twenty-eight while turns are two modulo-four
    quarter-turns ahead. Turns and flags complete a full cycle to checkpoint
    eighteen; top-BREAK bench geometry closes exactly, but ordinary bench retains
    its bounded q1/q3 `-0.015625px` and q2 `+0.015625px` history displacement.
    Q1/q3 collide internally. Two 24-case Chromium runs verify action selection,
    physical mappings, stable IDs, source fulfillment, three-observer/no-refresh
    lifecycle, cleanup, and recursive provenance. Later/lower-initiated,
    intervening, alternate-origin, attachment, candidate-parity, and production/
    UI paths remain separate.
41. The selected DOM implementation completes 100 mount → clear/reset → destroy
    cycles on one warmed route-owned host with the exact status sequence,
    complete scene IDs at mount, zero rendered scene children/IDs after clear and
    destroy, zero non-DOM diagnostic resources, and post-GC Chromium
    document/node/listener counts no higher than the warmed baseline. The React
    root/host is intentionally retained across clear/reset; heap sizes are
    attached as observations, not asserted as a portable retention budget.
42. A separate selected-DOM cache gate mounts 120 stable card identities backed
    by 120 distinct, versioned, same-origin SVG URLs from a deterministic
    serve-only fixture. Chromium successfully decodes every image at its exact
    intrinsic dimensions; a keyed update reassigns already-cached URLs without
    replacing any button or image node; and a fresh renderer/host creates new
    nodes while issuing no additional or conditional asset requests. Exact
    server counts prove one completed response per asset with no aborts or
    unexpected paths; any warm resource-timing entries report zero transferred
    bytes. Both renderer lifecycles terminate cleanly, and the route-owned
    renderer remains untouched. Its baseline now requires five consecutive
    stable paint frames so a warmed module path cannot mistake a delayed initial
    `ResizeObserver` commit for asset-gate interference. This is network-cache
    and browser-visible decode evidence, not a native decoder-invocation count,
    decoded-pixel/heap budget, real-raster load, external-host/CORS/failure test,
    hidden-face request behavior or cross-browser result.
43. The developer-only creator route completes 20 React StrictMode
    mount/unmount cycles through the actual lazy application branch, remote-room
    runtime, client session, replay/presentation ownership, and selected DOM
    renderer. The full parallel gate can take just over Vitest's 5-second
    default while the isolated gate completes near 4 seconds, so this deliberate
    20-cycle stress test has an explicit 10-second budget without removing any
    lifecycle assertion. Its deferred irreversible start coalesces each
    StrictMode probe into one room creation. Every cycle reaches a rendered board
    and then closes its runtime/socket, disposes its renderer/result exactly
    once, clears the console handle, and leaves no host children. HTTP and
    WebSocket transport are
    mocked in-process; deployed browser navigation, second-browser invitation,
    and heap/resource accounting remain separate evidence.
44. A complementary Chromium gate starts local Wrangler and Vite, verifies the
    safe public health response, creates a real Durable Object room through the
    same-origin proxy, exchanges the creator capability for a one-time ticket,
    completes WebSocket admission, and reaches a ready projected DOM board. It
    now drives an unclean transport-loss signal, lets the real client backoff
    open a second socket, and proves the second Hello uses the rotated resume
    capability rather than the spent admission ticket. The same room, view,
    renderer generation, renderer object, DOM surface, and revision survive the
    exact reconnecting→connecting→handshaking→ready sequence; a post-resume coin
    command commits revision 1. A client message still receives the documented
    `not_implemented` server notice, proving bidirectional transport without
    claiming chat parity. Every observed HTTP/socket URL is query-, credential-,
    and fragment-free, no second HTTP admission occurs, the superseded and
    current native sockets both close, successful `101` telemetry is accepted,
    and the terminal socket count reaches zero. Deployed navigation churn and
    the ADR-020 second-browser journey remain separate gates.
45. A thirty-fifth source checkpoint follows one ordinary marked Pokémon through
    active→bench movement, same-bench refresh reconstruction, and bench→active
    movement independently in both physical frames. Chromium proves that the
    source retains the card plus damage/ability marker nodes, reparents and
    reflows those markers, replaces every `play-container`, briefly retains two
    wrappers until `MutationObserver` delivery, and removes the active-only
    special condition on demotion. Four synchronous reflows measure the
    replacement bench wrapper before the old wrapper settles, temporarily
    shifting both surviving markers 4.765625 CSS px right even though the card
    returns to identical geometry. The old wrapper's `MutationObserver` and the
    native bench `ResizeObserver` reflow the markers during settlement and
    restore the prior bench geometry. V2 does not expose that transient source
    history: canonical state retains damage and ability on the stable stack, clears the condition, and recomputes
    deterministic current-slot geometry. Scene diffs update the two surviving
    top-card-derived marker IDs rather than remove/re-add them. DOM and Pixi retain their keyed
    marker objects across active/bench presentation changes without asset work.
    A real authority/session test proves the same transition, a public stable
    stack ID, private stable marker/parent aliases, and equal normalized geometry
    for owner, opponent, and spectator. Rotated/compound movement and
    marker-editor production integration remain separate.
46. A real-runtime Chromium checkpoint executes the shipped v1 marker modules
    rather than a transcription. It opens the actual active-card context menu;
    creates damage, condition, and ability markers; edits and blurs the live
    `contenteditable` nodes through retention and zero-removal; and invokes the
    numeric, Y, Alt-Y, and W shortcuts. Stable marker identity, exact condition
    cycle/palette, action counts and parameters, export-owner rewriting, asset
    requests, cleanup, and page errors are asserted. The replay also preserves
    evidence of a legacy defect: Alt-decrementing damage through zero deselects
    the card and then emits an unintended zero-card `viewDeck` action from the
    unselected branch of the same keydown. The typed v2 resolver maps that
    gesture to exactly one `SetDamage(null)` submission, preserves the complete
    condition cycle, and rejects invalid/unbounded editor values. No marker
    interaction is wired into the production renderer in this checkpoint, so
    layout, context-menu appearance, labels, and shortcuts remain unchanged.
47. A direct v1 evolution checkpoint executes the shipped card, cover,
    move-bundle, counter, and refresh modules for marked and unmarked incoming
    discard Pokémon. It proves that legacy copies host damage into a distinct
    new node, zeroes and removes old damage/condition nodes, removes host
    ability, and preserves/reparents the incoming ability node only when it
    already exists. It also pins array/DOM topology, relative links, one wrapper,
    the single live/export action with owner rewrite, asset service, and a clean
    error surface. V2 performs the transition atomically. Stack marker IDs now
    follow the visible top card's private recipient alias: active/bench movement
    remains stable, old evolution-host markers depart, incoming damage is added,
    and a visible incoming ability marker is updated under the same identity.
    Core, scene-diff, and real owner/opponent/spectator session tests prove the
    lifecycle, distinct aliases, equal geometry, and no canonical-ID leakage.
    No UI or UX changes.
48. A full-runtime v1 layout checkpoint drives the actual resize handles with
    DOM mouse events, proving overlay ownership and both normal branches. It
    activates the real flip control, proves both flipped handler bindings,
    reproduces the recorded 1920×1080 DPR-2 40%/35% asymmetric fixture, and
    double-flips without moving physical geometry. The real fullscreen control
    matches its recorded 1280×720 shell and restores it on second activation;
    the direct CSS viewport matrix now also includes compact 1024×768. The
    renderer contract's pure `resizeBoardLayoutState` matches these source
    events, including the first-event `49%`/`51%` handle fallbacks, and the
    opt-in session runtime projects it without game commands, route wiring, or
    UI/UX changes. The next checkpoint closes source edge collision/clamp
    evidence and focused candidate pointer ownership; painted controls,
    browser-level candidate gestures, and non-Chromium approval remain
    separate.
49. The real-runtime layout gate now pins the exact adjacent 1280×720 collision
    pixels in all four normal/flipped branches, both strict edge-growth
    thresholds, normal overscan clamps, flipped one-pixel clamps, and the
    history-sensitive collision caused by a previously expanded 10% handle.
    Near/far clamped source captures are identical. All nondegenerate shell,
    frame, handle, shared, and 16-region geometry matches the pure transition;
    at the flipped one-pixel endpoint, Chromium's nested iframe shifts inner
    regions by about 2.7 px, so only outer model parity is claimed while exact
    source-to-source clamp identity remains enforced. The opt-in React DOM
    runtime adds deny-by-default capture ownership with scaled coordinates,
    upper-handle overlap priority, flip-stable physical identity, wrong-pointer
    rejection, and complete release/cancel/blur/resize/disposal cleanup. Its handle
    nodes remain non-painting and pointer-transparent, no route opts in, and no
    production UI/UX changes.
50. A development-only React DOM harness mounts that opt-in pointer bridge on a
    translated 75%-scale 1280×720 surface. Real Chromium mouse input now proves
    candidate normal and flipped physical-handle movement, upper-handle overlap
    priority, the normal overscan and flipped one-pixel clamp endpoints, live
    frame/handle DOM geometry refresh, capture isolation from board bubbling,
    and listener cleanup when disposal interrupts an active gesture. The module
    is dynamically imported only by its browser spec; no production route opts
    in, the sentinels remain non-painting/pointer-transparent, and painted
    controls, browser-driven viewport-resize continuity, and non-Chromium
    approval remain separate gates. Running this warmed path immediately before
    the cacheable-asset gate exposed its two-frame startup-idle race; that gate
    now requires five stable paint frames before freezing strict route identity.
51. The same isolated harness now performs route-owned viewport synchronization
    after the bridge's earlier window-resize cancellation listener. Chromium
    holds a native pointer across 1280×720→1440×810, proves the stale move cannot
    mutate the split, verifies the renderer-neutral viewport and scaled DOM
    dimensions, applies a fresh correctly scaled normal gesture, preserves that
    layout at 1024×768, and then preserves flipped ownership through a return to
    1280×720 before applying a fresh flipped physical-lower gesture. Disposal
    removes both viewport and pointer ownership. No production route or visible
    UI/UX changes. The full quality run also exposed the existing 20-cycle route
    churn gate at 5.048 seconds under parallel load versus its 5-second default;
    that stress proof now has an explicit 10-second timeout while retaining every
    teardown assertion.
52. `BoardSessionRuntime` now exposes its stable frozen layout snapshot through
    a failure-isolated, idempotently removable route subscription; no-op layout
    replacement stays silent and disposal clears all listeners. The unwired
    `LegacyBoardChrome` consumes that boundary and copies the source handles,
    five controls, hover paint, and tooltips without entering `BoardRenderer`.
    A development-only composition drives real candidate handles and visible
    flip/fullscreen callbacks, then compares 1280×720 real-v1 and candidate
    screenshots for light, light-hover, dark, dark-hover, sequential resize,
    flipped asymmetric resize, and fullscreen. At most 1,536/921,600
    compositor-fringe pixels are accepted, with separate 512-pixel handle and
    1,280-pixel control caps plus a 128/255 channel delta across Chromium builds;
    all source/candidate images and metrics are
    attached, and the other three callbacks delegate once. Production routes,
    current UI/UX, and v1 sources remain unchanged; full action workflows and
    non-Chromium approval remain separate.
53. A separate development-only harness composes the real React DOM renderer,
    session runtime, controller, adapter, and recording live submission seam.
    Native Chromium drags reject a hand-to-same-zone no-op and a lower attached
    evolution-to-discard move with exact reasons, zero commands, cleared drag
    presentation, and suppressed clicks. A legal hand-to-discard drag emits one
    preconditioned `MoveCard` and one queued result. Native click, card
    double-click, zone double-click, and right-click then install protected
    selection, preview, opened-zone, and context state without another command;
    idempotent disposal removes the full harness. Production bundles/routes and
    current UI/UX remain unchanged. Visible overlay paint, keyboard/focus,
    source interaction parity, reconnect snap-back, and non-Chromium approval
    remain separate.
54. The same unwired route composition now owns `LegacyBoardOverlays`: context
    menu, full-card preview, stack preview, and zone browser render only
    recipient-safe scene images and return semantic input through the runtime.
    A dedicated opened-zone action accepts hidden cards only when their parent
    is the currently open safe zone; renderer-surface, closed-zone, and
    cross-zone forgery checks remain strict. Native Chromium covers Shift+F10,
    Enter/Space, menu arrows/Home/End, Escape/outside dismissal, focus return,
    exact card IDs, duplicate-card context anchoring, light/dark paint, and zero
    command leakage. `react-dom-overlay-paint.spec.ts` independently mounts the
    real v1 `Card` and pins source-ordered menu rows/computed paint plus the
    full-preview shell/image metrics, attaching both sides and JSON evidence.
    Action callbacks remain typed recording seams, not completed mutation
    workflows; replay availability, complete accessibility audit, reconnect
    behavior, production wiring, and non-Chromium approval remain separate.
55. Those typed callbacks now enter the same protected controller/effect/session
    path as renderer drops. `resolveLegacyBoardOverlayAction` exhaustively
    classifies every current menu/zone control and reuses the existing
    stale-safe annotation, visibility, inspection, random, prize-bottom, and
    loose-board resolvers for complete actions. The controller binds a request
    to the currently open menu card or zone, requires a ready live-player
    projection, and the adapter rechecks live/replay/session/role immediately
    before submit. Prompt and submenu controls emit typed `requires_input` or
    `requires_choice` rejection effects and cannot invent defaults. A forged
    zone-sort request remains a typed `local_only` rejection. Native Chromium
    proves one exact `SetAbilityUsed` command plus a zero-command hand-input
    rejection. The three v1
    replay-local disclosure exceptions are pinned, while V2 deliberately keeps
    replay actions non-submitting and unavailable until a separate local
    disclosure projection exists. Prompt/submenu composition, replay-local
    paint, production wiring, and the prior parity gaps remain separate.
56. Zone sorting now terminates inside `LegacyBoardOverlays`. The controlled
    checkbox renders a newly sorted card-array copy using only recipient-safe
    scene labels, explicitly retains canonical order for duplicate/concealed
    labels, restores canonical order when unchecked, and resets on overlay or
    zone replacement. It does not route an action, emit an effect, submit a
    command, or mutate the scene/view. The native fixture begins in a deliberate
    non-sorted order and proves both directions plus zero action/effect/command
    traffic. V1's rank came from exchanged deck data; protected opponent views
    do not contain that hidden information, so the documented security-preserving
    parity exception is stable disclosed-label order. The control, text, dialog
    layout, paint, and production-route boundary are unchanged.
57. The same route-owned layer now completes damage editing without making
    renderer markers mutable. A value-less `setDamage` request is bound to the
    exact open context card and installs one typed controller editor; if damage
    is absent it simultaneously emits only the source-characterized default
    `SetDamage(10)`. The temporary React `contenteditable` overlays the current
    recipient-safe marker geometry and shared appearance. Unchanged or Escape
    drafts cancel, integers `1..9990` submit exactly once, zero/negative/empty
    input removes damage, and decimal/nonnumeric/over-limit/overlong drafts stay
    local with `aria-invalid`. A typed submitted value must match the open
    editor before the pure resolver can reuse `resolveStackStateAction`.
    Reconnect, replacement, terminal state, and target departure clear it.
    Unit tests cover default creation, safe parsing, no-op/cancel, target
    forgery, reconnect, exact bounds, and immutable scene markers. Native
    Chromium proves invalid → `70` → removal → ability sequencing with three
    exact commands and no duplicate submission. Special-condition editing,
    keyboard shortcuts, other count prompts, submenus, and production wiring
    remain separate.
58. The cycle gate now excludes Wrangler's generated `.wrangler` staging tree
    alongside `dist` and `lib`. Repeated local Worker builds had left ignored
    bundle copies beneath `apps/server/.wrangler/tmp`, causing Madge to traverse
    generated code and grow from 252 reviewed source files to 498 mixed files.
    The corrected scan is stable at 252 files and still reports no circular
    dependencies; no generated directories are deleted as part of the gate.
59. The protected marker-input union now also completes special-condition
    editing. A missing active marker submits only the source default
    `SetSpecialCondition(P)` while opening; an existing marker opens with no
    command. The shared editor retains exact initial scene paint, applies the
    legacy `P/B/A/Pa/C` palette to local drafts, trims accepted text to at most
    16 characters, and maps zero/empty text to removal. Controller submission
    must match both card and editor kind; condition input also reconciles away
    when the stack leaves active. Unit and native Chromium coverage pin default,
    overlength/non-string rejection, cross-kind forgery, exact bounds/paint,
    yellow/black `Pa`, removal, immutable markers, and exact client sequences
    through the following ability action. The route remains development-only.
60. A dedicated count-input resolver now completes the six native prompt
    actions without replacing their visible browser UI. Hand discard/shuffle
    variants retain `Draw how many cards?` default `0`; direct draw retains the
    same prompt default `1`; top/bottom inspection retains its exact question
    and default `1`. One typed descriptor binds action/card/source-zone and a
    WeakSet identity gate prevents duplicate StrictMode prompting. Accepted
    complete integers are revalidated and clamped to current deck or combined
    hand/deck capacity plus the 200-card protocol ceiling. Hand actions allow
    zero; draw/inspection require one. Own inspection is private and opponent
    inspection public under the existing authority policy. Cancel is quiet;
    malformed values show the source alert rather than inheriting permissive v1
    `parseInt` prefixes. Unit and native Chromium coverage pins all six exact
    commands, prompt/default pairs, clamp/zero behavior, cross-action forgery,
    zone-departure cleanup, and continuous client sequences through eleven.
    The route remains development-only.
61. The route-owned context layer now completes the legacy category submenu
    without changing its visible parent or three rows. `Change type...` exposes
    `to Energy`, `to Tool`, and `to Pokémon` in source order; the visible Tool
    choice maps to the authoritative `Trainer` category. A closed typed union is
    revalidated at the resolver boundary, and every submitted choice must still
    match the exact currently open top stack card before the existing annotation
    resolver emits one preconditioned `ChangeCardCategory`. Missing values retain
    `requires_choice`; forged values, lower evolutions, loose cards, stale menu
    targets, and post-dismissal requests fail without reaching the submitter.
    Hover and click remain intact, while ArrowRight enters the submenu,
    Up/Down/Home/End traverse it, and ArrowLeft/Escape returns focus to the
    parent. A real-v1 paint gate additionally compares exact row order, box
    dimensions/offsets, padding, border, shadow, colors, and typography. Native
    Chromium pins all three commands at uninterrupted client sequences 12–14.
    The move-card submenu, keyboard marker shortcuts, and production route remain
    separate.
62. The same route-owned context layer now completes the adjacent five-choice
    move submenu without changing `Move card...`, its boundary, or its source-
    ordered `to Board`, deck-top, deck-bottom, deck-switch, and deck-shuffle
    rows. One closed union is revalidated at the resolver boundary. `to Board`
    resolves the card owner's loose-board zone and emits the existing zone,
    top-stack, inspection, or staged movement command; the four deck rows
    delegate to the existing deck-relative resolver. Missing/forged values,
    lower evolutions, foreign work areas, already-board cards, stale menu
    identity, post-dismissal requests, empty decks, and deck edge no-ops submit
    nothing. Category and move now share one nested hover/click/keyboard
    implementation, including parent focus return, without changing either
    menu's labels or paint. The real-v1 gate compares each move row plus submenu
    dimensions, offsets, padding, separator, shadow, colors, and typography.
    Native Chromium pins all five exact commands at uninterrupted client
    sequences 15–19. The keyboard marker shortcuts and production route remain
    separate.
63. A route-owned document bridge now completes the selected-card marker and
    category shortcuts without adding a visible control. Digits/Alt-digits/`0`,
    `Y`/Alt-`Y`, `W`, and Alt-`E`/`T`/`P` map from exact key/code pairs to one
    closed request carrying the selected stable card ID. The controller requires
    that exact installed selection on a ready live-player projection and then
    reuses the bounded stack or annotation resolver. Immediate selection cleanup
    matches v1 for ability, category, and accepted removal actions; additive
    damage and condition cycling retain selection. Alt-digit and Alt-`Y` also
    preserve the source's positive/default creation when a marker is absent.
    Unselected, editable, composing, already-consumed, forged, stale,
    unsupported, invalid, replay, and post-dismissal input cannot submit. Native
    Chromium pins nine exact commands and zero editable-target traffic. The
    production route remains separate.
64. Solo player replay now completes the three initially characterized
    zone-level local-disclosure exceptions without weakening replay's read-only
    command boundary. Authority
    deduplicates a separately bounded definition catalog across retained
    history, gives it fresh opaque replay aliases, and keys each frame's exact
    prize/opponent-hand records by that frame's concealed aliases. The optional
    catalog fails closed under definition or estimated server-frame churn;
    multiplayer and spectator projections remain unchanged. Client playback
    rejects asymmetric fields, wrong perspective/zones/owners, missing or extra
    cards, duplicate/colliding aliases, unknown definitions, and size overflow.
    The board keeps the historical view object unchanged, derives a transient
    display projection, and offers only `Reveal/hide prizes`, `Look/cover
prizes`, and `Look/cover hand`. Each action emits one replacement scene and
    zero commands; forward frames preserve zone mode, while seek, resync,
    reconnect, exit, identity change, and terminal state reset it. Native
    Chromium proves exact menu rows, every card face in the chosen zone,
    forward/seek/exit behavior, and an empty submission/rejection/error trail.
    No production route, label, layout, styling, live command, or canonical
    schema changes.
65. The protected selected-card keymap now includes the remaining visibility
    family: `C` toggles one private card inspection, `Z` requests public hide,
    and Alt-`Z` requests public reveal. The key/code/Alt boundary still emits a
    closed request carrying the selected opaque card alias; controller and
    adapter retain the ready live-player, exact-selection, current-scene, and
    submit-time checks. The resolver reuses the existing inspection and public
    visibility commands and retains selection for all three gestures. A
    per-card close fails closed instead of collapsing a multi-card zone grant;
    known cards without a matching private grant and already hidden/revealed
    values remain no-ops. A real-v1 Chromium run pins `C`/Alt-`C` local card-back
    swaps plus `Z`/Alt-`Z` face/public flags behind the deny-by-default network
    harness. Candidate Chromium proves the three exact semantic commands in the
    continuous protected-input lane and editable-target suppression remains
    unchanged. No wire/domain schema, visible control, key reference, route,
    layout, or styling changes.
66. Four non-Alt selected-card deck gestures now cross the same protected
    key/code boundary: ArrowUp moves to deck top, ArrowDown moves to deck
    bottom, ArrowRight swaps with deck top, and `S` shuffles into the deck. One
    closed runtime-validated deck action delegates to the existing stale-safe
    deck-relative resolver; controller and adapter retain exact-selection,
    ready live-player, current-scene, replay, source, empty-deck, no-op, and
    submit-time guards. Accepted moves dismiss selection in the same reduction
    and emit exactly one existing semantic command. A four-page real-v1
    Chromium oracle pins exact array ordering, source action/export payloads,
    selection cleanup, and deterministic shuffle permutations. It also exposes
    a source defect: `S` deselects during `shuffleIntoDeck`, then falls through
    to the unselected `shuffleAll` branch and shuffles/logs a second time. V2
    deliberately keeps one atomic move-and-shuffle command. Candidate Chromium
    proves all four exact commands after the prior twelve continuous shortcuts;
    Alt variants and editable targets remain suppressed. No wire/domain schema,
    visible control, key reference, route, layout, styling, UI, or UX changes.
67. Four generic selected-card zone gestures now cross that boundary: `H`
    moves to hand, `D` to discard, `L` to lost zone, and Space to the loose
    board on the card's current board side. A new closed, runtime-validated
    resolver is shared with the existing context-menu `to Board` operation and
    emits the appropriate stale-safe `MoveCard`, `MoveCardFromStack`,
    `MoveInspectedCard`, or `MoveStagedCard` command. It rejects same-zone
    requests, lower evolutions, foreign work areas, stale cards, and missing
    destinations; controller/adapter live, selection, replay, and submit-time
    gates remain unchanged. Four clean real-v1 Chromium pages pin exact
    destination arrays, `moveCardBundle` live/export payloads, selection
    cleanup, asset service, and errors. Candidate Chromium proves the four
    commands after the prior sixteen continuous shortcuts and editable targets
    remain silent. Active/bench, stadium, and prize keys remain separate because
    their placement, singleton replacement, and concealment rules need dedicated
    characterization. No protocol/domain/authority schema, visible control,
    route, layout, styling, UI, or UX changes.
68. Non-Alt `A` and `B` now map selected cards to active and bench through a
    separate runtime-validated play-placement union. Zone cards reuse
    `MoveCardToPlay`; eligible top play cards use `MovePlayStack` with exact
    active/bench order preconditions; a viewer-owned staged top uses
    `RestoreStagedStack`. Attachments, lower evolutions, inspected cards,
    foreign or partial staged work, stale boards, invalid values, and
    active-to-active requests fail closed. Two fresh real-v1 Chromium pages
    prove `A` replaces an incumbent active by moving it to bench and `B` appends
    the selected hand card to bench while preserving active, with one outer
    `moveCardBundle` action/export record and selection cleanup. The candidate
    proves both exact commands after the prior twenty continuous shortcuts and
    editable input stays silent. At this checkpoint, stadium and prize keys
    remain separate. No protocol/domain/authority schema, visible control,
    route, layout, styling, UI, or UX changes.
69. Non-Alt `G` now maps selected cards through a dedicated stadium-placement
    request. A shared recipient-view locator removes the duplicated source scan
    from the generic-zone and deck-relative resolvers and classifies zone,
    stack, inspection, and staged sources consistently. The new
    `MoveCardToStadium` wire command carries the selected opaque handle, exact
    source, and current stadium occupant's opaque handle or explicit `null`.
    Authority resolves both aliases, derives board-side ownership, and applies
    opponent-public policy. One domain revision first sends any incumbent to
    its immutable owner's discard, then moves the selected zone card, top
    evolution, attachment, viewer-owned inspected card, or staged card into the
    singleton stadium. Lower evolutions, foreign work areas, stale source or
    incumbent state, malformed multi-card stadium views, and same-stadium no-
    ops fail closed. The generated authority registry now exhaustively covers
    all 49 wire variants. Three fresh real-v1 Chromium pages prove empty, self-
    incumbent, and opponent-incumbent replacement with one outer
    `moveCardBundle`, exact live/export payloads, correct discard ownership,
    selection cleanup, asset service, and no page errors. Candidate Chromium
    proves the exact command after the prior twenty-two continuous shortcuts
    and editable input remains silent. No visible control, label, key reference,
    route, layout, styling, UI, or UX changes; at this checkpoint prize placement
    remained separate.
70. Non-Alt `P` now maps a selected card to prizes on the card's current board
    side; Alt-`P` remains the Pokémon category gesture. The already-validated
    per-card zone resolver expands its closed destination tuple to include
    `prizes`, so zone cards, top evolutions, attachments, viewer-owned inspected
    cards, and staged cards continue to emit their existing source-specific
    commands with exact preconditions. Same-prize moves, lower evolutions,
    foreign work areas, stale cards, and malformed destinations fail closed.
    Two fresh real-v1 Chromium pages prove self- and opponent-owned source cards,
    correct prize ownership, card-back paint, cleared `faceDown`/`public` flags,
    selection cleanup, one outer `moveCardBundle`, live/export owner handling,
    local assets, and no page errors. The domain's existing concealed-zone event
    path sets `concealIdentity`, advances visibility generation, and gives owner
    and opponent projections distinct fresh concealed aliases. Candidate
    Chromium proves the exact command after the prior twenty-three continuous
    shortcuts and editable input remains silent. No wire, domain, authority,
    visible control, label, key reference, route, layout, styling, UI, or UX
    changes.
71. Replay-local disclosure now includes the real v1 menu's `Reveal/hide card`
    row without broadening authority or replay submission. The operation is
    admitted only for an opaque card alias in the existing solo-player prize/
    opponent-hand catalog and updates a transient per-card display override;
    siblings stay covered. Prize menus therefore retain their source header,
    two zone actions, and card action, while opponent-hand menus retain their
    source header, hand-look action, and card action. Zone actions clear card
    overrides within that zone. Zone/card state carries only across a forward
    frame and clears on seek/resync/reconnect/exit/identity/terminal boundaries.
    A fresh real-v1 browser oracle and the React candidate pin exact row order,
    computed menu and focused-action paint, front/back asset replacement, stable
    card boxes and aspect ratio, selected-card-only disclosure, semantic menu/
    card names, empty child-image alt text, arrow/Home/End traversal and wrap,
    keyboard activation, focus return, screenshots/JSON evidence, and zero
    commands, rejections, or page errors. Arbitrary cross-renderer card size is
    recorded but remains in the broader geometry workstream. No protocol,
    authority, canonical view/history, visible label, layout, production route,
    or live-game behavior changes.
72. Stack previews and opened-zone dialogs now project the legacy iframe-local
    percentages through the immutable owning-player frame instead of sizing
    against the whole renderer viewport. This restores the source's half-height
    containing block, local/opponent vertical placement, opponent stack
    rotation, content-box padding, overflow, toolbar spacing, card radii,
    shadows, and physical ordering without changing a control or game state.
    The dialogs now declare modal semantics and contain Tab/Shift+Tab while the
    existing focus boundary still returns to the invoking card or zone. A new
    real-v1/candidate Chromium oracle mounts the exact recipient-safe candidate
    assets into shipped v1 `Card`, stack, and discard surfaces, then pins both
    player orientations for surface/card bounds, computed paint, asset and
    accessible-label order, screenshots/JSON evidence, focus containment and
    return, and zero submissions/rejections/errors. The pure frame projection
    has an independent 1280×720 unit oracle. No protocol, authority, canonical
    view, route, visible control, label, UI, or UX changes.
73. A recipient-privacy Chromium oracle now carries canonical state through the
    real `projectMatch()` and `createBoardSceneForViewport()` boundaries into a
    mounted selected-DOM renderer while intercepting every matching image
    request. Its 14-card fixture proves initial concealment, a six-prize public
    reveal and cover, a one-card private deck inspection visible only to its
    granted player and then closed, a fresh hidden renderer generation, and a
    face load that settles after the card has already been covered. Every hidden
    projection and scene is recursively scanned for canonical card IDs,
    definition IDs, names, and both image tiers; hidden DOM exposes only the
    neutral label, empty image alternative text, and decoded card back. Request
    evidence contains exactly the temporarily authorized board-tier faces,
    never any unauthorized or full-preview face URL, and a late completion
    cannot restore hidden paint. Two renderer generations destroy cleanly with
    no retained test host, renderer error, or page error. The deterministic SVG
    route isolates authorization and lifecycle behavior; real-raster memory,
    external hosts/failures, and non-Chromium approval remain separate gates.
74. The route-owned renderer viewport lifecycle now funnels host resize, window
    resize, resolution-media changes, and visible-document resume through one
    request-animation-frame scheduler. A synchronous signal burst cannot queue
    duplicate work; each committed reconciliation rereads window dimensions and
    DPR, then rearms the resolution query for the next monitor. Teardown cancels
    the frame and removes the observer plus all window, document, and media
    listeners. A browser gate reproduces the former same-CSS-size DPR 1→2 stale
    scene, verifies the corrected outer/scene DPR without replacing the renderer
    or its 61 cards, pins one commit for 25 simultaneous signals, collapses and
    restores a zero-paint-size host safely, and exercises hidden→visible DPR
    resynchronization. Chromium CDP changes query matches without emitting its
    normal media event, so the test injects only that missing event while
    retaining the real query and device-metrics transition. Unit coverage pins
    coalescing and exact post-unmount inertness. Physical background freezing,
    monitor movement in other browsers, and BFCache remain release-matrix gates;
    no visible UI/UX or scene contract changed.
75. The mounted remote-room board now receives live session readiness. Leaving
    `ready` cancels any captured renderer gesture and clears selection, hover,
    drag, and opened-zone presentation without remounting or discarding the last
    recipient-safe scene; drop intents and commands fail closed until readiness
    returns, while non-mutating selection remains available. The client session
    also skips pending-queue publications whose public summary is unchanged, so
    an empty-queue resume emits each lifecycle phase exactly once instead of a
    redundant second `ready` snapshot. Focused tests pin cancellation once per
    ready→non-ready boundary, real `not_ready` submission results, and exact
    notification order. The expanded local Wrangler/Vite gate interrupts the
    live socket, resumes with the rotated capability, preserves the same route,
    renderer, DOM surface, generation, and revision, commits a command after
    recovery, avoids repeat admission HTTP, and closes both native sockets. The
    abnormal close event is injected because JavaScript cannot ask Chromium to
    emit reserved network-loss code 1006; both resumed transport and server-side
    supersession are real. No visible UI/UX, protocol, or authority semantics
    changed. Local real-document navigation churn is covered by checkpoint 80;
    deployed navigation remains a separate gate.
76. Replay-transfer interruption and transport loss are now one atomic client
    publication. Previously `handleClose()` cleared `replayLoading` while the
    public phase was still `ready`; a reentrant external-store subscriber could
    submit into the already-cleared socket, trigger its own reconnect, and then
    let the outer close handler consume a second retry. The session now clears
    replay loading inside the same reconnecting, clean-closed, failed, or
    superseded state update. An adversarial listener immediately attempts a
    command on the first cleared-loading publication and proves `not_ready`, an
    untouched sequence/queue, exactly one reconnect attempt/timer, and one
    reconnecting notification. Supersession coverage also begins during replay
    loading and proves terminal cleanup. No protocol, authority, renderer,
    visible UI, or UX changed.
77. The remaining client-session notification boundaries are now explicitly
    safe for synchronous, reentrant external-store subscribers. Welcome emits
    role, ready phase, recipient view, sequence, and reconciled pending queue as
    one snapshot; command allocation emits its next sequence and queued summary
    together; and an advancing authority publication emits its view plus
    matching presentation events together. Connecting, handshaking, command
    send, and reconnect-timer continuations revalidate phase and socket
    generation after observers run. Every client-initiated close invalidates
    the generation before calling transport, preventing synchronous close
    delivery from spending a second reconnect attempt. Identical equal-revision
    resume views retain their current object identity, avoiding a redundant
    renderer commit, while divergent authoritative replacements still install.
    Invalid replay streams also transition directly to failed/not-loading. Nine
    focused tests pin observer-triggered close at each continuation boundary,
    atomic publication shapes, no post-close Hello/Command/socket creation, a single
    reconnect timer, and an untouched command sequence on replay failure. No
    protocol, authority, renderer, visible UI, or UX changed.
78. Retryable server notices are now causally bound to the socket generation,
    phase, and pending command head present when the notice arrived. Previously
    the notice was published first and `retryHead()` looked up the queue only
    after synchronous observers returned. An observer could submit the first
    command in response to a notice received with an empty queue, causing that
    unrelated command to be retried immediately or fail with an exhausted retry
    budget. A red-first regression uses a zero retry budget and proves the new
    command remains ready, in flight, written exactly once, and unclosed.
    Handshake retry/rejection also requires the receipt-time generation and
    phase to remain current. No protocol, authority, renderer, visible UI, or UX
    changed.
79. Socket-write success is now generation-aware. The transport-neutral client
    previously treated any non-throwing `send()` as success even if the socket
    delivered `close` synchronously during the call. Replay request then
    re-enabled loading on the already-reconnecting state, while chat and ping
    reported stale success. The client now requires the exact socket generation
    to remain installed after `send()` returns. Hello, command, and command-retry
    failure continuations additionally revalidate their original phase,
    generation, session, and head before scheduling recovery, leaving a
    synchronous close handler as the sole reconnect owner. Four focused tests
    cover close during Hello, command, replay, and chat/ping writes, pin false
    non-command results, cleared replay loading, retained in-flight command,
    and exactly one attempt/timer. No protocol, authority, renderer, visible
    UI, or UX changed.
80. The developer creator-room owner now closes its complete runtime on a
    non-persisted `pagehide`, before a full document navigation discards the
    JavaScript realm. Disposal is idempotent across the page lifecycle and the
    later React cleanup; a persisted `pagehide` deliberately retains the owner
    for a possible back-forward-cache resume. A new Chromium gate performs
    three real Vite/Wrangler document-navigation cycles. Each cycle creates a
    distinct durable room, exchanges exactly one admission ticket, reaches a
    ready DOM-rendered board through one credential-free native socket, then
    proves the old session is `closed`, its socket is synchronously `CLOSING`,
    and its global handle is gone before the neutral document mounts with no
    room socket. Unit coverage pins both non-persisted teardown and persisted
    preservation, including exact-once cleanup. This closes local creator-route
    document churn; deployed routing and physical BFCache restoration remain
    release gates. No visible UI/UX, protocol, authority, or renderer contract
    changed.
81. The global loose-board keyboard family now crosses the protected controller
    without requiring a selected card. Enter resolves the viewer's loose board
    to discard, Alt-Enter resolves it to hand, and Slash resolves it through the
    existing authority-owned deck shuffle. The request carries only a closed
    destination; controller policy requires a ready writable projection, and
    the resolver derives the target player plus exact ordered card precondition
    from the installed recipient view. A forged fourth destination, spectator,
    stale/empty board, replay, editable target, open overlay, and native
    card/zone Enter activation fail before submission. The selected-card branch
    keeps its legacy default suppression while unselected keys retain the source
    document default. A new deny-by-default Chromium
    oracle executes the unchanged v1 modules across three fresh pages and pins
    destination/deck arrays, deterministic shuffle indices, one outer action,
    export owner rewriting, and asset/error boundaries. Candidate Chromium
    emits one exact `ResolveLooseBoardCards` command for each key and no traffic
    from a focused input. No wire/domain/authority schema, visible control,
    key reference, layout, styling, UI, or UX changed.

The first browser run exposed a React integration defect that DOM emulation did
not: the nested renderer root used `flushSync()` and synchronous `unmount()`
inside its parent React lifecycle. The adapter now resolves mount from a real
layout-effect commit, uses scheduled React updates, resolves superseded mounts,
and queues unmount outside the parent lifecycle. The same tests then passed with
a clean console. This is retained as evidence for keeping browser tests separate
from happy-DOM lifecycle tests.

The renderer suites live in `tests/browser/renderer-spike.spec.ts`,
`tests/browser/renderer-dom-cacheable-assets.spec.ts`, and
`tests/browser/renderer-private-asset-privacy.spec.ts`. The source-parity suites
start with `tests/browser/legacy-dom-geometry.spec.ts` and
the transformed overlay comparison lives in
`tests/browser/react-dom-transformed-overlay-paint.spec.ts`,
the real-runtime marker controls live in
`tests/browser/legacy-runtime-marker-editing.spec.ts`, and real evolution marker
transfer lives in
`tests/browser/legacy-runtime-evolution-marker-transfer.spec.ts`. Real
flip/resize/fullscreen behavior lives in
`tests/browser/legacy-runtime-layout-interactions.spec.ts`. The geometry suites
continue with
`tests/browser/legacy-card-stack-geometry.spec.ts`, plus the contained-card
comparison in `tests/browser/legacy-contained-card-geometry.spec.ts` and the
source-backed evolution comparison in
`tests/browser/legacy-evolution-reflow-geometry.spec.ts` and the source-backed
single-Energy comparison in
`tests/browser/legacy-energy-attachment-reflow-geometry.spec.ts`, plus the
source-backed Trainer-as-Tool comparison in
`tests/browser/legacy-trainer-tool-attachment-reflow-geometry.spec.ts`, and the
source-backed stable two-Energy comparison plus departure capture in
`tests/browser/legacy-two-energy-attachment-compaction-geometry.spec.ts`, and
the separate source-only mixed Energy/Trainer order and departure check in
`tests/browser/legacy-mixed-energy-trainer-tool-attachment-order-geometry.spec.ts`,
plus the whole-stack/category-history source and React comparison in
`tests/browser/legacy-mixed-stack-movement-geometry.spec.ts`, the source-backed
marker/rotation history and pristine-q0 React comparison in
`tests/browser/legacy-marker-rotation-geometry.spec.ts`, and the separate
sole-bench marker history plus strict pristine-q0 React comparison in
`tests/browser/legacy-bench-marker-rotation-geometry.spec.ts`, plus the
active/bench marker node-transfer and refresh reconstruction checkpoint in
`tests/browser/legacy-marker-movement-geometry.spec.ts`, plus the split
source-only compound group/BREAK histories in
`tests/browser/legacy-compound-rotation-geometry.spec.ts`, and the q0/q2 BREAK
refresh histories in
`tests/browser/legacy-compound-break-refresh-geometry.spec.ts`, plus the q3
collapse in
`tests/browser/legacy-compound-break-refresh-q3-geometry.spec.ts`, and the
nonzero-group Alt-R matrix in
`tests/browser/legacy-compound-nonzero-group-single-geometry.spec.ts`, plus
lower-initiated group rotation in
`tests/browser/legacy-compound-lower-group-initiator-geometry.spec.ts`, and the
pristine-q0 lower Alt-R matrix in
`tests/browser/legacy-compound-lower-q0-single-geometry.spec.ts`, plus the
nonzero lower Alt-R matrix split between
`tests/browser/legacy-compound-lower-nonzero-group-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-group-single-break-geometry.spec.ts`,
plus the clean returned-q0 lower Alt-R matrix split between
`tests/browser/legacy-compound-lower-returned-q0-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-returned-q0-single-break-geometry.spec.ts`.
The same-card history-authored-q0 lower Alt-R matrix is in
`tests/browser/legacy-compound-lower-history-authored-q0-single-geometry.spec.ts`.
The immediate same-card follow-up after nonzero-group divergence is split
between
`tests/browser/legacy-compound-lower-nonzero-group-single-followup-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-group-single-followup-break-geometry.spec.ts`.
The immediate top-group rotation after the first lower-card divergence is split
between
`tests/browser/legacy-compound-lower-nonzero-group-rotation-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-group-rotation-after-single-break-geometry.spec.ts`.
The immediate wrapper refresh after that divergence is split between
`tests/browser/legacy-compound-lower-nonzero-group-refresh-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-group-refresh-after-single-break-geometry.spec.ts`.
The immediate whole-group rotation initiated by that same divergent lower card
is split between
`tests/browser/legacy-compound-lower-nonzero-same-lower-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-same-lower-group-after-single-break-geometry.spec.ts`.
The complementary immediate whole-group rotation initiated by the other lower
card is split between
`tests/browser/legacy-compound-lower-nonzero-different-lower-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-different-lower-group-after-single-break-geometry.spec.ts`.
The immediate second whole-group rotation initiated by that same lower card is
split between
`tests/browser/legacy-compound-lower-nonzero-same-lower-second-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-same-lower-second-group-after-single-break-geometry.spec.ts`.
The complementary second whole-group rotation by checkpoint twenty-five's same
other lower initiator is split between
`tests/browser/legacy-compound-lower-nonzero-different-lower-second-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-different-lower-second-group-after-single-break-geometry.spec.ts`.
The immediate second whole-group rotation by checkpoint twenty-two's same top
initiator is split between
`tests/browser/legacy-compound-lower-nonzero-top-second-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-top-second-group-after-single-break-geometry.spec.ts`.
The immediate mixed second whole-group rotation by checkpoint twenty-two's prior
divergent lower is split between
`tests/browser/legacy-compound-lower-nonzero-top-then-prior-lower-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-top-then-prior-lower-group-after-single-break-geometry.spec.ts`.
The complementary mixed second whole-group rotation by checkpoint twenty-two's
other lower sibling is split between
`tests/browser/legacy-compound-lower-nonzero-top-then-other-lower-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-top-then-other-lower-group-after-single-break-geometry.spec.ts`.
The immediate third whole-group rotation by checkpoint twenty-eight's same top
initiator is split between
`tests/browser/legacy-compound-lower-nonzero-top-third-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-top-third-group-after-single-break-geometry.spec.ts`.
The immediate fourth whole-group rotation by checkpoint thirty-one's same top
initiator is split between
`tests/browser/legacy-compound-lower-nonzero-top-fourth-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-top-fourth-group-after-single-break-geometry.spec.ts`.
The immediate third whole-group rotation by checkpoint twenty-six's same
divergent lower initiator is split between
`tests/browser/legacy-compound-lower-nonzero-same-lower-third-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-same-lower-third-group-after-single-break-geometry.spec.ts`.
The immediate third whole-group rotation by checkpoint twenty-seven's same
other lower initiator is split between
`tests/browser/legacy-compound-lower-nonzero-different-lower-third-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-different-lower-third-group-after-single-break-geometry.spec.ts`.
The mixed-
order suite validates a checked-in numeric oracle without mounting a candidate;
the mixed-stack movement suite mounts React only for its two canonical settled
movement phases; and the marker/rotation suite compares React only to pristine
source q0 while production canonicalizes any eligible current q0 and keeps
q1/q2/q3 and history-specific layout source-only. The bench-marker suite
likewise keeps its q1/q2/q3 and observer history source-only, while comparing
the separately composed clean-active-plus-sole-bench q0 production shape. The
compound, BREAK-refresh, top/lower nonzero-group single-card and same-card
follow-up plus immediate top-, same-lower-, different-lower-, repeated-same-
lower-, repeated-same-other-lower-, repeated-top-, third-top-, third-same-lower-,
third-other-lower-, fourth-top-, or top-then-prior/other-lower-group
rotation or wrapper refresh after
divergence, lower-group-
initiator, and pristine/returned/history-authored-q0 lower single-card suites
mount no candidate
because they prove that projected rotation fields alone cannot recover
selected-action, per-evolution BREAK, and wrapper-margin history, and that q3
refresh can mutate legacy orientation.

Standard
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

- expand the source-driven geometry checkpoint to painted/interactable frames,
  handles and controls, cards/stacks, screenshots, browser-level candidate
  split/flip/fullscreen controls, and the remaining structured 2 px / 1%
  thresholds (source edge clamp/collision states, the isolated candidate
  resize-pointer path, and normal/flipped fullscreen viewport continuity are now
  covered);
- a manual screen-reader audit beyond the automated replay-local and transformed
  stack/zone-dialog semantic names, roles, keyboard traversal/wrap,
  focus-visible paint/return, exact face assets, and stable geometry;
- actual external card/image hosts, redirects, CORS failures, oversized/corrupt
  images, and the proxy/hybrid policy in ADR-013;
- physical background freeze/resume and BFCache behavior plus non-Chromium
  monitor-DPR transitions; WebGL-only recovery/eviction cases remain gates for
  any future Pixi rollout;
- complete resource evidence beyond the green warmed-host lifecycle,
  controlled same-origin distinct-SVG request/decode gate, and local
  creator-route document churn: deployed route-host navigation, real-raster
  decoded-byte and retained-heap accounting on the ratified profile;
  display-object/GPU counters remain required only for a future Pixi rollout;
- the p95 reconciliation/input/drag budgets from the verification plan on the
  ratified four-core reference profile;
- keyboard and screen-reader audit of the selected semantic DOM surface; and
- Chromium automation plus Firefox and Safari approval.

The renderer-neutral core, protocol, authority, scene, and runtime remain valid
if a future measured bottleneck satisfies ADR-004's narrow revisit triggers.
