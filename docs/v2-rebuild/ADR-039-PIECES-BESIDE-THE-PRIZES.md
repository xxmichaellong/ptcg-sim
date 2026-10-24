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
   under them. A marker is never shorter than 22px (v1's corner markers
   were 24px); a row too short to stack two lays them side by side. The
   column is as wide as the wider of the markers and the coin.
2. **The Lost Zone**, when it is on the table and the row has room for it
   as well as the Stadium's; otherwise it takes its place at the end of the
   piles' column. Both halves decide together, so it is in the same place
   on both.
3. **The `+`** for the optional pieces, just past them at the row's edge
   toward the player.
4. **Clear felt** for the Stadium (below).
5. **The Active**, in the middle of the table. Its slot is up to 2.2 cards
   wide and gives way to the pieces and the Stadium's room first.
6. **The staging area**, from the Active out to the piles.

On an upright phone the row holds the column at the outer edge, the `+`,
the Active and the staging area; the Lost Zone keeps its place in the pile
row.

The markers never move to the hand's corner, past the app bar or to a row of
their own. The far hand keeps only the bar's corner (ADR-036).

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
top of the column with none), its size as before: a third of an Active
card, 34 to 64px. A half too small for one has no coin, and the rail offers
Coin instead.

## Consequences

- The probe's 37,000 layouts: the markers are on the mat in every one; the
  Stadium touches a staging area in 56 (phones 390px wide or less, and one
  half alone on a 568 × 1180 window) and nothing else, against about 14,000
  before; on tables of about 360 × 360 the `+` can touch the markers.
- The far half's refit around the app bar (ADR-036) keeps its staging area a
  clear card beside the Stadium; it no longer weighs where the markers go.
- `BoardPlayerExtrasLayout` gains `coin` and loses `corner` and
  `markersRow`; the scene loses `handHeldFlat`.
- Tests: `layout-table.test.ts`, `table-coin.test.ts`,
  `TableZoneAffordances.test.tsx`, `LegacyBoardChrome.test.tsx`,
  `LegacyBoardChrome.onehalf.test.tsx`.
