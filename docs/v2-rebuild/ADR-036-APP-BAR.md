# ADR-036: the app's controls leave the table for a corner bar

- Status: **ACCEPTED**
- Decision date: 2026-10-22
- Scope: where the app's controls (deck, play online, palette, log,
  Settings, menu) and the turn's game actions sit around the table
- Supersedes: ADR-030 §2 (the rail's ends) and §3 (the toolbar on the rail)

## Context

ADR-030 put one rail along the seam between the halves: the app toolbar at
its left end, the turn's actions in the middle, the log at its right end.
The owner found the toolbar in the middle of the board broke the table's
realism and added little there, and asked for a header or a drawer that
looks its best and works on phones and touch screens (2026-10-22).

What the research found (the review is in the session that made this):

- Digital card games show no header during a match: a gear or menu in a
  corner, and one turn button on the right edge at the centre line
  (Pokémon TCG Live, Hearthstone, Legends of Runeterra) or bottom right
  (MTG Arena, Marvel Snap).
- Hidden navigation (a drawer behind ☰) was used about half as often as
  visible navigation on desktop in NN/g's study (27% against 48%), and
  Material 3 has retired the navigation drawer. A drawer suits a phone's
  overflow, not a desktop's main controls.
- Frameworks for game UI (Fagerholt and Lorentzon) separate controls that
  are part of the play (turn, coin, undo: keep them on the table) from the
  app's own (keep them quiet, at the edges).

## Decision

### 1. One app bar in the top-right corner

The app's controls are one smoked-glass pill over the desk in the table's
top-right corner (`session/shell/AppMenu.tsx`, `AppBar`). It has three
groups, with a hairline between them:

1. The deck and where to play: **Deck**, **Play online** (from a Solo table)
   or **Solo table** (from Play online).
2. **Commands** (the palette), the **Log** (with its unread count) and
   **Settings**.
3. **Menu** (☰): the keys, full screen, saves and replays, help, leaving.

The buttons are 36px for a mouse and 44px under a finger, icons with
tooltips beneath. On a phone (the compact size: under 600px wide or under
500px tall) the bar keeps the palette, the log and the menu, and the menu
leads with the deck, where to play and Settings. The toolbar that opened
and closed along the rail, and its preference, are gone.

The log's newest lines, shown for a few seconds while it is closed, drop
below the bar at its right edge.

### 2. The table keeps the corner clear

The bar sits `APP_BAR_INSET_PX` (8px) in from the play area's top right, so a
docked log beside the table keeps its own column. The layout keeps that
corner clear (`BoardLayoutState.appBarPx`, the most buttons the bar shows
here):

- the far hand strip ends a gap short of the bar and is at least as deep
  as the bar's corner, so on a short screen nothing else lies under it;
- the far player's VSTAR/GX markers, where they have no room beside the
  Prize cards, get a corner of their own past the bar (`extras.corner`),
  and the far hand starts after it; where that would leave the hand less
  than 128px (an upright phone), they take a row below the bar instead,
  unless the row would leave the far board under 12px of card. Mat or
  portrait is chosen as if the half had no markers, so where they go never
  swaps the two as the window grows;
- a tilted far hand draws its cards in as they grow, so its outer card
  ends where the strip does;
- a half that fills the table keeps its top clear of the bar;
- the far hand strip never grows so deep that the far board keeps no rows
  (under 12px of Active card): on the smallest tables the bar's corner
  gives way first, and a markers' row only goes where it fits wholly below
  the bar; a tilted table keeps a hand with a markers' row on its strip.

The table's split is found as without the bar, and the far half laid out
with it at that scale, so the near half is unchanged by it; nothing on the
table is under the bar at any size it fits in (layout-table and
board-depth tests, app-bar.spec). Where the bar changes the far half so
that the Stadium lies over more of it than it would without the bar (a
cramped hand taking the mat, its cards bigger; a markers' row pushing its
rows toward the seam), the far half alone is fitted shorter until it
doesn't, its portrait mat too, the near half kept as it was.

### 3. The turn's actions stay on the table, at the seam's right end

The seam rail (`board/rail/TableRail.tsx`) holds only the turn's actions.
They sit at the seam's right end, past the Stadium and short of the near
piles there (their stacks rise toward the seam), where a right hand and the
player's own piles are and where the genre puts its turn button. Where
fewer than four buttons fit there (an upright phone, whose Stadium sits at
the right edge) they sit before the Stadium instead. Tilted, the Stadium and
piles are found on screen through the table's projection.

### 4. Every zone's hover name is centred

A zone's name (shown faintly on an empty spot under a mouse) sits in the
middle of the spot, piles included. Only an empty deck showing the `+` that
loads one moves its name under the `+` (the board marks such decks:
`data-load-deck-sides`).

## Consequences

- `BoardRailModel` and the chrome take one `bar` instead of `start`/`end`;
  `useRailWidth` and `ptcgsim.shell.v1`'s `toolbarCollapsed` are gone.
- Specs reach the bar through `tests/browser/support/table-shell.ts`
  (`chooseMenuItem` presses a bar button or opens ☰). `#appMoreButton` is
  gone; `#appMenuButton` opens the menu.
- The control ids are kept: `#deckImportButton`, `#p2Button`, `#p1Button`,
  `#commandsButton`, `#activityButton`, `#settingsButton`,
  `#shortcutsButton` (now in the menu), `#boardButtonContainer` and the
  turn's actions.
