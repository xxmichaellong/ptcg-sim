# ADR-029: current decks in the picker, from Limitless

- Status: **ACCEPTED**
- Decision date: 2026-10-14
- Scope: the deck picker's Popular decks menu, and the Worker that serves
  it a daily list of current tournament decks

## Context

The Popular decks menu came from v1: a fixed corpus of 168 lists across 22
seasons, the newest being nine 2023–24 decks. It is a good history and a poor
picture of what people play now. The owner asked whether decks could come
from Limitless.

Limitless publishes a documented public API for the online tournaments run
on play.limitlesstcg.com
([docs](https://docs.limitlesstcg.com/developer/tournaments)). It is free and
needs no key below 50 requests per five minutes. It allows browser calls
(`Access-Control-Allow-Origin: *`). A tournament's standings carry every
player's placing, archetype and full list (name, set, number, count). Lists
converted to text import through the same Limitless endpoint the deck import
already uses (`limitlesstcg.com/api/dm/import`). Checked on a real list: all
60 cards resolved. Official majors (Regionals, Internationals, Worlds) are on
limitlesstcg.com, with no documented API.

## Decision

1. **The server fetches, once a day.** A cron trigger (06:17 UTC) asks one
   Durable Object, `PtcgDeckFeed`, to refresh. It takes the 12 largest
   Standard events of at least 64 players that finished in the last two
   weeks. That is one list request plus 12 standings requests. A request
   that finds no lists, or lists over 30 hours old, triggers a refresh too.
   Attempts are serialized and at least ten minutes apart. A failed one
   keeps the lists already stored. Players never call Limitless, so its
   rate limit is spent once a day, not once per player.
2. **What is kept.** For every archetype that made a top 8, keep its best
   finish: higher place, then the bigger event, then the newer one. Order
   archetypes by how many top 8s they made, up to 40. Each deck is named
   "Archetype — 1st of 285". Expanded is left out: it has had no sizeable
   online events on Limitless since early 2025.
3. **Everything from Limitless is untrusted.** Responses are capped at 4 MB
   with a 15-second deadline. A list is kept only if every card line is well
   formed (bounded name, no control characters, simple set and number codes)
   and the deck has exactly 60 cards. The client decodes the feed with the
   same bounded decoder as the built-in corpus.
4. **`GET /v2/decks/current`** returns the lists with their source and fetch
   time, cacheable for 15 minutes. While there are none it answers 200
   `{ available: false }` (a 503 would log a console error on every visit). The
   client asks only when the menu first opens. When the request fails, the
   menu shows the built-in seasons alone and retries a minute later.
5. **Credit.** The current group carries a line crediting Limitless, linked to
   its completed tournaments, with the update date. The API terms ask for none.
   The community's data is theirs.
6. **Optional key.** `LIMITLESS_API_KEY`, a Worker secret, is sent as
   `X-Access-Key` when set. Limitless gives keys to public projects for
   higher limits. The daily refresh does not need one.

## Consequences

- The picker has a current Standard group of about 25–40 archetypes,
  refreshed daily, ahead of the v1 seasons.
- A new outbound dependency, contained: if Limitless is down or changes shape,
  the menu keeps the last good lists or, failing that, the built-in ones.
- One new Durable Object class and one cron trigger in both Wrangler
  environments. Preview and production each keep their own feed.
- Official major-event lists stay out until Limitless offers an API for them
  or permission to use them.
