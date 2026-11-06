# ADR-046: The far half mirrored, and a quieter mat

- Status: **ACCEPTED** (2026-11-06, the owner: "by default, actually, i
  think i want the opponent's side of the board to be mirrored - in other
  words, the decks are both on the right side from the player's POV, the
  prize cards are both on the left side, etc. and then in settings there's
  the option to not mirror the board (which would make it look like what it
  does right now)").
- Decision date: 2026-11-06
- Amends: ADR-027 (the table's geometry), ADR-039 (the pieces beside the
  prizes, the Stadium on the near left), ADR-030 (the turn banner).
- Parity: PX-094 (the far half mirrored), PX-095 (outlines on empty zones
  only).

## Context

Since the table was first laid out (ADR-027), the far half has been the
near half turned round the table's centre, as two players sitting across a
real table see it, and as v1 draws it: the opponent's deck on the viewer's
left, their prizes on the right, their Bench in the other order. Reading
the board means reading the two halves two ways. The owner asked for the
far half to read as the near one does, with the turned table kept as a
choice.

The same day the owner asked for four smaller changes to the mat: the `+`
that adds the optional pieces looked "really random" where it sat; the
zones' outlines draw a line round every spot, cards or not; the prize
cards stood too far apart ("reduce the spacing between the prize cards by
about 50%"); and the turn banner crossed the window's middle rather than
the board's ("a little bit lower than i'd like").

## Decision

### 1. The far half is the near half reflected across the centre line

- **On by default.** Settings › Table › View has the switch "Mirror
  opponent's side" (`#mirrorOpponentCheckbox`; the palette's
  `table.mirrorOpponentSide`), kept on this device with the board view
  (`BoardViewSettings.mirrorOpponentSide`, `ptcgsim.board-view.v1`). Off,
  the table is exactly as it was: the far half turned.
- **What it means.** `BoardLayoutState.mirroredFarSide` lays the far half
  out as the near one and reflects it across the centre line instead of
  turning it (`toPhysical`): its prizes on the left, its pieces (markers,
  coin) beside them, then the felt where the Stadium lies, its Active in
  the middle, its staging area right of the Active, its deck and discard
  down the right. Its Bench, hand, staging row and prize grid run left to
  right as ours do (`runsForward`, `layoutTableHand/Row/Prizes`'
  `mirrored`, the play rows' walk); its first prize is at the left by the
  centre line (our grid, the other way up). The far player's layout,
  regions and zones say `mirrored`, for whatever reads places off them
  (drops, arrangement, keyboard order).
- **Cards still face their owner.** Each far card, and each far stack as a
  whole (its evolutions and attachments peeking toward its owner's right),
  is turned half round as before; "Opponent's cards face me" still turns
  them upright. Mirroring changes where things are, not who they face: the
  table reads the same way on both halves, and each player's cards are
  still theirs.
- **Its counts and its hand's end.** A far pile's count badge sits on its
  top-right corner (the near half's right-hand corner, toward its player);
  the far hand's pill at the strip's right end, as ours. That end is the
  window's top-right corner, where the app bar sits (ADR-036), so a
  mirrored far hand keeps its end clear of the bar (`handEndReservePx`)
  where a turned one kept its start; its pill is set against the far end
  of its slot, so a wider one (Solo's cover beside the count and Sort)
  grows back over the strip's end rather than under the bar, as a turned
  one grew toward the window's edge. Its cards keep to the table's centre
  as before. The bar's corner counts the same at either end when a mat is
  judged, so both ways choose the same mat. The pile column's third slot
  (the Lost Zone's, only ever used while the Lost Zone is off the table)
  may lie under the bar; nothing shown does (probed at 26,880 layouts).
- **The Stadium** keeps ADR-039's place on the near left, straddling the
  centre line between the two halves' pieces, smaller if need be, wherever
  that has a clear place. Mirrored, both halves' pieces bound that felt,
  so where none is clear at any size it lies where the two staging areas
  meet the centre line right of the Actives instead, each making room for
  it from its Active end (`placeStadium` takes several staging areas). A
  half shown alone (Mine/Theirs) places it as the near half would.
- **Everything else follows the layout.** Drop targets, drag, arrangement,
  hints, count badges, the selection bar, the seam dock, the coin and its
  menus, the turn banner and cards moving between seats all read the
  physical rects, so they follow either way. The board flip (coaching
  view), Solo's seat swap, spectators and replays lay out whoever sits at
  the top the same way; the tutorial's practice table takes the player's
  setting; tilted and flat tables, phones upright and sideways, all use it.

### 2. The `+` for the optional pieces sits at the foot of their column

The small `+` that adds the Lost Zone and the markers sat past the pieces'
column at the top of the Active row (2026-10-29), aligned with nothing. It
now sits at the foot of the pieces' column, centred under the coin, on the
Active row's bottom line, on every mat and size (`extrasControlAtFoot`):
the markers, the coin and the `+` that adds them read as one column. The
coin keeps its room above it (`coinAbove`); where the column's foot holds
the Lost Zone, or a coin of its least size would not fit above it (a phone
held sideways with both markers shown), the `+` sits just past the column
on the same line. It keeps its 26px face and its touch area, its tooltip
and its keyboard place, and the Stadium keeps clear of it as before.

### 3. Outlines on empty zones

By default a zone shows its outline only while it is empty, and every zone
shows its own while a card is carried (they are where it can go). A zone
holding cards draws no line round them: the cards say where the zone is,
and a full table had a line round every spot. Drop-target highlights, the
names an empty spot shows under the pointer, the count badges and the `+`
affordances are unchanged. Settings › Table › View's "Always show zone
outlines" (off by default) keeps every outline, as before
(`BoardViewSettings.zoneOutlines`: `empty`, `always`, or `never` for a
player who had turned the old switch off; a stored on became `empty`).
The renderer takes it as `BoardPreferences.outlineFilledZones`.

### 4. The prizes sit closer

The gap between prize cards is half what it was, on both mats and both
halves (`PRIZE_GAP_SHARE`, and the mat's own prize gap): the six sit as a
player sets them out. The room it frees goes to the cards.

### 5. The turn banner crosses the board's centre line

The banner runs along the centre line between the halves as it is drawn
(`turnBannerCentreY`: projected on the tilted table), not the window's
middle, which lay below it (the near half is the taller); with one half
shown, across that half's middle.

### 6. Even boards, and rows that line up (2026-11-06)

The owner, of the mirrored table: the two halves should be "exactly the
same size" flat and at any tilt, so the decks, prizes, coins and markers
meet; "we should set the default split to 50/50"; the near hand "a tiny
bit bigger"; both hands' count pills "on the left side … vertically
aligned"; and the Bench "vertically aligned" with the Active.

- **The Split is the boards'.** `BoardLayoutState.boardSplit` (the
  player's Split, 50/50 by default: `TABLE_SPLIT.defaultLowerShare` is
  0.5) gives the frames wherever the hands lie
  (`tableVerticalLayoutForBoards`): tilted on a window wider than tall
  (`tableHandsOutside`), where the hands lie past the board's edges, the
  frames are the boards, so both are one size; flat or upright, the near
  frame also holds the deeper hand strip, 3 points more (0.53 at 50/50, as
  before). Dragging the seam sets the frames and drops the board split.
  Settings store only what differs from the defaults, so a player who
  never moved the Split gets 50/50; a Split they chose keeps its number,
  now the boards'. The welcome and invite cards centre above the seam
  where the frames meet (`tableSeamShare`).
- **The near hand, tilted, is 1.12 times its strip's size**: lying past
  the board's edge it takes none of the board's room.
- **Both hand pills lie on the window's left**, before their strips (a
  turned far half's strip end is the window's left anyway), set against
  the same x, one above the other; a wider pill (Solo's cover and Sort)
  grows over the strip's empty start. Each hand's strip starts past its
  pill and runs to the far edge, short of the app bar on the far half.
  A pill is drawn with its own hand on the tilted table
  (`BoardDepthProjection.countAnchor`), wherever it lies beside the strip.
- **The Bench centres under the Active** (`BoardLayoutRegion.rowCentreX`):
  its cards, not its stacks' outer margins, are centred on the Active's
  centre line while the row fits there, and held to the bench's edges
  past that.
- A mat whose shown Lost Zone would keep no pile at all is laid out
  smaller until it keeps one, as one too narrow for the Stadium is.
- The bar's Solo | Online switch puts the side in play first, on the
  left; its two sides slide past each other when it changes (a new bar,
  after the page changed, slides from the last), and fade in place under
  reduced motion (ADR-036).

## Consequences

- A turned table stays one switch away and unchanged; specs that read the
  far half's places run mirrored by default, and `mirrored-table.spec.ts`
  checks both.
- `BoardLayoutState.mirroredFarSide`, `BoardPlayerLayout.mirrored`,
  `BoardLayoutRegion.mirrored`, `ZoneSceneNode.mirrored` and
  `BoardPreferences.outlineFilledZones` join the renderer contract;
  `BoardLayoutState.boardSplit`, `BoardLayoutRegion.rowCentreX`,
  `tableHandsOutside`, `tableVerticalLayoutForBoards`, `rowStartX` and
  `BoardDepthProjection.countAnchor` with §6.
