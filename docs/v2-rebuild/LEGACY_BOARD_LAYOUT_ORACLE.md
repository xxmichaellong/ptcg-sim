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
the six covers and bottom-owner stadium against the live React DOM candidate,
including physical anchors, dimensions, rotation, one enabled/top-painted
scene node per pile, and disabled covered nodes.

This does not yet prove the legacy cover-click behavior: v1 opens the zone,
whereas the current candidate's top card still emits its ordinary card intent.
The source-measured top-owner stadium branch has structured scene tests but no
candidate-browser comparison. Opened-zone cards/markers, exact one-node cover
rendering, Pixi geometry, noncanonical or undersized assets, and rotated hit
regions remain outside this checkpoint.

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

Bench marker production, BREAK and compound evolution/group rotation,
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
before one harness-only disconnect and makes no source teardown claim. This
checkpoint remains source-only. Additional bench siblings/flex contention,
all rotated production paths, BREAK/compound and attachment rotation, marker
movement/editing, alternate layouts, and candidate/Pixi paint parity are still
deferred.

These are characterization checkpoints, not a blanket parity pass. The earlier
region checkpoint feeds every renderer-relevant derived region field into the
renderer-neutral scene and has structured scene assertions for all four board
oracle fixtures, including asymmetric resize, flipped ownership, midpoint
shared placement, compact and fullscreen states. The controlled hand/bench/
attachment-stack fixture remains source-only; the narrower contained-card,
ordinary-evolution, single-Energy, Trainer-as-Tool, and stable two-Energy
fixtures feed and compare their strict production geometries. The bench-marker
rotation fixture is source-only. The two-Energy
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
