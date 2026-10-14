# ADR-030: the table fills the screen; everything else opens over it

- Status: **ACCEPTED**
- Decision date: 2026-10-14
- Scope: the v2 client's shell -- where every control lives, how it is
  reached, and how the product works on phones and touch screens
- Builds on: ADR-027 (the redesign), ADR-028 (preferences and shortcuts)
- Supersedes: ADR-023 (desktop browsers at a 1280×720 minimum)

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

### 2. One rail, along the seam

Geometry v2 keeps a clear band at the centre line between the halves; the
**table rail** lives there (`board/rail/TableRail.tsx`, painted by
`LegacyBoardChrome` from the layout's `boardControlsAnchor`, following the
seam when the table is tilted). Its left end holds the **app menu**, its
right end the **activity log**, and between them only the turn's **game
actions**, stopping short of the Stadium, which straddles the seam:

| Seat stage (`board/seat-stage.ts`) | Rail actions                                    |
| ---------------------------------- | ----------------------------------------------- |
| No cards yet                       | **Load a deck** (primary), Coin, Switch side    |
| A deck not yet set up              | **Set up** (primary), Coin, Undo, Switch side   |
| Playing                            | Turn, Attack, Pass, Coin, Undo, Switch side     |
| Replay                             | Restart, Back, **Next**, End, Switch side, Exit |

The rarer actions sit behind **More**: Set up again, Announce mulligan,
Reset, and in Solo Set up both sides / Reset both sides, and Change deck.
Spectators see only Switch side. Labels give way to icons when the rail is
short (a container query); each button keeps its full name for its tooltip
and for assistive tech, with the key that does the same. The board owns
Turn, Coin (which waits on the room's answer), Switch side and Mulligan; the
route orders them among its own (`BoardRailModel.compose`). v1's control ids
are kept where they still name the same control (`#setupButton`,
`#p2AttackButton`, `#turnButton`, `#flipCoinButton`, `#flipBoardButton`).

### 3. The app menu

One button at the rail's left end (`session/shell/AppMenu.tsx`), headed by
where you are ("Solo table", "Room ABC123", "Replay"):

- Play online… (from Solo), Deck…, Settings…, Keyboard shortcuts;
- Game: Exit replay, Watch a replay…, Save online game, Resume a saved
  game…, Download replay;
- Full screen, Reload card images;
- Tutorial, the release notes (named by the release, `v1.6`);
- Copy an invitation, Leave room (in a room).

### 4. The activity log

The rail's right end opens the battle log and chat
(`session/shell/ActivitySheet.tsx`). On a window at least 1025px wide and
500px tall it docks at the right, `--rail-width` wide, and the table lays out
beside it (the layout's `sidebar` shell), so play goes on with it open; it
stays as the player left it (`ptcgsim.shell.v1`). Narrower, it opens over the
table, and from the bottom on a phone. Its header holds the room's name, Copy
an invitation, and the log's own actions (Download, Clear). While it is
closed the launcher counts what others said and who came or went since it
was last open, and the other side's newest lines show above it for a few
seconds; a player's own moves do not, nor anything at a Solo table but the
room's announcements.

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

### 8. Card images retry by themselves

v1's Refresh images re-assigned every image's address by hand; nothing
retried automatically. Now a card image that fails retries by itself after
1.5, 4, 10 and 30 seconds, with a marker in the address so a cached failure
is not reused, and at once when the browser comes back online
(`renderer-dom/src/card-image-retry.ts`). The toolbar button is gone; R and
the menu's **Reload card images** retry every failed image now, without
cancelling a drag or re-installing the scene.

### 9. Phones and touch are first-class

- **Breakpoints by available space, not device:** compact (narrower than
  600px, or shorter than 500px), medium (up to 1024px) and expanded
  (`ui/breakpoints.ts`; stylesheets repeat the numbers).
- **Portrait phones get a portrait table.** Each half is laid out both ways
  and keeps whichever shows the larger bench card: on a 390×844 phone the
  portrait mat (Active row, a full-width bench, a pile row of prizes 3×2 and
  deck, discard and Lost Zone side by side, then the hand) gives 64×90px
  bench cards where the landscape mat gave 10×14. Landscape sizes are
  unchanged.
- **Touch:** a tapped card gets a bar beside it with Read and Actions (the
  full card menu, as a right-click opens) and Deselect; tapping a selected
  card again reads it; drag works as with a mouse. Card submenus open in
  place on a phone. Under a finger the seam opens to 48px for 44px rail
  targets (`seamBandPx`), menu rows grow to 44px and key hints are hidden.
- **No hold-to-reveal gestures anywhere.**
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
