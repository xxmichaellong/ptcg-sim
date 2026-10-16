# ADR-033: the deck screen — saved decks, one-step import, real rules

- Status: **ACCEPTED**
- Decision date: 2026-10-15
- Scope: the deck screen (`apps/web/src/features/deck/`), the deck model and
  rules in `@ptcgsim/deck-core`, and how decks reach the table. The card
  data behind it is ADR-032.

## Context

The deck screen was v1's, reshaped: a decklist column (paste, Popular decks,
Random, card back, language) beside a builder (name search, two sort
controls, a deck grid). The owner asked for it to be redesigned: "you have to
go through so many steps just to import a deck", "the UI is kind of all over
the place", "every filter you could think of", and a way to "save decks and
name them". They asked for the logic to be reviewed for the right
primitives, scale, persistence and accuracy, with Limitless TCG's card search
and deck builder as the bar.

What the review found:

- **Importing took four steps.** Paste, Import, a full-screen table of rows
  with image URLs to check, Confirm, and only then Play. Two P1/P2 toggles
  (one per column) chose the seat.
- **Nothing was saved.** The "Saved" badge meant only that the edit was in
  memory; a reload lost every deck.
- **The deck model kept no identity.** A deck was `Record<name, {cards:
[{data, count}]}>`, where `data` was whatever the source gave: a TCGdex
  object from search, `{name, supertype, image}` from an import. A card's
  set and number were lost on import, so a deck could not be exported in
  Pokémon TCG Live's format or checked against a format.
- **The rules were wrong.** Every Energy card was exempt from the copy
  limit (four Special Energy is the limit). There was no Basic Pokémon
  requirement, no ACE SPEC, Radiant, Prism Star or Pokémon ☆ limit, and no
  format legality at all.
- **Search took 3–5 seconds and only matched names** (ADR-032).

Research across Limitless, Pokémon TCG Live, pokemoncard.io, the official
card database, pkmncards, Moxfield, Archidekt, Hearthstone, MTG Arena and
Fabrary pointed the same way: import in one gesture and never overwrite,
save automatically, give the deck the most room, group it the way players
read it, make filter chips and typed syntax one query, check rules live and
specifically without blocking, and go from deck to table in one click.

## Decision

### The model (`@ptcgsim/deck-core`)

1. **A deck is an ordered list of entries** (`DeckList`), each a
   self-contained `DeckCard` and a count. A card's `id` names its printing
   ("TWM 130", or `custom:…` for one made by hand); entries of the same id
   merge, and two printings of one card are two entries. A card carries what
   the table needs (name, kind, images, layout) and, when the catalog knows
   it, the facts the rules check (stage, ACE SPEC/Radiant/Prism Star/☆,
   Trainer and Energy kind, regulation mark, legality, evolution line). A
   saved deck therefore opens, plays and validates with no catalog at hand.
   The v1 grouped `Deck`, its deep-equality card comparison and its
   validation are gone.
2. **Rules are per format and return typed issues** (`checkDeck`):
   Standard, Expanded, Unlimited and TCG Pocket. 60 cards (20 in Pocket);
   at least one Basic Pokémon; four of a name (two in Pocket) counted across
   printings, a Trainer's subtitle ignored ("Professor's Research
   (Professor Turo)"), Basic Energy unlimited; one ACE SPEC, one Radiant
   Pokémon and one Pokémon ☆ per deck; one of each Prism Star card; legality
   from the catalog, reprints included; no Energy in Pocket; TCG and Pocket
   cards never mixed. Each issue names the cards it is about. A card typed in
   by hand is reported as unchecked, never guessed.
3. **Text formats.** `formatDecklistText` writes Pokémon TCG Live's export,
   which every deck site reads. The v1 `QTY,Name,Type,URL` CSV stays readable
   and writable.
4. **Matching a list line to a printing** (`resolveDecklistRow`): set and
   number (promo codes aliased: PR-SV → SVP), then the name in that set
   (Limitless numbers some sets differently from TCGdex), then Basic Energy
   by name (every spelling, PTCGO's `Basic {R} Energy` included), then the
   name alone. `withCatalogFacts` gives decks made without the catalog their
   facts later, without changing anything the table shows.
5. **Search** is Limitless's syntax over the catalog in memory
   (`parseCardQuery`, `searchCatalog`): `t:`, `s:`, `is:`, `hp>=`, `ac<=cc`,
   `text:draw_3_cards`, `w:`, `rs:`, `rc:`, `reg>=`, `f:`, `e:`, `a:`, `r:`,
   `o:`, `u:`, comma for or, plus for and, minus for not. One tile per card,
   its newest ordinary printing, with every print a click away.

### Saved decks (`deck-library.ts`)

6. **Every deck is saved, automatically**, in IndexedDB, one record per deck
   (name, format, cards, cover, source, created and changed times). Edits
   apply in memory at once and reach storage batched per deck, and whatever
   is pending is written when the page is hidden. Another tab's change
   arrives on a BroadcastChannel and is read back, unless this tab changed
   that deck meanwhile. Records are decoded defensively and a bad one is
   skipped. Where IndexedDB is blocked, or a write fails (storage full),
   the library works for the visit and says so, on the deck list and in
   the editor, and the next write tries the failed decks again. There are no accounts; decks are this device's, and
   leave it as text or files.
7. **Seats hold decks; the library holds decks.** A seat (`DeckBuilderStore`)
   holds the deck it will play and a label: the saved deck it is, or the
   name of a list being tried. Editing a saved deck that is on a seat
   updates the seat. A seat calls its deck changed only when the table would
   see a difference, so a rename, a deleted saved deck, or facts arriving
   never reload a deck mid-game. Installing to the table (the LoadDeck
   receipts and drain) is unchanged.

### The screen

8. **Home first.** The deck screen opens on the player's decks: a paste box
   (and Ctrl+V anywhere on the screen, a dropped file, From clipboard, Open
   file), their saved decks as tiles (cover art, format, count and validity,
   seat badges), the decks winning now (ADR-029's feed, with cover art), and
   the classic decks by season. Choosing a tile puts it on the current seat;
   Play takes the seats to the table.
9. **Import is one step.** A pasted or dropped list becomes a saved deck,
   named from a `###`/`Name:` header or its main attackers ("Dragapult ex /
   Pidgeot ex"), put on the seat, with a toast saying how many cards. The
   review table is gone. Lines nothing could place come back as a list to
   look at in the editor ("Find it" searches for each); the rest still
   imports. A tried list (a tournament deck) goes on the seat without
   cluttering the library until it is saved or edited.
10. **The editor** puts card search beside the deck, the deck the larger
    side. Search has the typed syntax, filter chips (kind, then its stages,
    mechanics or subtypes; the eleven types), a drawer for HP, retreat,
    damage, attack cost, Weakness, Resistance, Ability, Rule Box,
    regulation marks, set, rarity, illustrator and evolution, a sort, every
    print on demand, and "only legal in this deck's format" on by default.
    Results render as the grid scrolls. Click adds, Shift+click removes,
    right-click opens the card; Enter in the search adds the first card, `/`
    focuses it. The deck is grouped by evolution line, then Supporters,
    Items, Tools, Stadiums, then Special and Basic Energy, as a list or as
    images, with a live checklist whose issues point at their cards, and
    opening-hand odds. Every change is saved and undoable (Ctrl+Z,
    Ctrl+Shift+Z). Card details show the card's text, legality and every
    printing, and can swap the deck's copies to another print or make the
    card the deck's cover. Export copies the list for Pokémon TCG Live or
    downloads it as text or a simulator file.
11. **On a phone** the seats wrap under the header and the editor's search
    and deck take turns behind two tabs.

## Consequences

- One paste and one click (Play) take a list to the table, and every deck
  survives a reload.
- Decks are checked by the real rules; some v1 decks that passed (five
  Special Energy, no Basic Pokémon) now show what to fix. The check never
  blocks Play: the table is a manual tabletop (ADR-001).
- Saved decks are per device. Moving them is by text or file; an account
  sync would be a later decision.
- The deck screen's markup is new; specs drive it through stable ids
  (`#nativeDeckBuilderCsvImport`, seat tabs, Play, the seat summary's
  `data-card-count`). The v1 deck-screen parity spec is retired (PX-045).
