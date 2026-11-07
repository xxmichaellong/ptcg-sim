# ADR-042: selecting several cards at once

- Status: **ACCEPTED** (2026-10-29, the owner's request to build it out,
  after a review of an earlier draft against 6d642963). Built the same day:
  the contract below (§11), then the room and core, the controller and
  keys, the renderer, and the overlays and touch, with end-to-end specs.
- Decision date: 2026-10-29
- Number: 042; its parity exception is PX-079.
- Scope:
  - a selection of several cards (and whole Pokémon) on the table and in the
    pile viewer;
  - what every input does with it;
  - acting on a selection as one move: moves, damage, conditions, reveal and
    the ability marker;
  - playing cards printed in pieces (V-UNION, LEGEND, split Stadiums) in one
    gesture;
  - recognising split cards from catalog data.
- Amends:
  - ADR-004: one selected card.
  - ADR-026: one move, one undo step; still true.
  - ADR-028: new rebindable keys.
  - ADR-030 §9: the touch card bar.
  - ADR-035: palette sources.
  - ADR-032: catalog piece metadata.

## Context

v1 could select one card, and every v2 surface inherits that:

- the presentation holds `selectedCardId`, read in 49 places across 10
  files;
- hotkeys resolve against it (`resolveLegacyBoardShortcutKey(input,
cardId)`);
- the context menu, the pile viewer's toolbar, the palette's "Selected
  card" section and `TouchCardBar` are built for one card;
- a drag carries one card or one whole Pokémon (`held-cards.ts`);
- every wire command acts on one card or one Pokémon.

Whole-zone bulk commands exist (`MoveZoneContents`, `ShuffleZoneIntoDeck`,
`ResolveLooseBoardCards`, `ResolveStagedCards`, `ResolveInspectionCards`).
Nothing acts on an arbitrary set.

The owner (2026-10-29) asked for multi-select "built out completely",
expecting to "hold shift or something". They named the cases that hurt
most: a V-UNION's four pieces, a LEGEND's two halves and the new two-piece
Stadium, each played as one card but taking one move per piece today. Two
later rulings:

- group damage, conditions and reveal are in the **first** build;
- a drag on empty felt is free for a selection rectangle.

### What the rules say (none enforced: ADR-001 keeps the table manual)

- **V-UNION** (four pieces; Sword & Shield promos): "Once per game during
  your turn, combine 4 different [name] V-UNION from your discard pile and
  put them onto your Bench." It isn't Basic, takes one Bench spot, and gives
  up 3 Prize cards when Knocked Out. ([pokemon.com][vunion],
  [tcgcollector][morpeko])
- **LEGEND** (two halves; HeartGold & SoulSilver): "Put this card from your
  hand onto your Bench only with the other half of [name] LEGEND." (HGSS and
  Undaunted rulebooks, cited in `reviews/2026-10-10-special-card-formats.md`)
- **Split Legendary Stadiums**: "This card can't be played on its own.
  Combine the 2 kinds of this Stadium from your hand and play them as 1
  Stadium." A new Stadium discards both halves. ([samuraiswordtokyo][split],
  [sealedvault][split2], [pokemoncard.io][m6])
  - **Japanese:** Storm Emeralda (M6, 2026-07-31). Legendary Trench 71/72
    and Summit 73/74 are confirmed on the official product page; a third
    pair, Lava Cave (伝説の溶岩洞) 75/76, is in retailer lists and in
    TCGdex's Japanese data (2026-10-29).
  - **English:** Mega Evolution—Delta Reign (2026-11-06). Its official
    preview shows **Legendary Pyroduct 94/95** (`reviews/2026-10-10-special-
card-formats.md:16`).

### How it works today

- **Joined artwork.** v2 draws pieces as one card when they share a stack
  or the Stadium zone. That comes from `CardPresentation.join` (`key`,
  `columns`, `rows`, `part`), produced by `resolveCardPresentation`'s
  image-path heuristics (V-UNION 2×2, LEGEND 1×2 turned, `m6` Stadiums 2×1),
  plus `composeCardArtwork`.
- **Coming apart** already works:
  - a KO or a scoop takes every piece (`MovePlayStackToZone`);
  - a replaced Stadium discards every piece (`decideMoveCardToStadium`).
- **Getting in** takes one move per piece (`special-card-formats.spec.ts`):
  `b` places the first piece, a drag places each of the rest, and `g` is
  pressed once per Stadium half.
- **English split Stadiums aren't recognised.** The Stadium heuristic only
  knows Japanese `m6` paths 71–74 whose names start 伝説の or "Legendary"
  (`card-presentation.ts:151-170`). Catalog cards carry no `presentation`
  (`catalog-deck.ts:429` keeps only one the card already has). Two English
  Delta Reign halves plus `g` therefore give two separate Stadium cards.

### Prior art

- **Tabletop Simulator:** box-select by dragging on empty table, then grab
  the highlighted group ([TTS basic controls][tts]).
- **Cockatrice-based clients:** "Select multiple cards at once: Shift,
  Click, Drag" ([guide][cockatrice]).
- **File managers and card-grid UIs:** Ctrl/Cmd+click toggles a card,
  Shift+click picks a run, and a drag on empty space draws a rectangle
  ([Syncfusion][sync], [DevExpress][devx]).
- **Gmail:** `x` toggles the focused row's selection.
- **Touch canvases:** a drag on empty space paint-selects, or there is an
  explicit select mode ([Kinopio][kinopio]).

## Decision

### 1. The selection is an ordered list of items; single-card paths need exactly one

- **Canonical state.** `BoardPresentation.selection: readonly ViewCardId[]`
  is the ordered selection, in the order items were added. It is local
  presentation: it never reaches the room, the opponent or a replay.
- **Items.** Each id stands for one item, normalised by
  `normalizeSelection(view, scene, ids)`:
  - **A whole Pokémon.** Any card in a Pokémon's evolution line is stored
    as that Pokémon's top card, and its attached cards come with it.
    Selecting a lower stage or a second piece of the same Pokémon is the
    same item, never a duplicate.
  - **A single card:**
    - a card in the hand or the staging area;
    - a card in the open pile viewer;
    - a work-area card (looking at cards, or the attached-cards window);
    - an attached Energy or Tool chosen on its own, which moves alone as a
      drag of it does. If its Pokémon is already selected, the click is
      ignored with "Already part of the selected Pokémon";
    - a face-down prize the seat may move.
  - **Never an item:**
    - a pile's cover or top card on the table (deck, discard, Lost Zone;
      open the pile to pick cards from it);
    - the deck as a whole;
    - cards this seat can't control (in multiplayer, the opponent's
      face-down hand and deck). These are skipped silently by the rectangle
      and **Select all**, and refused with a notice on a modifier click.
- **`selectedCardId` is derived.** It is the one item when exactly one is
  selected, and **null for a group**. Every single-card surface that isn't
  ported (preview, Read, the single touch bar, single hotkeys, the viewer
  toolbar's single Move) therefore goes quiet for a group instead of
  quietly acting on one card.
- **Keyboard mode.** `LegacyBoardKeyboardShortcuts` gains a `'group'` mode
  (2+ items). In it, table keys (digits draw, `s` shuffles the deck, Alt+D
  discards the hand…) are **swallowed** with a notice rather than falling
  through to table mode.
- **Reducer.** A pure `reduceSelection(state, op)` with ops `replace`,
  `toggle`, `add`, `addMany`, `clear`, `reconcile(view, scene)` and the cap.
  It is unit-tested in Phase 0.
- **Cap.** 60 items. One more is refused with a notice and a status
  announcement.
- **Selection-preserving controller paths.** These clear the selection
  today; with a group they keep it when the card involved is selected:
  - `CardContextRequested` (`BoardSessionController.ts:1379`): a right-click
    or long press on a selected card opens the **group menu**;
  - `CardPreviewRequested` (`:1423`): reading a card leaves the group
    standing;
  - `DragChanged` (`:1681`): a drag of a selected card carries the group;
  - `q`/`e` targeting (`:1959`): the group is the source;
  - a drop from the viewer (`:1504-1512`).
- **What clears it:**
  - Esc. Today's Esc closes every temporary surface at once
    (`LegacyBoardKeyboardShortcuts.tsx:206-210`), and the group goes with
    it. There is no two-step Esc. An Esc inside a menu or the viewer still
    belongs to that surface first.
  - A press on empty felt with no modifier and no drag. **New:** today it
    only cancels targeting (`:1361-1369`). It is recorded in the PX for
    single selection too.
  - A drag of an unselected card (today's behaviour: a drag clears the
    selection).
  - A group action the room accepts.
  - A scene installed with `replace` (reconnect, undo, replay seek), as
    today.
- **What it survives.** A refused group action gives the selection back:
  the ids are remembered at submit and restored, keeping those still shown.
  `reconcile` drops items that leave view (moved by the opponent, a pile
  closed) and announces "2 cards left the selection".
- **Appearance.** With 2+ items, each item gets the selected ring and an
  **order badge** (1, 2, 3…). A whole Pokémon gets one ring around its
  composition and one badge on its top card. Each card's accessible name
  says "selected, 2 of 3".

### 2. Inputs

**Mouse.** ⌘ on macOS and Ctrl elsewhere are the "platform modifier".

| Gesture                                                | Effect                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Click                                                  | Select this item only (as today); clicking the sole selected item lets it go (today's `toggle`)                                                              |
| **Shift+click** or **platform-modifier+click**         | Add or remove this item, keeping the rest. A modifier click ignores `event.detail`: it toggles on every click and never counts toward a double-click preview |
| Ctrl+click **on macOS**                                | Stays a secondary click (the OS sends `contextmenu`, not `click`). On a selected card it opens the group menu                                                |
| Press with a modifier on an unselected card, then drag | Adds it, then drags the group                                                                                                                                |
| Drag a selected item                                   | Moves the group (§4)                                                                                                                                         |
| Drag an unselected item                                | Moves it alone and clears the selection (today's behaviour)                                                                                                  |
| **Drag on empty felt** (≥ 6 px)                        | Rectangle. Items whose _painted_ box intersects it replace the selection, or are added with Shift or the platform modifier                                   |
| Right-click a selected item (group)                    | The group menu                                                                                                                                               |
| Click empty felt                                       | Clear                                                                                                                                                        |

Shift+click **toggles**; it is not a range. That matches the owner's "hold
shift" and Cockatrice. Runs come from the rectangle or Ctrl/⌘+A.

**The rectangle:**

- It starts only on empty felt: not on a card, zone affordance, pill, rail,
  marker, coin, the seam's resize handle or the app bar.
- It stays **within the half where it began**, near or far. The far half is
  allowed so spread damage on the opponent's Pokémon works.
- It skips pile covers and tops and cards this seat can't control.
- Its order is reading order (rows top to bottom, left to right in the
  viewer's frame).
- While it is drawn, the preview is renderer-local: a `data-` attribute
  whose name appears in no `:root` rule (dom-table-performance) on the
  intersecting cards, plus one transformed rectangle element.
  `CardsSelected` is sent **once, on release**.
- With the pile viewer open, a rectangle drawn on the viewer's empty grid
  selects tiles. **Cut from the first build** (the review's scope cut): the
  viewer has Select all and modifier clicks.

**Keyboard.** Keys are registered in `hotkey-catalogue.ts`, translated by
`keymap.translate` and rebindable (ADR-028).

| Key (default)           | Effect                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Enter on a focused card | Select it only (as today)                                                                                                                                                                        |
| **`x`**                 | Toggle the focused card, or failing that the hovered card, in the selection. `x` is free in the catalogue and is Gmail's select key                                                              |
| **Ctrl/⌘+A**            | Select every item in the **container of the focused card**; failing that, of the last item added; failing that, of the open pile viewer. With none of these the browser keeps its own Select All |
| Esc                     | Today's Esc (closes everything, including the group)                                                                                                                                             |
| Action keys             | Act on the whole group where §3 says they apply. **Shift is ignored while a group is selected** (Shift+G ≡ G, Shift+→ ≡ →), because players keep Shift held after Shift-clicking                 |

Cut: Shift+Enter (Enter is a table key: Enter discards the staging area),
Shift+←/→ (→ swaps with deck top, and the table has no arrow-key focus
model: `focus-from.ts:14-18`) and Shift+A. "Play as one card" (§5) is in
the menu, palette and touch bar, with no key. The table's existing focus
model (Tab) is unchanged; a roving-focus project is out of scope.

**Touch** (no hover, no modifiers). Long press already opens a card's menu
and ends a peek with the menu.

- **Starting:**
  - The single `TouchCardBar` (Read · Actions · ✕) gains a **Select**
    icon button (checkbox icon, 44 px; the bar grows from 236 to 280 px,
    which fits 320 px phones). It starts **selection mode** with that card
    selected.
  - A **finger drag on empty felt** draws the rectangle and starts
    selection mode. The surface is already `touch-action: none`.
- **In selection mode:**
  - A tap toggles an item.
  - **Tap-again-to-read is off** (`RemoteSessionBoard.tsx:449-528`).
  - Letting go after a peek on a crowded hand toggles the raised card. The
    peek reads the mode flag from the presentation.
  - A long press on a **selected** item opens the group menu; on an
    unselected item it opens that card's own menu, as today.
- **The group bar** is a `TouchCardBar` variant, placed the same way, next
  to the last item touched. A bar docked at the screen edge would collide
  with the app bar, the rail and the hand pill. Its content is
  "3 · Move… · Damage… (when the group holds Pokémon in play) · ✕". Its
  width follows its buttons, at most 4.
- **One mode covers the table and the pile viewer.** While it is on, viewer
  tiles show ticks and the bar offers **Select all** for the open pile.
  There is no separate viewer toggle.
- **Ending:** ✕, Done (on the group menu), an empty selection, or Esc on a
  keyboard.

**The pile viewer is modal.** It has `aria-modal`, a tab trap, and
outside-dismiss (`LegacyBoardOverlays.tsx:2221-2330`).

- A **modifier press**, or a selection-mode tap, on a table card while the
  viewer is open **adds the card and leaves the viewer open**:
  `useOutsideDismiss` lets such presses through.
- A plain press outside still closes it, and `reconcile` drops its cards
  from the selection.
- To build a group across the table and a pile, select the table cards,
  then open the pile and add from it, or the other way round with
  modifiers.

**Stacked tiles** in the viewer ("Fire Energy ×5"): each toggle adds the next
copy (badge "2/5"). Toggling past the last copy clears the tile. **Select
all** takes every copy of every tile. "Shift takes all copies" is cut, so
Shift means the same everywhere.

### 3. What a group can do

Every action below is one gesture, sent as **one command** (§4) that is one
undo step. The log gets one line per source and destination (§6).

**Order rule, everywhere:** item 1 lands first.

- On any pile (discard, Lost Zone, deck top, prizes) the highest number
  ends on top. The group menu says so ("3 ends on top").
- On the deck's bottom, item 1 goes under first, so the highest number ends
  just above it.
- In the hand, the staging area and the Bench, item 1 is leftmost.

**Destinations relative to the owner**, as the single keys already are
(`resolveCardZoneMoveAction.ts:55-62`):

- `d`, `l`, `h`, `p`, `↑`, `↓` and `s` send each item to _its owner's_
  pile;
- Space sends each to the staging area of the seat it came from.

A Solo group holding both seats' cards therefore makes moves to both
seats.

**Moves**

| Action                   | Mouse              | Keys                    | Touch              | Notes                                                                                                                                                                                 |
| ------------------------ | ------------------ | ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| To hand                  | drag to the hand   | `h`                     | Move…              | at the drop gap (opens N wide) or the end                                                                                                                                             |
| Discard / Lost Zone      | drag to the pile   | `d` / `l`               | Move…              | —                                                                                                                                                                                     |
| Deck top / bottom        | drag to deck = top | `↑` / `↓`               | Move…              | —                                                                                                                                                                                     |
| Shuffle into deck        | —                  | `s`                     | Move…              | each card goes on top, then one shuffle per deck at the end                                                                                                                           |
| Prizes                   | drag to the prizes | `p`                     | Move…              | face down as today                                                                                                                                                                    |
| Staging area             | drag there         | Space                   | Move…              | —                                                                                                                                                                                     |
| Bench                    | drag to the Bench  | `b`                     | Move…              | each card is its own new Pokémon, except a **piece set** (§5), which becomes one. The gap index counts only the Bench's staying Pokémon (as `MovePlayStack.benchIndex`)               |
| Active                   | drag to the Active | `a`                     | Move…              | only when the group is one item or one piece set; otherwise "Only one Pokémon can be Active"                                                                                          |
| Stadium                  | drag there         | `g`                     | Move…              | only one card, or one Stadium's piece set (one join key, ≤ 4 distinct pieces)                                                                                                         |
| Onto a Pokémon           | drag onto it       | `q`/`e`, then pick      | Move… → Attach to… | Non-Pokémon cards attach. Pieces of _that_ Pokémon's set join it. Anything else: "Only attachments can go on a Pokémon together". `q`/`e` light only the Pokémon every item can go on |
| Whole Pokémon in a group | drag               | `d` `l` `h` `↑` `↓` `s` | Move…              | each goes **whole** with its attached cards (`MovePlayStackToZone`); labelled "Discard 2 Pokémon with attached cards". A Pokémon can't join a group going to the Bench or Active      |

**One Pokémon versus several.** `d` on one selected Pokémon keeps v1's
behaviour:

- its top card goes to the discard;
- the rest go to the attached-cards window (`MoveCardFromStack`,
  `decide-command.ts:321-377`).

`d` on two or more Pokémon moves each whole. This difference is deliberate:

- the common group case is several Knocked Out Pokémon;
- each player has one attached-cards window
  (`attachmentResolution ?? next`), so per-card departures for several
  Pokémon can't work.

The ADR and the PX record it, and both cases are tested.

**Annotations** (in the first build, by the owner's ruling). They apply to
each **distinct Pokémon in play** once: cards collapse to their Pokémon.
Any item not in play makes the key refuse, naming the card.

| Action                  | Keys          | Touch / menu / palette                                              | Command per Pokémon                                                                                                   |
| ----------------------- | ------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Add N×10 damage to each | `1`–`9`       | Damage… (the marker-controls stepper) · "Add 10 damage to each (3)" | `SetDamage` with that Pokémon's total from the view + N×10                                                            |
| Remove N×10 from each   | Alt+`1`–`9`   | Damage…                                                             | `SetDamage`, floored at 0                                                                                             |
| Clear damage            | `0`           | menu, palette                                                       | `SetDamage null`                                                                                                      |
| Special condition       | `y` / Alt+`y` | menu                                                                | `SetSpecialCondition`, only when every item is an **Active** Pokémon (at most two)                                    |
| Ability used            | `w`           | menu                                                                | `SetAbilityUsed` per Pokémon (`SetCardAbilityUsed` for cards in the discard, as single `w` does)                      |
| Reveal / hide           | Alt+`z` / `z` | menu                                                                | `SetPublicReveal` per card (Pokémon items reveal their top card, as single `z` does). One reveal notice for the group |
| Rotate                  | `r` / Alt+`r` | menu                                                                | `RotateStack` / `SetCardOrientation` per item                                                                         |

Spread damage usually targets the opponent's Pokémon, so the rectangle
works on the far half (§2). The default policy allows it
(`room-authority/src/model.ts:307`). In multiplayer the room authorises
each step as it would alone.

**Not for groups:**

- Read (`v`);
- switch with deck top (`→`);
- change type (Alt+E/T/P);
- look/cover (`c`);
- draw and view counts.

In `'group'` mode these answer "Select one card for that". The palette and
menus leave them out.

**Cards already there** are skipped. If every item is, the table-feedback
fork's `already-there-notice.ts` answers (now on main: "Already in the
discard pile").

**The group menu** (right-click, long press on a selected item, or the
group bar's Move…) has:

- a header, "3 cards", or "3 of Red's cards" when it holds the opponent's;
- the moves and annotations that apply, as state-true labels (the
  table-prompts fork's rule);
- "Play as one card" when §5 applies;
- "Deselect".

The palette's "Selected cards" section (`board-commands.ts:380-386`) lists
the same entries with counts.

### 4. One command: an atomic batch of existing single-card steps

```ts
type CardStep =
  // The existing single-card wire commands, unchanged, from an allowlist:
  | MoveCard | MoveCardFromStack | MovePlayStackToZone | MoveInspectedCard
  | MoveStagedCard | MoveCardToPlay | MoveInspectedCardToPlay
  | PlaceCardOnPlayStack | MoveCardToStadium | MoveCardToDeckTop
  | MoveCardToDeckBottom | SetDamage | SetSpecialCondition | SetAbilityUsed
  | SetCardAbilityUsed | SetPublicReveal | RotateStack | SetCardOrientation
  | ShuffleZone;                       // only in the trailing block
// One addition: on MoveCardToPlay and PlaceCardOnPlayStack, in place of
// targetStackId, `targetStackRef: k` = "the Pokémon step k created".

{ type: 'ApplyCardSteps'; steps: CardStep[] /* 2..120 */ }
```

**Why not the draft's `MoveCards` destination union:**

- It re-implemented about fifteen drop shapes in three places: the client
  (`resolveBoardDrop.ts:177-570`), the room's per-type checks
  (`resolve-command.ts:204-430`, where `PlaceCardOnPlayStack` alone checks
  work-area control, source seat and cross-board evolve) and the domain.
- It couldn't express destinations relative to the owner.
- It put artwork grouping into game-core, which contradicts
  `card-presentation.ts:1`.

**Why the batch:**

- It reuses every existing check, predictor and narration rule.
- It carries the annotations the owner put in scope.
- Its allowlist keeps the batchable set narrow.

**The client** compiles groups in `compileGroup(view, scene, selection,
action) → CardStep[]`, the only place group rules live:

- normalise items;
- partition piece sets;
- apply the order rule;
- choose destinations relative to the owner;
- skip items already there;
- choose each step's shape with the existing single resolvers
  (`resolveBoardDrop`'s source detection, `resolveCardZoneMoveAction`,
  `resolveCardPlayMoveAction`, `resolveCardStadiumMoveAction`,
  `resolveStackStateAction`);
- build each step's expectations by **folding `predictWireCommand` over the
  earlier steps**, which exist for every allowed type
  (`predictWireCommand.ts:723-1410`).

Keys, drops, the menu, the palette and the touch bar all call it. A group
of one compiles to today's single command, sent as itself: specs, the log
and v1 parity are unchanged.

**Room** (`room-authority`):

1. Resolve **every alias once**, against the identity registry as it stood
   before the command.
2. Then for each step:
   - substitute `targetStackRef` with the stack id step k created (refused if
     step k created none);
   - run the **existing per-type resolver** on the scratch state (each `case`
     in `resolveWireCommand` is refactored into a callable function);
   - decide and apply.
3. Any refusal refuses the whole command with that step's code.

Duplicate card ids across steps that move cards are `invalid_command`.

**Game core.** `executeCommandSequence(state, next, context, options)`
folds `decideCommand` over the steps on a scratch state. `next(i, scratch,
createdStackIds)` yields the i-th resolved `GameCommand`. It returns **one
`EventBatch`**, which records `steps: n` for narration. Lone-Benched
promotion and the `overfills` check run once, at the end. game-core gains
no artwork rule: grouping, order and destinations come from the client
and are checked step by step.

**Wire** (`protocol/schemas.ts`): steps 2..120 (60 items moved, plus their
annotations or a trailing shuffle), each validated by the existing per-type
schema plus `targetStackRef`. The worst case (60 items, sixteen 8-card
Pokémon with their expected-id arrays at about 35 characters per id) stays
under the 64 KiB client frame, and is tested.

**Prediction:**

- `predictWireCommand` folds over the steps, mapping `targetStackRef` to the
  provisional stack id the fold created. A null step makes the whole
  prediction null (not shown; never a failure).
- `isRandomizingCommand` is true when any step shuffles, so commands queued
  behind it aren't predicted against the unshuffled deck.

**Settling and rebinding:**

- Settling entries gain a `dropId`. `SubmissionQueued` and
  `SubmissionRejected` bind or drop every entry of the drop together (today
  only the newest unbound one: `BoardSessionController.ts:2182-2218`).
- `movesWholeStack` reads per-step shapes.
- `rebindProvisionalReferences.ts` learns `ApplyCardSteps` (every step, and
  the stacks it created), so a move of the new V-UNION queued right behind
  the batch is rebound.
- At most **5 cards** are held or settling per group: the lead and up to 4
  fanned behind it. The rest fly from where they lie once the room
  publishes, so `withHeldCards` never mounts 60 buried pile cards.

**Undo:** one batch, one undo step (ADR-026, unchanged). In multiplayer a
player may undo their own group while it is the newest move; once the
opponent acts on top of it, it can't be undone.

**Refusals:** one notice, plural ("Move didn't go through — the cards went
back"). `MOVES_CARDS` in `refusal-notice.ts` reads the steps. The selection
comes back (§1).

### 5. Cards printed in pieces

- **Recognising them from catalog data.** Hard-coded numbers are only the
  fallback for decks without the catalog.
  - **Catalog build** (`apps/server/src/card-catalog`) derives a piece
    layout per print. Within one set:
    - **V-UNION:** runs of consecutive collector numbers with the same name
      and stage V-UNION; four pieces, 2×2, `part` in number order.
    - **LEGEND:** stage LEGEND (`normalize.ts:285-289`); runs of two; 1×2,
      read turned a quarter (`readingQuarterTurns: 1`), lower number on top.
    - **Split Stadium:** trainer type Stadium; runs of two with the same
      name **and** the split rule in the card's text (English "can't be
      played on its own" / "Combine the 2 kinds"; the Japanese rule
      wording); 2×1, lower number on the left.
  - The key is `<set>:<first number>:<name>`. These rules recognise Delta
    Reign's Pyroduct (94/95) as soon as the catalog has the set, and any
    later split card that follows the printed rule, with no code change.
  - The catalog wire card gains an optional `pz` (piece layout).
    `deckCardFromCatalog` sets `presentation` from it, and
    `withCatalogFacts` adds a missing presentation (today it skips cards
    that have one and never adds one).
  - Decks installed from image URLs alone (v1 CSV, pasted lists without the
    catalog) keep `resolveCardPresentation`'s heuristics, extended with the
    official Delta Reign numbers once confirmed against the release.
    Lava Cave 75/76, now in TCGdex's Japanese data, can join the
    fallback's numbers (it is not in it yet).
- **A piece set** is the cards in a group sharing a `join.key`,
  **partitioned into sets of distinct parts** (`composeCardArtwork`
  refuses repeated parts: `card-composition.ts:73-74`). Two copies of one
  LEGEND's halves therefore make two sets and two Pokémon.
  - A set is **complete** when its distinct parts number `columns × rows`.
    Partial sets combine too, drawn with gaps (the table never refuses a
    manual play).
- **Playing a set** (compiled client-side):
  - **Onto the Bench or Active**, the lowest part makes the Pokémon:
    `MoveCardToPlay` (new stack) from a zone, or `MoveInspectedCardToPlay`
    from a work area. The other parts follow in part order as
    `PlaceCardOnPlayStack` (mode evolution) with `targetStackRef` and the
    previous piece as `expectedTargetTopCardId`.
  - **Onto the Stadium**, the first piece replaces the incumbent (whose
    pieces go to their owners' discards once, as today). The rest follow
    as `MoveCardToStadium` (placement `add`), with the expected occupants
    folded forward.
- **"Play as one card"**, one tap or click. It appears on any piece whose
  set has other pieces **known to the viewer and face up**: in the hand,
  the open pile, or the hand plus the discard (as
  `resolveCardStadiumMoveAction.ts:57-61` already limits Stadium joins).
  - **Where:** in the card's menu, the palette, and the touch bars (single
    and group).
  - **What it does:** it selects the visible siblings in part order, and
    offers the destinations that fit the set's kind: Bench or Active for a
    Pokémon, Stadium for a Stadium.
  - It is the main path on touch: tap the piece, Play as one card, Bench.
  - It never pulls pieces in during a drag of a single piece.
- **`b` on a lone piece** whose unfinished Pokémon is in play (same key,
  missing that part, on the acting board) **joins it**, as `g` already
  joins a Stadium half (`resolveCardStadiumMoveAction.ts:57-75`). The
  single and group paths then agree.
- **Coming apart:** unchanged.
  - A KO, scoop, Lost Zone or shuffle takes every piece.
  - A replaced Stadium discards every piece.
  - A long-press detach takes one piece off for manual fixes.
- **Custom cards** with an artwork group carry the same `join` and behave
  the same.

### 6. The log

- **Folding.** For batches with `steps ≥ 2`, the existing
  `withinOneFrame`/`runOf` fold (`presentation-events.ts:76-123`) applies
  always, not only past 100 lines. A run of `CardMoved` with the same actor,
  source and destination becomes **`CardsResolved`**, which gains an
  optional `cardNames` (the publicly known names, in order, by the
  per-card `publicName` rule) and the destinations `prizes` and `board`.
  For example: "Blue moved 3 cards from hand to the discard pile: Fire
  Energy, Fire Energy, Switch".
- **One line per source and destination.** A group from the hand and the
  discard to the deck reads as two lines. The draft's "always one line"
  claim is dropped.
- **Joined cards.** A new narration rule: a `CardMovedToPlay` (new stack)
  followed in the same group batch by evolution placements of cards **with
  the same name** onto that stack reads "Blue put Morpeko V-UNION onto the
  Bench". It does not read as three "evolved" lines
  (`narration-events.ts:322-352`). A Stadium set reads "Blue played
  Legendary Pyroduct". This is name-based, with no artwork rule in the
  narration.
- **Annotations:**
  - "Blue put 10 damage on each of 3 Pokémon";
  - "Blue revealed 2 cards: …";
  - otherwise one line per Pokémon as today, when the values differ.
- **Older batches.** Only batches marked `steps` fold, so older logs and
  replays read exactly as before. That includes the two-piece Stadium
  replacement, which already emits two moves (`decide-command.ts:656-675`).
- **Hidden information.** Names stay per card, so a face-down prize reads
  "2 cards". Two-browser specs check the opponent's and the spectator's
  logs and the perspective replay.

### 7. Accessibility

- **Announcements.** Selection changes are announced in a separate visually
  hidden `role="status"` region, replaced rather than queued and coalesced
  over about 250 ms, as `TutorialHost.tsx:622` does: "3 cards selected",
  "Fire Energy added, 4 selected", "Selection cleared". They don't go
  through `AccessibilityAnnouncementDrain`, which is the room-event queue
  and speaks entries one by one.
- **Viewer tiles stay `aria-pressed` toggle buttons.** A listbox would
  clash with their click, double-click, context-menu and drag handling. The
  grid's label carries the count ("Discard pile, 3 selected").
- **Item names.** Each selected item's accessible name gains "selected, 2
  of 3".
- **Keyboard and touch paths.** Every group action has a keyboard path (`x`,
  Ctrl/⌘+A, the action keys, the group menu via the context-menu key) and a
  touch path with no modifier. The group bar's buttons are 44 px.

### 8. Performance

- **Selection repaints.** `selection` is compared by reference.
  `CardNode` is memoised on its own selected flag and order number, so a
  toggle repaints only the cards it changes. `onlyHeldCardMoved`
  (`held-cards.ts:188-209`) compares `selection` and `drag.groupCardIds` by
  reference, so a pointer move during a group drag never re-renders the
  table.
- **Group drag:**
  - The drop outcome is compiled **once per change of target or index**,
    not per pointermove (`dropOutcome`, `BoardSessionController.ts:1574-1604`,
    is per move today).
  - On the flat table the carried set is the lead plus up to 4 fanned cards
    (`card-composition.ts:199-245`, `BoardSurface.tsx:1560-1590`).
  - On the tilted table (the default, ADR-031) `TableDepthDirector` poses
    the fan in table space, and `BoardMotionDirector.carry` carries all
    their keys.
- **The rectangle** is renderer-local until release (§2).
- **Measurement.** A production build, 60 selected, at 4× CPU throttling:
  the drag holds frame time and selection toggles stay under one frame.

### 9. Edge cases

| Case                                                               | Behaviour                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| The opponent moves a selected card                                 | dropped on the next scene; announced                                                                               |
| A group across a pile, and the pile closes with a plain press      | the pile's cards are dropped; announced                                                                            |
| A face-down prize                                                  | selectable where a single move is; its badge sits on the back                                                      |
| A two-player room, the opponent acts mid-drag                      | compiled against the new view; a stale step refuses the whole group, with one notice, and the selection comes back |
| Solo, flipped board                                                | the acting-seat rules are unchanged (`actingPlayerIdOf`); destinations stay relative to each card's owner          |
| A whole Pokémon plus loose cards, to the Bench                     | refused: "A Pokémon in play can't join a group going to the Bench"                                                 |
| Two different V-UNIONs' pieces, to the Bench                       | two Pokémon                                                                                                        |
| Two copies of the same LEGEND's halves, one drag                   | two Pokémon (distinct-part partition)                                                                              |
| Pieces of two Stadiums, or a set plus a stray card, to the Stadium | refused (one key or one card)                                                                                      |
| `a` with three Basics selected                                     | refused: "Only one Pokémon can be Active"                                                                          |
| Work-area cards (looking at cards, the attached-cards window)      | allowed; their steps carry the work-area source, as single moves do                                                |
| Opponent's cards in the group (multiplayer)                        | each step is authorised as alone; the menu header names the owner                                                  |
| A digit with a group that includes a hand card                     | refused, naming the card                                                                                           |
| Undo after the opponent has acted on top                           | refused (ADR-026)                                                                                                  |
| Reconnect or undo while a group is selected                        | `replace` clears it, as today                                                                                      |
| A group drag with reduced motion                                   | the fan draws without easing; the rectangle with no animation                                                      |

### 10. Scope

**In the first build:**

- the selection model;
- mouse, keyboard and touch input (including the rectangle on the table,
  for mouse and finger);
- group moves and annotations;
- the step-batch command end to end;
- piece sets, "Play as one card" and `b` joining a lone piece;
- catalog recognition of split cards;
- the log folding and joined-card narration;
- accessibility.

It is merged in two internal steps (A: model, mouse, keys, command,
annotations, pieces; B: touch, rectangle, viewer), shipped together.

**Cut:**

- the pile viewer's own rectangle;
- the listbox semantics;
- the viewer's separate Select toggle;
- "Shift takes all copies";
- the edge-docked selection bar;
- Shift+Enter, Shift+←/→ and Shift+A;
- the two-step Esc;
- Phase 3 (now folded in).

**Added** (from the review):

- the derived `selectedCardId` and the `'group'` key mode;
- item normalisation;
- the order rule;
- owner-relative destinations;
- `dropId` settling and rebinding;
- catalog piece metadata;
- `b` joining a lone piece;
- the status region;
- the performance trace;
- the extended test matrix.

PX-079: v1 selects one card. v2:

- selects several;
- acts on them as one move;
- clears the selection on a press on the felt;
- `b` joins a lone piece to its unfinished Pokémon.

### 11. The contract (phase 0)

What the work packages build on, with no visible change:

- **Presentation** (`renderer-contract`): `BoardPresentation.selection`
  and `selectionMode` replace `selectedCardId`. `selectedCardIdOf` gives
  the one item, null for none or several; `NO_SELECTION` is the shared
  empty selection; `cardSelectionModeOf` reads `CardSelected.mode`
  (`replace`; `toggle`, a plain press, v1's click, which the old `toggle`
  flag means; `add`, a press with Shift or ⌘/Ctrl, in or out). New:
  `CardsSelected { cardIds, mode: 'replace' | 'add' }`,
  `SelectionModeChanged { on }`, `drag.groupCardIds`,
  `CardDropRequested.groupCardIds` and `SettlingCard.dropId`.
  `onlyHeldCardMoved` compares the selection and the group by reference.
- **Wire** (`protocol`): `ApplyCardSteps { steps }`, 2 to `MAX_CARD_STEPS`
  (120) of `WireCardStepSchema`, the allowlist in §4, with
  `targetStackRef` on `MoveCardToPlay` and `PlaceCardOnPlayStack`
  (`cardStepMakesPokemon` says which steps make a Pokémon to refer to);
  the schema checks the steps' shape (a reference to an earlier step that
  made a Pokémon, one target only, shuffles last). `CardsResolved` gains
  `cardNames` (a name each, null for a card not publicly known) and the
  destinations `prizes` and `board`.
- **Domain** (`game-core`): `ApplyCardStepsCommand`, `CardStep`,
  `CARD_STEP_TYPES`, `BaseGameCommand` (every command but the group's),
  and `EventBatch.steps`.
- **Stubs**, refusing until WP1: `decideCommand` (`invalid_command`) and
  `resolveWireCommand` (`precondition_failed`); `predictWireCommand`
  predicts no batch, but `predictCardStep`/`predictCardSteps` fold one
  (WP1 turns them on); `isRandomizingCommand` reads the steps; the
  refusal notice counts a group as moving cards; the controller refuses
  `CardsSelected` and `SelectionModeChanged` as unsupported.
- **Rules** (`apps/web/src/board`): `selection.ts` (`normalizeSelection`,
  `reduceSelection` with `replace`, `toggle`, `add`, `addMany`, `clear`,
  `reconcile`, `restore`, and the cap `MAX_SELECTION_ITEMS`),
  `piece-sets.ts` (`cardPieceOf`, `partitionPieceSets`,
  `visiblePieceSetOf` for "Play as one card", `unfinishedPokemonFor` for
  `b`), and `compile-group.ts` (`compileGroup(context, selection,
action)`, the only place group rules live; one item compiles to the
  command it sends alone). The number keys' and `y`'s v1 quirks moved to
  `resolveDamageKeyAction` and `resolveConditionKeyAction`, shared by the
  single keys and the group.
- **Catalog**: the server's catalog build gives a card printed in pieces
  its place (`pz`) by the rules of §5; `deckCardFromCatalog` gives the
  deck card that `presentation`, and `withCatalogFacts` adds it to a deck
  card made without it.

## Consequences

- One new wire and domain command, `ApplyCardSteps`, made of existing
  steps.
  - Old replays never contain it. New replays apply its batch through
    existing event types.
  - Only the room's per-type resolvers are refactored, into callable
    functions.
- Every single-card surface goes quiet for a group until it is ported; it
  can no longer quietly act on one card.
- A V-UNION, LEGEND or split Stadium is one gesture ("Play as one card"),
  or a selection plus `b` or `g`. Nothing is enforced.
- The catalog becomes the source of piece layouts. Delta Reign's Stadiums
  work once the set is in the catalog.

## Review resolution (23 items, against 6d642963)

| #   | Item                                                                                                     | Resolution                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The primary `selectedCardId` makes un-ported single paths act on one card; five paths wipe the selection | **Accepted.** `selection` is canonical, `selectedCardId` is derived (exactly one, else null), there is a `'group'` key mode that swallows table keys, and the five paths are preserving (§1). `reduceSelection` is in Phase 0                                       |
| 2   | The `MoveCards` union duplicates per-type rules ×3 and puts artwork in game-core                         | **Accepted.** `ApplyCardSteps`, an atomic batch of allowlisted existing commands with `targetStackRef`. Rules live in client `compileGroup`; the room reuses per-type resolvers on a scratch state; game-core has `executeCommandSequence` and no artwork rule (§4) |
| 3   | Group damage, conditions and reveal are in scope with no design                                          | **Accepted.** The annotation table in §3, and steps in the same batch                                                                                                                                                                                               |
| 4   | The English split Stadium isn't recognised                                                               | **Accepted, adapted.** Recognition from catalog data (name runs + stage/trainer type + the printed split rule) via `pz`, with heuristics only as the fallback. Lava Cave 75/76 is dropped until confirmed (§5)                                                      |
| 5   | Settling, prediction and rebinding assume one card                                                       | **Accepted.** `dropId`, `isRandomizingCommand`, rebinding, `onlyHeldCardMoved` by reference, ≤5 held or settling (§4, §8)                                                                                                                                           |
| 6   | The rectangle sweeps lower stages, Energy, pile tops and uncontrollable cards                            | **Accepted.** Item normalisation; the rectangle stays in one half, skips piles and uncontrollable cards; the header names the owner (§1–§3)                                                                                                                         |
| 7   | A Pokémon behaves differently alone vs in a group                                                        | **Accepted.** Kept deliberately and labelled; both cases tested (§3)                                                                                                                                                                                                |
| 8   | Shift and Ctrl collisions (Shift+G, Shift+→, Enter; browser Ctrl+D/L/H)                                  | **Accepted.** Shift is ignored in group mode; `x` and Ctrl/⌘+A; Shift+Enter, Shift+Arrow and Shift+A cut; keys are rebindable in the catalogue. The platform modifier is used only for click, never for action keys                                                 |
| 9   | Mac Ctrl+click is a right-click; click `detail`                                                          | **Accepted.** ⌘ on macOS, Ctrl elsewhere, Shift everywhere; Mac Ctrl+click is the group menu; modifier clicks ignore `detail`; press-then-drag adds; the "drag makes it the selection" claim is corrected                                                           |
| 10  | No arrow-key focus model                                                                                 | **Accepted.** Shift+Arrow cut; Ctrl/⌘+A's container fallback chain (§2)                                                                                                                                                                                             |
| 11  | Touch: tap-again-to-read, bar width, viewer hold                                                         | **Accepted.** Read-again off in the mode; peek release toggles; long press on a selected item opens the group menu; a `TouchCardBar` variant (280 px with Select, at most 4 buttons); one mode for the table and the viewer; finger rectangle                       |
| 12  | The viewer is modal; Esc; felt press; stacked tiles                                                      | **Accepted.** Modifier or mode taps pass outside-dismiss; today's Esc kept; felt-press clear recorded in the PX; stacked tiles cycle copies; the Shift-all rule cut                                                                                                 |
| 13  | Log: `CardsResolved` exists; V-UNION reads "evolved"; old batches have runs                              | **Accepted.** Reuse `CardsResolved` + `cardNames`, fold only `steps` batches, a name-based joined-card rule, one line per source; the claim corrected (§6)                                                                                                          |
| 14  | Drag rendering and per-frame cost                                                                        | **Accepted.** Outcome once per target change; ≤5 carried; `TableDepthDirector`, `card-composition` and the carry paths in WP3; the rectangle commits on release; the hint-cache claim removed; a 4× throttled trace                                                 |
| 15  | Announcements and listbox                                                                                | **Accepted.** A separate replaced status region, coalesced; `aria-pressed` tiles kept; the count in the grid label; the order in names                                                                                                                              |
| 16  | Plan file split, `extend` vs `toggle`, PX clash, locales                                                 | **Accepted.** `CardSelected.mode: 'replace'                                                                                                                                                                                                                         | 'toggle' | 'add'`replaces the boolean`toggle` (kept as an alias for one release); the selection-mode flag in Phase 0; numbers at merge; only the main session runs i18n and the API surface; the extra files are listed in the plan |
| 17  | Test gaps                                                                                                | **Accepted.** The matrix is in the build plan (flat and tilted, WebKit and Firefox modifiers, two browsers and a spectator, chaos, a performance trace, the card formats, Esc, rebinding, annotations, one vs two, undo after the opponent)                         |
| 18  | The order rule flips by destination                                                                      | **Accepted.** One rule: item 1 lands first; the menu says which ends on top; the rectangle and Ctrl/⌘+A in reading order                                                                                                                                            |
| 19  | Duplicate pieces; the Stadium accepts any 4                                                              | **Accepted.** Distinct-part partition; the Stadium takes one key or one card                                                                                                                                                                                        |
| 20  | Clearing and restoring the selection                                                                     | **Accepted.** Accepted actions clear it; a refusal restores it; `replace` clears it (stated)                                                                                                                                                                        |
| 21  | `b` vs `g` on a lone piece                                                                               | **Accepted.** `b` joins a lone piece to its unfinished Pokémon (recorded in the PX)                                                                                                                                                                                 |
| 22  | Frame size underestimated                                                                                | **Accepted.** The worst case (60 items, 16 eight-card Pokémon) is tested under 64 KiB; steps capped at 120                                                                                                                                                          |
| 23  | Bench gap index                                                                                          | **Accepted.** It counts only the staying Pokémon                                                                                                                                                                                                                    |

Rebutted: none. One partial adaptation: the review's `ApplyCardSteps`
allowlist adds `SetCardAbilityUsed` and `SetCardOrientation`, so `w` and
`r` work on cards outside play as their single keys do.

[vunion]: https://www.pokemon.com/uk/pokemon-news/pokemon-v-union-arrive-in-the-pokemon-tcg
[morpeko]: https://www.tcgcollector.com/cards/36128/morpeko-v-union-vmax-climax-056-184
[split]: https://samuraiswordtokyo.com/blogs/news/two-part-stadium-cards-storm-emeralda-m6
[split2]: https://sealedvault.com.au/blogs/journal/two-cards-one-stadium-the-split-stadiums-of-storm-emeralda
[m6]: https://pokemoncard.io/article/japanese-m6-storm-emeralda-set-revealed-featuring-mega-rayquaza
[tts]: https://kb.tabletopsimulator.com/player-guides/basic-controls/
[cockatrice]: https://anoda.substack.com/p/how-to-play-star-wars-unlimited-tcg
[sync]: https://help.syncfusion.com/php/kanban/selection-and-hovering
[devx]: https://demos.devexpress.com/Bootstrap/CardView/Selection.aspx
[kinopio]: https://about.kinopio.club/posts/selecting-and-bulk-actions
