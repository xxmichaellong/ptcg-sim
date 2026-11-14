# ADR-035: Command palette

Status: accepted (2026-10-21)

## Context

The owner asked for Magic Circle's backtick launcher, made into a tool for
players: "a general tool for users as QoL so they can easily perform
basically any action they want in the game", structured, intuitive and
complete.

Magic Circle's launcher (`client/.../systems/devLauncher/`) is a Raycast-style
panel over the game: a static catalogue of commands in sections, a fuzzy
search that also finds commands nested in sub-screens, a screen stack for
choices, one typed value per command, recents, and a two-press confirm for
dangerous commands. Its model and ranking port directly; its Pixi rendering
and developer cheats do not.

v2 already has every game action, reached four ways: keys (the hotkey
catalogue), the card menu, pile windows and the rail/toolbar. Each path ends
in the same controller and resolvers, which check the move and say why one
is refused.

## Decision

### 1. A front end over the actions that exist

A palette command runs an action the table already has, through the same
path its button, menu entry or key uses: the same checks, refusals and log
lines. The palette adds no game logic. Its catalogue is built from the
existing catalogues where they exist (the card menu's entries are
`selectLegacyContextEntries`, so the palette's list for a card is the right-
click menu's), so an action added there appears here.

### 2. One registry, filled by the screens that own the actions

`commands/registry.ts` holds command _sources_: functions that list commands
for the current state. A screen registers its own while it is mounted
(`useCommandSource`): the table registers card, pile, deck and view
commands; the room registers turn, room and replay commands; the app
registers settings and help. Sources are called again whenever the palette
opens and whenever the table changes while it is open, so it never lists
something stale. A command is listed only when it would be accepted now:
nothing is shown greyed out.

### 3. Sections a player already thinks in

With an empty search the palette shows, in order:

1. **Recent**: the last six commands run (`ptcgsim.commands.v1`).
2. **Selected card**: when a card is selected, everything that card can do:
   its menu (damage, condition, move, reveal, change type…) and its keys
   (to hand, to bench, rotate, look, attach to…).
3. **Turn**: Set up, Start turn, Attack, Pass, Undo, Flip coin, Announce
   mulligan, Reset, the VSTAR and GX markers; in Solo, Set up both sides
   and Reset both sides.
4. **Deck and hand**: Draw, Shuffle deck, Look at the top or bottom cards,
   Search the deck, and the hand refreshes (discard, shuffle in, to the
   bottom, then draw).
5. **Cards**: Find a card…, every card face up on the table, by name and
   place, leading to that card's actions.
6. **Piles**: open any pile of either seat; the loose board's bulk moves;
   prizes; the other hand; sorting a hand.
7. **Table**: flip the board, which halves show, the view (Auto, Flat,
   Raised, Tabletop), table style, the optional pieces, full screen, the
   Log, say something in chat.
8. **Room**: load a deck, play online, copy an invitation, leave; replays.
9. **Settings** and **Help**.

Seat actions act for the seat at the bottom, as the keys and the rail do; in
Solo each says which seat it is for, and Flip board switches.

### 4. Choosing and typing

- A command ending in "…" opens a sub-screen of choices (where to move a
  card, which condition, which language), with a breadcrumb in the search
  field. Backspace on an empty search or Escape goes back.
- A command that takes a number (Draw, Look at the top cards, the hand
  refreshes, Damage) can take it inline: "draw 3" lists **Draw 3 cards** and
  Enter draws three. Chosen without one, it asks for the number in the
  field.
- Chat takes text: "Say…" then Enter sends it.
- A search finds nested choices from the root ("bench pika" finds Pikachu's
  Move to bench), shown with their path.

### 5. Search

Ported from Magic Circle: a case-insensitive subsequence match scored by
word starts, runs and prefixes (exact > prefix > word-start > scattered),
also matching a title's initials and its keywords (×0.9), nested results
×0.9, a small recency boost that never beats a better text match, at most
18 results and 8 per section. Titles are in the player's language; most
commands also answer to a few English keywords, so "draw" works in every
language. A keyword is matched without the prefix bonus, so it never
outranks a title that starts with the search. Ties keep the order the
sources list them in (yours before theirs, in play before the hand).

### 6. Keyboard, touch and feedback

- **Open:** `` ` `` (a catalogue shortcut, `table.commands`, so it can be
  changed and is listed in the shortcuts dialog), Ctrl+K / ⌘K, or the
  toolbar's Commands button (touch). `` ` `` again, Escape (after clearing
  the search and backing out of sub-screens) or a press outside closes it.
- **Move and run:** ↑ ↓ (wrapping), Enter runs, mouse hover selects.
  Each row shows its key, so the palette also teaches the keys.
- **After a command** the palette closes and the table shows the result,
  except for repeatable steps (draw one, damage ±10), which keep it open.
- **Dangerous commands** (Reset, Reset both sides, Clear log) ask for a
  second Enter; Leave room keeps its own confirmation.
- A command the room refuses says why, as it does whatever sent the
  move; the palette lists only what the table would take now, so a
  command is rarely refused before it is sent.
- **Phones:** the panel fills the width from the top; rows are finger-sized;
  key hints are hidden on touch-only screens.

## Consequences

- One more way in, no new rules: every command is covered by the tests of
  the action it runs; the palette's own tests cover listing, ranking,
  arguments and the panel.
- New actions must be added to a source to be found. The card commands come
  from the card menu and the key catalogue, so most appear on their own.
- The deck screen keeps its own controls; the palette opens it but does not
  edit decks.
