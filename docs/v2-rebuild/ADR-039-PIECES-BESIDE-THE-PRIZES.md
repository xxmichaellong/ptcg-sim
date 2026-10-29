# ADR-039: one place for each piece, the same on both halves

- Status: **ACCEPTED**
- Decision date: 2026-10-24
- Scope: where the table puts the VSTAR/GX markers, the coin, the Lost Zone,
  the staging area and the Stadium, at every size
- Supersedes: ADR-036 §2's corner and row for the far markers; PX-051's coin
  on each player's right; the staging area beside the Active toward the
  prizes (ADR-030)

## Context

The owner found the markers' placement inconsistent at smaller widths: on a
desktop they lay beside the prizes, but on a narrower table they moved to
the corner by the hand, or past the app bar, or to a row below it, and the
two halves could put them in different places. They asked to keep them in
about the same place, on the board, and for the staging area (v1's loose
board) to sit on the Active's right rather than its left, with the coin on
the left, near or under the markers (2026-10-24).

A probe over 37,000 layouts (28 widths by 22 heights, mouse and touch, both
halves or one, three splits, 0 to 2 markers, the Lost Zone on or off) found
the old rules put the markers off the mat in about 25,000 of them, and the
Stadium over a staging area, an Active, the prizes, a marker or a pile in
about 14,000.

## Decision

### 1. Each half is one mat, turned around across the table

In each player's own frame, the Active's row reads, from the prizes:

1. **The pieces column**, beside the prizes: the VSTAR and GX markers the
   viewer keeps on the table, stacked (VSTAR first), and the player's coin
   under them. A marker is at least 22px tall (v1's corner markers were
   24px) where the Active's row is that tall, and as tall as the row on the
   smallest tables, whose row is shorter; a row too short to stack two lays
   them side by side. The column is as wide as the wider of the markers and
   the coin.
2. **The Lost Zone**, when it is on the table and the row has room for it
   as well as the Stadium's; otherwise it takes its place at the end of the
   piles' column. Both halves decide together, so it is in the same place
   on both. "On the table" means shown, or holding cards whatever the
   viewer's setting (since 2026-10-29: before, one holding cards with the
   setting off went to the column's end, under the discard pile).
3. **The `+`** for the optional pieces, just past them and past the Lost
   Zone's count, which stands out beyond the pile's corner: at the top of
   the row, by the centre line and level with the pieces' tops (the owner,
   2026-10-29: it sat low, by the player's edge, which felt unnatural).
   Where that would crowd the Stadium's room beside the Active, or the row
   is too short to hold it, it keeps to the row's edge toward the player.
   On the smallest tables of one player alone (320–390px tall) the
   Stadium then lies a little smaller beside it.
4. **Clear felt** for the Stadium (below).
5. **The Active**, in the middle of the table. Its slot is up to 2.2 cards
   wide and gives way to the pieces and the Stadium's room first.
6. **The staging area**, from the Active out to the piles.

On an upright phone the row holds the column at the outer edge, the `+`
(at the row's foot: the Stadium straddles the centre line just past the
pieces), the Active and the staging area; the Lost Zone keeps its place in
the pile row.

The markers never move to the hand's corner, past the app bar or to a row of
their own. The far hand keeps only the bar's corner (ADR-036).

Both halves take the same mat, the mat or the portrait mat. Where each
would choose differently on its own (a portrait tablet, whose far half is
shorter and holds a smaller hand), they take the one that leaves neither
hand cramped, then the one whose smaller half shows the larger cards, as
long as both halves lay it out with their pieces clear of their zones;
otherwise the other mat, where that is clear. Where neither is, each half
keeps its own; the probe below found no such table. The mat is chosen as
without the app bar, as the split is (ADR-036), so the bar never changes the
near half's; on the smallest tables (about 420 × 580 and smaller) the far
hand past the bar can then be narrower, down to about 85px, than the 128px
a half on its own would keep. On a portrait tablet the far half gives up
the most: its cards about a third smaller than on the mat it would take on
its own (768 × 1024: a bench card 160px tall on the mat, 108px on the
portrait mat), for the near half's portrait mat and one mat on both sides.

### 2. The Stadium on the near player's left

The Stadium straddles the seam to the left of the Actives, as the viewer
sees the table, its width × 0.35 clear of them: over the clear felt beside
the near player's pieces, and at the far player's staging area, which
starts past it where that leaves it a pile's width (otherwise it stays
whole, under the Stadium's edge). With one half alone the Stadium lies
beside that half's Active on the player's own left, in the row, level with
its centre-line edge; the board controls' band stays clear of it.

Where that place would lie on or by anything -- a zone, a piece, the app
bar, the controls' band -- it takes the nearest place clear of them, along
the row before off it; where none is, a smaller Stadium (down to 70% of a
bench card) that has one; and only then the full size's place that covers
least, a staging area before anything else.

### 3. The coin

Each player's coin lies in their pieces column, under the markers (at the
top of the column with none): a third of an Active card, up to 64px, and
at least 34px where the row has room for that; where it hasn't, the coin
fills the room under the markers, down to 24px (a touch target's least).
Both halves shown have their coin or neither does: where one has no room
for 24px, the table keeps none and the rail offers Coin instead. Its Heads
or Tails chip is centred on it but kept inside the table, where a coin by
the prizes lies nearer the edge than half the chip (an upright phone).

## Consequences

- The probe's 37,000 layouts: the markers are on the mat in every one, and
  both halves on one mat in every one with both shown (the halves' own
  choices differed in about 3,600). The Stadium touches a staging area in
  52, all on upright phones 390px wide or less with both halves shown, and
  never a hand, another zone or a piece, against about 14,000 before. The
  `+` grazes the markers on tables of about 370 × 360 and smaller. Where a
  narrow row pulls the `+` against the Active, under the pieces' edge, the
  coin ends above it and its touch area, a little smaller.
- Coins on 7,452 common layouts (27 widths by 23 heights, mouse and touch,
  0 or 2 markers, three splits): both halves have one in 6,276 and neither
  in 1,176, against 3,393 and 1,846 before, when 2,213 had a coin on one
  side only (an upright phone's far half, its Active a little shorter).
- The far half's refit around the app bar (ADR-036) keeps its staging area a
  clear card beside the Stadium; it no longer weighs where the markers go.
- `BoardPlayerExtrasLayout` gains `coin` and loses `corner` and
  `markersRow`; the scene loses `handHeldFlat`.
- The hand pill keeps off the zones it would cover, their count badges
  too (`LegacyBoardChrome`): tilted, and since 2026-10-28 flat as well,
  where a short table's piles run down beside the hand's end. Since
  2026-10-29 the layout keeps its room (`handEndFor`): the hand ends 8px +
  a 64px pill + 4px short of the screen's edge, and, where the piles'
  column reaches down beside the pill, 12px + 72px short of the column. In
  25,872 probed layouts the flat pill then covers no pile, badge or hand
  card, where before it lay over the Lost Zone 11,304 times and over a hand
  card 15,924 times; on the real table (190 sizes, mouse and touch, flat
  and tilted, both hands at 16 cards) it covers nothing, where before it
  covered a hand card at 140 sizes and the Lost Zone at up to 31. Across
  the table the pill's room past the column costs the far hand about 28px
  on short mats. The piles' badges are kept on the table too
  (`countBadgeAnchorWithin`): at the screen's edge they stood 1px off it.
- Tests: `layout-table.test.ts`, `table-coin.test.ts`, `TableCoin.test.tsx`,
  `TableZoneAffordances.test.tsx`, `LegacyBoardChrome.test.tsx`,
  `LegacyBoardChrome.onehalf.test.tsx`.
