# ADR-043: the Pokémon window, card text on the table, and cards a player writes

- Status: **ACCEPTED** (2026-11-04, the owner's request: "rendering the
  attacks and abilities etc. into clickable buttons that obviously don't do
  anything besides say in the chat that I used the ability", a structured
  window in place of the stack view's row of cards, and "granular control
  … so I can basically create a card in any way that I want, or edit
  existing cards to behave differently").
- Decision date: 2026-11-04
- Number: 043; its parity exceptions are PX-083 (the window and named
  moves) and PX-084 (a card's own text, written in the deck screen).
- Amends: ADR-032 (the catalog's text reaches the table), ADR-001 (still
  manual: nothing reads the text to enforce a rule).

## Context

The catalog (ADR-032) holds every card's text: HP, types, Abilities,
attacks with their cost and damage, Weakness, Resistance, Retreat, and a
Trainer's effect. The deck screen showed it; the table never did. A deck
card became a table definition of a name, a picture and a content-hashed
id, so the table could not tell which print a card was.

Double-clicking a Pokémon in play opened v1's stack view: its cards laid
in a row over the player's half, nothing else. A lone Basic opened the
card itself. Using an Ability was the card menu's "ability used" marker
("Blue used Pikachu's ability"); an attack was the turn's Attack button
("Blue attacked").

## Decision

1. **Text reaches the table by print, not by copy.** A definition carries
   `print` ("OBF 125": the deck card's set and number, or its catalog id),
   and each viewer reads the text from their own copy of the catalog
   (`apps/web/src/board/card-text.ts`, `resolveCardText`). The catalog's
   text never travels with the deck, so a 60-card list stays far inside
   the room's 64 KiB frame. A room from before prints (or a deck card that
   has none) is looked up by its picture's address, and only under its own
   name (`findCatalogPrint`).
2. **A deck may give a card its own text** (`DeckCard.text`, game-core
   `CardText`): one made by hand, or a catalogued card edited to play
   differently. It travels with the definition (`CardDefinition.text`) and
   wins over the print's. Every field is bounded (`CARD_TEXT_LIMITS`: 4
   Abilities, 4 attacks, 600 code units a move's text, 1,000 the rules),
   checked by the room (`isCardText`, the protocol's schema, the
   invariants) and on loading a saved deck; a deck's own text altogether
   is at most 32,000 code units (`text_too_long`), so its LoadDeck message
   fits. Two prints that look the same on the table are still one
   definition (the first one's print stands for both); a card's own text is
   part of what makes it itself.
3. **The catalog reaches the table with the deck screen's script.** It is
   fetched the way the warm-up fetches it (every built file first, then
   the import), so a dropped connection can't leave it unloadable
   (`tableCardCatalog`). It is asked for only when a window opens on a card
   that needs it, and usually is already there from the warm-up.
4. **Every Pokémon in play opens in its window** (`PokemonWindow.tsx`),
   a lone Basic too. Its cards on one side: the Pokémon large, beside it
   the Stages under it ("Evolved from") over what is attached, Energy
   fanned with its types as symbols and Tools apart. On the other side:
   HP less damage as a meter, the damage stepper, the Special Conditions
   (the Active only), the reminders and the Ability marker; then its
   Abilities and attacks from its text, then Weakness, Resistance and
   Retreat. Side by side where there is room, one scrolled column on a
   phone (a container query on the window). A card pressed there is read
   large, and Back or Esc returns to the window; a card dragged out hides
   it as the pile viewers hide. A card in pieces (V-UNION, BREAK) still
   opens assembled first; Details opens its window.
5. **A move pressed is told by name, and does nothing else.** An Ability's
   Use is `SetAbilityUsed` with `ability`: it marks the Pokémon used (even
   when it already was: some Abilities are used more than once a turn) and
   the log reads "Blue used Charizard ex's Infernal Reign". An attack, for
   the Active Pokémon's player, is `DeclareAttack` with `attack` (the
   Pokémon and the name): exactly the turn's Attack (the loose board to
   the discard, the Ability markers off) with the log reading "Blue
   attacked with Charizard ex's Burning Darkness". No damage is dealt and
   no cost is checked (ADR-001). The window closes after either. The room
   resolves an attack only from the attacker's own Pokémon; a move is
   named only with a Pokémon everyone can see. Each move is pressed by its
   own button (Use, Attack), in one column on the moves' end, or under the
   move's text where they are narrow; the text is only read, so a tap to
   read it uses nothing. A Pokémon whose attacks the table doesn't know (no
   card text, or none written) has a plain Attack there instead, its
   `DeclareAttack` naming none (2026-11-05, since the rail has no Attack,
   PX-088).
6. **Who may press what.** Damage, conditions, reminders and the marker
   are anyone's at the table, as the card menu's are (the room's policy);
   a spectator or a replay presses nothing. Moves are their Pokémon's
   player's (either seat's at a Solo table); the other player's are read,
   not pressed. A Benched Pokémon's attacks are read too.
7. **The window's presses need no menu open.** They are overlay actions
   with the `window` origin (as the palette's are direct), and they leave
   the window open.

8. **A player writes a card's text in the deck screen**
   (`CardTextEditor.tsx`): HP, type, stage and what it evolves from; up
   to four Abilities (kind, name, text) and four attacks (an Energy cost
   built symbol by symbol, name, damage, text); Weakness and Resistance
   with their amounts; Retreat; and the rules (a Trainer's or Energy's
   effect, a Pokémon's rule box). `{R}`-style codes are drawn as Energy
   symbols. The custom card dialog has it as Card text (optional), so a
   card made by hand plays with its moves; the same picture with other
   text is another card. A card in the deck has Edit text (Add text for
   one with none) in its sheet, which writes the deck's own text for every
   copy of it, starting from what it says now. Use the printed text takes
   it off, and text saved back to the print's own is none. The sheet then
   shows the card's own text, marked Edited. Esc while writing puts the
   writing away, not the card. A card's own text survives the catalog's
   upgrades of the deck's facts and a swap to another print.

9. **What a card is, as the table reads it.** A BREAK is known by its
   name, or (one made by hand) by its stage or its BREAK layout. Its
   window adds the Stage below's moves, and takes that Stage's Weakness,
   Resistance and Retreat: the printed BREAK has none, and the catalog's
   Retreat 0 for it is no cost of its own. A BREAK given text of its own
   keeps what that says, the Stage filling the rest. One whose own text
   no one knows shows nothing of its Stage as its own (no HP, no
   stage). A card printed in pieces (V-UNION, LEGEND) is one Pokémon, and
   its window reads every piece's moves, each once.
10. **The window's damage is a field like any other.** A number typed is
    set when it is left, and also when the window goes another way: a
    press outside, a card dragged out, a move used, a card read large.
    Only Esc drops it. Steps (+, −, the arrow keys) go on from the number
    typed, else from the last one asked for, until the table shows it or
    four seconds pass. The number sits on a damage counter, in the table's
    counters' colors (yellow, orange from 50, red from 100, as the physical
    ones), an empty dashed slot at 0 (2026-11-05, the owner: the bare number
    was "really confusing").
11. **A hand-made card's id says what it is** (`customCardIdOf`: name,
    kind, picture, layout and its own text, its fields in one order), as
    the card dialog and a deck file make it. Edited, it is another card: its id follows
    (`textedCardId`), and it joins a card already in the deck that is now
    the same. The editor's history records each step's change of ids, so
    the sheet and the deck's cover follow the card through Undo and Redo.
    A catalogued print keeps its id; the sheet shows it as the deck now
    has it.
12. **A deck file keeps a card's text.** The simulator CSV gains a Text
    column after Presentation (`QTY,Name,Type,URL,Presentation,Text`),
    the card's own text as JSON, which an import checks as the table does
    (`isCardText`) and keeps through the catalog's facts. A row's own text
    makes it another card than the same print without it.
13. **Each Ability marked on itself, HP from effects, no attack damage**
    (2026-11-05). The owner: the window's reminders aren't needed, "just
    the ability used is the main one ... we should be able to mark that on
    the ability itself", for cards with more than one (Abilities,
    Poké-Powers, Poké-Bodies); a Pokémon's HP must go above what is
    printed ("a lot of cards ... can modify damage"), and so "refrain from
    rendering even the damage associated with an attack".
    - **Ability marks.** A Pokémon in play keeps the names of the
      Abilities marked used (`PlayStack.abilitiesUsed`, at most 8), read
      only while its marker (`abilityUsed`) is on: whatever turns the
      marker off (a new turn, an attack, an evolution) forgets them.
      `SetAbilityUsed` with a name marks that one (and the marker);
      not used, it takes that one's mark off, the marker with the last.
      Each Ability's row wears its own Used mark, a press of which (anyone
      at the table, as the marker) takes it off; the marker set from the
      card's menu, with no name, marks them all. Use is still the
      player's, and still told each time.
    - **HP from effects.** `SetHpModifier` sets what effects add to (or
      take from) a Pokémon's printed HP (`PlayStack.hpModifier`): a
      multiple of 10 up to 990 either way, kept through evolution as
      damage is. The window shows the HP as it stands, the change beside
      it ("+30", the printed HP its tooltip), with − and + by 10; the log
      reads "Blue set Pikachu to +30 HP".
    - **No reminders, no attack damage in the window.** Its markers are
      the Active's Special Conditions; reminders stay on the card's menu
      and the marker controls. An attack's row is its cost, name and text.

    Events that mark an Ability by name carry `named: true`; a named
    `StackAbilitySet` from before (the name for the log only) replays as it
    did, setting the Pokémon's marker alone, so a room's kept history
    still hashes as it was.

14. **Special Conditions stack as the rules say** (2026-11-06, the owner:
    "i should be able to select multiple special conditions? ... i'm pretty
    sure some of these conditions are stackable"). The rules (the rulebook;
    Bulbapedia, "Special Condition (TCG)"): Asleep, Confused and Paralyzed
    are shown by turning the card, so a Pokémon has one of them at most and
    a new one replaces the last; Burned and Poisoned are markers, and either
    or both can be on beside one of the three; going to the Bench, evolving
    and devolving take them all off.
    - **Kept in the one marker string the stack always had**
      (`PlayStack.specialCondition`): several conditions are written as their
      v1 letters in checkup order, space-separated ("P B Pa"; game-core
      `special-conditions.ts`). One condition and v1's typed marker (a word,
      or anything typed) are kept as typed. So nothing stored changes shape:
      rooms, replays, continuation saves and the snapshot schema (8) read as
      they were, `SetSpecialCondition` is unchanged on the wire, and a client
      from before shows several as one typed marker.
    - **A marker names conditions** only when every part names one and they
      may stand together; anything else is a typed note, which stands alone:
      putting a condition on takes a note off, and typing a note replaces the
      conditions. The room refuses a value whose parts are all conditions but
      break the rules ("A C", "P P"); a note stored like that before still
      loads, read as a note.
    - **The controls** (the window's chips, the marker controls, the
      palette): each condition on or off, the markers (Poisoned, Burned)
      apart from the three one at a time, a new one of those replacing the
      last; "Remove all conditions" when several are on. The marker
      controls stay open, on the Active, once the last condition comes off,
      for the next. The keys' cycle (v1's) still steps through single
      conditions, from the first on.
    - **On the card**, each condition is its own official chip (the Pokémon
      TCG Pocket icons the table already wore), all of v1's size. The first
      lies where v1 puts its marker; each other takes the first free place
      that stays on the card and clear of the damage counter, the Ability
      marker and the reminders: the middle of v1's marker row, above the
      first (below it on the opponent's side), then the damage's place when
      it has none. So on an upright Pokémon every marker can be read and
      pressed whatever else is on it (`condition-chips.test.ts` tries every
      combination). On a card turned a quarter, where v1's own row already
      crosses the Ability marker, the chips share that row, smaller, up to
      the damage counter.
    - **The log** tells them as they now stand: "Blue made Pikachu Poisoned,
      Burned and Asleep"; "Blue took Burned off Pikachu, still Poisoned".
      `ConditionSet` carries `conditions` (all of them) and `off` (taken off
      while others stay); `condition` stays the one marker a client from
      before reads -- the note, or the condition just put on. Presentation
      level 2: a level-1 client gets `condition` alone.

## Consequences

- The opponent sees which print each card in play is (its picture already
  said so) and, for a card a player wrote, its text; neither is sent for a
  card they can't see.
- A deck of hand-made cards with a great deal of text can be refused at
  the table with "Its cards' own text is too long for the table."
- The window is a parity exception (PX-083): v1's stack view is a row of
  cards. Its paint spec now checks the same cards, the Pokémon first and
  no smaller than v1's, every card upright.
- Card text is English, as the catalog is; the window's own words are
  translated.

## 2026-11-07: Options before artwork

ADR-049 extends this window pattern to hand, Prize, Stadium and loose cards. Joined Pokémon now open their options window first, with View whole card as an explicit action. Artwork returns to its window with tap/Escape; the corner close icon is removed. Compact attachment handles retain the complete individual-card list here.
