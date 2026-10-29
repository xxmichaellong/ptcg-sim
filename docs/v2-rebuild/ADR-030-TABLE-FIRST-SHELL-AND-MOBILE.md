# ADR-030: the table fills the screen; everything else opens over it

- Status: **ACCEPTED**
- Decision date: 2026-10-14
- Scope: the v2 client's shell -- where every control lives, how it is
  reached, and how the product works on phones and touch screens
- Builds on: ADR-027 (the redesign), ADR-028 (preferences and shortcuts)
- Supersedes: ADR-023 (desktop browsers at a 1280×720 minimum)
- Superseded in part: §2's rail ends and §3's toolbar by ADR-036 (the app
  bar in the top-right corner, 2026-10-22)

## Context

The redesigned table still sat beside v1's permanent right sidebar: four
tabs (Solo, Multiplayer, Deck, Settings), a welcome card, the activity log
and chat, announcement buttons, a chat field and five lifecycle buttons.
The sidebar took a quarter to a third of a desktop window and most of a
phone's, while play happens on the table. On the table itself a toolbar mixed
game actions (Turn, Coin) with view and system controls (flip, refresh
images, full screen, board view). Settings collected whatever had no other
home. On a phone the page was unusable, and a notice said to use a desktop.

The owner asked (2026-10-13) for the space to go to the table; for controls
to move into menus, sheets and icons on the board; for the buttons on the
board to be about the game; for Settings to make sense; for an empty deck to
offer a deck; for the Lost Zone to be optional; and for the whole product to
work on phones and touch screens.

## Decision

### 1. The table fills the window

The board is laid out full-window on every device (the layout's `fullscreen`
shell). Nothing is docked beside it by default. The one exception is the
player's own choice: the activity log, opened on a wide screen, docks at the
right and the table lays itself out beside it (§4).

The table appears once. The page opens on a loading screen painted by
`index.html` itself (`#tableCurtain`: the desk, and after a moment a spinner
and "Setting up the table…"); it stays while the lobby, the board renderer
and the Solo room load and connect, and fades away once the room's table has
painted (`session/shell/table-curtain.ts`). The empty table the lobby shows
while that room is made is never seen on the way to it, so the board no
longer appears, vanishes and comes back. Trading one table for another later
(joining or leaving a room, Play online parking a Solo game) draws the same
screen over the old table first and lifts it from the new one, so no frame
shows a bare desk. It is only paint, never input, and follows the motion
settings: under reduced motion it lifts at once, and tables are traded
without it.

### 2. One rail, along the seam

_Since ADR-036 the rail holds only the turn's actions, at the seam's right
end; the app's controls and the log are in the app bar in the top-right
corner. The rest of this section describes the rail as it was._

Geometry v2 keeps a clear band at the centre line between the halves; the
**table rail** lives there (`board/rail/TableRail.tsx`, painted by
`LegacyBoardChrome` from the layout's `boardControlsAnchor`, following the
seam when the table is tilted). Its left end holds the **app toolbar**, its
right end the **activity log**, and between them only the turn's **game
actions**, stopping short of the Stadium, which straddles the seam:

| Seat stage (`board/seat-stage.ts`) | Rail actions                             |
| ---------------------------------- | ---------------------------------------- |
| No cards yet                       | **Load a deck** (primary), Coin, Flip    |
| A deck not yet set up              | **Set up** (primary), Coin, Undo, Flip   |
| Playing                            | Turn, Attack, Pass, Coin, Undo, Flip     |
| Replay                             | Restart, Back, **Next**, End, Flip, Exit |

The rarer actions sit behind **More**: Set up again, Announce mulligan,
Reset, and in Solo Set up both sides / Reset both sides. (Changing the deck
is the toolbar's Deck.) Spectators see only Flip. The actions are icons, 40px
for a mouse and 44px under a finger; each keeps its full name for its tooltip
and for assistive tech, with the key that does the same. The board owns
Turn, Coin (which waits on the room's answer), Flip and Mulligan; the
route orders them among its own (`BoardRailModel.compose`). v1's control ids
are kept where they still name the same control (`#setupButton`,
`#p2AttackButton`, `#turnButton`, `#flipCoinButton`, `#flipBoardButton`).

### 3. The app toolbar

_Superseded by ADR-036: the toolbar is now the app bar in the top-right
corner, always open, with the keys and the rest in its menu._

A toolbar at the rail's left end (`session/shell/AppMenu.tsx`), one
segmented group. Its first button (☰) opens it along the rail and closes it
back into itself, animating its width so the game actions move with it; the
choice is kept in `ptcgsim.shell.v1`, open by default. Open, it shows
**Deck** (the acting seat's), **Play online** (Solo table, from the lobby),
**Keyboard shortcuts** (not on a touch-only screen) and **Settings**, then
**More** (⋯) for the rest, headed by where you are ("Solo table", "Room
ABC123", "Replay"):

- Game: Exit replay, Watch a replay…, Save online game, Resume a saved
  game…, Download replay;
- Full screen (Exit full screen while full screen);
- Help: Tutorial, the release notes (named by the release, `v1.6`),
  Sponsors & Donations, Discord, contact;
- Copy an invitation, Leave room (in a room).

On a rail narrower than 820px there is no room to open it along, so ☰ opens
one menu holding all of it. Settings holds settings only: the table, the
page, motion.

### 4. The activity log

The rail's right end opens the battle log and chat
(`session/shell/ActivitySheet.tsx`). On a window at least 1025px wide and
500px tall it docks at the right, `--rail-width` wide, and the table lays out
beside it (the layout's `sidebar` shell), so play goes on with it open; it
stays as the player left it (`ptcgsim.shell.v1`). Narrower, it opens over the
table, and from the bottom on a phone. A window resized past that width keeps
the log as it was, never opening it on its own: open over the table, it docks
open as the window grows; narrower, it starts closed over the table, as on
each visit. Docked, it slides in and out and the
table makes room as it moves, both driven by one spring
(`session/shell/dock-slide.ts`). Its header holds the room's name, Copy
an invitation, and the log's own actions (Download, Clear). While it is
closed the launcher counts what the other side did and said, the room's
announcements and who came or went since it was last open, and the same
lines show above it for a few seconds; a player's own moves do not count.

### 4a. The optional pieces

The Lost Zone and the VSTAR/GX markers are optional (few formats use them):
off by default, kept on this device (`ptcgsim.board-view.v1`). On, they sit
beside each player's prizes toward the centre line, the Lost Zone level with
the Active (the Tournament Handbook keeps it directly above the prizes), the
markers beside it; the staging area takes the rest of the row
(`BoardPlayerLayout.extras`). A table too narrow for them keeps the Lost Zone
at the end of the outer column and the markers by the hand. A small `+` in
the viewer's staging area adds or removes them; Settings has the same
switches; an empty Lost Zone can be put away from its corner. A Lost Zone
holding cards always shows.

### 4b. A Pokémon moves whole

Grabbing a Pokémon (any card of the Pokémon itself) carries everything under
and attached to it: the cards follow the pointer together and the drop takes
all of them, into play or into a pile (`MovePlayStackToZone`, one log line,
the Pokémon on top). A long press with a mouse or pen lifts the pressed card
off alone, to devolve it; an attached Energy or Tool always moves alone. A
drop that would swap two Pokémon shows ⇄ on the card being held (PX-042).

### 5. Sheets and the deck screen

Settings, Play online and the help pages open in **sheets** (`ui/Sheet.tsx`,
Base UI Drawer): a centred panel or a side drawer where there is room, a
bottom sheet that swipes away on a phone. They trap focus, close on Esc and
outside presses, and their keys never reach the table.

The deck builder needs the whole window, so **Deck** is a full-window screen
(`session/shell/DeckLayer.tsx`): the builder's workspace on the left and the
decklist column (paste, popular decks, card back) on the right. Narrower than
900px the two take turns, chosen at the top. It closes from its Table button,
Esc, or the builder's Play, and the table takes no keys while it is open.

### 6. Settings has an order

Sections, in order of use: **Table** (halves, split, depth, Lost Zone, zone
outlines, opponent's hand in Solo, hover preview, reset), **Appearance**
(theme, background), **Motion**, **Controls** (keyboard shortcuts), **About**
(what's new, tutorial, sponsors, Discord). Every choice is a preference
(ADR-028), applied live and kept on this device. The Board view panel and its
table button are gone; their controls are the Table section.

### 7. The table asks for what is missing

- **An empty deck shows `+`.** Before a seat has any cards its deck pile
  carries a `+` that opens the deck screen for that seat (P2 at a Solo
  table). A deck emptied in play shows nothing: decking out is a game state.
- **The Lost Zone is optional.** Few formats use it, so it is off by
  default: an empty Lost Zone leaves the table (`hideEmptyLostZone` in the
  layout state; its zone and count leave the scene). A `+ Lost Zone` chip
  under the discard pile adds it; an empty one shown has a hide button; the
  Table section has the same switch. A Lost Zone holding cards always shows,
  whatever the setting.
- **The empty table's welcome** sits in the far half, clear of the rail, and
  can be put away for good. The menu keeps the same help.

### 7a. A seat keeps its colour

A seat's colour follows the player, not the half of the table it sits in
(`SeatTone`, `renderer-contract/src/seat-tone.ts`): the viewer's own seat
is in the "you" colour (blue) and the other in the opponent's (red). A
spectator, and a replay watched as one, takes the first seat as their own.
Turning the board around -- Solo, or a room's coaching flip -- moves the
seats, not their colours, as v1's flip swapped `self-color` and
`opp-color`. The scene stamps each seat's frame with its `tone`, and
everything painted in a seat's colour reads it (the empty deck's `+`, each
half's glow, the hand pill and its Sort, the pile viewers, the log and
the turn banner); where a thing goes on
screen still comes from its `side`. The rail is painted for the seat it
acts for, the one at the bottom.

### 8. Card images retry by themselves

v1's Refresh images re-assigned every image's address by hand; nothing
retried automatically. Now a card image that fails retries by itself after
1.5, 4, 10 and 30 seconds and then once a minute for as long as it is on the
table, with a marker in the address so a cached failure is not reused, and
at once when the browser comes back online or the player comes back to the
tab (`renderer-dom/src/card-image-retry.ts`). Nothing is left for a button
to do, so there is none: the toolbar button, the menu's Reload card images
and R's refresh (2026-10-21) are gone.

### 9. Phones and touch are first-class

- **Breakpoints by available space, not device:** compact (narrower than
  600px, or shorter than 500px), medium (up to 1024px) and expanded
  (`ui/breakpoints.ts`; stylesheets repeat the numbers).
- **Portrait phones get a portrait table.** Each half is laid out both ways
  and keeps whichever shows the larger bench card: on a 390×844 phone the
  portrait mat (Active row, a full-width bench, a pile row of prizes 3×2 and
  deck, discard and Lost Zone side by side, then the hand) gives 64×90px
  bench cards where the landscape mat gave 10×14. Landscape sizes are
  unchanged. A mat whose hand would show less than 20px of each of seven
  cards fanned across it gives way to one whose hand shows more, where that
  keeps a bench card 40px tall (2026-10-28): short portrait phones (412×568,
  480×640 with a browser's bars) took the mat for its larger cards and held
  a hand two cards wide, the Stadium in its row. Portrait tablets keep the
  mat they had; a near-square window, small on either, its larger cards.
- **Touch:** a tapped card gets a bar beside it with Read and Actions (the
  full card menu, as a right-click opens) and Deselect; tapping a selected
  card again reads it; drag works as with a mouse. Card submenus open in
  place on a phone. Under a finger the seam opens to 48px for 44px rail
  targets (`seamBandPx`), menu rows grow to 44px and key hints are hidden.
- **A finger peeks along a crowded hand** (2026-10-29), as a mouse's
  hover raises a hand card. A hand showing less than half of each card (a
  phone's sixteen cards show about 10px each) answers a touch with the
  card under it risen clear of the finger, whole, drawn at least 120px
  wide and over the piles' counts. Sliding along the hand raises each card
  under the finger in turn, without dragging or reordering; moving toward
  the table (straight away, or 24px once the finger heads that way, read
  over its last 100ms so a thumb's arc along the hand still slides) picks
  up the raised card, held where it is drawn; letting go after a slide taps
  the raised card (selected, with Read and Actions), and a long press opens
  its menu. A touch that never moves is a tap as before, and a hand with
  room to spare, a mouse, a pen and the keys are unchanged
  (`BoardSurface`, `BoardDragController.pick`; `hand-peek.spec.ts`).
- **No hold-to-reveal gestures anywhere.** The peek is not one: the card
  rises the moment the finger lands, and letting go acts on it.
- The "best on a desktop" notice is gone.

## Consequences

- Sidebar-shaped ids keep their meaning where they still describe a control
  (for example `#setupButton`, `#messageInput`, `#chatbox`). Browser specs
  reach the shell through `tests/browser/support/table-shell.ts`.
- `RemoteSessionBoard` takes the rail (`rail`), exposes `commandsRef`
  (reload images, switch side), and takes `sidePanel`, `keysSuspended` and
  `loadDeck`; it no longer owns a full-screen toggle or the Board view panel.
- v1's geometry and its harnesses keep v1's own shell; this decision changes
  the redesigned table. The departures are PX-026 to PX-031 in
  `PARITY_EXCEPTIONS.md`.
