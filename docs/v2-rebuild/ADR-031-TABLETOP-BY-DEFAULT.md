# ADR-031: a tilted tabletop by default, with cards that move like cards

- Status: **ACCEPTED**
- Decision date: 2026-10-14
- Scope: how the table is shown in depth (the board's depth view, its
  camera and its motion), for both renderers
- Builds on: ADR-027 (the redesign), ADR-030 (the table-first shell)
- Revises: the 2026-10-10 depth pass (`reviews/2026-10-10-board-depth.md`),
  which made depth optional and Flat the default

## Context

The owner asked (2026-10-13) for the table to feel like "the smoothest, most
authentic tabletop simulator ever, like you're actually playing with
cards", taking PTCGO, PTCG Live and the CABT viewer into account, with
options for tilt and depth. The 2026-10-10 pass had built Flat, Raised and
Tabletop views, but defaulted to Flat, capped the tilt at 18°, used a long
lens (two board sizes away), and in depth mode a card was stiffer than in
Flat: no hover response, a lift that stepped up at once, straight flights
and a flip that squashed the face in its own plane. A research brief
compared the references: PTCG Live is near top-down for legibility, PTCGO
a raised mat at about 40°, and the CABT viewer a gentle 8° CSS tilt.

## Decision

1. **Auto is the default view.** It shows the tabletop at 22° in a
   landscape window at least 900px wide and the flat table elsewhere (an
   upright phone). Flat, Raised and Tabletop stay one choice away in
   Settings → Table. The stored setting keeps only what differs from the
   defaults, so a player who never chose follows the default; one who chose
   Tabletop keeps it. Auto is resolved in the app; the renderers only ever
   see Flat, Raised or Tabletop.
2. **The camera** may tilt to 35°. The eye sits 1.5 window diagonals away
   (about a 37° lens). The tilted table is fitted between the two hands,
   which stay flat along the edges, with a full sixty-card deck standing on
   it, and centred between them, so the room above the mat's far edge is
   the room below its near edge (2026-10-16; it was centred in the window,
   which left the far side's band of mat and hand looking empty). The fit
   depends on the layout alone, so the table never moves when a pile grows
   or shrinks.
3. **The mat** is a cloth playmat under a lamp: a woven texture that
   foreshortens with the tilt, light falling off from just above the
   middle, a rubber rim and the mat's thickness along its near edge. The
   halves' tints and the seam are printed on it.
4. **Cards are sleeved**: 0.8% of a card's width thick, so a deck stands
   about half a card high.
5. **Picked up**, a card rises about half its width over 120ms, and its
   grip stays under the pointer at every height on the way: each painted
   frame places the held cards so the gripped point is under the pointer
   at the height painted, not only when the pointer moves. With reduced
   motion it is raised at once.
6. **Under the pointer**, a table card rises 6% of its width. A joined
   card's pieces rise, settle and are picked up together, as the one card.
7. **Carried across the table**, a card takes 320–560ms by distance and
   arcs above its path, as a hand would carry it. **Turned over** on the
   way, it turns about its long axis during the middle of the move: the old
   face turns on edge, the faces change while hidden, and the new face
   turns flat. It is never seen from behind.
8. **Shadows** are two: a dark contact shadow under a resting card that is
   gone once it lifts, and a cast shadow that slides away, spreads and
   fades as it rises. Only lifted cards' shadows are blurred. They are
   painted in the card's own plane, so for the frames a card turning over
   stands nearly on its edge, an outline that would map behind the eye or
   far off the card is left out: painted, it runs off toward infinity and
   the browser's layer, blurred, takes gigabytes.
9. **Natural placement**: resting table cards lie a touch askew (under
   0.6°, Prizes under 1.2°, and a hair off true), the same way every time.
   Piles, the hand and joined panels stay square. Settings → Table →
   Natural card placement turns it off.
10. **A shuffled pile is riffled**: it splits into two halves that lift
    apart and tip in, riffles back together while the cards pass into one
    pile between them, and squares up (900ms). Stand-ins with their own
    edges and shadows play it while the real pile is hidden; picking the
    pile up ends it at once.
11. **Markers lie on their cards**: damage counters, conditions and the
    other tokens are the projection of their own box a hair above the card,
    so they foreshorten with the table and travel with the card. In the
    hand they stay upright on screen.

Picking stays exact throughout: every painted face is one homography (a
flip included), and hit-testing inverts the painted pose.

## Consequences

- Browser specs at desktop sizes play on the tabletop unless they ask for
  the flat table (`useFlatTable` in `tests/browser/support/table-shell.ts`);
  specs that aim drags at zones' logical centres do.
- Still to come from the brief: the coin tossed on the table plane, the
  discard's top cards fanned, and a 2D fast path for the Raised view on
  phones.
