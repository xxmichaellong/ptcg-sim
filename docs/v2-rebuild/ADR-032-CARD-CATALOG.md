# ADR-032: a server-built card catalog, searched in the browser

- Status: **ACCEPTED**
- Decision date: 2026-10-15
- Scope: where the deck builder's card data comes from, how it reaches the
  browser, and how legality is decided

## Context

The deck builder searched cards at runtime against TCGdex's REST API: one
name search, then up to 150 card-detail requests at eight at a time, plus a
request per set for release dates. A search for "Charizard" took 3 to 5
seconds. It could search by name only, because TCGdex's REST filters cannot
reach inside attacks, abilities or weaknesses, and TCGdex sends
`Cache-Control: no-store`, so nothing was ever reused.

The owner asked for every filter Limitless's card search offers (type,
stage, HP, attack cost, ability text, weakness, resistance, retreat,
regulation mark, set, legality, rarity, illustrator, …), and for it to be
fast and current. The sources, measured on 2026-10-15:

- **TCGdex** (MIT, keyless, `Access-Control-Allow-Origin: *`) adds sets on
  release day. Its GraphQL endpoint answers one set's cards, every field,
  in one request (`cards(filters: { id: "sv06-" })`, about 0.4 s), and every
  set's metadata in another. It lacks a few mechanics: Tera, Ancient,
  Future, the Battle Styles, Team Plasma, Ultra Beast, and ACE SPEC before
  Scarlet & Violet.
- **pokemontcg.io** has the richest fields but closes on 2027-03-01, failed
  6 of 18 probes, and marks about 2,000 rotated cards Standard-legal.
- **Limitless** has no card API, but its image CDN has scans by set code and
  number for the sets TCGdex has no image of.

## Decision

1. **The server builds the catalog; the browser searches it.** A Durable
   Object, `PtcgCardCatalog` (one instance, `tcgdex-en`), keeps every English
   card from TCGdex in a compact wire format
   (`packages/deck-core/src/catalog-wire.ts`). The browser loads it once
   (ahead of the deck screen, once the table is idle: ADR-033 §12) and
   filters it in memory, so a search is a filter over ~24,000 cards, under
   a millisecond, with the Limitless query syntax
   (`packages/deck-core/src/card-query.ts`).
2. **One set per step.** A refresh (the daily cron, `17 6 * * *`, shared
   with the current-decks feed; or a request that finds no catalog or a
   list of sets over 30 hours old) fetches TCGdex's list of sets and queues
   the sets that are new or whose card count changed, newest first, plus the
   fourteenth of the rest fetched longest ago, so every set is fetched again
   within two weeks; when normalize.ts keeps more of a card
   (`CARD_CATALOG_NORMALIZATION`), every set stored with less is queued,
   and the next version has them all. Each alarm fetches one set, normalizes it
   (`apps/server/src/card-catalog/normalize.ts`) and stores its JSON as one
   value, keyed by its hash, so no invocation parses more than one set. A first build is 220
   steps a second and a half apart; it publishes every 20 sets, so search
   works within a minute of a fresh deploy.
3. **Versions are content hashes.** The catalog's version hashes every set's
   stored JSON and the ban list, so it changes only when a card does. A
   version keeps the ban lists it was made with, so its body never changes;
   a deploy that changes `bans.ts` makes the next request refresh, and the
   new lists come with a new version.
   `GET /v2/cards/catalog` names the version and its body's URL (cached five
   minutes; while a first build has nothing, a 200 saying `building`, which
   the loader asks again on, never a logged 503). `GET
/v2/cards/catalog/<version>.json` is the body, assembled by joining the
   stored sets' JSON without parsing them, cached for a year as immutable,
   and kept in the location's edge cache. A version names the stored value
   of each of its sets, and a value is removed only once no published
   version names it, so a set refetched mid-refresh never changes the body
   being served. The browser's HTTP cache keeps it
   between visits; the last body that loaded is also remembered, so a visit
   whose manifest request fails still has cards.
4. **Set codes and numbers are Pokémon TCG Live's and Limitless's**, so a
   pasted list and the catalog agree: a card's id is "TWM 130". Codes come
   from a checked-in table (`set-codes.json`, from
   `scripts/card-catalog/build-set-codes.ts`); a set released later is
   looked up from TCGdex's REST API and remembered once it has one (a set
   TCGdex hasn't given one yet is asked again when next fetched). A short override
   list covers promos (`SP`, `SMP`, …), folded subsets and old collisions.
   Numbers drop leading zeros ("TG01" is TG1) and promo prefixes ("SWSH022"
   is SP 22).
5. **Mechanics TCGdex lacks** come from `tags.json`, built once by
   `scripts/card-catalog/build-tag-table.mjs` from the Pokémon TCG API's open
   data (1,113 cards) before it closes; the rest come from TCGdex's suffix,
   stage, rarity and the card's name.
6. **Legality is the card's, not the print's.** Prints with the same name and
   rules share a print group: in Standard and Expanded an older print stands
   in for a reprint only when its text is functionally the same (the TCG
   Tournament Handbook, 4.1.3), so Neo Genesis's coin-flip Super Rod is not
   today's but Ultra Ball DEX 102 is. Text is compared after undoing
   wording-only changes ({C} spelled "Colorless", "his or her", "Shuffle
   your deck afterward", the old Supporter and Stadium reminders, …), and a
   few staples reworded further, or made one card by official errata (Rare Candy, whose older prints are played as today's), are listed by name
   (`packages/deck-core/src/reprints.ts`). A Trainer TCGdex has no text for
   yet is legal where the newest print of its name is, and lends that print
   nothing. Pokémon alike in all that are one card only when their
   Weakness, Resistance and Retreat agree, modifiers included (Electrike
   AR 63's +10 Weakness is not ROS 24's ×2); a print TCGdex gives no
   Weakness (some promos) is taken for the newest it matches. Each piece of a card printed in pieces (V-UNION, LEGEND) is its own group, though TCGdex gives every piece the whole card's text, and a LEGEND half's stage is LEGEND, not the Basic TCGdex says. A Trainer's kind does (Base Set's Bill, an Item as
   the rules play a Trainer printed before kinds were, is not the Supporter
   Bill); its subtitle doesn't ("Boss's Orders (Giovanni)"); a Basic Energy's group is its type; TCG Pocket's cards
   keep to their own groups. A group is legal in a format when TCGdex
   marks any of its prints legal there (so a rotated print is legal through
   a legal reprint), Basic Energy is legal whatever its set (but Fairy
   Energy left Standard with the Fairy type), TCG Pocket cards nowhere, and
   the Expanded ban list (`bans.ts`, 49 prints) bans every print of a banned
   card. Standard bans none. TCGdex calls some Special Energy "Normal"
   (Reversal, Prism, Team Rocket's); only the nine Basic Energy names are
   taken as Basic.
7. **Images** are TCGdex's (600×825 WebP for the table, 245×337 for
   results; CORS-enabled). Where TCGdex has none, the card uses Limitless's
   scan, for the series Limitless covers; a card with neither is left out.
8. **Everything from TCGdex is untrusted.** Each response is capped at 8 MB
   with a 20-second deadline; values are checked and a card that doesn't fit
   is left out. A failed request holds the next one back ten minutes (stored,
   so it survives eviction); a set that fails three times keeps its last
   stored cards until the next refresh.

## Numbers (live build, 2026-10-15)

- 220 sets, 23,687 cards, 17,391 distinct cards; 3,486 prints legal in
  Standard and 15,271 in Expanded.
- A full build makes 229 requests (about 31 seconds of TCGdex time).
- The body is 7.9 MB of JSON: 1.27 MB gzipped, 0.60 MB with brotli at its
  best and about 0.79 MB as Cloudflare compresses it.
- Parsing and decoding it takes about 150–250 ms on a desktop.

## Consequences

- Card search is instant, works offline once loaded, and every filter the
  builder offers is a local predicate. A new TCGdex set reaches players
  within a day without a deploy.
- A new Durable Object class in both Wrangler environments, and a second
  task for the daily cron. Nothing needs provisioning.
- `tags.json` is frozen history. Mechanics introduced after the Pokémon TCG
  API closes must come from TCGdex's fields or a new source.
- The ban list is code. A change to the official list is a one-line change
  to `bans.ts`, which changes the catalog's version.
- The old runtime TCGdex search (`tcgdex-card-catalog.ts` and its modules)
  is superseded and goes when the redesigned deck builder lands.
