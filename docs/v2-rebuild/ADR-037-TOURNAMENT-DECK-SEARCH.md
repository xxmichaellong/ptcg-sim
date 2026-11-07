# ADR-037: tournament deck search, from Limitless's online events and majors

- Status: **ACCEPTED**
- Decision date: 2026-10-22; amended 2026-10-28 (majors from Limitless
  Labs, §8) and 2026-10-30 (majors first, online events opt-in, a format to
  pick, §9)
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

Official majors (Regionals, Special Events, Internationals, Worlds) are a
different matter. limitlesstcg.com has no API for them, and its pages show
only Day 2 lists. Its Labs site (labs.limitlesstcg.com) reads a JSON API at
mew.limitlesstcg.com with every Masters player's standing, archetype and
list, for every major since September 2024 (Baltimore). RK9's terms forbid
scraping, and pokedata.ovh's data is scraped from RK9. On 2026-10-28 the
owner confirmed Limitless's permission to read Labs.

## Decision

1. **One index, built slowly.** `PtcgDeckIndex` is one SQLite Durable Object
   (`deck-index/`). It holds:
   - tournaments;
   - each one's standings;
   - lists, each kept once by a hash of its text;
   - archetypes;
   - FTS5 tables over archetype and tournament names.

   An alarm step makes at most one request:
   - It reads the whole tournament list once, in pages of 1,000, to a page
     with nothing on it (Limitless may send fewer than asked for), or one
     past the first with nothing new and past the oldest event it reached;
     short of that, the list moved on while the crawl was off, unless the
     page repeats the one before three times in a row (a page number
     Limitless ignores). A backfill left by an older build, its page alone,
     takes the oldest event listed for where it reached.
   - Every half hour, it reads the newest pages until a page holds only
     tournaments it knows that are over two days old, 20 pages at most a
     run; a run that ends at 20 among new events (the crawl off for
     months) goes on from there the next time. A run, or the backfill,
     keeps the oldest event it has reached with every page, and isn't over
     until it goes past it, however far the list moved on while the crawl
     was off (turned off by a deploy, say) part-way.
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
   - A failure of Limitless holds the crawl back, longer each time;
     standings whose rows none read count as one (what is stored keeps
     answering). A page of the list refused, a 200 whose body isn't a list,
     or a page none of whose events read holds the list alone back the same
     way, said as a failure each time: standings are read meanwhile.
   - A tournament whose read fails is retried an hour later, then two, and
     then left to players opening it. A player's read that fails while the
     event may still be running, before the crawl's next try is due, or once
     the crawl has given up on it, spends none of those tries, and players
     don't ask for it again for five minutes. Standings failing (or answering unknown)
     for two events or more, its list still answering, are an outage: once
     a standings read answers again, the events given up on during it, and
     those read while running whose final read failed, are due once more,
     their tries not reset, so one broken for good is retried a few times
     at most.
   - Limitless answering an id as unknown removes it; after two in a row,
     the rest are taken for Limitless refusing (nothing more removed, the
     crawl held back and moving on) until a standings read answers again.
     The run is kept with the index, so neither a list page nor a restart
     ends it. The crawl's next read is then one elsewhere: the newest event
     read before and not asked for in the last hour, asked again with its
     ETag, else the one waiting that would be read last. It answering tells a batch Limitless removed from
     Limitless refusing: the run ends and the next of the batch are
     removed, rather than each held back for and tried again for hours.
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
   `wrangler.jsonc` sets it for production and the preview until the
   account is on Workers Paid, so a deploy that forgets `--var` doesn't
   crawl; a deploy's `--var DECK_INDEX_SOURCE:on` (or the config) turns it
   on. Off, the tournaments listed are only those read, since any other
   answers "not found" when opened.
8. **Majors, from Limitless Labs** (2026-10-28, with Limitless's
   permission; `deck-index/labs.ts`). The same index holds them, in a lane
   of their own:
   - **Masters only.** No other division is ever asked for: the others are
     minors.
   - **Discovery.** Labs' list of majors (`tournaments`) every six hours, and
     at once on the daily cron. A major joins once it is over (`completed`).
     It is `labs-0077` in the index (Labs' number, four digits), named as
     limitlesstcg.com names it ("Regional Nice", "Special Event Lima", "LAIC
     2025–26, São Paulo", "World Championships 2026"), Standard (every
     major on Labs is), and found by its kind's words too ("regionals",
     "worlds", "major").
   - **Reading one.** Its state (`tournament`), then its standings
     (`standings`), then each player's list (`decklist`), one request each,
     best placed first, the newest major's first. Labs sends no ETag:
     `updated_at` is the major's version. A major is checked daily for 17
     days from its start, and its standings read again only when the version
     changed. A list read is kept; one Labs newly has is wanted; one Labs
     answers without is never asked for again.
   - **Its own pace.** One request every 2 s at most (`MAJORS_POLICY`),
     separate from the online API's budget, which it never touches. A 429
     holds the lane for as long as Labs says (five minutes if it doesn't,
     30 at most); Labs down or answering what can't be read holds it 30 s,
     doubling to 30 minutes. The online crawl goes on meanwhile, and its
     own pace is unchanged.
   - **Players.** A major's standings show every list Labs has, read or not.
     Loading one not read yet reads it at once (ten a minute at most, besides
     the lane). A major is never read on demand: it shows once the lane has
     read it.
   - **Shown.** `kind` on every tournament (`online`, `regional`, `special`,
     `international`, `worlds`); `GET /v2/tournaments?kind=major` lists
     majors alone; source links go to Labs' standings and decklist pages.
     Majors' finishes count in deck search as online ones do (a top 8 at a
     2,000-player Regional weighs log₂ 2,000).
   - **Not covered.** Majors before September 2024 (only Day 2 lists on
     limitlesstcg.com), League Cups, and Japanese and Korean events, which
     Labs doesn't list.
9. **Majors first; online events when asked; a format picked** (2026-10-30,
   the owner: "we should only support tournaments that are sanctioned at
   the regional level or higher, not these random online tournaments. or at
   least that should be what's most important. being able to sort by format
   would also be incredibly important").
   - **The deck screen shows majors alone by default.** Deck search, the
     Tournaments shelf and a deck's All lists ask for `kind=major` until
     the player turns on **Online events**; the choice, and the format, are
     one preference (`ptcgsim.tournaments.v1`) shared by the three and kept
     between visits.
   - **Format.** A Standard / Expanded control beside it (the formats whose
     lists the index keeps; GLC, Standard JP and the others are skipped when
     listed). Every event row and every finish names its format and, for a
     major, its kind ("Regional · Standard · 2,336 players"). Every major
     on Labs is Standard: Expanded with majors alone asks nothing and says
     "No majors in Expanded", with Show online events beside it.
   - **Routes.** `kind=major` on `/v2/decks/search` and
     `/v2/decks/archetype/<id>` too: a deck's counts, ranking and finishes
     from majors alone. Without it, as before, every event counts, but
     majors come first:
     1. **Ranking.** After an exact name, decks are ordered by their major
        results (a top 32 at a major, each worth log₂ of its size and half
        as much every 90 days back), then by their online top 8s, weighed
        alike, then by name: a deck with a major result ranks above one with
        online results alone. A top 32, not a top 8: a Regional's thousands
        of players would leave most decks without a top 8 there.
     2. **Finishes.** A deck's best finishes and its All lists put majors
        first, then placing, the bigger event and the newer. Its cursor
        carries which of the two it had reached (`m`); one from before has
        none and is refused, so the list starts over from its first page.
   - **Finishes name their kind.** `kind` (`online`, `regional`, `special`,
     `international`, `worlds`) on each finish's tournament; the page reads
     one without it as online.

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
- Majors, measured in workerd: 6 rows to list one, about 2.1 a player for its
  standings and 2 for each list (the list's row, the player's again): about
  4 a player, some 8,000 for a 2,000-player Regional. A daily check finding
  the version unchanged writes 1; standings read again unchanged, 3. A season
  (about 37 majors, 64,000 Masters players) is about 260,000 rows; the
  backfill since September 2024 (78 majors) about 550,000, spread over the
  days it takes.
- Requests to Labs: about 2,300 for a 2,300-player Regional (two for its
  state and standings, one a list), some 80 minutes at the lane's pace; a
  season about 65,000; the backfill about 140,000, some 75 hours. Labs
  offers no endpoint for many lists at once: one from Limitless would make
  a major one request.
- Labs' API is undocumented: its paths, the `{ ok, message }` wrapper, its
  fields and the four-digit player numbers can change without notice. A
  change reads as nothing readable, which holds the lane back and leaves
  what is stored answering.
- Seniors and Juniors are minors, and never read. Masters' names and
  countries are kept as Labs shows them, as online players' are.
