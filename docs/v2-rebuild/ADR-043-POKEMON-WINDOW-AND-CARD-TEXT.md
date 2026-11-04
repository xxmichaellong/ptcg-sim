# ADR-043: the Pokémon window, card text on the table, and cards a player writes

- Status: **ACCEPTED** (2026-11-04, the owner's request: "rendering the
  attacks and abilities etc. into clickable buttons that obviously don't do
  anything besides say in the chat that I used the ability", a structured
  window in place of the stack view's row of cards, and "granular control
  … so I can basically create a card in any way that I want, or edit
  existing cards to behave differently").
- Decision date: 2026-11-04
- Number: 043; its parity exception is PX-083 (the window and named
  moves).
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
   named only with a Pokémon everyone can see.
6. **Who may press what.** Damage, conditions, reminders and the marker
   are anyone's at the table, as the card menu's are (the room's policy);
   a spectator or a replay presses nothing. Moves are their Pokémon's
   player's (either seat's at a Solo table); the other player's are read,
   not pressed. A Benched Pokémon's attacks are read too.
7. **The window's presses need no menu open.** They are overlay actions
   with the `window` origin (as the palette's are direct), and they leave
   the window open.

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
