# ADR-038: tutorial mode, in the game

- Status: **ACCEPTED**
- Decision date: 2026-10-22
- Scope: how a new player learns the table
- Replaces: v1's tutorial video (the help page `#videoContainer`)

## Context

v1 and v2 taught the sim with a YouTube video in a help sheet. The owner
asked for a tutorial that is entirely in the game, walks through
everything a player needs, follows a touch screen's flow where it
differs, and has a button to go into it; researched and done thoroughly
(2026-10-22).

What the research found (the reviews are in the session that made this):

- **People learn a new interface by doing it, not reading about it.**
  - In NN/g's study, people who read a card-by-card tutorial did no better than people who skipped it, and rated the tasks harder.
  - Interactive walkthroughs in a low-stakes setting work. Learn-by-doing products (Duolingo, GitHub Skills, Lichess Learn) check each step against the result.
- **Short chapters, started by the player, keep people going.**
  - Tours of 1–5 steps finish far more often than longer ones: 38% median at 3–5 steps against 8% at 9 or more.
  - Tours the user starts finish about three times as often as ones that start by themselves.
  - A checklist launcher doubles completion, and a progress indicator helps.
- **Restricting the player's freedom gave no gain** in a 45,000-player study (Andersen et al., CHI 2012), and forced scripts are what break Board Game Arena's tutorials. Never lock the board.
- **Our own studio's experiments** (Magic Circle's tutorial A/B tests) found that a character with flavoured copy lost retention and drew more skips than plain instructions with a highlight ring. Forced waits cost players.
- **Card games** (MTG Arena, Hearthstone, PTCG Live) script whole matches against an AI. A free-form table has no rules engine to do that, so its closest models are:
  - Lichess Learn: levels as data, checked against the board;
  - Legends of Runeterra's Challenges and PTCG Live's Learning Lab: short lessons with one focus, in any order.

## Decision

### 1. Lessons on a practice table

Tutorial mode is a set of short lessons (`apps/web/src/tutorial/`), each
of two to five steps, played on a practice table: a Solo room of its own.
The player's own table, with whatever game is on it, stays live behind it
and comes back as it was when they leave, turned around if it was (the lobby holds both,
`RemoteRoomLobby` `tutorial`). The web bundle may not contain the game
core, so the practice table is a real room, and every move in it is one
the room makes in play.

The lessons, in order:

1. **Start a game:** Set up, the hand and Prize cards, an Active Pokémon, the Bench.
2. **Look at cards:** read a card, open its actions.
3. **Attach and evolve:** Energy, evolving, a Trainer, the Bench, Undo.
4. **Damage and conditions:** through the card's own menu.
5. **Knock Out:** a whole Pokémon to the discard pile, a Prize, the next one up.
6. **Your deck:** draw, look through it, take a card, shuffle.
7. **Turns:** Turn, the coin, Attack or Pass.
8. **Both sides:** flip the table and play the other seat (Solo).
9. **Keys and commands** with a keyboard, **Commands** on a touch screen.
10. **Around the table:** what each app bar button is for.

Undo comes early because it makes every later mistake cheap. Reading and
moving single cards come before stacks, the deck's windows after the plain
moves, and the app's other screens last.

### 2. Each lesson deals its own position

A lesson starts from a position dealt by the room's own commands
(`scenario-runner.ts`):

1. Both decks are loaded in exactly the order wanted. `LoadDeck` keeps its entries' order, so a card that recurs goes in under a copy of its definition.
2. Each seat draws what the position needs (`DrawCards` takes from the top).
3. The position is laid out with play's own moves: Prize cards, Pokémon, stages, attached cards, the discard pile, damage.

The deck's next cards are then known, so a lesson can say "draw" and "find
Rare Candy". The first lesson alone leaves your deck unshuffled for Set up
to shuffle; a hand without a Pokémon (about one deal in seventy) says it is
a mulligan.

The deal's own log lines are cleared, and the log's lines over the table go
with them. Each lesson can be started over from the coach.

The cards are real ones scanned by Limitless (`tutorial-cards.ts`), so each
player sees them in their own language (ADR-034, PX-061). The room shows
definitions under aliases, so a lesson knows a card by its name, which the
practice table keeps unique.

### 3. A step is done when the table shows it

Each step says one thing to do in a line or two. Its check is a predicate
over:

- the view;
- the view when the step began;
- the log's events since;
- what is open on screen (preview, card menu, damage controls, a pile, the
  palette, the deck screen, a sheet), read from the page.

So a drag, the card's menu, a key and the palette all count, and a step
already done goes on by itself, except one Back went to: that one waits
until the table has shown it undone. A step to read has Next. A step whose
card has gone says so, with "Start the lesson over".

### 4. The coach

- **The coach card:**
  - It sits in the corner that covers nothing the step points at, nor the app bar or the open palette (across the top or the bottom on a phone, above the on-screen keyboard); failing every corner, the one that covers least. It stays put through a step's done moment.
  - It shows the lesson and step ("2 of 4") with a progress line, and offers Back, Show me (for a drag), Skip or Next, the list of lessons and leave (✕).
  - A step done shows a tick for a moment.
- **Rings, not a dim:** a ring lights what to touch, and for a drag a second, dashed one lights where it goes. Nothing blocks the table.
- **The drag hand:** a hand carries the card to where it goes three times, then rests. Under reduced motion it is a dotted arrow instead.
- **Accessibility:**
  - The coach is a non-modal dialog named by its lesson; a lesson started from the list gives it the focus.
  - Each step, the first too, is announced politely from one live region that is always on the page.
  - The keyboard is never trapped.
- **Layering:** the coach lies over the table and the command palette (a lesson is read while the palette is open); the lesson list, the deal and the done card step aside for the palette. All of it hides under the deck screen and sheets. The deal and the done card can each be left.
- **Wording follows the hand:** it starts from the pointer the screen reports, then follows whichever was last used. "Double-click" becomes "Tap, then Read", and "Right-click" becomes "Tap, then Actions". The keys lesson is offered only with a keyboard; touch screens get Commands instead.

### 5. Ways in

- The empty table's welcome card has **Tutorial** beside Load a deck and
  Play online.
- The app menu's Tutorial (Leave tutorial on the practice table).
- The palette: Tutorial, and each lesson by name ("tutorial damage").
- An address: `?tutorial` opens the list, `?tutorial=<lesson>` a lesson.
  The address forgets it once taken, so a reload is the player's own table.

It never starts by itself. It is offered at a Solo table and from Play
online, not in a room, where the other player would be left waiting, nor
while a room the page made waits for its guest.

### 6. Progress

Finished lessons are kept on this device (`ptcgsim.tutorial.v1`), each at
the version it was finished at. A rewritten lesson raises its version and
reads as new in the list; nothing is pushed at the player.

## Consequences

- One Solo room per tutorial visit, made when it opens and closed when it is
  left.
- A lesson's steps name controls and cards by the ids and labels the table
  already has. `tutorial.spec.ts` walks every lesson with a mouse, and the
  first ones by touch on a phone, so a change that breaks a lesson fails
  there.
- The YouTube tutorial page is gone.
