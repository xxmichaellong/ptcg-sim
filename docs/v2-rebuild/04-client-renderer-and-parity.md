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

An eighth Chromium source capture isolates the mixed
one-Energy/one-current-category-Trainer case. Four fresh attachment histories
cover both ingress orders on both physical sides, and four fresh departure
histories independently remove either attachment on both sides. The
Trainer-first path exercises the legacy
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
fixture. Those historical/transient phases remain diagnostics; only the stable
canonical mixed output contributes to the strict current-state path below.

The same source-only oracle now adds six staged histories: reversed
Trainer/Energy restore, four-card interleaved restore, and a multi-card staged
deck-top swap on both physical sides. Legacy `leaveAll` resets the flat popup
cards, locates the staged Pokémon, and replays remaining cards from index zero.
The ordinary incoming-Energy rule therefore converts `[Trainer, Energy]` to
`[Energy, Trainer]` and `[Trainer1, Energy1, Trainer2, Energy2]` to
`[Energy1, Energy2, Trainer1, Trainer2]`. Legacy staged deck-top swap removes the
selected Energy, rotates the deck, and appends the old top Trainer; subsequent
restore produces `[Energy2, Trainer1, Trainer2, deckTopTrainer]`. V2 deliberately
retains its atomic exact-position staged replacement, so the matching history
restores `[Energy2, Trainer1, deckTopTrainer, Trainer2]`; both restore paths run
the same category partition, but preserve the different within-Trainer input
order.

Unlike the earlier explicit refresh observations, `leaveAll` itself does not
refresh. Immediate and two-animation-frame captures are identical, retain one
live wrapper with no superseded wrapper, leave the staging popup hidden, and
retain history-dependent offsets: `14.8333` px for reversed two-card Energy,
`14.8333/28.8333/44.8333/60.6667` px for interleaved four-card attachments, and
`13.8333/29.8333/45.5/60.6667` px after the staged swap. Those values reinforce
that logical normalization alone cannot authorize a production path or become
saved renderer state.

These staged phases remain source-only. Reverse lists remain valid historical
state outside the v1 normalized transition subset; neither the core nor
renderer imposes a global order invariant.

The ninth capture closes a narrower production boundary. It compares React DOM
against only the settled sole-bench and returned-active phases after a seeded
reverse-history round trip, on both physical sides. The strict predicate admits
exactly one known same-owner face-up Pokémon base with current-category
attachments `[Energy, Trainer]`, all unrotated/marker-free, at the default
1600×900 DPR-1 sidebar layout. The placement is either sole active, active with
one clean base-only bench control, or sole bench with one clean base-only active
control. Original definition category/name/URLs, revision, and prior layout
history do not select geometry.

React matches every mixed card's pre-transform and painted bounds, effective
Tool q1/q3, z `300/299/298`, back-to-front order, and four native hit regions
within 2 px / 1% / 0.1 degrees. Scene diffs preserve card identities across
active/bench movement. Pixi consumes the same descriptors with stable Sprite
objects and no texture load/release churn, but Pixi-native paint/hit and
arbitrary-URL behavior remain unclaimed. A real owner/opponent/spectator
session proves distinct, stable recipient-specific aliases through
movement/category cycling, identical normalized geometry, and no canonical
card/definition ID leakage.

Pokémon/Unknown attachments, reverse order, base-only `leaveAll`, multiple
bench controls, extra/evolution attachments, bases whose current projected
category is not Pokémon, alternate layouts, broader overflow, and transition
rendering remain generic or deferred. Original category history is not
projected and cannot select geometry. Nonstandard-intrinsic asset parity remains
unclaimed; definitions and URLs do not select geometry.

A tenth Chromium checkpoint isolates one ordinary active Pokémon with a damage
circle, special-condition circle, and ability-used tab in each physical frame.
Its source history pins damage update, every legacy condition-color branch,
direct active-zone parentage, editable/pointer-hit semantics, and synchronous
q0→q1→q2→q3→q0 reflow. Marker sizes derive from the painted card: q1/q3 expand
the circles from one-third of 90.5625 px to one-third of 126 px and the ability
tab from 90.5625 px to 126 px. q2 writes the active wrapper's `1%` right margin;
returned q0 remains shifted about 1.92 px. Opponent circles add an inner
half-turn while the opponent ability tab retains only the frame half-turn.

Only canonical active-q0 current-state geometry now enters production. The
strict predicate requires one known same-owner face-up Pokémon in the sole
unrotated active stack, no bench, evolution, or attachments, at the default
1600×900 DPR-1 sidebar/even/unflipped layout, at least one stack marker, and no
per-card ability marker. The public 63:88 ratio yields a 90.2045×126 px card,
30.0682 px circles, and a 90.2045×18.0409 px ability tab. React matches the
pristine source q0 local/opponent geometry within 2 px anchors / 1% sizes;
palette and empty ability text are exact, typography remains proportional, and
marker z is exactly card z plus one. Markers remain deliberately non-interactive
until the editor lifecycle is implemented. Since
DOM history is absent from the projection, an eligible returned-q0 state is
canonicalized to the same q0 geometry rather than reproducing wrapper-margin
drift. Stable marker IDs participate in scene diffs. Pixi reuses keyed
Container/Graphics/Text views across changes and cleanup without card asset
churn, but its native paint/hit output is not claimed. A real owner/opponent/
spectator test proves identical normalized geometry and stable distinct aliases
without canonical card or definition ID leakage.

An eleventh source-history checkpoint isolates damage and ability markers on one
ordinary sole-bench Pokémon in both frames. The 80.859375×112.5 px q0 card uses
a 26.953125 px damage circle and an 80.859375×16.171875 px ability tab. q1/q3
paint at 112.5×80.859375 px, write bench-only `3%` right/`2%` left margins, and
resize the markers to 37.5 px and 112.5×22.5 px. In their overlap, the
later-appended ability tab wins equal-z native hit order over damage and card.
q2 and returned q0 write `1%`/`0%`; returned q0 is physically identical to
pristine q0 because those inline values equal the bench CSS default. Visible
control, keyboard, and movement sources pin canonical bench state to damage and
ability only. The fixture counts its two window listeners separately from the
bench initializer's native `ResizeObserver`, proves that observer remains live,
and disconnects it only as harness cleanup.

The full rotation/observer history remains diagnostic, but production now
consumes its strict pristine-q0 current-state subset. Eligibility composes the
already-characterized clean active control with exactly one clean unrotated
bench base, allows damage and/or ability-used state but never a special
condition, and requires the default 1600×900 DPR-1 sidebar/even/unflipped
layout. The public 63:88 ratio yields an 80.5398×112.5 px card, a 26.8466 px
damage circle, and an 80.5398×16.1080 px side-colored ability tab. The exact
card geometry also applies while markerless to avoid a last-marker removal
shift. `legacyBenchQ0` markers retain source append order (`damage` then
`abilityUsed`), update by stable IDs, and remain deliberately display-only.
Chromium compares the marked q0 React output to source within the declared
tolerances and verifies marker hit-through; DOM/Pixi lifecycle tests and real
owner/opponent/spectator projection cover stable identities, cleanup, resource
churn, recipient-equivalent geometry, distinct stable opaque card aliases, and
the shared canonical public stack ID.

Production parity/layout for rotated active or bench q1/q2/q3 and
source-history-dependent active returned-q0, additional bench siblings,
BREAK, compound evolution/group and attachment rotation, movement/evolution/
refresh marker transfer, marker text-entry UX, alternate layouts, and
Pixi-native paint/hit parity remain explicitly deferred.

The next source-only gate now characterizes compound Pokémon rotation without
weakening that production boundary. Separate ordinary-group and BREAK oracles
cover fresh three-stage chains in local/opponent active and sole bench, full
top-selected group cycles, and identity-preserving q1 refresh reconstruction.
The BREAK history composes the top's q1 offset with stack q0–q3 and toggles it
off only after returning to group q0. Authored/painted/physical boxes, selected-
transform margins, topology, z/hit order, ghost-wrapper settlement, native
observer construction/delivery, and harness-only handle cleanup are measured in
Chromium.

Production remains intentionally unchanged: the same projected active
`stack q0 + top q1 + lower q0` tuple has different legacy margins when fresh or
returned through four group turns, and current state does not identify BREAK
provenance. q1 reconstruction is captured separately and preserves its pre-
refresh geometry.

A thirteenth source-only checkpoint now closes the previously uncaptured BREAK
refresh q0/q2 matrix without widening production eligibility. Twelve fresh
local/opponent active/sole-bench cases independently refresh fresh q0, returned
q0 after four group turns, and q2 after two turns. Each records the pre-refresh,
synchronous two-wrapper, and settled phases. q0 replays zero group turns while
q2 replays exactly two; wrapper replacement preserves card nodes and the final
card turns. The active fresh, returned, and reconstructed q0 states retain the
same `[top q1, lower q0]` turns but three distinct inline-margin histories and
two exact anchor clusters; every anchor delta remains within the declared 2 px
parity tolerance. The bench histories converge, and q2 settles back to its
pre-refresh geometry.

Those results confirm that no exact legacy normalization can be derived from
the current projected tuple alone.

A fourteenth source-only checkpoint isolates q3 rather than mixing its state-
changing failure with the geometry-preserving q0/q2 cases. The selected BREAK
top is effectively q0, so subtracting its BREAK quarter-turn produces
`numberRotations=-1`. The replay loop executes zero times after same-zone
re-entry resets and rebuilds the stack: `[top q0, lower q3, q3]` synchronously
becomes `[top q1, lower q0, q0]` and stays collapsed after settlement. The
BREAK flag and card nodes survive, but the group orientation does not.

V2 refresh/layout remains state-free; it does not reproduce this legacy defect
or add DOM-refresh history to canonical state.

A fifteenth source-only checkpoint captures the clean nonzero-group Alt-R entry
matrix independently across ordinary/BREAK, q1/q2/q3, local/opponent, and
active/sole-bench histories. The keyboard and clicked-card ingress sources are
digest-pinned but not executed by the inert harness. Legacy reads the selected
top's absolute effective angle. Five paths snap only that card to q0 and clear
BREAK, leaving both lower cards at their prior group angle. BREAK at group q3
instead starts its top at effective q0, so Alt-R advances it to q1, retains
BREAK, and leaves the lower cards q3. No refresh occurs; the wrapper remains
stable, but its inline margins still depend on the attempted intermediate angle
and slot.

V2 keeps its explicit group plus per-card orientation model and does not copy
this absolute-angle ambiguity into canonical state. Lower-card initiators,
repeated Alt-R or group rotation after divergence, refresh after divergent
Alt-R, raw/imported q2/q3 per-card states, and attachment timing still require
characterization or a compatibility decision before any strict compound
React/Pixi layout predicate can be sound.

A sixteenth source-only checkpoint then covers middle/base initiation of
whole-stack rotation. Sixteen fresh ordinary/BREAK histories span both roles,
slots, and physical sides through q0→q1→q2→q3→q0 and q1 reconstruction. Logical
indices middle=1/base=2 remain distinct from DOM ordinals 2/1, and the exposed
native hit regions retain both selection paths. Rotations and BREAK flags match
the top-selected phases exactly, but margins follow the selected lower card's
angle. Initial BREAK q1 therefore stays empty in active and `3%`/`2%` on bench
until top-driven refresh normalizes both to `1%`/`0%`; later bench writes shift
similarly.

This supplies more evidence that exact legacy compound layout cannot be chosen
from projected turns alone. Production remains generic for these histories.
Lower-card single/Alt-R beyond pristine group q0, mixed initiators, refresh
after divergence, attachment timing, and candidate paint/hit parity remain
separate decisions.

A seventeenth source-only checkpoint isolates the pristine group-q0 lower-card
Alt-R entry. Sixteen independent histories span middle/base selection,
ordinary/top-BREAK composition, active/sole-bench placement, and both physical
sides. A selected attached lower evolution advances from q0 to q1 and receives
its own legacy `PokémonBreak=true` flag without rotating either sibling. The
top-BREAK composition therefore ends with two BREAK-flagged evolutions. Logical
indices middle=1/base=2 remain distinct from DOM ordinals 2/1.

The checkpoint adds lower-specific painted-only and authored-only native hit
probes, pins exact stack/card/physical geometry and topology, and preserves the
source margin writes: active remains unwritten, ordinary bench changes to
`3%`/`2%`, and top-BREAK bench stays `3%`/`2%`. Keyboard/click ingress is
digest-pinned but not executed. Across the measured pre-single→post-single
transition, there is no refresh or wrapper replacement.
Because canonical v2 state deliberately does not contain a legacy per-evolution
BREAK flag, this evidence does not authorize a production predicate or schema
expansion.

An eighteenth source-only checkpoint extends lower-card Alt-R to clean group
q1/q2/q3 entries. Forty-eight independent histories span middle/base selection,
ordinary/top-BREAK composition, active/sole-bench placement, both physical
sides, and all three nonzero group angles. The selected lower evolution alone
snaps from its absolute q1/q2/q3 angle to q0 and remains
`PokémonBreak=false`; the other lower card keeps the group angle, and a flagged
top keeps both its BREAK status and effective orientation. In the top-BREAK q3
history that means the top is already effectively q0 while both lower cards
begin at q3.

The source margin write still uses the selected card's tentative angle before
that snap, preserving the observed active/bench history differences. Exact
authored and painted bounds distinguish q1/q3 footprints, while the q2→q0
transition is geometrically rectangular and therefore also requires the pinned
action trace and turn state. Keyboard/click ingress remains digest-pinned but is
not executed, and there is no refresh or wrapper replacement across the
measured transition. Returned/history-authored q0, repeated or mixed actions,
refresh or group rotation after divergence, attachments, and candidate parity
remain separate work; production, domain, protocol, and schema paths are still
unchanged.

A nineteenth source-only checkpoint closes the clean returned-q0 lower-card
Alt-R entry without conflating other q0 histories. Forty-eight independently
built histories cross ordinary/top-BREAK composition, a homogeneous prior
whole-stack initiator (top, middle, or base), final middle/base selection,
active/sole-bench placement, and both physical sides. Each group first follows
the established q0→q1, q1 reconstruction, q2→q3→q0 cycle; only the final
`pre-single`→`post-single` transition is measured as refresh-free.

The selected lower evolution then advances q0→q1 and receives its own legacy
`PokémonBreak=true` flag while its siblings remain unchanged. Prior group
initiator is semantically relevant: an ordinary return ends at `1%`/`0%`, while
a top-BREAK bench return retains `3%`/`2%` only when the top drove the cycle;
middle/base-driven BREAK returns end at `1%`/`0%`. Every bench Alt-R converges
to `3%`/`2%`, and active wrappers retain `1%`/`0%`. The oracle also pins the
q1 reconstruction wrapper replacement separately from stable identity across
the measured action, exact lower hit wedges, traces, geometry, observers, and
cleanup. Four-turn cycles without reconstruction, repeated lower Alt-R,
refresh after return or divergence, mixed prior group initiators, imported
states, attachments, and candidate parity remain distinct. No production,
domain, protocol, schema, UI, or UX path changes.

A twentieth source-only checkpoint distinguishes repeated lower-card Alt-R
history from that clean group return. Sixteen histories cross ordinary/top-
BREAK composition, middle/base selection, active/sole-bench placement, and
both physical sides. The same selected lower evolution receives two setup
single-card actions, q0/false→q1/true→q0/false, before a third measured action
returns it to q1/true. The second action computes q2 and writes `1%`/`0%`
before the legacy single-card branch snaps the card to q0 and clears BREAK.

Every pre-state therefore has `1%`/`0%` wrapper margins. Active keeps those
values after the measured action, while bench writes `3%`/`2%`. The resulting
pre/post geometry is exactly equivalent to the same-role lower-initiated
returned-q0 oracle, but its trace and lifecycle are not: there is no refresh
after construction, wrapper/card identity remains stable, and only three
observer pairs exist. This collision proves again that projected turns and
BREAK flags cannot select exact legacy layout. Alternating targets, fourth or
later repeats, interleaved group actions/refresh, imported states, attachments,
and candidate parity remain separate. Production, domain, protocol, schema,
UI, and UX paths remain unchanged.

A twenty-first source-only checkpoint follows the same selected lower card
immediately after the clean nonzero-group Alt-R entry above has already snapped
it to q0/false. Forty-eight independently constructed histories cross ordinary/
top-BREAK composition, initial group q1/q2/q3, middle/base selection, active/
sole-bench placement, and both physical sides. The new pre-state must equal the
matching eighteenth-checkpoint post-state exactly. The measured follow-up then
changes only that selected card from q0/false to q1/true; its top and lower
sibling preserve their divergent turns and BREAK flags.

Active wrappers remain at `1%`/`0%`. Bench q1/q3 histories enter at
`1%`/`0%` and move to `3%`/`2%`, including the small fractional x shift caused
by inline-margin flex redistribution; the bench q2 wrapper already has
`3%`/`2%` and its anchor does not move.
The oracle pins exact cross-fixture pre-state inheritance, full setup plus
follow-up traces, authored/painted/physical geometry, all ten native hit probes,
stable identities, and the same three-observer/no-refresh lifecycle. Q2
histories expose another deliberate collision: active geometry and hit
evidence match the history-authored-q0 case in both phases, and bench converges
to it after the action. BREAK flags also coincide, while sibling turns and full
setup traces differ.
Different follow-up targets, third or later repeats, intervening group rotation or refresh,
imported/refreshed q0 origins, attachments, and candidate parity remain separate.
No production, domain, protocol, schema, UI, or UX path changes.

A twenty-second source-only checkpoint instead applies one top-initiated whole-
group R immediately after the eighteenth-checkpoint lower-card divergence.
Forty-eight histories span ordinary/top-BREAK composition, original group
q1/q2/q3, prior middle/base single selection, active/sole-bench placement, and
both physical sides. Every pre-state equals the matching eighteenth-checkpoint
post-state. The measured top/index-zero `single=false` action advances every
Pokémon one quarter-turn but changes no per-card BREAK flag, so the previously
divergent lower card reaches q1 while remaining `PokémonBreak=false`.

Active margins remain `1%`/`0%`, and ordinary bench margins are unchanged.
Every top-BREAK bench case changes anchor by exactly `0.015625px`: q1/q3 move
from `1%`/`0%` to `3%`/`2%`, while q2 moves the opposite way. Exact pre-state
inheritance, complete trace extension, turns/flags, authored/painted/physical
geometry, ten native probes, stable identity, and the three-observer lifecycle
with no measured-transition refresh are pinned; the two construction refreshes remain
in the inherited setup trace. Cross-fixture collisions prove that identical current
turns and geometry can still retain a different selected-card BREAK flag and
operation history. Lower-selected or repeated group rotation, any intervening
Alt-R/refresh/movement, markers, attachments, candidate parity, and production
normalization remain separate; no UI or UX changes.

A twenty-third source-only checkpoint takes the alternate immediate branch:
one wrapper refresh directly after the eighteenth-checkpoint lower-card
divergence, before any further input or movement. The same forty-eight-case
matrix is split into ordinary and top-BREAK browser runs. Every pre-state and
trace prefix equals its checkpoint-eighteen predecessor. The refresh creates a
new wrapper around the same image nodes, temporarily leaves the empty old
wrapper connected, reattaches both lower cards, and then replays a whole-group
turn count derived only from the unattached top.

Ordinary q1/q2/q3 consequently becomes homogeneous q1/q2/q3 and erases which
lower card diverged. Top-BREAK q1/q2 becomes `{top:q2,lowers:q1}` and
`{top:q3,lowers:q2}` with only the top BREAK flag. Top-BREAK q3 exposes the
legacy defect: its top is raw q0 with BREAK=true, so refresh computes
`(0-90)/90=-1`, replays no turns, and collapses to `{top:q1,lowers:q0}`.
The oracle pins same-task two-wrapper geometry and settled one-wrapper
recentering separately, including margins, all ten hit probes, node/wrapper
identity, observer ownership, cleanup, and canonical collision checks. This is
compatibility evidence, not a rule allowing viewport refresh to mutate v2 game
state. Real KeyR image reload/network behavior, later actions, candidate parity,
and production normalization remain separate; no UI or UX changes.

A twenty-fourth source-only checkpoint returns to the input branch and measures
plain R on the same lower evolution that created the checkpoint-eighteen
divergence. Forty-eight independently rebuilt histories span ordinary/top-
BREAK composition, original group q1/q2/q3, middle/base initiation, active/
sole-bench placement, and both physical sides. The measured logical index is
1 for middle or 2 for base even though their DOM ordinals remain 2 and 1.
`single=false` advances all three Pokémon one quarter-turn and preserves every
BREAK flag, so the initiating lower card becomes q1 while remaining non-BREAK.

The resulting turns and flags exactly match the corresponding checkpoint-
twenty-two top-initiated state, but layout can still differ because the source
writes margins from the initiator's new angle. Active stays `1%`/`0%`; every
bench result becomes `3%`/`2%`. Relative to the top-initiated result, ordinary
q1/q3 and top-BREAK q2 therefore move exactly `-0.015625px` frame-local x;
the other bench cases and every active case are exact. The oracle pins this
signed differential, exact checkpoint-eighteen pre-state inheritance, action
indices, traces, authored/painted rectangles, physical-frame mappings, ten
native probes, stable wrapper/card identifiers, and the unchanged three-observer/no-refresh lifecycle. Other-lower
or repeated group actions, intervening single/refresh/movement, alternate q0
origins, attachments, candidate parity, and production normalization remain
separate; no UI or UX changes.

A twenty-fifth source-only checkpoint measures the complementary immediate
plain-R branch: after the same checkpoint-eighteen middle/base divergence, the
other lower evolution initiates the whole-group rotation. The forty-eight-case
ordinary/top-BREAK, q1/q2/q3, prior-middle/prior-base, active/sole-bench, and
local/opponent matrix keeps the pre-state and trace prefix identical to
checkpoint eighteen. Prior middle selection makes base logical index 2 / DOM
ordinal 1 the measured initiator; prior base selection makes middle logical
index 1 / DOM ordinal 2 the initiator. `single=false` advances all three raw
turns once and preserves every BREAK flag.

Post turns and flags equal both the top-initiated and same-lower-initiated
checkpoints, while the other lower card's original q1/q2/q3 angle retains the
pre-existing bench margin: compact `1%`/`0%` for q1/q3 and spread `3%`/`2%`
for q2. Ordinary geometry therefore exactly matches the top-initiated result.
Top-BREAK bench x differs from it by `+0.015625px`, `-0.015625px`, and
`+0.015625px` frame-local for q1/q2/q3. Relative to the same-lower result,
q1/q3 bench x is `+0.015625px` and q2 is exact; every active case is exact.
The oracle pins both signed collision tables, exact predecessor inheritance,
cross-role action indices, traces, authored/painted rectangles, physical-frame
mappings, ten native probes, stable wrapper/card identifiers, and the unchanged
three-observer/no-refresh lifecycle. Repeats, intervening operations, alternate
origins, attachments, candidate parity, and production normalization remain
separate; no UI or UX changes.

A twenty-sixth source-only checkpoint repeats plain R on the same lower card
immediately after the checkpoint-twenty-four group action. Forty-eight
independently rebuilt ordinary/top-BREAK histories cross original q1/q2/q3,
middle/base initiation, active/sole-bench placement, and both physical sides.
The pre-state and full trace prefix equal checkpoint twenty-four exactly. The
measured second `single=false` action advances the selected lower q1→q2 and
both siblings once while preserving every BREAK flag.

Active margins remain `1%`/`0%`. Every bench pre-state is `3%`/`2%`; the
selected q1→q2 action rewrites it to `1%`/`0%`, moving the wrapper and all
authored card boxes exactly `+0.015625px` frame-local x. Painted boxes are
freshly measured because all three cards change portrait/landscape parity and
cannot be derived by translating checkpoint twenty-four. Q1/q3 post geometry
and all ten probes collide internally despite different raw turns. Q2 also
collides with the matching checkpoint-eighteen pre-divergence geometry, except
for the explicit `+0.015625px` top-BREAK bench displacement. The oracle pins
these collision limits, turns/flags, traces, actions, authored/painted boxes,
physical-frame mappings, stable wrapper/card identifiers, three observer pairs,
cleanup, and no refresh. Third/later group turns, top/different-lower followups,
intervening inputs, alternate origins, attachments, candidate parity, and
production normalization remain separate; no UI or UX changes.

A twenty-seventh source-only checkpoint repeats plain R on checkpoint twenty-
five's same other lower initiator. Forty-eight independently rebuilt ordinary/
top-BREAK histories cross original q1/q2/q3, prior middle/base divergence,
active/sole-bench placement, and both physical sides. Every pre-state and full
trace prefix equals checkpoint twenty-five exactly. The measured other lower
advances q2→q3, q3→q0, or q0→q1; both siblings advance once and all BREAK flags
remain unchanged.

Active margins remain `1%`/`0%`. Bench q1/q3 changes compact `1%`/`0%` to
spread `3%`/`2%`, moving wrapper and authored x by `-0.015625px`; q2 changes
spread to compact and moves them `+0.015625px`. Painted boxes and all ten probes
are freshly measured because every card changes parity. Every post turn/flag
vector equals checkpoint twenty-six: active geometry is exact, bench q2 is
exact, and bench q1/q3 is translated `-0.015625px`. Q1/q3 also collide
internally despite turns differing by 180 degrees, while q2 retains the bounded
checkpoint-eighteen reference. The oracle pins cross-role logical/DOM action
selection, exact inheritance and collisions, traces, authored/painted boxes,
physical-frame mappings, stable identifiers, three observer pairs, cleanup,
and no refresh. A different second initiator, third/later turns, intervening
operations, alternate origins, attachments, candidate parity, and production
normalization remain separate; no UI or UX changes.

A twenty-eighth source-only checkpoint immediately repeats plain R on the same
top/index-zero initiator used by checkpoint twenty-two. Forty-eight independently
rebuilt ordinary/top-BREAK histories cross original q1/q2/q3, prior middle/base
single-card divergence, active/sole-bench placement, and both physical sides.
Every pre-state and full trace prefix equals checkpoint twenty-two exactly. The
measured second top `single=false` action advances all three raw turns once and
preserves every per-card BREAK flag, including top's true→true transition in the
top-BREAK composition.

Active margins remain `1%`/`0%`. Ordinary benches change compact→spread for
q1/q3 (`-0.015625px` frame-local wrapper/authored x) and spread→compact for q2
(`+0.015625px`); top-BREAK benches take the opposite branches and signed
displacements. Painted rectangles and all ten probes are freshly measured as
every card changes parity. Every post turn/flag vector equals checkpoint
twenty-seven. Ordinary geometry is exact; top-BREAK active geometry is exact and
bench q1/q2/q3 differs by `+0.015625px`, `-0.015625px`, and `+0.015625px`.
Q1/q3 collide internally despite turns differing by 180 degrees,
and q2 collides exactly with checkpoint eighteen's matching pre-divergence
geometry. The oracle pins top logical/DOM selection, exact inheritance and
bounded collisions, traces, authored/painted rectangles, physical mappings,
stable identifiers, observer ownership, cleanup, and no refresh. Lower/different
initiators, third/later turns, intervening operations, alternate origins,
attachments, candidate parity, and production normalization remain separate;
no UI or UX changes.

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
