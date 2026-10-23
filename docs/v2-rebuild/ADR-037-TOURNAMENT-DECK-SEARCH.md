# ADR-037: tournament deck search, from Limitless's online events

- Status: **ACCEPTED**
- Decision date: 2026-10-22
- Scope: the Worker's tournament deck index and the routes the deck screen
  reads it through
- Builds on: ADR-029 (current decks from Limitless)

## Context

The deck screen offers built-in seasons and, since ADR-029, a daily list of
current archetypes. The owner asked to search decks by name, as Limitless
does, and to pull any player's list from any tournament.

Limitless's public API (play.limitlesstcg.com/api) covers its online
tournaments: 16,898 Pokémon TCG events since 2021, 824,026 entries. It needs
no key, allows browser calls, and allows 50 requests per five minutes per
caller. A tournament's standings carry each player's placing, record,
archetype (`{ id, name, icons }`) and full list. Nothing in the API
searches: a search by name has to be built from the standings. Without a
key, a Worker shares that limit with whatever else reaches Limitless from
Cloudflare's addresses. A key, which Limitless gives to public projects,
gives it a bucket of its own.

Official majors (Regionals, Internationals, Worlds) are a different matter.
limitlesstcg.com has no API for them. Its Labs site reads an undocumented
JSON API. RK9's terms forbid scraping, and pokedata.ovh's data is scraped
from RK9.

## Decision

1. **One index, built slowly.** `PtcgDeckIndex` is one SQLite Durable Object
   (`deck-index/`). It holds:
   - tournaments;
   - each one's standings;
   - lists, each kept once by a hash of its text;
   - archetypes;
   - FTS5 tables over archetype and tournament names.

   An alarm step makes at most one request:
   - It reads the whole tournament list once, in pages of 1,000.
   - Every half hour, it reads the newest pages until a page holds only
     tournaments it knows that are over two days old.
   - It reads one finished tournament's standings per step. Recent Standard
     events of 32 or more players go first, then by newest and biggest. The
     rest of history follows over the next days.
   - Events under 30 days old are read again weekly, conditionally with
     `If-None-Match`, because Limitless re-categorises decks.

   Only Standard and Expanded events of at least 8 players and real dates
   are read; their lists are 60 cards. One listed before it had them (players
   still registering, no format yet) is taken up once a later page shows it
   worth reading. One listed again in a format whose lists aren't kept
   leaves the search with its lists, and a read ending after that keeps
   nothing. The daily cron and the first request
   start the crawl, and the alarms keep it going.

2. **A budget well under the limit.**
   - At most 30 requests in any five minutes. The crawl may use 20 and
     players opening a tournament not read yet 15 (read at once; two players
     asking share one read), so players always have 10 and the crawl 15.
   - With those spent, the route answers 503 `busy` with `Retry-After`.
   - A 429, or Limitless saying none are left, stops every request until its
     window resets.
   - A failure of Limitless holds the crawl back, longer each time; a 200
     whose body isn't a list counts as one, as do standings whose rows none
     read (what is stored keeps answering), and a page of the list refused.
   - A tournament whose read fails is retried an hour later, then two, and
     then left to players opening it. A player's read that fails while the
     event may still be running, or before the crawl's next try is due,
     spends none of those tries. Standings failing (or answering unknown)
     for two events or more, its list still answering, are an outage: once
     a standings read answers again, the events given up on during it, and
     those read while running whose final read failed, are due once more,
     their tries not reset, so one broken for good is retried a few times
     at most.
   - Limitless answering an id as unknown removes it; after two in a row,
     the rest are taken for Limitless refusing (nothing more removed, the
     crawl held back and moving on) until a standings read answers again.
     The run is kept with the index, so neither a list page nor a restart
     ends it.
3. **Everything from Limitless is untrusted, as in ADR-029.**
   - Responses are capped at 8 MB with a 15-second deadline.
   - Names are bounded single lines.
   - Ids, usernames, archetype slugs, icons and country codes must match
     their known shapes.
   - A list is kept only as a whole 60-card deck.
4. **Searching by name.**
   - Names are matched as a player types them: case, accents and apostrophes
     don't matter.
   - "ex", "V", "VSTAR", "VMAX", "GX" and "Mega" are optional, so "Gardevoir"
     finds "Gardevoir ex".
   - Any word of the archetype's name, its id or its icons matches at a word
     start.
   - Ranking:
     1. an exact name, without the optional words;
     2. then recent top-8 finishes, each worth log₂ of the event's size, half
        as much every 90 days back, over two years at most;
     3. then the name.
   - Only archetypes with a list in the asked format are shown.
5. **Routes.** All GET, with every parameter checked and unknown ones
   refused. JSON with the same security headers as the other routes. Cursors
   are opaque.
   - `GET /v2/decks/search?q=&format=STANDARD|EXPANDED&limit=1..20`:
     archetypes with their list count, top-8 count and best five finishes:
     from the last 90 days when there are any, by placing, then the bigger
     event, then the newer. Cached five minutes. While nothing has been read,
     the answer is `{ available: false }`.
   - `GET /v2/decks/archetype/<id>?format=&since=<days>&cursor=`: every
     finish with a list, best first, 50 a page, from the last `since` days
     (90 unless asked, at most 3,650). A page starts after the last finish
     of the one before (its cursor), so events indexed meanwhile neither
     repeat nor drop out between pages. A cursor the server refuses (one
     from before an update) starts the list over from its first page.
   - `GET /v2/tournaments?q=&format=&minPlayers=&cursor=`: newest first, 50
     a page, by name, from events that have started (one still registering
     has nothing to show). `hasLists` is null until the standings are read,
     and `organizer` is null (naming it would cost a request per event).
   - `GET /v2/tournaments/<id>`: standings by placing, those who dropped
     without one last, with a link to the source. Not found before the event
     starts, and not read for it. Cached a day once the event
     is over a day old and read after it ended, otherwise five minutes (an
     event under a day old is read again when asked after five minutes).
     Standings read while an event may still be running show only here: no
     deck's finishes, top 8s or ranking count them until it is read again
     once over. If every read after it ends fails, they stay that way
     (`unconfirmed`, never cached as settled) until the weekly resync reads
     it.
   - `GET /v2/tournaments/<id>/players/<player>/list`: the list as the text
     the deck import reads (`decklistText`), with its source link. Cached a
     week once settled.
6. **Credit and personal data.**
   - The deck screen credits "Tournament data: Limitless TCG", linked to
     each source page.
   - Only what Limitless shows is kept: a player's username, display name
     and country, per tournament.
   - There is no search by player and no view across a player's
     tournaments.
   - An event Limitless drops leaves the index when it is next read.
7. **Off switch.** `DECK_INDEX_SOURCE=off` keeps the index from ever calling
   Limitless. The browser specs set it and serve their own answers.
8. **Majors are out, for now.** They need either Limitless's permission
   (their Labs JSON, or an endpoint for majors) or the owner's decision. Until
   then the deck screen links to limitlesstcg.com's tournaments, and a list
   copied from there imports as any pasted list does.

## Consequences

- One new SQLite Durable Object class and binding in both Wrangler
  environments; the existing daily cron also starts its discovery.
- The first full read of history takes a few days at the budget. Recent
  Standard events come first, so search is useful within hours.
- An outbound dependency, contained:
  - If Limitless is down or changes shape, what is stored keeps answering.
  - If Limitless's limit is shared with others, a 429 slows the crawl and
    nothing else.
  - A `LIMITLESS_API_KEY` secret, when set, gives the index its own bucket.
- Storage grows to some hundreds of megabytes over the whole history: lists
  are kept once each, about 600 bytes apiece.
- Rows written, as Durable Objects bill them (index entries count), measured
  in workerd (`deck-index-runtime.test.ts`): 5 per event listed, about 3.5
  per player for an event's first standings (its list included), none for
  a page of the list that comes round unchanged, and about 3 (the event's
  own) for standings read again unchanged: a player's re-read asks with the
  ETag, and only changed players are written. Keyed tables are
  `WITHOUT ROWID`, with no separate index for their key; a database made
  before keeps its tables, at about 5 rows a player for a first read. A
  deck's finishes are read from its own entries, never by walking every
  event's. History
  is a couple of million rows, up to about a million a day while the crawl
  catches up: well within Workers Paid, far over the Free plan's 100,000 a
  day, which the whole account shares. On a Free account the index stays
  off (`DECK_INDEX_SOURCE`).
- `current-decks.ts` and the index share `limitless.ts` (bounded fetch,
  rate-limit header, decklist text). ADR-029's feed is unchanged.
