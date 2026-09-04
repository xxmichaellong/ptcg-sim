# Legacy board layout and interaction oracle

Status: `SOURCE_PINNED_IDEAL_CSS_PIXELS`

Geometry version: `1`

Production renderer selection: unchanged

## Purpose and boundary

This checkpoint turns the primary v1 board geometry into deterministic,
renderer-neutral data before either renderer is allowed to replace the current
DOM/iframe board. It is an executable transcription of source-authored CSS and
JavaScript behavior, not a claim that a browser has already measured every
pixel.

The implementation is additive:

- `packages/renderer-contract/src/layout.ts` defines the versioned state and
  pure layout functions;
- `tests/legacy-fixtures/renderer/board-layout-v1.json` is a manually recorded
  numeric oracle; and
- `tests/characterization/legacy-board-layout.test.ts` compares the model to
  that independent oracle and verifies every direct source digest.

`geometry.ts`, `scene.ts`, the DOM and Pixi adapters, the renderer host, and the
production v1 route do not consume this state yet. Passing these tests therefore
does not change rendered output and does not ratify a renderer.

## Provenance model

The fixture contains the authoritative source manifest and a claim-to-source
catalog. It covers the direct HTML, CSS, resize, fullscreen, flip, input,
stack, marker, popup, stadium, and document-keyboard sources used by this
contract. The test requires:

1. one unique entry per source path;
2. every claimed behavior to cite at least one manifest path;
3. every cited path to exist in the manifest;
4. every manifest path to support at least one claim; and
5. each canonical-LF UTF-8 file digest to match its recorded SHA-256.

The canonical-LF rule prevents `core.autocrlf` from creating a false drift
failure. A digest failure means the transcription must be reviewed and the
fixture deliberately re-recorded. A passing digest detects source stability;
it does not prove that the original manual transcription was correct. That
independent check is the later real-browser gate.

## Coordinate spaces

The contract does not fold the legacy iframe and content-box layers into one
ambiguous rectangle.

| Space                    | Meaning                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Outer viewport           | The top-level browser CSS viewport. Sidebar, tabs, stadium, controls, and handles use this space.                                       |
| Play area                | The left `75.5vw` in normal mode or `100vw` in fullscreen mode. Player iframe width follows it.                                         |
| Physical frame           | The current lower or upper player iframe rectangle. Frame height and `bottom` are independent authored ratios of outer viewport height. |
| Player-local             | Top-left normalized coordinates inside an unrotated player document.                                                                    |
| Physical declared bounds | The percentage-authored rectangle mapped through the physical frame and upper-frame rotation, excluding padding and borders.            |
| Physical border box      | The actual content-box element expanded by separately retained padding and border edges.                                                |
| Physical content box     | The inner rectangle after transformed physical padding and border edges are removed.                                                    |

For a player-local rectangle `(x, y, width, height)`, the upper frame's
180-degree transform uses:

```text
x' = 1 - x - width
y' = 1 - y - height
```

It also swaps top/bottom and left/right padding and border edges. Player iframe
borders are `none`, so no unmodeled iframe border is added.

## Source-authored board geometry

These are normalized player-local declared rectangles before content-box
expansion and before upper-frame rotation:

| Region           |   x |   y | width | height | Box detail                                                                         |
| ---------------- | --: | --: | ----: | -----: | ---------------------------------------------------------------------------------- |
| Hand             |  0% | 70% |  100% |    30% | Authored height is `calc(30% - 3px)` plus a 3 px top border, for a 30% border box. |
| Bench            | 10% | 40% |   79% |    25% | Play-slot flex row.                                                                |
| Active           | 34% |  7% |   32% |    28% | Play-slot flex row.                                                                |
| Prizes           |  1% | 21% |    6% |    43% | 5 px content-box padding on every edge.                                            |
| Lost zone        |  1% |  1% |    7% |    15% | Cover surface.                                                                     |
| Deck             | 91% |  9% |    8% |    25% | Authored with `right: 1%`; cover surface.                                          |
| Discard          | 91% | 41% |    8% |    23% | Authored with `right: 1%`; cover surface.                                          |
| Lower free board | 66% |  9% |   24% |    30% | Authored with `left: 66%`; 5 px padding.                                           |
| Upper free board | 12% |  9% |   22% |    30% | Authored with `right: 66%`; 5 px padding, then frame rotation.                     |

For bottom-anchored padded elements, the border box expands upward; for
right-anchored elements it also expands left. The model preserves those anchor
effects before applying the enclosing rotation. The 10 px prize/free-board
border-box expansion is therefore not approximated as a larger normalized
rectangle.

Normal shell geometry is `75.5vw` play area, a `0.5vw` unused gap, and a
right-side shell beginning at `76vw` with width `24vw`. Tabs occupy the upper
`5vh`; the sidebar begins at `5vh` and is `95vh` high. Fullscreen expands only
the player play area to `100vw`, removes shell rectangles from this layout
snapshot, and moves the controls' left anchor from `52vw` to `67vw`. Stadium,
controls height, and resize handles remain outer-viewport-unit geometry.

## Resize and flip state

There are two independent physical handles and two independent physical player
frames. The model deliberately does not replace them with one split ratio.
Each handle retains its authored CSS `bottom` and its current `2.5%` or `10%`
height. Its physical top accounts for `translateY(50%)`:

```text
top = viewportHeight * (1 - bottomRatio - heightRatio / 2)
```

After a resize handler runs, shared placement uses the mean of the two inline
handle bottoms. Stadium bottom is `min(84%, mean - 8%)`; controls bottom is
`min(90%, mean - 3%)`. Before any handler runs, the distinct CSS defaults are
42% and 47%.

The collision predicate intentionally retains the dimensionally odd v1 code:

```text
parseInt(lowerComputedBottomPx) + lowerOffsetHeightPx
  > parseInt(upperComputedBottomPx)
```

Computed bottoms truncate toward zero, including negative values. The current
lower handle height participates, so an expanded handle changes the threshold.
`offsetHeight` is integer CSSOM data; version 1 uses `Math.round()` as the
characterized browser approximation and pins fractional, negative, equality,
and one-pixel threshold cases. Rounding is not asserted as a universal browser
specification and must be verified in Chromium, Firefox, and Safari.

The accepted state range includes the odd edge values reachable from the four
normal/flipped handlers, including lower handle `-2.5%`, upper handle `102.5%`,
and player-frame overscan. It is not a generic 20%-80% clamped splitter.

Flip changes player-to-physical-frame ownership while retaining the two
physical frame geometries. The lower player is unrotated and receives the 24%
free board; the upper player is frame-rotated and receives the authored 22%
free board. Applying flip twice restores the original state. Hand concealment,
stadium card readability, chrome colors, text/image counter-rotation, and
handler rebinding are real flip behaviors but are intentionally outside this
geometry state.

## Cards, stacks, z order, and input

`layoutLegacyPlaySlotCards` covers only a controlled, non-overflowing,
unadorned active/bench row:

- each card supplies its actual intrinsic width/height ratio; the legacy CSS
  does not enforce a universal card ratio;
- active children have no margin;
- bench children have `margin-right: 1%` of the bench row;
- upper-frame physical order is reversed by the 180-degree transform; and
- flex shrink inferred from the supplied ratios is detected and rejected;
  callers must exclude the unrepresented Rotation/BREAK inline 2%/3% margins
  and attachment-expanded container widths rather than assume they were
  validated.

The stack helper is a narrowed source model. It records evolution offsets of
base card width divided by 15 and Energy/Tool offsets of base width divided by
6, mirrored for the upper frame. Its rectangles and z ranks are suitable for a
controlled reference stack. They do not prove ordinary `evolveCard` DOM
insertion order, equal-z paint order, browser edge-hit behavior, rotated-card
axis-aligned bounds, or flex placement of an attachment-expanded container.

Z values are semantic ranks. Player iframes create separate stacking contexts,
so the numeric catalog is not a global topmost-hit algorithm. Likewise,
affordances record which semantic inputs the legacy sources bind; they do not
claim exact browser target geometry. Empty zone containers expose drop only.
The deck, discard, and lost-zone cover child images expose cover-card input as
separate optional targets; their object-fit/intrinsic image rectangles are not
the container rectangles in this oracle. Likewise, the empty stadium exposes
drop only while an optional child stadium card exposes ordinary-card
affordances separately. An adapter must not bind either union to both surfaces.

## Executable fixtures and present acceptance

The version 1 fixture covers:

- a 1600×900 normal shell with numeric rectangles for all eight regions on both
  players;
- a 1920×1080 DPR 2 flipped, asymmetric resize state;
- a 1024×768 four-three shell; and
- a 1280×720 fullscreen shell.

Unit tests additionally pin invalid viewports, duplicate/unknown players,
frame overscan validation, both extreme handles, shared caps, collision
truncation/rounding boundaries, flip involution and free-board asymmetry,
opponent card order, bench-only margins, intrinsic ratios, and stack mirroring.
Structured fixture comparisons allow `0.01` CSS px only to absorb floating-point
arithmetic.

This checkpoint is accepted when the source-manifest test, all structured
fixture comparisons, renderer-contract tests, and TypeScript build pass without
wiring the model into production. It establishes a dependency for later
renderer parity; it does not itself satisfy UI/UX parity.

## Current real-browser checkpoint

`tests/browser/legacy-dom-geometry.spec.ts` now serves only the allowlisted,
checked-in v1 HTML/CSS/assets through Playwright, replaces the networked legacy
application module with an inert module, and blocks every external request. At
the default 1600×900 DPR 1 fixture, Chromium measures and verifies against this
oracle:

- the play area, shell gap, sidebar, and tabs;
- both player iframe frames and the opponent's 180-degree transform;
- stadium and board-control anchors plus both resize handles; and
- all eight border-box regions for both physical player sides.

The same test now independently measures the React DOM candidate and verifies
all 16 visible player-region border boxes against the live legacy-source capture
and their structural content boxes against the source-pinned oracle. It also
checks the visible stadium plus non-painting player-frame, resize-handle, and
board-control projection anchors and the projected opponent rotation. The
sidebar content rectangle is reconstructed from the measured shell/tab edges.
The enforced acceptance remains the declared 2 CSS px browser tolerance; these
sentinels do not claim visible controls or resize interaction parity.

`tests/browser/legacy-card-stack-geometry.spec.ts` adds a separate source-only
card checkpoint at that viewport. Its independently reviewed numeric fixture is
`tests/legacy-fixtures/renderer/card-stack-layout-v1.json`, whose manifest pins
both raw binary assets as well as every relevant HTML, CSS, constructor, reset,
play-container, and attachment source. The inert harness creates the fixed
layout-relevant DOM/inline-style output rather than importing the stateful
legacy modules. Across both player frames it measures 18 image boxes:

- portrait and deliberately square hand images, preserving intrinsic-aspect
  sizing under the authored max height, iframe-relative margins, leading-edge
  flow, and opponent reversal;
- portrait and square unadorned bench play containers, preserving the authored
  one-percent container margin and flex centering; and
- a controlled active stack with one base, two Pokémon-style vertical
  attachments, and two Energy-style horizontal attachments.

The active-stack capture pins integer `clientWidth` rounding before the
width/15 and width/6 calculations, sequential container-width expansion,
full-size attachment boxes, negative layer z values, `base.after()` sibling
reversal, and `elementsFromPoint()` order at common and exposed overlaps. It is
explicitly a controlled `attachCard` transcription: it does not characterize
the separate `evolveCard` action/reflow path, BREAK/rotation margins, bench
overflow, markers, or expanded-stack presentation. It also does not yet compare
these card boxes with either candidate renderer. The intrinsic-size evidence is
observational only: it does not authorize adding secret definition dimensions
to recipient projections. Until a safe asset-metadata boundary exists,
production scene geometry must remain a function of recipient-visible inputs.

The next bounded card slice is implemented by
`layoutLegacyContainedCard` and `legacyPileTopIndex`. It covers the optional
image in each deck/discard/lost-zone cover and the shared stadium:

- cover images use the legacy `object-fit: contain` constraints; the stadium
  reaches the same intrinsic-ratio element box through auto sizing and maximum
  width/height rather than an authored `object-fit` value;
- inline placement is centered, while physical block placement is start for
  the lower frame and end after an upper-frame or top-owner-stadium rotation;
- deck index zero is the cover; discard and lost-zone use their last index;
  stadium admits at most one card;
- only that top scene node paints above and accepts input; covered nodes remain
  present but disabled for stable reconciliation, and cover-pile ability
  markers remain hidden until an opened-zone presentation exists; and
- stadium orientation composes a known card's explicit quarter turns with the
  recipient-visible owner-versus-bottom half-turn.

The production helper intentionally uses the public canonical `63/88` ratio.
The source fixture's 736×1024 intrinsic size is observational and stays out of
`MatchViewState`; exact no-upscale behavior for an undersized or custom-ratio
asset requires a separately designed safe metadata boundary.

`tests/browser/legacy-contained-card-geometry.spec.ts` is the first card-level
source-to-candidate comparison. Its separate
`tests/legacy-fixtures/renderer/contained-card-layout-v1.json` manifest pins
the HTML/CSS/asset plus cover update, deck order, stadium update/flip, and
ability-marker sources. The deny-by-default Chromium fixture measures six
player cover images and both owner-readable stadium states. It then compares
all eight states against the live React DOM candidate, including physical
anchors, dimensions, rotation, one enabled/top-painted scene node per pile,
disabled covered nodes, and stadium-content alignment. The separately mounted
top-owner candidate holds the bottom player and explicit card turn fixed while
changing only projected stadium ownership; its q2 rotation and lower-edge
alignment are therefore independent of the measured source result.

This does not yet prove the legacy cover-click behavior: v1 opens the zone,
whereas the current candidate's top card still emits its ordinary card intent.
Opened-zone cards/markers, exact one-node cover rendering, Pixi geometry,
noncanonical or undersized assets, and rotated hit regions remain outside this
checkpoint.

`tests/browser/legacy-evolution-reflow-geometry.spec.ts` adds a fourth card
checkpoint with the separately digest-pinned
`tests/legacy-fixtures/renderer/evolution-reflow-v1.json`. It runs one isolated,
unrotated portrait base → middle → top chain in each local/opponent active and
bench slot. The fixture records the stable two-card prestate, the synchronous
second-`evolveCard` diagnostic state, and the post-`refreshBoard` state after
two animation frames allow the empty-wrapper MutationObserver to settle.

The source boundary establishes that ordinary three-card evolution normalizes
to top/middle/base logical order, top/base/middle DOM order, and
top/middle/base paint and hit order. The top retains layer two while lower
cards use negative z ranks and offsets of one and two times the top image's
integer CSSOM `clientWidth / 15`. At the pinned viewport, active uses 91 even
though the image paints at 90.5625 CSS px; bench uses 81 for an 80.859375 px
image. The lower-frame cards extend physically upward and the upper-frame
cards extend downward through its 180-degree transform. It also prevents the
synchronous empty wrapper from being mistaken for a stable flex child.

The production `layoutLegacyOrdinaryEvolutionStack` helper uses the public
canonical card ratio while preserving the integer CSSOM-width rule, physical
bench margin, opponent direction, canonical index, and source z rank.
`createBoardScene` selects it only for the exact three-card, face-up, unrotated,
marker-free, attachment-free, common-owner, single-stack, non-shrinking state
at the captured default 1600×900 DPR-1 sidebar layout, even split, and
unflipped bottom identity. The same Chromium test mounts a separate React DOM
candidate scene and compares all 12 card boxes, effective rotations, and
common/middle/base overlap hit order directly with the source capture within
2 px / 1% / 0.1 degrees. Canonical bottom-to-top state remains unchanged, and
the candidate need not reproduce the legacy wrapper or top/base/middle DOM
sibling implementation detail.

The evolution fixture does not execute the networked modules. It excludes
Energy/Trainer/Tool and unrelated attachments, markers, BREAK/rotation,
multiple-stack flex shrink and overflow, resize/flip,
transfer/removal/promotion, `leaveAll` and other history-dependent restoration,
noncanonical dimensions, face hide/reveal and source mutation, previews, and
input or network behavior. Those states retain the previous scene path or
require a later oracle rather than inheriting this narrow result. Pixi consumes
the same renderer-neutral scene geometry for qualifying stacks, but its paint
and hit parity remain unverified.

`tests/browser/legacy-energy-attachment-reflow-geometry.spec.ts` adds a fifth,
source-backed card checkpoint with the separately digest-pinned, source-only
`tests/legacy-fixtures/renderer/energy-attachment-reflow-v1.json`. It isolates
one face-up Energy attached to one unrotated active Pokémon in the local and
opponent frames at the default 1600×900 DPR-1 sidebar layout. The replay records
the immediate post-attach result only as a diagnostic, then transcribes the
unconditional `refreshBoard` reconstruction, `adjustCards` width rewrite, and
MutationObserver-delayed old-wrapper cleanup before accepting stable geometry.

The stable source state preserves `[base, energy]` logical and DOM order, z
ranks `[0, -1]`, common-overlap priority `[base, energy]`, and an Energy-only
outer strip. The 736×1024 source card paints at 90.5625×126 px while its integer
`clientWidth` is 91, so the Energy offset is 91/6 and the final wrapper width is
`91 + 91/6 = 106.167` px. The upper frame mirrors the horizontal extension and
adds its enclosing half-turn. Refresh synchronously leaves two wrappers before
the old empty container settles away, so the stable wrapper count is one.

The source fixture remains an independent oracle. A strict production helper
now selects its stable layout only for exactly one known face-up Pokémon base
and one same-owner known face-up Energy in an unrotated, marker-free active
stack whose player has no bench stacks at the captured default layout.
Recipient geometry
uses the public 63:88 ratio: the canonical base width rounds to 90 px, yielding
a 15 px offset and 105 px wrapper. Chromium compares all four React DOM card
boxes, rotations, mapped z ranks `300/299`, and common/Energy-only hit order to
the source within 2 px / 1% / 0.1 degrees. The renderer list stays back-to-front
and does not reproduce legacy wrapper or sibling identity.

This Energy checkpoint does not itself cover the separate Trainer-as-Tool path,
multiple Energy or mixed-order normalization, departures/compaction, Pokémon
evolution layers or Pokémon-classified attachments, bench/flex overflow,
markers, BREAK/rotation, noncanonical assets, alternate layouts, input, Pixi
paint/hit behavior, or network behavior. States excluded from every
characterized strict path retain the prior generic scene geometry; asset shape,
input, Pixi paint/hit, and network behavior remain uncharacterized rather than
eligibility inputs.

`tests/browser/legacy-trainer-tool-attachment-reflow-geometry.spec.ts` adds a
sixth source-backed card checkpoint with its own digest-pinned
`trainer-tool-attachment-reflow-v1.json`. It isolates the legacy convention in
which the Tool UI action assigns category `Trainer`; any current-category
Trainer attached to an ordinary active Pokémon receives the non-Pokémon
`clientWidth / 6` offset and z decrement, then `syncRotation` adds a 90-degree
presentation turn and writes `margin-right: 2%` on the wrapper. The stable
wrapper retains the same 91 px integer base width and 106.167 px authored width
as the single-Energy case, but its computed 7.71875 px margin shifts the
centered stack.

The Tool checkpoint explicitly separates the pre-transform 90.5625×126 px
layout box from the 126×90.5625 px painted bounding box. It records the local
90-degree and opponent-effective 270-degree rotations, transform matrix and
origin, rotated overflow beyond the wrapper, `[base, tool]` logical/DOM/z hit
priority, exposed Tool-only and base-only regions, and a portion of the
authored Tool layout rectangle containing no painted card. Stable geometry is
accepted only after the synchronous two-wrapper refresh state settles to one
wrapper through the legacy MutationObserver.

The narrow production path selects only the exact one-base/one-current-category
Trainer active stack described above at the captured default layout. It uses
the public 63:88 ratio, giving a 90 px rounded base width, 15 px offset, 105 px
wrapper, and an active-region `2%` margin; it does not consult definitions,
asset URLs or intrinsic dimensions, viewer role, or public-reveal metadata.
`CardSceneNode.bounds` stays the pre-transform box, base/Tool z ranks map to
`300/299`, and the Tool rotates one quarter-turn locally and three for the
opponent. Shared hit/drop containment inverse-rotates around the box center.
Chromium compares all four scene boxes and painted React DOM boxes, rotations,
z ranks, and common/Tool-only/base-only/empty-layout native hit order to source
within 2 px / 1% / 0.1 degrees. A separate both-candidate fixture verifies the
same painted-only versus authored-layout-only click/drop boundary and removes
Pixi's incorrect CSS-pixel explicit sprite hit area.

Energy retains its separate strict path; mixed ordering, multiple attachments,
departures and stale margins, category history, evolution combinations,
bench/flex variants, markers, BREAK/compound rotation, alternate layouts,
candidate wrapper/sibling identity, and Tool-specific Pixi paint parity remain
excluded from this Tool gate. Every state excluded from all characterized
strict paths retains generic scene geometry with no implicit Tool turn.

`tests/browser/legacy-two-energy-attachment-compaction-geometry.spec.ts` adds a
seventh source checkpoint for two ordinary Energy attachments followed by
direct inner/first or outer/second departure in independently constructed local
and opponent active stacks. The stable source state records logical order
`[base, E1, E2]`, DOM sibling order `[base, E2, E1]`, z indexes
`[0, -1, -2]`, common hit order `[base, E1, E2]`, the two-Energy overlap
`[E1, E2]`, and an E2-only outer strip. With the captured 91 px base
`clientWidth`, stable offsets are `91 / 6` and `2 * 91 / 6`; post-refresh
`adjustCards` writes a 121.333 px wrapper even though sequential attachment had
briefly authored 121.167 px from an integer wrapper width.

Direct outer departure leaves E1 at one offset and z `-1`. Direct inner
departure resets E1, promotes E2 to z `-1`, and briefly moves it to
`parseInt(2 * 91 / 6) - 91 / 6 = 14.833` px. Both branches contract the
121 px integer wrapper to 105.833 px, then full refresh rebuilds the survivor at
15.167 px in a 106.167 px wrapper. The old empty wrapper remains synchronously
connected and is removed by the real MutationObserver. Only the
observer-settled state is a parity oracle; the earlier phases document legacy
mutation history.

The new strict production helper selects only this stable pre-departure shape:
one known same-owner face-up Pokémon base and exactly two known same-owner
face-up Energy cards, all unrotated and marker-free, in the sole active stack at
the captured default layout. It uses the public 63:88 ratio rather than source
asset dimensions, giving a rounded 90 px base, 15/30 px offsets, a 120 px
wrapper, and scene z ranks `300/299/298`. State attachment order maps directly
to inner/outer geometry, while the renderer-neutral scene remains
back-to-front: E2, E1, base. Chromium matches all six scene and React DOM card
boxes, rotations, z ranks, and four native hit regions to the stable source
within 2 px / 1% / 0.1 degrees. Legacy wrapper and sibling identity are not a
candidate requirement.

Both departures converge on the existing one-Energy source state and select its
strict production geometry after authoritative state compaction. The immediate
drift and synchronous ghost wrapper remain source-only diagnostics: no renderer
caches or recreates that history. Mixed/Tool attachments, three or more Energy,
category-history interactions, evolution/base departure, staged restore,
bench/flex contention, markers, BREAK/rotation, alternate layouts and assets,
destination UX, candidate click/drag behavior, Pixi paint/hit, and
server/network behavior remain excluded.

`tests/browser/legacy-mixed-energy-trainer-tool-attachment-order-geometry.spec.ts`
checks the source-only
`tests/legacy-fixtures/renderer/mixed-energy-trainer-tool-attachment-order-v1.json`.
It records four isolated attachment histories—both Energy/Trainer ingress
orders in the local and opponent active frames—and four isolated departure
histories—remove Energy or Trainer-as-Tool on each side. This is a checked-in-
source capture, not a candidate renderer comparison or a new production
eligibility path.

For the stable three-card source stack, both ingress orders converge on logical
`[base, Energy, Trainer]`, sibling `[base, Trainer, Energy]`, and z-index
`[0, -1, -2]`. The captured source asset has a 90.5625×126 px untransformed box
and a 91 px integer `clientWidth`. Thus Energy and Tool begin at `91 / 6 =
15.1667` px and `2 * 91 / 6 = 30.3333` px from the base; post-refresh
`adjustCards` writes `91 + 2 * 91 / 6 = 121.333` px. The Tool sets a `2%`
right wrapper margin, computed as `7.71875` px at the captured active region,
and its center-origin quarter-turn swaps its painted box to 126×90.5625 px.
Frame-local rotations are `[0, 0, 90]`; the opponent enclosure makes their
physical effective rotations `[180, 180, 270]` and reverses extension direction
without changing relative layout math.

At the stable checkpoint the shared frame-local wrapper is
`(x=539.46875, y=31.5, width=121.328125, height=126)`. The base and Energy
paint at x `539.46875/554.625`, y `31.5`, with 90.5625×126 px bounds. The
Tool's authored box begins at `(569.796875, 31.5)` with that same size, while
its rotated painted box is `(552.078125, 49.21875, 126, 90.5625)`. The local
physical frame adds 450 px to y. The opponent physical frame maps each box by
`x = 1208 - localX - width` and `y = 450 - localY - height`, then contributes
the effective half-turn above.

The six sampled stable regions report base-only `[base]`, base/Energy above the
Tool `[base, Energy]`, Energy above the Tool `[Energy]`, common overlap
`[base, Energy, Trainer]`, Energy/Tool overlap `[Energy, Trainer]`, and
Tool-painted-only `[Trainer]`. On Trainer-first ingress, attaching Energy first
places it at `30.3333` px, then recursive Tool movement compacts it to
`parseInt(30.3333) - 91 / 6 = 14.8333` px before refresh restores `15.1667` px.
Energy departure applies the same transient compaction to the surviving Tool;
Tool departure leaves a stale `2%` margin on the old wrapper until refresh.
Both departure branches first author an integer-width contraction of
`121 - 91 / 6 = 105.833` px, reset the removed card, and then converge on the
already characterized stable single-Tool or single-Energy state. Refresh
synchronously exposes the superseded empty wrapper and the new wrapper; the
real MutationObserver settles this to one, and fixture cleanup leaves no cards,
wrappers, or sink.

Those attach/reorder/departure transients are diagnostic and must not become
renderer state. The stable canonical `[Energy, Trainer]` output now contributes
source evidence to the narrow strict production path described below; reverse
order and every transient checkpoint continue through generic layout.

Six additional source-only staged histories cover reversed two-attachment
`leaveAll`, four-card interleaved `leaveAll`, and multi-card
`switchWithDeckTop` followed by `leaveAll` in both frames. Because staged cards
are reset outside a play container, `leaveAll` replays them from popup index
zero and the incoming-Energy Tool relocation runs. The two restore inputs settle
to Energy-before-Trainer with within-category order preserved. The staged swap
itself is remove-then-append in v1, not positional replacement: selecting the
middle Energy from `[Trainer1, Energy1, Trainer2, Energy2]` and receiving a
Trainer deck top leaves `[Trainer1, Trainer2, Energy2, deckTopTrainer]`, then
restores `[Energy2, Trainer1, Trainer2, deckTopTrainer]`.

The swap capture checks logical and direct-child deck order plus complete reset
card state at every phase. A separate phase/card invocation trace keeps the
otherwise idempotent selected-departure, deck-rotation, and prior-top-return
reset calls observable.

`leaveAll` does not call refresh. Its immediate and two-animation-frame phases
are identical with one live wrapper, no superseded wrapper, and the staging
popup hidden: reversed two-card restore leaves the Energy at `14.8333` px;
interleaved four-card restore leaves offsets
`14.8333/28.8333/44.8333/60.6667` px; and the staged-swap restore leaves its
sole Energy at `13.8333` px before the three Tools at
`29.8333/45.5/60.6667` px. These history-dependent integer-compaction values,
their exact logical/DOM/z/hit order, and the 151.167 px four-attachment wrapper
are pinned source diagnostics, not stable renderer inputs.

V2 intentionally keeps its already-modeled atomic exact-position staged swap,
so that matching history retains a different within-Trainer order after the
same restore partition. The source oracle records this as an explicit semantic
exception rather than candidate parity. Unsupported attachment categories,
base-only `leaveAll`, category-history geometry, whole-stack swaps, broader
overflow/flex behavior, and Pixi parity remain deferred. Reverse arrays remain
valid historical state outside the v1 normalized transition subset; they are
not globally invalid state.

`tests/browser/legacy-mixed-stack-movement-geometry.spec.ts` adds a ninth source
oracle and a bounded React DOM candidate comparison backed by
`tests/legacy-fixtures/renderer/mixed-stack-movement-category-cycle-v1.json`.
It runs native canonical construction, a reverse-restore whole-stack round
trip, and a current-category cycle independently in both physical frames. The
movement history seeds the exact reverse-restored geometry independently pinned
by the preceding oracle, sends the mixed active stack to an occupied bench
without a target, observes the legacy automatic promotion, and then returns it
to the occupied active slot. It does not replay `leaveAll` a second time. The
category history changes Energy to Trainer and back and Trainer to Energy and
back through real board departure and ordinary reattachment semantics.

The seeded reverse-restored checkpoint begins with the already observed
14.8333/30.3333 px active offsets. Because `moveCardBundle` refreshes after each
whole-stack move, its settled sole-bench state is canonical at 13.5/27 px with
a 108 px wrapper, and its returned active state is canonical at
15.1667/30.3333 px with a 121.333 px authored wrapper. The category cycle also
settles on that active geometry while retaining only the semantic `type2`
values Energy and Trainer. Synchronous
movement phases expose three old/new wrappers in each zone, the category cycle
exposes two, and the real empty-wrapper observer settles every case to one
active and one bench wrapper. Exact logical and DOM order, current/original
categories, card and wrapper geometry, Tool rotation, z/hit order, parent
identity, reset and harness-operation traces, cleanup, source digests, and
deny-by-default request fulfillment are frozen.

The strict renderer-contract path uses only the semantic current state: one
known same-owner face-up Pokémon base followed by one known Energy and one known
current-category Trainer, all unrotated/marker-free, in the exact default
layout. It admits the sole active placement, active with one clean base-only
bench control, and sole bench with one clean base-only active control. It uses
the public 63:88 ratio and canonical rounded offsets of 15/30 px active and
13.5/27 px bench; no source wrapper or history identity is retained.

The candidate comparison mounts the settled sole-bench scene first and then a
higher-revision returned-active scene. Across both physical sides it compares
all mixed cards' scene pre-transform boxes and React painted boxes, effective
Tool turns, z `300/299/298`, renderer order `[Tool, Energy, base]`, and the four
base-only/all-overlap/Energy-Tool/Tool-only native hit regions within 2 px / 1%
/ 0.1 degrees. The unrelated opposite-slot control is an eligibility fixture,
not a geometry claim. Stable-ID scene diffs and Pixi consumption tests cover
the same active/bench/active descriptor updates without card or sprite
replacement and without texture churn. A real multiplayer projection test
confirms identical normalized geometry and stable, distinct aliases for owner,
opponent, and spectator through movement and a current-category cycle.

This does not make transient wrappers renderer state or justify persisting DOM
provenance or pixel offsets. Bench reordering, multiple bench controls, the
legacy case-3 target branch, extra/evolution attachments, bases whose current
projected category is not Pokémon, alternate layouts, nonstandard-intrinsic
asset parity, broader gestures, and Pixi paint/hit remain deferred. Unprojected
original-category history cannot select a renderer path.

`tests/browser/legacy-marker-rotation-geometry.spec.ts` adds a tenth source
oracle backed by
`tests/legacy-fixtures/renderer/marker-rotation-v1.json`. Two independent inert
histories place one ordinary active Pokémon and its damage, special-condition,
and ability-used markers in the local and opponent source frames. They capture
the pristine card, marked q0, each synchronous q1/q2/q3/q0-return phase, and
marker-node/card-pointer cleanup, post-removal resize non-observation, and
wrapper cleanup. The fixture also executes a damage update and all
P/B/A/Pa/C/default condition palette branches.

At q0 the card paints at 90.5625×126 px. Damage and condition are editable,
pointer-hit 30.1875 px circles; the empty ability marker is a pointer-hit
90.5625×18.109375 px tab. At q1/q3 the rotated card paints at 126×90.5625 px,
so the source recomputes 42 px circles and a 126×25.1875 px tab from that
painted width. The three markers are direct active-zone children at z-index 1,
and marker-center hit tests return marker before card. Opponent circles add an
inner 180-degree transform to the outer opponent frame's half-turn, while the
opponent ability tab retains only the enclosing half-turn.

The pristine active wrapper has no inline margins. q1 preserves that state;
q2 writes `margin-right: 1%` and `margin-left: 0%`, q3 retains it, and the
returned q0 remains at x 556.78125 rather than pristine x 558.703125. This is a
source-history diagnostic, not a candidate layout rule. The active q1/q3 marker
geometry remains source-only.

The same Chromium suite mounts React DOM against only the pristine source q0
phase. The strict renderer-contract branch admits one known same-owner face-up
Pokémon in the sole unrotated active stack, no bench/evolution/attachments, at
the exact default layout, with at least one stack marker and no per-card ability
marker. It uses the public 63:88 ratio: a 90.2045×126 px card, 30.0682 px
circles, and a 90.2045×18.0409 px ability tab. Local/opponent physical geometry
matches the source within 2 px anchors / 1% sizes; palette and empty ability
text are exact, font and line height remain proportional, and marker z is
exactly card z plus one. The test separately asserts
`pointer-events: none`; this intentionally differs from the source's editable,
pointer-hit markers until the editor lifecycle is implemented. Because DOM
history is not projected, any eligible returned-q0 current state receives the
same deterministic q0 geometry rather than the source margin drift. Marker
scene diffs expose stable add/remove/update/unchanged IDs; keyed Pixi marker
views update and clean up without card asset churn. Real owner, opponent, and
spectator sessions retain distinct stable aliases and identical normalized
geometry without serializing canonical card or definition IDs.

Rotated bench markers, BREAK and compound evolution/group rotation,
Energy/Trainer rotation, marker transfer/reconstruction, editing gestures,
alternate layouts, and Pixi-native paint/hit parity remain deferred.

`tests/browser/legacy-bench-marker-rotation-geometry.spec.ts` adds an eleventh,
separate source oracle backed by
`tests/legacy-fixtures/renderer/bench-marker-rotation-v1.json`. Each physical
side receives one ordinary Pokémon in the sole bench wrapper, with a damage
circle and ability-used tab. Visible control eligibility, keyboard eligibility,
and movement cleanup sources pin special conditions as active-only; the bench
fixture records zero special-condition nodes and explicitly excludes direct
noncanonical low-level creation.

The portrait q0 card paints at 80.859375×112.5 px. Its damage circle is
26.953125 px and its ability tab is 80.859375×16.171875 px. q1/q3 paint the
card at 112.5×80.859375 px and recompute a 37.5 px circle plus a
112.5×22.5 px tab. Both markers are direct bench children at z-index 1. At the
q1/q3 intersection the later-appended ability tab wins native hit order over
damage and card, making equal-z ordering an explicit future-renderer contract
rather than an ID-sort assumption.

Pristine q0 has no inline wrapper margins but computes the bench CSS default of
`9.53125px` right and `0px` left. q1/q3 write `3%`/`2%`; q2 and returned q0
write `1%`/`0%`. Unlike the active history, returned bench q0 is physically
identical to pristine q0 because those authored values reproduce the CSS
default. Local/opponent geometry otherwise agrees, with the opponent
q0/q2/q0-return ability tab retaining a measured 0.015625 px frame-local y
delta.

One window resize invokes exactly the two live marker listeners, and removal
prevents later invocations. Separately, the source bench `ResizeObserver`
delivers once after marker setup and refreshes both markers, then delivers on
empty-wrapper cleanup without refreshing either removed marker. Legacy does
not expose an observer disconnect path: the capture proves it remains live
before one harness-only disconnect and makes no source teardown claim.

The full rotation and observer checkpoint remains source-only. Its pristine q0
phase now feeds a strict production branch only when one clean active control
and one clean sole-bench base are present in the exact default layout. The
production card uses the public 63:88 ratio (80.5398×112.5 px), including while
markerless, with a 26.8466 px damage circle and 80.5398×16.1080 px ability tab.
It emits the separate `legacyBenchQ0` presentation and deterministic source
append order (`damage`, then `abilityUsed`); special conditions fail closed to
generic layout. Chromium compares the marked q0 React geometry/paint and
non-interactive hit-through boundary to source within the declared tolerances.
DOM/Pixi lifecycle and real owner/opponent/spectator projection tests cover
stable IDs, cleanup, no asset churn, equal normalized geometry, distinct stable
opaque card aliases, and the shared canonical public stack ID.

Additional bench siblings/flex contention, all rotated production paths,
BREAK/compound and attachment rotation, marker movement/editing, alternate
layouts, and Pixi-native paint/hit parity are still deferred.

`tests/browser/legacy-compound-rotation-geometry.spec.ts` adds a twelfth source
checkpoint while deliberately splitting its evidence between
`compound-group-rotation-v1.json` and `compound-break-rotation-v1.json`. Four
fresh cases per oracle cover local/opponent active and sole bench. Each builds
the stable three-Pokémon `[top, middle, base]` logical chain (DOM order
`[top, base, middle]`, z `0/-1/-2`) through the digest-pinned evolve/refresh
transcription and rotates only from the canonical top.

The ordinary oracle records q0→q1, q1 after wrapper reconstruction, then
q2→q3→q0. The BREAK oracle records the upright top-only q1 toggle, composed
card turns `[1,0,0]→[2,1,1]`, the same valid q1 after reconstruction, then
`[3,2,2]→[0,3,3]→[1,0,0]` and the final BREAK-off all-q0 state. Every phase
pins client/intrinsic dimensions, temporary-transform-none and painted boxes,
physical frame mapping, margins, topology, relative links, layer offsets,
wrapper/card identity, golden frame-local phase rectangles and hit coordinates,
six native hit regions, native observer construction/delivery, and harness-only
observer-handle cleanup. q1 refresh proves one synchronous ghost wrapper and one
stable replacement after two animation frames without changing card geometry or
identity.

This source evidence also closes off an unsafe production shortcut. Fresh and
returned active BREAK-q0 phases have identical card/stack quarter turns but
different inline-margin geometry; moving a BREAK stack can create a third
history. The current recipient projection does not carry legacy BREAK or DOM
history, and a non-BREAK q1 card can reach an otherwise identical v2 tuple.
Alt-R while group rotation is nonzero, BREAK refresh at group q0/q2 or q3,
lower-card initiators, and attachment timing are explicitly excluded from that
twelfth checkpoint. No new renderer presentation or production gate is claimed
by the source-only slice.

`tests/browser/legacy-compound-break-refresh-geometry.spec.ts` adds a
thirteenth source checkpoint backed by
`tests/legacy-fixtures/renderer/compound-break-refresh-q0-q2-v1.json`. It
isolates fresh BREAK q0, returned BREAK q0 after four group turns, and BREAK q2
after two turns across local/opponent active and sole-bench slots. All twelve
histories begin from a newly constructed three-Pokémon chain. Their
pre-refresh, synchronous post-refresh, and two-animation-frame settled phases
pin the exact operation/replay trace, two-to-one wrapper lifecycle, preserved
card-node identity, observer delivery and harness cleanup, margins, authored
and painted rectangles, topology, and six native hit regions.

Fresh and returned q0 both make `refreshBoard` derive zero replay turns and
retain card turns `[top q1, middle q0, base q0]`; q2 derives and replays exactly
two turns, retaining `[q3, q2, q2]`. The active slot nevertheless exposes three
q0 layouts for the same final card turns: fresh q0 starts with empty inline
margins, returned q0 starts at `1%`/`0%`, and either refresh settles at
`3%`/`2%`. Their exact x values form a fresh and a returned/reconstructed
cluster: fresh-to-returned differs by 1.921875 px, fresh-to-reconstructed by
1.9375 px, and returned-to-reconstructed by 0.015625 px. All are within the 2 px
parity tolerance. All bench histories already use `3%`/`2%` and converge after
replacement, while active q2 returns to its pre-refresh `1%`/`0%` geometry. The
synchronous phase deliberately measures the new wrapper while the old empty
sibling still participates in flex layout.

This closes q0/q2 evidence only. q3 refresh retains a separate negative-count
collapse hazard; nonzero-group Alt-R, lower-card group/single initiators,
attachments, movement/evolution/removal, and candidate parity remain excluded.
Because v2 does not project BREAK identity or DOM/wrapper history, no strict
production layout is enabled and no legacy pixel provenance is added to game
state.

`tests/browser/legacy-compound-break-refresh-q3-geometry.spec.ts` adds a
fourteenth source checkpoint backed by
`tests/legacy-fixtures/renderer/compound-break-refresh-q3-v1.json`. Four newly
constructed local/opponent active/sole-bench histories reach BREAK group q3 and
then capture pre-refresh, synchronous post-refresh, and settled phases. The
oracle recursively live-verifies the preceding q0/q2 and compound BREAK source
manifests while directly pinning the rotation and refresh entries specific to
the failure.

Before refresh the top BREAK card has effective inline q0 and both lower cards
have q3. `refreshBoard` subtracts the BREAK quarter-turn, derives
`numberRotations=-1`, and moves the stack through same-zone reconstruction. Its
`for (i = 0; i < numberRotations; i++)` loop executes no times, so the reset and
reattachment path synchronously changes `[top q0, middle q3, base q3]` into
`[top q1, middle q0, base q0]`. The settled phase retains that collapse. Exact
operation traces contain the negative refresh call and no replay calls; the
BREAK flag and all card nodes survive while the old wrapper settles from the
synchronous pair to one.

The fixture also pins the before/after hit-region class, margins, authored and
painted rectangles, opponent half-turn mapping, topology, native observer
delivery, and harness-only observer cleanup. This is defect evidence, not a
parity requirement: v2 layout/resize/refresh stays a pure projection and does
not mutate canonical orientation or persist browser history.

`tests/browser/legacy-compound-nonzero-group-single-geometry.spec.ts` adds a
fifteenth source checkpoint backed by
`tests/legacy-fixtures/renderer/compound-nonzero-group-single-v1.json`.
Twenty-four fresh clean-group histories cover ordinary/BREAK q1/q2/q3 across
both physical frames and active/sole-bench slots. Each inherits an exact pre-
action compound phase, then invokes top-selected single-card rotation once.
Keyboard and clicked-card ingress are digest-pinned but not executed by the
inert harness. There is no refresh or wrapper replacement: both phases have one
wrapper and the three construction observers remain live until harness cleanup.

Legacy Alt-R operates on the selected card's effective inline angle, not on a
group-relative offset. Ordinary q1/q2/q3 therefore become `[top q0, lower q1]`,
`[top q0, lower q2]`, and `[top q0, lower q3]`. BREAK q1/q2 similarly clear the
flag and reset the top to q0 while preserving the lower group turns. BREAK q3
is the exception: its top is already effective q0, so Alt-R produces
`[top q1, lower q3]` and retains BREAK. Active and bench wrapper margins follow
the intermediate attempted angle before the q0 snap, leaving additional
history-sensitive but visibly near-equivalent layouts.

The oracle pins complete operation/transition traces, action targeting,
quarter-turns and BREAK flags, margin histories, topology, painted and physical
geometry, all six native hit regions, observer delivery, cleanup, and the
recursive ordinary/BREAK dependency chain. This remains compatibility evidence,
not a mandate to copy the ambiguity: v2 keeps group orientation and per-card
orientation explicit. Lower-card group/single initiators, refresh after these
divergent states, repeated Alt-R or group rotation after divergence,
raw/imported per-card q2/q3 inputs, attachments, movement/evolution/removal,
candidate geometry, and the final product-level compatibility decision remain
outside this checkpoint.

`tests/browser/legacy-compound-lower-group-initiator-geometry.spec.ts` adds a
sixteenth source checkpoint backed by
`tests/legacy-fixtures/renderer/compound-lower-group-rotation-v1.json`.
Sixteen independent histories cover middle/base-selected whole-stack rotation,
ordinary/BREAK composition, both physical frames, and active/sole-bench slots.
Each completes q0→q1→q2→q3→q0 with the established q1 reconstruction point.
Clicked-image selection and R-key forwarding are digest-pinned but not executed.
The captured actions instead prove logical indices middle=1/base=2 while DOM
order remains `[top, base, middle]`; native middle/base exposed regions prove
both cards are selectable.

Card rotations remain coherent and match the exact top-selected ordinary/BREAK
dependency phases. The margin history does not. At BREAK q1 a lower initiator's
tentative angle is q1 rather than the top's q2, leaving active margins empty and
bench margins `3%`/`2%` instead of `1%`/`0%`. The subsequent top-driven refresh
replay normalizes both slots to `1%`/`0%`. Lower-selected q2/q3/q0 margin writes
continue to differ from top selection on bench even though card turns, BREAK
flags, topology, links, offsets, and painted shapes remain identical.

The dependent oracle pins exact selected indices and traces, per-phase margins
and anchors, dependency-relative card/hit geometry, physical-side mapping,
wrapper/card identity, native observer delivery, and harness cleanup. It mounts
no candidate and changes no production state. Lower-card single/Alt-R (which
can assign BREAK to an attached evolution), mixed initiators, refresh outside
the coherent q1 reconstruction, attachments, and later divergence remain
explicitly excluded.

`tests/browser/legacy-compound-lower-q0-single-geometry.spec.ts` adds a
seventeenth source checkpoint backed by
`tests/legacy-fixtures/renderer/compound-lower-q0-single-v1.json`. Sixteen
fresh histories cover ordinary/top-BREAK composition, middle/base selection,
local/opponent frames, and active/sole-bench slots at pristine group q0. Alt-R
and clicked-card selection are digest-pinned but not executed; the inert harness
transcribes only `single=true` rotation on logical index 1 or 2 after proving
their reversed DOM ordinals 2 or 1.

The selected attached lower evolution changes q0→q1 and receives its own
`PokémonBreak=true`; neither sibling changes. Ordinary results contain one
BREAK-flagged lower card, while top-BREAK composition retains the top q1 flag
and adds a second flag to the lower card. Active margins remain empty. Ordinary
bench changes from empty to `3%`/`2%`, and top-BREAK bench remains `3%`/`2%`.
Lower-role painted-only and authored-only native probes close the top-centric
hit-evidence gap, alongside exact stack/card/physical rectangles, topology,
links, traces, observer ownership, and harness cleanup. No refresh or wrapper
replacement occurs across the measured pre-single→post-single transition; the
independent setup trace still includes the two construction refreshes.

This remains source-only because projected v2 orientation can paint the current
turns but canonical state deliberately lacks the legacy per-evolution BREAK
flag that affects later actions. It mounts no candidate and changes no
production/domain/schema path. Returned or history-authored q0, group q1/q2/q3
lower Alt-R, repeated or mixed initiators, refresh after divergence, an already-
BREAK lower card, attachments, movement/removal, and candidate parity remain
excluded.

The eighteenth source checkpoint is split across
`tests/browser/legacy-compound-lower-nonzero-group-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-group-single-break-geometry.spec.ts`,
with one shared oracle at
`tests/legacy-fixtures/renderer/compound-lower-nonzero-group-single-v1.json`.
Forty-eight fresh histories cover ordinary/top-BREAK composition, middle/base
selection, group q1/q2/q3, both physical frames, and active/sole-bench slots.
The two Chromium executions contain twenty-four cases each, but together form
one source-only checkpoint. Every history is constructed independently and
records `pre-single` and `post-single` with no measured-transition refresh.

Legacy single-card rotation reads the selected lower card's absolute inline
angle. The selected middle or base therefore snaps q1/q2/q3→q0 and remains
`PokémonBreak=false`, while the top and other lower evolution retain their
turns. A top-BREAK card stays flagged and keeps its effective orientation; at
group q3 it is already q0 while the two lower cards start q3. Logical action
indices remain middle=1/base=2 despite DOM ordinals 2/1. Exact traces are
essential for q2→q0 because both endpoints have the same rectangular painted
and authored bounds.

The oracle pins authored and painted rectangles plus their physical-frame
mapping, including lower-role painted-only and authored-only native hit probes
at q1/q3 and their required absence at q2 and selected post-q0. Margins preserve the
selected card's tentative-angle write: ordinary q1/q3 bench entries move from
`3%`/`2%` to `1%`/`0%`, ordinary q2 bench moves the opposite direction, while
the top-BREAK bench values remain fixed within each group history. Active q1
begins unwritten only for ordinary composition; all other measured active phases
are `1%`/`0%`. Card/wrapper identity, topology, links, observers, and cleanup
remain stable across the action.

The keyboard and clicked-card ingress files are digest-pinned but not executed;
the harness narrowly transcribes the `single=true` source branch and its
`processAction` call payload index. Opponent cases prove physical half-turn
mapping, not local mutation of opponent-owned application state. The checkpoint
mounts no candidate and changes no production/domain/protocol/schema path.
Returned/history-authored q0, q1-refreshed entry, repeated actions, group
rotation or refresh after divergence, mixed initiators, already-BREAK lower
cards, attachments, movement, and candidate parity remain excluded.

The nineteenth source checkpoint is split across
`tests/browser/legacy-compound-lower-returned-q0-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-returned-q0-single-break-geometry.spec.ts`,
backed by
`tests/legacy-fixtures/renderer/compound-lower-returned-q0-single-v1.json`.
Forty-eight histories cross ordinary/top-BREAK composition, homogeneous prior
top/middle/base whole-stack initiation, final middle/base Alt-R selection,
local/opponent frames, and active/sole-bench slots. All use the previously
pinned q1 wrapper reconstruction inside q0→q1→q2→q3→q0 setup. The
measured `pre-single`→`post-single` transition itself performs no refresh.

The selected lower card changes q0→q1 and false→true while every sibling
retains its turn and BREAK flag. Logical indices 1/2 and reversed DOM ordinals
2/1 remain explicit. Ordinary returned wrappers start at `1%`/`0%`. BREAK
active wrappers also start and remain there; BREAK sole-bench starts at
`3%`/`2%` after a top-driven cycle but at `1%`/`0%` after a middle/base-driven
cycle. Every bench result is `3%`/`2%`. Exact authored/painted/physical
rectangles and ten probes prove the selected q1 lower wedge, with stable
wrapper/card identities across the measured action.

The setup lifecycle separately preserves the q1 synchronous two-wrapper state,
settled replacement, card-node reuse, observer ownership, and cleanup. Source
digests pin keyboard/click ingress without executing application or network
state. Refresh-free four-turn cycles, mixed initiators within a cycle, repeated
lower Alt-R, alternate q0 construction, refresh after return/divergence,
already-BREAK lower cards, attachments, movement, and candidate parity remain
separate. No production/domain/protocol/schema/UI path is widened.

`tests/browser/legacy-compound-lower-history-authored-q0-single-geometry.spec.ts`
adds a twentieth source checkpoint backed by
`tests/legacy-fixtures/renderer/compound-lower-history-authored-q0-single-v1.json`.
Sixteen independent histories cover ordinary/top-BREAK composition,
middle/base selection, local/opponent frames, and active/sole-bench slots. The
same selected lower card receives two setup Alt-R actions, producing
q0/false→q1/true→q0/false, before a third measured Alt-R restores q1/true.
The second action computes a tentative q2 and writes `1%`/`0%` before the
single-card fallback snaps its transform to q0 and clears BREAK.

All pre wrappers therefore have `1%`/`0%`. Active retains those margins;
bench post-state writes `3%`/`2%`. Exact pre/post geometry and ten native hit
probes equal the same-role lower-initiated returned-q0 dependency, while the
complete operation trace and no-refresh lifecycle differ. Only the two
construction refreshes exist, measured wrapper/card identity is stable, and
three source-shaped observer pairs are retained until harness cleanup. Logical
indices middle=1/base=2 remain distinct from DOM ordinals 2/1, and top-BREAK
composition retains the top flag while reassigning the selected lower flag.

This visual/state collision is source-only evidence against deriving legacy
layout from projected state. Intermediate setup-q1 geometry, alternating lower
targets, fourth/later repeats, interleaved group rotation or refresh, imported
states, already-BREAK lower inputs, attachments, movement, candidate parity,
and application/network execution remain excluded. No production/domain/
protocol/schema/UI path changes.

The twenty-first source checkpoint is split across
`tests/browser/legacy-compound-lower-nonzero-group-single-followup-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-group-single-followup-break-geometry.spec.ts`,
backed by
`tests/legacy-fixtures/renderer/compound-lower-nonzero-group-single-followup-v1.json`.
Forty-eight histories cover ordinary/top-BREAK composition, group q1/q2/q3,
middle/base selection, both physical frames, and active/sole-bench placement.
Each first reproduces a clean nonzero-group lower Alt-R, then captures that
divergent q0/false result as `pre-single` before immediately applying Alt-R to
the same selected card.

Every pre-state is required to equal the matching post-state in
`compound-lower-nonzero-group-single-v1.json`, including turns, flags, margins,
stack/card rectangles, and ten hit probes. The measured action changes only the
selected lower card q0/false→q1/true. Ordinary top remains q1/q2/q3; BREAK top
remains flagged at q2/q3/q0, and the other lower card retains q1/q2/q3. Active
margins remain `1%`/`0%`. Bench q1/q3 moves from `1%`/`0%` to `3%`/`2%` with
the pinned fractional wrapper-anchor shift; bench q2 stays `3%`/`2%` without a
wrapper-anchor shift.

The complete operation trace retains the earlier nonzero-group snap and appends
one q0→q1, false→true selected-card action. There is no refresh after
construction, wrapper/card IDs remain stable, and three source-shaped observer
pairs persist through the measured transition and harness cleanup. Every q2
active phase has the same geometry and hit evidence as the corresponding
history-authored-q0 case, and its BREAK flags also coincide, despite different
sibling turns and full setup traces. Q2 bench differs only at the pre wrapper
anchor and converges after the action. q1/q3 remain geometrically distinct.
Different follow-up targets, third/later singles,
lower-initiated or refreshed nonzero
groups, intervening group rotation/refresh/movement, imported q0, attachments,
candidate parity, and application/network execution remain excluded. No
production/domain/protocol/schema/UI path is widened.

The twenty-second source checkpoint is split across
`tests/browser/legacy-compound-lower-nonzero-group-rotation-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-group-rotation-after-single-break-geometry.spec.ts`,
backed by
`tests/legacy-fixtures/renderer/compound-lower-nonzero-group-rotation-after-single-v1.json`.
Forty-eight independent histories reproduce the checkpoint-eighteen lower-card
q1/q2/q3 divergence, snapshot it as `pre-group-rotation`, then measure exactly
one top/index-zero `single=false` group action. Ordinary/top-BREAK composition,
prior middle/base selection, local/opponent frames, and active/sole-bench slots
are exhaustive.

The action advances every Pokémon one quarter-turn and preserves every BREAK
flag. Ordinary post turns are `{top,other}=N+1` and `selected=q1`, all false;
top-BREAK post turns are `top=(N+2) mod 4`, `other=(N+1) mod 4`, `selected=q1`,
with only top true. Ordinary `{top,other}` is likewise `(N+1) mod 4`. The
selected lower card's q1/non-BREAK result is the defining defect
evidence. Active remains `1%`/`0%`. Ordinary bench retains q1=`1%`/`0%`,
q2=`3%`/`2%`, q3=`1%`/`0%`; BREAK bench rewrites those post values to
`3%`/`2%`, `1%`/`0%`, and `3%`/`2%`, respectively. Each changed anchor shifts
exactly `0.015625px` frame-local x and mirrors physically for the opponent.

Every pre payload equals the matching checkpoint-eighteen post payload. New q1
and q2 post turns match checkpoint twenty-one q2 and q3 respectively; new q3
post turns match the history-authored-q0 post. Frozen geometry is exact for all
active cases and the bench cases sharing margins, while translated cases retain
the same shape. The reference lower card is BREAK=true but this group-rotated
card is false, and full traces differ, so tests positively assert those state
distinctions rather than inferring history from rectangles. All ten probes,
topology, identities, three observer pairs, no measured-transition refresh,
cleanup, and the three direct recursive fixture dependencies are pinned. The
two construction refreshes remain in the inherited setup trace.

Lower-initiated or repeated group rotation, another single before R,
intervening refresh/movement/replay/import, already-BREAK lower cards, markers,
attachments/non-Pokémon cards, extra bench siblings, alternate layout/assets,
candidate parity, and application/network execution remain excluded. No
production/domain/protocol/schema/UI path is widened.

The twenty-third source checkpoint is split across
`tests/browser/legacy-compound-lower-nonzero-group-refresh-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-group-refresh-after-single-break-geometry.spec.ts`,
backed by
`tests/legacy-fixtures/renderer/compound-lower-nonzero-group-refresh-after-single-v1.json`.
Its forty-eight independent histories use the exact checkpoint-eighteen
post-single payload as `pre-refresh`, call the transcribed wrapper-reconstruction
path immediately, snapshot the replacement in the same task, and snapshot it
again after two animation frames.

Ordinary q1/q2/q3 converges to homogeneous q1/q2/q3. Top-BREAK q1/q2 converges
to top q2/q3 with both lowers q1/q2 and only the top flag retained. Top-BREAK
q3 instead computes `(raw q0 - 90deg) / 90deg = -1`; no replay iteration runs,
so both prior middle/base divergences collapse to top q1/BREAK plus lower q0.
Middle- and base-divergent histories therefore share post state and geometry
while their pre payloads and complete traces remain distinct.

Synchronous evidence has two wrappers with the empty old wrapper still
connected. Settled evidence has one wrapper after flex recentering; rotations,
flags, links, ordering, dimensions, and margins do not otherwise change. The
new fixture pins all ten probes, physical mirroring, same card-node identity,
new wrapper identity, four source-shaped observer pairs, cleanup, exact replay
traces, and digest-closed collision dependencies. The same-task snapshot is a
diagnostic and is not claimed as a painted user-visible frame. Real KeyR image
reload/cache/network behavior, later rotation or movement, extra siblings or
attachments, candidate parity, and production/domain/protocol/schema/UI paths
remain excluded.

The twenty-fourth source checkpoint is split across
`tests/browser/legacy-compound-lower-nonzero-same-lower-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-same-lower-group-after-single-break-geometry.spec.ts`,
backed by
`tests/legacy-fixtures/renderer/compound-lower-nonzero-same-lower-group-after-single-v1.json`.
It rebuilds the same forty-eight checkpoint-eighteen divergent histories, then
uses the same middle/base lower card as the immediate whole-group initiator.
The measured action is logical index 1/2, DOM ordinal 2/1, and `single=false`.
It moves the selected q0 lower to q1 and advances both siblings, but preserves
every BREAK flag.

Every post turn/flag vector equals the matching checkpoint-twenty-two top-
initiated result. Active geometry also equals it exactly. The lower initiator's
q0→q1 angle forces all bench margins to `3%`/`2%`, however, so ordinary q1/q3
and top-BREAK q2 are exactly `-0.015625px` frame-local x from the corresponding
top-initiated geometry; the other bench cases coincide. Local physical x uses
the same signed delta and opponent physical x mirrors it. The fixture freezes
exact predecessor inheritance, lower-card action identity/index, margins,
authored and painted rectangles, both physical mappings, ten native hit probes,
stable wrapper/card IDs, three observer pairs, cleanup, and no refresh across
the measured transition. Different-lower or repeated group actions, any
intervening operation, alternate q0 origins, attachments, candidate parity,
and production/domain/protocol/schema/UI paths remain excluded.

The twenty-fifth source checkpoint is split across
`tests/browser/legacy-compound-lower-nonzero-different-lower-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-different-lower-group-after-single-break-geometry.spec.ts`,
backed by
`tests/legacy-fixtures/renderer/compound-lower-nonzero-different-lower-group-after-single-v1.json`.
It rebuilds the same forty-eight checkpoint-eighteen divergent histories but
uses the other lower card as the immediate whole-group initiator. Prior-middle
histories select base at logical index 2 / DOM ordinal 1; prior-base histories
select middle at logical index 1 / DOM ordinal 2. The q1/q2/q3 initiator
advances to q2/q3/q0, advances both siblings, and preserves all BREAK flags.

The other lower's original angle leaves every bench margin unchanged across
the action: q1/q3 remain `1%`/`0%`, q2 remains `3%`/`2%`. Post turns and flags
equal both checkpoint twenty-two and twenty-four. Ordinary post geometry is
exactly checkpoint twenty-two; top-BREAK bench x has signed frame-local deltas
`+0.015625px`, `-0.015625px`, and `+0.015625px` for q1/q2/q3. Against
checkpoint twenty-four, q1/q3 bench x is `+0.015625px` and q2 is exact. Every
active case is exact. The fixture independently pins both collision tables,
predecessor inheritance, cross-role action metadata, traces, authored/painted
rectangles, physical-frame mappings, ten native probes, stable wrapper/card
IDs, three observer pairs, cleanup, and no refresh. Repeats, intervening
operations, alternate origins, attachments, candidate parity, and production/
domain/protocol/schema/UI paths remain excluded.

The twenty-sixth source checkpoint is split across
`tests/browser/legacy-compound-lower-nonzero-same-lower-second-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-same-lower-second-group-after-single-break-geometry.spec.ts`,
backed by
`tests/legacy-fixtures/renderer/compound-lower-nonzero-same-lower-second-group-after-single-v1.json`.
It reconstructs each checkpoint-twenty-four post-state independently, then
immediately repeats the same lower card's whole-group action. The selected
middle/base remains logical index 1/2 and DOM ordinal 2/1. Its q1→q2
`single=false` transition advances every raw turn once and changes no BREAK
flag, leaving only the top flagged in top-BREAK composition.

Every active wrapper remains `1%`/`0%`. Every sole-bench wrapper begins at
checkpoint twenty-four's `3%`/`2%` and is rewritten to `1%`/`0%`, so its
frame-local x and all authored card x coordinates move exactly
`+0.015625px`. Painted rectangles are captured independently because all card
parities flip. Q1 and q3 post geometry and all ten probe tuples collide with
each other despite raw turns differing by 180 degrees. Ordinary q2 post
geometry/probes collide exactly with checkpoint eighteen's matching pre-single
phase; top-BREAK q2 active also collides, while its bench carries the explicit
`+0.015625px` displacement. The fixture pins exact checkpoint-twenty-four
inheritance, these bounded collisions, traces, actions, authored/painted
rectangles, physical-frame mappings, stable wrapper/card IDs, three observer
pairs, cleanup, and no refresh. Third/later group turns, top/different-lower
followups, intervening operations, alternate origins, attachments, candidate
parity, and production/domain/protocol/schema/UI/UX paths remain excluded.

The twenty-seventh source checkpoint is split across
`tests/browser/legacy-compound-lower-nonzero-different-lower-second-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-different-lower-second-group-after-single-break-geometry.spec.ts`,
backed by
`tests/legacy-fixtures/renderer/compound-lower-nonzero-different-lower-second-group-after-single-v1.json`.
It independently reconstructs every checkpoint-twenty-five post-state, then
repeats whole-group rotation on that same other lower card. Prior-middle
histories measure base at logical index 2 / DOM ordinal 1; prior-base histories
measure middle at logical index 1 / DOM ordinal 2. The selected q2/q3/q0 turn
advances to q3/q0/q1, both siblings advance once, and no BREAK flag changes.

Active stays `1%`/`0%`. Sole-bench q1/q3 changes `1%`/`0%`→`3%`/`2%` for a
`-0.015625px` wrapper/authored x displacement; q2 changes in the reverse
direction for `+0.015625px`. Painted rectangles and all ten probes are fresh
because every parity flips. Post turns and flags equal checkpoint twenty-six;
active geometry and bench q2 collide exactly, while bench q1/q3 carries the
explicit `-0.015625px` displacement. Q1/q3 also collide internally despite
raw turns differing by 180 degrees, and q2 retains its explicit checkpoint-
eighteen reference. The fixture pins exact checkpoint-twenty-five inheritance,
these bounded collisions, cross-role action selection, traces, authored/
painted rectangles, physical-frame mappings, stable IDs, three observer pairs,
cleanup, and no refresh. Different second initiators, third/later actions,
intervening operations, alternate origins, attachments, candidate parity, and
production/domain/protocol/schema/UI/UX paths remain excluded.

The twenty-eighth source checkpoint is split across
`tests/browser/legacy-compound-lower-nonzero-top-second-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-top-second-group-after-single-break-geometry.spec.ts`,
backed by
`tests/legacy-fixtures/renderer/compound-lower-nonzero-top-second-group-after-single-v1.json`.
It independently reconstructs every checkpoint-twenty-two post-state, then
immediately repeats whole-group rotation on the same top logical index 0 / DOM
ordinal 0 initiator. All three turns advance once and every BREAK flag remains
unchanged, including top's true→true transition in top-BREAK histories.

Active stays `1%`/`0%`. Ordinary sole-bench q1/q3 changes compact→spread for a
`-0.015625px` wrapper/authored x displacement and q2 changes spread→compact for
`+0.015625px`; top-BREAK takes the inverse branches and signed deltas. Painted
rectangles and all ten probes are fresh because every parity flips. Post turns
and flags equal checkpoint twenty-seven. Ordinary geometry is exact; top-BREAK
active geometry is exact, while bench q1/q2/q3 differs by `+0.015625px`,
`-0.015625px`, and `+0.015625px`. Q1/q3 also collide internally despite raw
turns differing by 180 degrees, and q2 exactly retains checkpoint eighteen's
pre-divergence geometry. The fixture pins checkpoint-twenty-two inheritance,
these bounded collisions, top action selection, traces, authored/painted
rectangles, physical mappings, stable IDs, three observer pairs, cleanup, and
no refresh. Lower/different initiators, third/later actions, intervening
operations, alternate origins, attachments, candidate parity, and production/
domain/protocol/schema/UI/UX paths remain excluded.

The twenty-ninth source checkpoint is split across
`tests/browser/legacy-compound-lower-nonzero-top-then-prior-lower-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-top-then-prior-lower-group-after-single-break-geometry.spec.ts`,
backed by
`tests/legacy-fixtures/renderer/compound-lower-nonzero-top-then-prior-lower-group-after-single-v1.json`.
It reconstructs checkpoint twenty-two exactly, then measures a second whole-
group action by the prior divergent middle/base at logical index 1/2 and DOM
ordinal 2/1. That lower is always q1/non-BREAK, advances q1→q2, advances both
siblings once, and changes no BREAK flag.

All post wrappers are compact `1%`/`0%`. Ordinary bench q2 and top-BREAK bench
q1/q3 move `+0.015625px` frame-local wrapper/authored x; the complementary
histories do not move. Painted rectangles and all ten probes are freshly
captured across the parity flip. Every post turn, flag, margin, geometry, and
probe tuple equals checkpoint twenty-six despite the distinct first initiator
and trace. Checkpoint twenty-eight provides the bounded alternate-initiator
comparison, while q1/q3 collide internally despite turns differing by 180
degrees. Exact checkpoint-twenty-two inheritance, actions, traces, physical
mappings, stable IDs, three observer pairs, cleanup, no refresh, and recursive
provenance are pinned. Top/other-lower second initiators, later/intervening
actions, alternate origins, attachments, candidate parity, and production/
domain/protocol/schema/UI/UX paths remain excluded.

The thirtieth source checkpoint is split across
`tests/browser/legacy-compound-lower-nonzero-top-then-other-lower-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-top-then-other-lower-group-after-single-break-geometry.spec.ts`,
backed by
`tests/legacy-fixtures/renderer/compound-lower-nonzero-top-then-other-lower-group-after-single-v1.json`.
It reconstructs checkpoint twenty-two exactly, then measures a second whole-
group action by the lower sibling other than the prior divergent card. Prior-
middle histories select base at logical index 2 / DOM ordinal 1; prior-base
histories select middle at logical index 1 / DOM ordinal 2. The selected card is
non-BREAK and advances q2→q3, q3→q0, or q0→q1; every sibling advances once and
all BREAK flags persist.

Active stays compact. Ordinary bench q1/q3 changes compact→spread by
`-0.015625px` frame-local wrapper/authored x and q2 changes spread→compact by
`+0.015625px`; top-BREAK margins are unchanged. Fresh painted rectangles and ten
probes cover every parity flip. Every post turn, flag, margin, geometry, and
probe tuple equals checkpoint twenty-seven. Against checkpoint twenty-nine,
active and q2 are exact while bench q1/q3 is translated `-0.015625px`; q1/q3
also collide internally despite raw turns differing by 180 degrees. Exact
checkpoint-twenty-two inheritance, cross-role actions, traces, physical
mappings, stable IDs, three observer pairs, cleanup, no refresh, and recursive
provenance are pinned. Top/prior-lower second initiators, later/intervening
actions, alternate origins, attachments, candidate parity, and production/
domain/protocol/schema/UI/UX paths remain excluded.

The thirty-first source checkpoint is split across
`tests/browser/legacy-compound-lower-nonzero-top-third-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-top-third-group-after-single-break-geometry.spec.ts`,
backed by
`tests/legacy-fixtures/renderer/compound-lower-nonzero-top-third-group-after-single-v1.json`.
It reconstructs checkpoint twenty-eight exactly, then measures an immediate
third whole-group action by the same top at logical/DOM index zero. All three raw
turns advance once and all BREAK flags persist, including top's true→true
top-BREAK transition.

Active stays compact. Ordinary bench q1/q3 changes spread→compact by
`+0.015625px` frame-local wrapper/authored x and q2 changes compact→spread by
`-0.015625px`; top-BREAK takes the inverse branches. Painted rectangles and all
ten probes are captured fresh because every parity flips. Every post margin,
geometry, and probe tuple and every BREAK vector equals checkpoint twenty-two,
while each raw turn differs by exactly two modulo four. Q1/q3 also collide
internally despite 180-degree raw-turn differences. Exact checkpoint-twenty-
eight inheritance, action/trace evidence, physical mappings, stable IDs, three
observer pairs, cleanup, no refresh, source fulfillment, and recursive
provenance are pinned. Fourth/later or lower-initiated measured actions,
intervening operations, alternate origins, attachments, candidate parity, and
production/domain/protocol/schema/UI/UX paths remain excluded.

The thirty-second source checkpoint is split across
`tests/browser/legacy-compound-lower-nonzero-same-lower-third-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-same-lower-third-group-after-single-break-geometry.spec.ts`,
backed by
`tests/legacy-fixtures/renderer/compound-lower-nonzero-same-lower-third-group-after-single-v1.json`.
It reconstructs checkpoint twenty-six exactly, then measures an immediate third
whole-group action by the same divergent middle/base card at logical index 1/2
and DOM ordinal 2/1. The selected lower advances q2→q3, both siblings advance
once, and every BREAK flag persists.

Active remains compact. Every bench changes compact→spread by `-0.015625px`
frame-local wrapper/authored x. Painted rectangles and all ten probes are
captured fresh across the parity flip. Every post margin, geometry, probe tuple,
and BREAK vector equals checkpoint twenty-four while each raw turn differs by
two modulo four. Post turns and flags also equal checkpoint thirty-one, but
ordinary q1/q3 and top-BREAK q2 bench geometry differs, preserving the bounded
initiator-history distinction. Q1/q3 collide internally despite 180-degree raw-
turn differences. Exact checkpoint-twenty-six inheritance, lower action/trace
evidence, physical mappings, stable IDs, three observer pairs, cleanup, no
refresh, source fulfillment, and recursive provenance are pinned. Fourth/later,
top/different-lower, intervening, alternate-origin, attachment, candidate-parity,
and production/domain/protocol/schema/UI/UX paths remain excluded.

The thirty-third source checkpoint is split across
`tests/browser/legacy-compound-lower-nonzero-different-lower-third-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-different-lower-third-group-after-single-break-geometry.spec.ts`,
backed by
`tests/legacy-fixtures/renderer/compound-lower-nonzero-different-lower-third-group-after-single-v1.json`.
It reconstructs checkpoint twenty-seven exactly, then measures an immediate
third whole-group action by the same other lower card at logical index 2/1 and
DOM ordinal 1/2. The selected lower advances q3→q0, q0→q1, or q1→q2, both
siblings advance once, and every BREAK flag persists.

Active remains compact. Bench q1/q3 changes spread→compact by `+0.015625px`
frame-local wrapper/authored x; q2 changes compact→spread by `-0.015625px`.
Painted rectangles and all ten probes are captured fresh across every parity
flip. Every post margin, geometry, probe tuple, and BREAK vector equals
checkpoint twenty-five while each raw turn differs by two modulo four. Post
turns and flags also equal checkpoint thirty-two; active and q2 geometry is
exact, while q1/q3 bench geometry carries a `+0.015625px` initiator-history
difference. Q1/q3 collide internally despite different raw turns. Exact
checkpoint-twenty-seven inheritance, lower action/trace evidence, physical
mappings, stable IDs, three observer pairs, cleanup, no refresh, source
fulfillment, and recursive provenance are pinned. Fourth/later, top/prior-
lower, intervening, alternate-origin, attachment, candidate-parity, and
production/domain/protocol/schema/UI/UX paths remain excluded.

The thirty-fourth source checkpoint is split across
`tests/browser/legacy-compound-lower-nonzero-top-fourth-group-after-single-ordinary-geometry.spec.ts`
and
`tests/browser/legacy-compound-lower-nonzero-top-fourth-group-after-single-break-geometry.spec.ts`,
backed by
`tests/legacy-fixtures/renderer/compound-lower-nonzero-top-fourth-group-after-single-v1.json`.
It reconstructs checkpoint thirty-one exactly, then measures an immediate
fourth whole-group action by the same top at logical/DOM index zero. All three
raw turns advance once and every BREAK flag persists, including top's true→true
top-BREAK transition.

Active remains compact. Ordinary bench q1/q3 changes compact→spread by
`-0.015625px` frame-local wrapper/authored x and q2 changes spread→compact by
`+0.015625px`; top-BREAK takes the inverse branches. Painted rectangles and all
ten probes are captured fresh across every parity flip. Every post margin,
geometry, and probe tuple equals checkpoint twenty-eight while each raw turn
differs by two modulo four. Post turns and flags equal checkpoint eighteen;
top-BREAK bench geometry also equals it, while ordinary q1/q3 and q2 retain the
bounded `-0.015625px`/`+0.015625px` initiator-history displacement. Q1/q3
collide internally despite different raw turns. Exact checkpoint-thirty-one
inheritance, top action/trace evidence, physical mappings, stable IDs, three
observer pairs, cleanup, no refresh, source fulfillment, and recursive
provenance are pinned. Later/lower-initiated, intervening, alternate-origin,
attachment, candidate-parity, and production/domain/protocol/schema/UI/UX paths
remain excluded.

These are characterization checkpoints, not a blanket parity pass. The earlier
region checkpoint feeds every renderer-relevant derived region field into the
renderer-neutral scene and has structured scene assertions for all four board
oracle fixtures, including asymmetric resize, flipped ownership, midpoint
shared placement, compact and fullscreen states. The controlled hand/bench/
attachment-stack fixture remains source-only; the narrower contained-card,
ordinary-evolution, single-Energy, Trainer-as-Tool, and stable two-Energy
fixtures feed and compare their strict production geometries. The compound
group/BREAK, BREAK q0/q2/q3 refresh, top- and lower-selected nonzero-group
Alt-R, its same-card follow-up, and immediate top-, same-lower-, different-
lower-, repeated-same-lower-, repeated-same-other-lower-, repeated-top-, third-
top-, fourth-top-, third-same-lower-, third-other-lower-, or top-then-prior/other-lower-group rotation after
divergence or wrapper refresh after divergence,
lower-initiated group, and pristine/returned/history-authored-q0
lower single histories remain wholly source-only. The
bench-marker rotation history remains source-only while its strict pristine-q0 phase also
feeds and compares the production geometry. The two-Energy
departure phases remain source-only and prove stable convergence to the
single-Energy source state. The mixed fixtures retain their historical and
transient phases as source-only diagnostics, while their canonical settled
active/sole-bench shapes feed the narrow strict production branch. Raw
normalized/authored inputs, box edges, affordances,
and semantic z evidence remain in the richer characterization snapshot rather
than being duplicated in
`BoardScene`. Real-browser measurements for additional layout states,
candidate-renderer card/stack parity, remaining card modes, screenshots, and
interaction surfaces remain in the gate below.

## Required real-browser acceptance gate

Before either DOM or Pixi may replace the v1 board, a Playwright/Chromium
capture must independently measure the legacy source and both candidate
renderers at the fixture viewports. Zone/card anchor positions must be within 2
CSS px, card width/height within 1%, and rotations within 0.1 degrees, matching
the verification plan. Frame, shared-surface, handle, and non-card stack edges
are compared as anchors under the 2 CSS px threshold; stack-card dimensions use
the 1% card threshold. Fixed screenshots may supplement the structured
measurements for paint-only evidence, but are not a substitute for numeric
bounds.

That browser suite must cover at least:

- normal, fullscreen, flipped, double-flipped, asymmetric resize, both handler
  directions, edge clamps, expanded handles, and collision thresholds;
- source-intrinsic and nonstandard card aspect ratios, active/bench overflow,
  flex shrink, BREAK/Rotation margins, attachment-expanded stacks, prizes, and
  scroll clipping;
- pointer target edges, overlap and equal-z paint order, selection, drag,
  pointer capture, context menu, double-click/expanded stack, zone drop, and
  marker editing;
- popup/menu/preview/zone-browser/marker anchors and cross-iframe or DOM-overlay
  stacking;
- stadium card readability, hand concealment, image/text counter-rotation, and
  chrome/handler changes through flip; and
- DPR/subpixel quantization, integer `offsetHeight`, viewport resize, and the
  supported Chromium/Firefox/Safari matrix.

Until that gate is green, browser-dependent packing, menus, markers, hit edges,
scrollbars, text, images, and paint-order behavior remain decision debt.
