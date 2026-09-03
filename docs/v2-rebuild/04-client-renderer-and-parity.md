# Client, renderer, and UI parity

## Production boundary and retained Pixi candidate

React owns the existing application chrome:

- Solo, Multiplayer, Deck, and Settings tabs;
- room lobby/status, chat, buttons, tooltips, menus, dialogs, tutorial, and
  import/export/replay controls;
- deck builder and deck import feedback;
- native-scrolling zone browsers, context menus, full-card preview, counter
  editor, and popup/button chrome anchored to the board;
- accessible announcements and focus management; and
- the stable-keyed board surface behind the imperative `BoardRenderer`
  lifecycle adapter.

The selected React DOM board owns:

- playmat geometry and zone outlines;
- all card nodes, stacks, attachment/evolution offsets, covers, counters,
  conditions, and target highlights;
- card dragging/selection visuals and board flip; and
- the same semantic input and presentation contract used by the route.

This preserves native scrolling, form focus, keyboard behavior, accessibility,
arbitrary `<img>` display, and screenshot parity without a second DOM overlay
tree. Stable nodes are views of the immutable scene; they never own or repair
logical state.

ADR-004 selects React DOM for the first production renderer. Raw Pixi remains a
hardened, unwired comparison that proves the contract does not depend on DOM.
It is reconsidered only after a protected workflow demonstrates a material
rendering bottleneck on target hardware and Pixi passes the full parity,
accessibility, image, and recovery matrix. `@pixi/react` is not selected.

## Renderer public contract

The renderer-neutral board package exposes a deliberately small API; both
candidate adapters implement it:

```text
createBoardRenderer(adapters, options)
  mount(hostElement, initialRenderModel, initialPresentation)
  installScene(nextRenderModel, presentationEvents, mode = "advance")
  installPresentation(nextPresentation)
  cancelInteraction()
  clearScene()
  resize(viewport)
  setPreferences(renderPreferences)
  destroy()
```

The retained Pixi adapter additionally owns context recovery behind this
interface. Every renderer emits semantic intents such as `CardSelected`, `CardDropRequested`,
`ZoneOpened`, `CardContextRequested`, and `BoardResizeRequested`. It never emits
legacy function names, zone indices, or network messages.

All public calls are safe after rapid reconnect, route changes, React strict-mode
development remounts, and WebGL context loss. `destroy()` is idempotent and
releases listeners, pointer capture, timers, textures, and GPU resources.
`cancelInteraction()` is the additive reconnect/resync seam: it releases active
pointer capture and clears renderer-owned drag/suppressed-click state without a
scene replacement. `clearScene()` is the privacy/reset seam: it cancels input,
removes retained scene/presentation state and rendered board children
synchronously, but keeps a healthy renderer mounted for replacement. See
[`BOARD_SESSION_CONTROLLER.md`](./BOARD_SESSION_CONTROLLER.md) for the headless
controller, live/replay adapter, and uninstantiated DOM composition contract.

`installScene` rejects a lower revision in its default `advance` mode. Replay is
the only caller allowed to request explicit `replace` mode when previous or
restart selects an older recorded projection. Both DOM and Pixi implementations
replace in place, so rewind does not require renderer destruction/recreation and
live stale-snapshot protection remains intact. Multi-revision fast-forward
effects are dispatched by the presentation layer rather than mislabeled as
events for only the final scene.

## Scene structure

```text
Stage
  PlaymatRoot
    OpponentBoardRoot
      zone backgrounds / cards / markers
    SharedRoot
      stadium / shared highlights
    LocalBoardRoot
      zone backgrounds / cards / markers
  InteractionRoot
    drag ghost / selection / drop highlights
  PixiOverlayRoot
    opened-zone card surfaces / temporary work areas
  DebugRoot (development only)
```

Each recipient-safe `ViewCardId` maps to at most one `CardView` in a registry. A `CardView`
is a rendering object, never the data model. It contains sprite/container
references and the last render descriptor needed for diffing. When a card moves,
the registry reparents or animates the existing view; it does not destroy and
reload the image because its zone index changed.

Counters and conditions are child views keyed by their card ID and marker type.
Evolution/attachment layouts derive from projected play stacks. Z-order is a pure
function of zone, relationship order, board orientation, and drag/popup state.

## Renderer systems

Keep systems small and explicit:

| System                | Responsibility                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `BoardLayout`         | Converts normalized parity geometry, viewport, side heights, and board flip into world transforms |
| `CardViewRegistry`    | Creates/reuses/releases stable-ID card views and applies render descriptors                       |
| `ZoneViewSystem`      | Outlines, covers, counts, ordered roots, opened-zone layout, and highlights                       |
| `RelationshipLayout`  | Evolution/attachment offsets and child z-order                                                    |
| `MarkerViewSystem`    | Damage, condition, ability, VSTAR/GX, rotation, and visible annotations                           |
| `InteractionSystem`   | Hit testing, selection, pointer capture, drag ghost, drop candidate, double/right click           |
| `AnimationSystem`     | Short parity-preserving transitions and completion/cancellation                                   |
| `TextureManager`      | Resolution selection, fetch/deduplication, leases, fallback, LRU eviction, and metrics            |
| `RenderScheduler`     | Coalesced invalidation and temporary animation/drag frame loop                                    |
| `OverlayAnchorSystem` | Converts card/zone world bounds to DOM screen coordinates                                         |
| `AccessibilityBridge` | Maintains semantic focus targets, labels, and live announcements outside the canvas               |
| `Diagnostics`         | Development-only bounds, IDs, frame timing, allocations, and texture budget                       |

Systems communicate through typed calls/events and have `mount`, `update`, and
`destroy` lifecycles. A monolithic engine class modeled after the full Quinoa
engine is explicitly out of scope.

## Layout migration

Phase 1 extracts current CSS geometry from `index.css`, `self-containers.css`,
and `opp-containers.css` into versioned parity data:

- canonical desktop viewport(s);
- side-panel width and board viewport;
- normalized bounds for each zone, label, outline, and shared stadium;
- card aspect ratio, scale, overlap, fan, stack and attachment offsets;
- local/opponent transform and flip behavior;
- draggable self/opponent split-resizer behavior; and
- popup/menu/preview anchors and clipping.

`BoardLayout` consumes this data; logical reducers do not. The first Pixi spike
must render a fixed fixture over a legacy screenshot and demonstrate acceptable
geometry before broader renderer work.

The first source-pinned ideal-CSS-pixel oracle is now executable in
`packages/renderer-contract/src/layout.ts` and
`tests/legacy-fixtures/renderer/board-layout-v1.json`. It records every primary
zone, separate content/padding/border boxes, physical frame ownership, the two
independent resize handles, shared geometry, fullscreen, flip asymmetry, and
semantic input/z evidence. A deny-by-default Playwright harness now measures the
checked-in legacy HTML/CSS in Chromium at the default 1600×900 fixture and
confirms every recorded shell, frame, handle, and region border box plus the
shared stadium bounds and board-control anchor. The React DOM candidate now
consumes that snapshot and the same browser harness confirms all 16 visible
player-region border boxes plus their structural content boxes, the visible
stadium, and non-painting frame/handle/control projection anchors. The sidebar
content rectangle is reconstructed from its measured shell and tabs; these
anchors do not claim visible control or resize interaction parity. A second
source-only Chromium fixture now pins portrait/nonstandard intrinsic-aspect
sizing under authored constraints in both hands and benches and a controlled
active attachment stack, including
integer offset rounding, expanded-container centering, z/DOM order, and overlap
hit order. It deliberately stops before candidate-renderer card comparison and
ordinary evolution reflow. Other card modes, browser-measured viewports, and
screenshot paint parity remain explicit expansions; these checkpoints do not
replace the production layout. See
[`LEGACY_BOARD_LAYOUT_ORACLE.md`](./LEGACY_BOARD_LAYOUT_ORACLE.md).

A third source-backed checkpoint now covers the contained image path used by
deck, discard, lost-zone, and stadium cards. The renderer contract maximally
fits the public canonical card ratio in each source-derived content rectangle,
centers it on the inline axis, resolves upper-frame/stadium transforms to a
physical start/end edge, and exposes only the source-defined pile top to input:
deck index zero, discard/lost-zone last index, and the only stadium card.
Covered scene nodes are retained for stable reconciliation but are disabled and
paint below the cover; closed cover piles do not paint ability markers. Stadium
orientation composes recipient-visible card orientation with owner-versus-
bottom readability, and malformed foreign-owner or multi-card stadium views
fail closed. No definition dimensions enter recipient projections.

`contained-card-layout-v1.json` digest-pins the legacy source for those claims.
Chromium measures both player covers and both owner-readable stadium states,
then compares all six covers and the bottom-owner stadium against the React DOM
candidate within 2 px / 1% / 0.1 degrees. The top-owner candidate stadium path
is unit-tested but not yet browser-compared. Exact cover-click/open-zone UX,
opened-zone layout, undersized/noncanonical asset no-upscale behavior, removal
of retained covered renderer nodes, Pixi geometry, and 90/270-degree hit boxes
remain explicit gates.

A fourth source-backed Chromium checkpoint now isolates ordinary evolution
reflow from the generic attachment fixture. It replays an attachment-free
base → middle → top chain independently in local/opponent active and bench
slots. `evolution-reflow-v1.json` digest-pins the legacy sources behind a
manually reviewed geometry transcription of move/evolve/reattach/refresh and
distinguishes the synchronous diagnostic result of
`evolveCard` from the stable result after `refreshBoard` and the empty-wrapper
MutationObserver settle. The stable legacy order is top/middle/base in the zone
array, top/base/middle in DOM siblings, and top/middle/base at shared hit
overlap. Lower layers use the top image's integer CSSOM `clientWidth / 15`, not
its fractional painted width, and physical extension reverses through the
opponent frame half-turn.

`layoutLegacyOrdinaryEvolutionStack` now reproduces that stable, integer-width
geometry without adding image dimensions to the projection. `createBoardScene`
uses it only for the exact characterized state: three face-up, unrotated,
marker-free Pokémon, no attachments, one stack in the slot, common ownership,
and no flex shrink, at the captured default 1600×900 DPR-1 sidebar layout with
an even split and unflipped bottom identity. The React DOM browser gate directly
matches all 12 card boxes, rotations, and common/exposed-strip hit order to the
live source capture within 2 px / 1% / 0.1 degrees. The candidate keeps
canonical bottom-to-top state and flat DOM nodes; legacy wrapper identity and
sibling order are not part of the observable contract.

Energy/Trainer/Tool interaction, counters, BREAK/rotation, multiple-stack flex
shrink and overflow, transfers/removal, `leaveAll` restoration, noncanonical
assets, face hide/reveal/source mutation, other viewport/split/fullscreen/flip
states, and input behavior retain the previous scene path or remain explicit
later slices. Pixi consumes the same renderer-neutral scene geometry for the
qualifying state, but its paint and hit parity remain unverified.

A fifth source-backed Chromium checkpoint now separates the simplest attachment
path from the older mixed five-card transcription. One face-up Energy attaches
to one unrotated active Pokémon on each physical side at the default 1600×900
DPR-1 layout. `energy-attachment-reflow-v1.json` distinguishes the immediate
attach diagnostic state from the stable post-`refreshBoard` result, including
the 91 px integer base `clientWidth`, `clientWidth / 6` offset, 106.167 px
`adjustCards` wrapper width, target/relative/energy-layer state, z and hit order,
and the synchronous ghost wrapper that settles from two containers to one. It
now feeds a dedicated renderer-contract helper only for exactly one known,
face-up Energy on exactly one known, face-up Pokémon in an unrotated,
marker-free active stack whose player has no bench stacks at that exact default
layout. Production
geometry uses the public 63:88 card ratio, a 90 px CSSOM base width, 15 px
offset, and 105 px wrapper width rather than leaking source-asset dimensions.
Chromium matches all four React DOM boxes, rotations, z ranks, and common/
Energy-only hit order to the live source within 2 px / 1% / 0.1 degrees.
Multiple/order-normalized attachments, departure, evolution combinations,
bench/overflow, rotation, markers, alternate layouts, candidate DOM
wrapper/order identity, Pixi paint/hit behavior, and input remain explicit
later gates.

A sixth, independent source-backed checkpoint isolates the corresponding
Trainer-as-Tool presentation. Legacy has no distinct Tool category: its Tool
action assigns the current category
`Trainer`, and `syncRotation` gives any such attachment an extra 90-degree
presentation turn plus a `2%` right wrapper margin. The fixture preserves both
the 90.5625×126 px pre-transform layout box used by attachment reflow and the
126×90.5625 px painted bounding box, along with transform matrix/origin,
opponent 270-degree effective rotation, wrapper overflow, z/DOM order, and
common, Tool-only, base-only, and empty authored-layout hit regions. It also
pins the same transient two-wrapper cleanup boundary as Energy.

A dedicated renderer-contract path now selects only one known current-category
Trainer attached to one same-owner known Pokémon in the marker-free active
stack, with no bench stacks, at the exact default 1600×900 DPR-1 sidebar,
even-split, unflipped layout. It uses the public 63:88 ratio, rounded 90 px base
width, 15 px offset, 105 px wrapper, and active-region `2%` margin without
reading definition or asset dimensions. Scene bounds remain pre-transform;
base/Tool z ranks are `300/299`, and the Tool's effective quarter-turn is 1
locally and 3 for the opponent. Chromium matches all four scene/layout and
painted React DOM boxes, rotations, z ranks, and common/Tool-only/base-only/
empty-layout hit order to the source within 2 px / 1% / 0.1 degrees. Shared hit
and drop containment inverse-rotates around the card center in both renderers;
Pixi uses native sprite containment instead of a double-scaled CSS-pixel hit
rectangle. Multiple/mixed attachments, category history, removal/stale margins,
evolution combinations, BREAK or compound rotations, bench/overflow, alternate
layouts, and candidate wrapper/sibling identity remain explicit later gates.

A seventh source-only checkpoint separates two ordinary Energy attachments and
direct departure from the mixed five-card transcription. Four independently
constructed local/opponent histories remove either the inner/first or
outer/second Energy. The stable two-Energy source layout has logical order
`[base, E1, E2]`, reversed attachment siblings `[base, E2, E1]`, z layers
`[0, -1, -2]`, and integer `clientWidth / 6` offsets. Direct inner departure
briefly compacts the surviving E2 with `parseInt(oldLeft) - clientWidth / 6`,
while outer departure leaves E1 at its original offset; both paths decrement
the wrapper from its integer CSSOM width. Those immediate mutations and the
synchronous two-wrapper refresh state are diagnostic. After the real legacy
MutationObserver settles, both histories normalize to the same one-Energy
source geometry already covered by the strict production gate.

`layoutLegacyTwoEnergyAttachmentStack` now selects only the stable source shape:
one known same-owner Pokémon base and exactly two known same-owner Energy cards,
all face-up, unrotated, and marker-free, in the sole active stack at the exact
captured default layout. It uses only projected fields and the public 63:88
ratio. The rounded 90 px base width yields 15/30 px attachment offsets, a 120 px
wrapper, source layers `0/-1/-2` mapped to scene z `300/299/298`, and
outer-Energy → inner-Energy → base renderer order. Chromium directly matches all
six production scene/React DOM boxes, rotations, z ranks, and the common,
attachment-overlap, outermost-Energy, and base-only native hit regions to the
stable source within 2 px / 1% / 0.1 degrees.

Departure remains a state handoff rather than renderer history. Removing either
Energy from authoritative state selects the existing one-Energy layout for the
correct survivor; removing the final Energy returns to generic no-attachment
geometry. The transient `parseInt` drift and ghost wrapper are source-only
diagnostics and are never reproduced by a renderer. Mixed/Tool ordering, three
or more Energy, category-history interactions, evolution/base departure,
staged restore, bench/flex contention, markers, BREAK/rotation, alternate
layouts and assets, destination UX, candidate click/drag behavior, Pixi
paint/hit, and network behavior remain later gates.

An eighth, source-only Chromium capture now isolates the mixed
one-Energy/one-current-category-Trainer case without broadening those production
gates. Four fresh attachment histories cover both ingress orders on both
physical sides, and four fresh departure histories independently remove either
attachment on both sides. The Trainer-first path exercises the legacy
Energy-triggered recursive Tool move; both ingress orders settle to logical
`[base, Energy, Trainer]`, DOM `[base, Trainer, Energy]`, and source z
`[0, -1, -2]`. The 91 px source `clientWidth` yields stable offsets
`15.1667/30.3333` px and a `121.333` px authored wrapper. Its `2%` right margin
is `7.71875` px at this active region; every card retains a 90.5625×126 px
untransformed box, while the Tool paints as 126×90.5625 px after its 90-degree
local turn. Opponent placement mirrors through the enclosing half-turn, giving
effective rotations `[180, 180, 270]`.

The stable hit samples distinguish exact native order in six regions: base-only
`[base]`, base/Energy above Tool `[base, Energy]`, Energy above Tool `[Energy]`,
common overlap `[base, Energy, Trainer]`, Energy/Tool overlap
`[Energy, Trainer]`, and rotated Tool-only paint `[Trainer]`. Diagnostics also
record the Trainer-first recursive detach/reattach, its temporary `14.8333` px
Energy offset, the corresponding Tool-survivor drift after Energy departure,
the stale old-wrapper margin immediately after Tool departure, synchronous
two-wrapper refresh, reset removed-card state, and observer-settled cleanup.
Stable departure converges to the existing one-Tool or one-Energy source
fixture. No mixed renderer-contract helper, scene eligibility branch, DOM/Pixi
candidate comparison, or transition rendering is claimed. Mixed production
geometry, reversed/unsupported histories, staged restoration and work-area
resolution or deck-top swaps, whole-stack swaps, and broader overflow remain
generic, noncanonical, or deferred.

The current duplicated self/opponent CSS becomes one declarative player-board
layout with transforms for top/bottom orientation. Any asymmetry found during
characterization is represented explicitly instead of assumed to be duplication.

Initial repository measurements that the Phase 1 extractor must confirm include
a roughly 75.5%-wide play area and 24%-wide right sidebar, two half-height player
boards, and a 180-degree opponent iframe transform. Each half includes a
bottom-30% horizontally scrolling hand, a lower bench, central active zone,
vertical prizes, upper deck/lost-zone covers, lower discard cover, and an offset
free board. These measurements are evidence, not hard-coded truth until captured
at all reference viewports.

Board flip is not a simple stage rotation: it changes which player is at the
bottom, blue/red chrome, resize behavior, stadium/card readability, and which
hand is concealed. Full-screen playmat hides sidebar/tabs/deck workspace and
expands the play surface. Both interactions require structured geometry and
semantic tests.

## State-to-view synchronization

The first additive application-boundary implementation lives in
`apps/web/src/board/BoardSessionController.ts` with its concrete public-source
adapter in `BoardSessionAdapter.ts`. The exported, opt-in
`BoardSessionRuntime.ts` proves that boundary against real session/replay
coordinators; thin React DOM and Pixi wrappers select the renderer without
duplicating lifecycle logic. No route imports or instantiates them yet. Explicit
frame, source, replay-generation, and replay-index cursors keep stale aliases,
same-revision reconnect replacement, and replay rewind from being inferred from
revision alone. Renderer and command effects are one-shot and never retained.
Protocol presentation facts remain exclusively owned by the parallel
`GamePresentationCoordinator`, not this board controller. See
[`BOARD_SESSION_CONTROLLER.md`](./BOARD_SESSION_CONTROLLER.md) for the reducer,
adapter, effect-order, cleanup, and deferred-browser-parity contract.

The runtime borrows the route-owned live/replay sources and does not accept,
construct, subscribe, or dispose a second presentation coordinator. Its layout
bridge now projects the full characterized layout into `BoardScene`, including
independent asymmetric frames, handle positions, moved shared placement,
region border/content boxes, shell mode, and flipped physical ownership.

On each authoritative view publication:

1. Build compact render descriptors keyed by stable IDs.
2. Diff maps and zone/relationship order, not serialized whole objects.
3. Create views for newly visible IDs; update changed descriptors; reparent moved
   views; release disappeared or newly concealed views.
4. Apply presentation events only when their revision matches the view they
   describe.
5. Reconcile selection, menus, preview, and drag against the new view. If a
   target disappeared or a pending command was rejected, cancel cleanly.
6. Invalidate one frame; continue frames only while drag/animation requires it.

The renderer must not reorder canonical zones to make the screen look correct.
Layout derives a visible ordering without changing state.

## Input behavior

### Pointer input

- Use Pointer Events and explicit pointer capture so leaving the canvas or moving
  over overlays does not orphan a drag.
- Apply a small characterized movement threshold before treating a press as
  drag, preserving click/double-click behavior.
- Hit areas match current card and zone target geometry, including attached card
  stacks.
- During drag, update only presentation transforms and target highlighting.
- On drop, resolve a stable-ID intent with source preconditions and one target
  anchor/card ID; the application submits one command.
- On rejection or reconnect, animate/snap the drag view back to authoritative
  placement and announce the reason without leaving stale highlight state.
- Context menus suppress the browser menu only over valid game targets.
- Double-click on active/bench preserves the expanded whole-stack view and marker
  behavior; double-click elsewhere preserves full-resolution preview behavior.
- Direct marker/counter editing uses one temporary React input anchored to the
  Pixi marker rather than a listener-bearing input per display object.

### Keyboard input

- A central keymap replaces scattered global handlers but preserves every
  characterized shortcut and modifier.
- Shortcuts do not fire while typing in inputs, textareas, editable elements, or
  dialogs unless current behavior deliberately requires it.
- The selected stable card ID, not zone/index, is the shortcut target.
- `KeyboardEvent.code`/`key` and Alt/Shift behavior are tested across supported
  browsers. Known legacy mistakes are labeled before correction rather than
  silently copied.
- Shortcuts and menu items invoke the same semantic intent functions.

### Local versus networked feedback

Hover, selection, initial drag, popup open/close, and preview are instant/local.
Domain changes reconcile against authority. A safe optimistic overlay may show a
card at its proposed location while a move is pending, but canonical view state
is never mutated. Randomized actions, hidden-information actions, undo, and
multi-card transactions are not predicted unless a later ADR proves them safe.

## React application state

Use one small client controller/store outside React that exposes selectors for:

- connection/session status;
- latest view state and revision;
- bounded pending command records;
- room presence and role;
- chat messages with bounded history;
- an isolated projected-replay playback controller; and
- local presentation/preferences.

React components subscribe narrowly. No component receives the entire canonical
state because the browser never has it in multiplayer. Do not mirror the Pixi
display tree in React state. Derived selectors are memoized only after profiling
identifies a need.

The deck builder ports the existing pure `.mjs` core into `deck-core`, preserving
the current UI. Its state must distinguish main and alternate/opponent deck dirty
status, validate empty/unload transitions, and use a robust CSV parser/serializer
with compatibility fixtures.

### Presentation effect routing

Recipient-safe protocol facts do not write directly to chat DOM, React state, or
Pixi objects. `presentationEffectsForEvent` exhaustively maps every current
variant into typed local effects:

- activity entries retain the legacy `player`/`announcement` distinction and
  projected blue/red player metadata;
- a separate polite accessibility announcement never depends on whether the
  activity panel is mounted; and
- `CoinFlipped` additionally emits a standalone animation request containing
  the trusted actor and already-resolved heads/tails result.

The mapper uses only projected display names. If a referenced player is absent,
visible text says `Player` rather than printing an opaque routing ID. Public
visibility and private-look facts preserve the legacy actor, owner, semantic
source, and card-versus-zone wording. The authority includes a card name only
for a single-card public reveal after checking the resulting spectator
projection; hides and private looks use the legacy generic `card` wording and
never receive a private name. The activity category/color follows the trusted
actor or viewer rather than the owner of the affected source.

`SessionPresentationDispatcher` consumes newly retained live event objects once
even when its bounded source drops older entries. `ReplayPresentationDispatcher`
uses replay ID plus monotonic playback generation. `GamePresentationCoordinator`
owns both, provides their shared adapters and failure boundary, and gates each
delivery against the effective mode. Each path reads the matching live or replay
view when resolving names. It silently consumes live facts received during
replay and suppresses the remainder of an event's effects and replay batch if
mode exits reentrantly. Dispatcher, timeline, lifecycle, and effect failures are
isolated, and all teardown operations are idempotent.

`PresentationRuntime` is the concrete local adapter target. Activity,
accessibility, and animation are independent immutable external-store channels,
with defaults of 100 history entries, 32 queued announcements, and 16 queued
animations; every configured bound is validated and capped at 1,000. Entries
receive local monotonic IDs. Announcement and animation consumers acknowledge
only the FIFO head, while clear/reset installs all affected empty snapshots
before notifying subscribers and blocks reentrant writes during teardown.
React bindings subscribe to only the requested channel. A match/viewer identity
binding preserves state across same-session remounts while purging every channel
before a changed identity or terminal session can publish new effects.
`GamePresentationRuntime` is the required base composition: it wires the
runtime's adapters, timeline replacement, transient cancellation, and identity
binding to `GamePresentationCoordinator`, then disposes subscriptions before
purging store data. Its optional `PresentationConsumerRuntime` constructs the
correctly paired queue consumers; mounting code does not assemble sources and
acknowledgements manually. `LegacyGamePresentationRuntime` is the concrete
route-scoped sidebar owner: it adds the live-region dwell lifecycle, owns those
consumers, and exposes only the feed and live-region sources needed by React.

`ActivityFeedModel` projects only the ordered recipient-safe display fields and
local entry identity. It contains no DOM class, mutable node, scroll position,
or renderer object, and memoizes by immutable activity snapshot identity. The
accessibility drain invokes one polite-announcement handler at a time and waits
for its settlement before acknowledging the FIFO head. The animation executor
does the same for visual work. Both hand an `AbortSignal` to the surface and
cancel the active handler when the queue head is cleared or evicted, on runtime
teardown, or—only for animation—when motion preference changes. A late resolve
or rejection from cancelled work is ignored by exact local entry identity.
Failures are reported without wedging later entries.

Reduced motion never invokes the animated callback. It uses an optional
instantaneous/static result callback and then acknowledges the same already-
resolved effect, so command timing and authoritative state cannot depend on the
preference. Turning reduced motion on while an animation is running aborts that
work and reprocesses its still-current head through the non-animated path.
The legacy `flip-coin.js` has no separate coin visual: it appends only the
resolved text row. To honor the no-UX-change constraint, the legacy sidebar
owner acknowledges the already-resolved animation request without motion while
the activity and accessibility channels present the result. A future visible
coin animation requires an approved parity exception rather than being slipped
into the rebuild.

Live activity appends to the bounded history. In replay, activity is seekable
state: the coordinator maps `timelinePresentationEvents` and replaces the log on
every effective frame, so restart/previous remove future entries and remount
hydrates the current timeline without firing announcements or animation.
Forward-crossed facts alone enqueue those one-shot effects. Enter/exit,
replacement, and backward seek cancel stale transient queues; forward movement
keeps valid queued work. The replay-only activity adapter is removed to prevent
duplicate append after timeline replacement.

### Replay playback state

Replay does not replace or rewind the live session store. The client-session
playback controller accepts only a completed role-projected artifact, exposes
one immutable `MatchViewState` at a time, and has no transport or command API.
React observes it with `useSyncExternalStore`; either board renderer can consume
the same current view.

The controller maps the existing buttons exactly: `setupButton`/`⏮` restarts,
`resetButton`/`◀` steps backward, `setupBothButton`/`▶` steps forward, and
`resetBothButton`/`⏭` fast-forwards. Boundary actions are stable no-ops. Rewind
rebuilds the visible event timeline from recorded frames and does not execute
domain logic; forward transitions separately report newly crossed presentation
facts, keyed by generation, for effect deduplication. The non-React
`ReplayPresentationDispatcher` delivers each later replay ID/generation once in
recorded order. It serializes reentrant playback publications, continues after
one sink or diagnostic failure, and treats the generation visible at its own
construction as already consumed. Fast-forward effects can span revisions, so
they enter the shared presentation effect pipeline rather than renderer
`installScene`. Loading is transactional, so a malformed replacement cannot
disturb the active replay.

`ReplaySessionCoordinator` is the application mode boundary. Its immutable
external-store snapshot contains the live/replay mode, request phase, effective
projected view, live revision, playback state, and bounded safe failure. It is
the only layer that asks `RemoteGameSession` for replay and installs a completed
artifact into playback. Existing artifacts are request baselines, not implicit
navigation targets. A request can be loading, or `discarding` after the user
exits while the uninterruptible network transfer drains. The coordinator blocks
replay controls outside replay mode, disposes its session subscription on route
teardown, and retains no completed replay after a room/viewer identity change or
terminal session. Renderers continue to consume only the selected `view`.

`RemoteSessionBoard` now consumes that effective view. Its submit adapter calls
the live session only while mode is live and request phase is idle; loading,
active replay, and post-exit `discarding` return the local typed
`replay_mode` rejection without allocating a command ID or writing transport.
Mutating drop intents are not forwarded to a second parent submission path;
local selection/preview/context/zone/resize intents remain available. The board
enables explicit renderer replacement only in replay mode.
`LegacyReplayControls` preserves the four original IDs, symbols, ordering, color
classes, and action mappings without disabling boundary buttons. The headless
`ReplayModeShell` binds those controls and exit to the coordinator and exposes an
exact legacy chrome selector: Replay/Solo label and 50% tab widths; multiplayer,
deck, chat, import, clear-log, turn, coin, and twelve private mutation-action
visibility; persistent export and Options actions; and the exit action. Loading
and post-exit discarding deliberately retain live chrome until replay mode is
active. `LegacyPresentationSurface` now concretely renders the existing
`#chatbox` contract from keyed recipient-safe rows, preserves self/opponent and
announcement styling plus bottom scrolling, and uses a separate visually hidden
polite live region with serial dwell. Its integration tests mount live and
replay sources and verify seek cancellation and teardown. `RemoteRoomRoute` now
mounts that surface as `#p2Chatbox` in connected live mode and `#chatbox` in
replay, mounts the replay controls beside the existing Options label, and wires
Exit through the coordinator. `RemoteRoomRuntime` creates all dependent owners
before transport connects and disposes presentation, replay, then session; it
is intentionally created outside React so StrictMode cannot duplicate a socket
or destroy a live resource during its effect probe. The application branch is
lazy, keeping the room-route implementation out of the default renderer-spike
chunk.

`RemoteRoomBootstrap` now produces the trusted `ConnectSessionOptions` handoff.
It validates and normalizes room input, exchanges the caller's in-memory
long-lived capability in a same-origin no-store POST, rejects redirects and
malformed/expired responses, derives a credential-free WebSocket URL, and gives
only the short-lived ticket to `RemoteRoomRuntime`. React receives the runtime
and route descriptor, never either credential. `main.tsx` still selects the
renderer spike until the existing create/join form can supply the bootstrap
input. Normal live sidebar actions, chat, navigation, and complete
focus/keyboard/visual parity remain later slices.

## Rendering cadence and performance

PTCG Sim is a discrete tabletop, so a permanent 60 Hz game loop is wasteful.

- Idle: render only after invalidation, resize, asset completion, or context
  recovery.
- Drag/animation: use `requestAnimationFrame` until the interaction settles.
- Network publication: coalesce all changes for the revision into one render.
- Resize: debounce layout computation to a frame, but keep the resizer visually
  responsive.
- Hidden tab: stop animation work and resume from state, never simulated elapsed
  frames.

Performance tests record frame time, long tasks, texture bytes, display-object
count, fetch count, heap trend, and update time. Budgets and hardware profiles are
defined in the verification document.

## Texture and asset strategy

Card images are the dominant memory and reliability risk.

1. Use controlled resolution tiers: board thumbnail/standard and full-resolution
   preview. Never upload full-resolution textures for every card by default.
2. Deduplicate loads by normalized definition/image variant, including language.
3. Use reference-counted leases plus a byte-aware LRU cache. A released texture
   can stay warm only within the configured GPU budget.
4. Abort obsolete requests and limit fetch/decode concurrency.
5. Display the existing card back or a stable placeholder immediately; failures
   are retryable and do not block logical actions.
6. Preload only the imminent visible set and small likely-next set, not both full
   decks at maximum resolution.
7. Instrument cache hits, decodes, bytes, failures, and evictions.
8. Use a controlled image proxy/CDN or verified CORS-capable allowlist so WebGL
   uploads and screenshots are reliable. Validate content type, dimensions,
   response size, and upstream URL to avoid proxy abuse.
9. Recover after WebGL context loss by rebuilding GPU views from current view
   state and cache/source descriptors; never ask the game core to repair state.
10. Fall back to Canvas rendering or a clear compatibility message only if the
    approved browser matrix requires it and the spike demonstrates viability.

The spike must explicitly cover every supported Limitless/language/native-builder
host, redirects, card backs/backgrounds, and user-supplied URLs with and without
CORS. If arbitrary URLs remain a guaranteed feature, choose and security-test one
of: a hardened proxy; a DOM image fallback for non-uploadable cards; or a
documented hybrid renderer. Silently losing a formerly valid custom image is not
parity. Opponent-controlled direct URLs also leak participant network metadata,
so visual compatibility cannot be the only decision driver.

A hidden card must never trigger a face-image request. Private textures and async
loads are scoped to renderer generation, room/session, viewer role, view-card ID,
and visibility generation; a reused sprite must receive its back before it can
display, and old private textures are purged on role/room transition.

The provisional desktop target is 128 MiB for board-tier textures plus 16 MiB for
the tiny preview cache, configurable and validated on actual fixtures. If the
representative maximum board cannot fit, the resolution/cache strategy changes
before raising the budget.

## Accessibility preservation and minimum improvement

A canvas removes implicit DOM semantics, so v2 must not regress keyboard and
screen-reader access that exists through current controls.

- All React controls keep native elements, labels, focus order, and visible focus.
- Context menus/dialogs use correct focus trapping, Escape behavior, and return
  focus to the selected card/zone.
- The accessibility bridge provides a compact, virtualized DOM representation of
  selectable visible cards/zones with labels, actions, and roving focus; it is not
  a second visual renderer.
- Chat, command rejection, coin flip, turn, attack/pass, reconnect, and import
  errors use a bounded live region.
- Reduced-motion preference shortens/removes nonessential transitions without
  changing command timing.
- High-contrast/dark settings continue to affect outlines and controls according
  to characterized behavior.

Accessibility work here restores semantics lost by moving images into canvas; it
is part of parity and reliability, not a visual redesign.

## Visual parity verification

At fixed viewport/device-pixel-ratio/font/asset fixtures:

- compare full-screen screenshots for the baseline states;
- compare extracted zone/card bounding boxes and z-order;
- test popup and context-menu screen anchors near every edge;
- exercise drag/drop videos or frame captures for source opacity, ghost,
  highlight, final placement, and cancellation;
- test board flip and both split resizers across their range;
- verify text/control DOM snapshots separately from the canvas; and
- manually review anti-aliasing differences that exceed automated thresholds.

A blanket large screenshot threshold is forbidden because it can hide shifted
cards. Use region-specific thresholds plus geometry assertions. Any intentional
visual difference requires a parity exception decision.

## Renderer spike exit gate

Before implementing the whole board, a vertical slice must demonstrate:

- the empty playmat and a representative mid-game fixture at parity geometry;
- at least 60 distinct card sprites with stacks, damage, conditions, face-down
  cards, attachments/evolution, shared stadium, and an opened zone;
- click, double-click, right-click menu, shortcut, drag/drop, board flip, and
  resize behavior;
- on-demand idle rendering and smooth interaction on the baseline device;
- resolution-tier texture loading, eviction, failure fallback, and no unbounded
  memory growth through repeated setup/reset;
- context-loss recovery with the same logical state; and
- clean mount/destroy through 100 cycles without duplicate listeners/resources.

The same fixture and interaction set runs in a stable-keyed React DOM renderer.
Select Pixi only if it passes every gate and materially improves measured
interaction consistency, CPU time, or memory enough to justify CORS,
accessibility, context-recovery, and dual-layer complexity. Failure does not mean
abandoning the rebuild: the normalized DOM renderer can win while the core/server
design remains unchanged.

The spike also exercises renderer unavailable at startup, permanent/repeated
context loss, silent GPU eviction on resume, a temporarily 0×0 host, DPR change,
stale image completion after card/room/renderer destruction, oversized/corrupt
images, state replacement mid-drag/menu/edit, overlay-anchor movement after
resize/fullscreen, and private texture eviction/role change.
