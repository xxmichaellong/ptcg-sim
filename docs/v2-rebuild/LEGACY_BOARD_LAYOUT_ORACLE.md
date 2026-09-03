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
