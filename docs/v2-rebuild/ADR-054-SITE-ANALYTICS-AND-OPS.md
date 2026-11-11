# ADR-054: Site analytics and the internal dashboard

- Status: **ACCEPTED**
- Decision date: 2026-11-11
- Request: an internal tool to follow how the website is doing, with the high-level details that matter most, in the spirit of Magic Circle's mcconfig.
- Builds on: ADR-051 (the beta on Workers Free), the server telemetry (`server-telemetry.ts`).

## What is measured

Two sources, both written to Workers Analytics Engine. It is free on Workers Free up to 100,000 events a day, keeps three months, and counts toward none of the Durable Object limits. ANALYTICS_LAYOUT (`packages/protocol/src/analytics-layout.ts`) names every column for the writer and the reader. Columns are only appended, never moved. The account must enable Analytics Engine once, in the dashboard; until it does, a deploy with the binding fails (code 10089). It was enabled on 2026-11-11.

**The server's events.** Every event the server already logs also becomes a row (`AnalyticsTelemetrySink`):

- requests the Worker answers, by route, status and time;
- rooms made, restored and deleted, with their mode and, when deleted, their move count;
- joins and refusals;
- moves;
- connections opened and closed, with the close code;
- rate limits that bit;
- saves;
- failures.

Moves are most of a game's events, so one accepted move in four is written, weighted 4. Every refused or failed move is written. Alarm bookkeeping and allowed rate-limit checks are not written. The edge's rows carry the visitor's country and Cloudflare data center; a room's own rows carry neither.

**Each page's report** (`PageReport`, `apps/web/src/telemetry/page-report.ts`) goes to `POST /v2/beacon` when the page is hidden or closed, at most twelve times a page. It carries:

- how the visit began: Solo, Play online, an invite link or a room code link;
- load timings:
  - first byte, first paint and largest paint;
  - time to table, from the request until the loading screen lifts off a ready table;
  - responsiveness (INP) and layout shift (CLS), by the Core Web Vitals' definitions;
- the median and slowest round trip of heartbeats and of moves (the session's new `observer`);
- time on screen;
- reconnects;
- script errors, counted and summarized by their first line with numbers and addresses folded out;
- the table shown, pointer kind, window size, interface language, the referring site's host and any `utm_source`.

The Worker turns the User-Agent into a browser family, a system and a device class, and adds the country. It keeps neither the User-Agent nor the address. The beacon accepts only same-origin requests, at most 30 per address per minute (`PAGE_REPORT_RATE_LIMITER`). It writes nothing but the row and answers 204.

**No one is identified.** There is no cookie, identifier or address. A player is counted by a date the page keeps for itself (`ptcgsim.visits.v1`: the UTC days of the first and latest visit). The report carries only "first visit ever / today / this ISO week / this month" and the days since the last visit. A page whose storage is refused counts as no player.

Cost:

- **A game:** at about 500 moves it writes about 150 rows (125 move samples, joins, connections, requests).
- **A visit:** writes 1 to 12 rows and makes the same number of Worker requests.
- **Daily ceiling:** at the ADR-051 ceiling of about 100 games a day, that is roughly 20,000 of the 100,000 daily events.
- **Past the event limit:** writes are dropped; the site is unaffected.

## The dashboard

`apps/ops` is its own Worker (`ptcgsim-ops`, workers.dev only) with a React page in mcconfig's manner. It has four views and a Setup page:

- **Overview** for one environment over 7, 30 or 90 days:
  - a headline strip: players, new players, games, moves, time to table and visits with errors, each a 7-day average against the 7 days before;
  - Players: daily players and new players, sources, countries, devices, browsers, systems and languages;
  - Games: Solo and online games, moves, joins, and moves per game;
  - Speed: time to table, the Web Vitals with ratings, the players' round trips, moves by kind, and requests by route;
  - Reliability;
  - Traffic, from the zone's own count of the beta's host, with 31 days of history from before the site counted itself;
  - Releases, marked on every daily chart.
- **Live:**
  - whether the beta, the preview and v1 answer, and the build each runs;
  - today so far against yesterday at the same hour;
  - each metric by the hour;
  - the free plan's day so far and where it is heading;
  - the latest events.
- **Budget:**
  - each Workers Free allowance today, projected to 00:00 UTC from yesterday's shape of the day, and each day of the range against its line;
  - use by Worker and by kind of Durable Object;
  - what a month of this use would cost on Workers Paid.
- **Errors:** script errors grouped by message, with first and last seen, browsers and builds; server failures, Worker exceptions, error responses, refused moves and joins, close codes, rate limits and the latest problems.

The browser names a view, an environment and a range. The Worker builds a fixed set of queries from those three checked values (`shared/queries.ts`), runs them, and returns each source's rows or the reason it has none. Each source fails on its own. The browser shapes the rows (`client/shape`), so the Worker stays within Workers Free's 10 ms of CPU. Answers are kept per isolate for 20 s (Live) to 5 minutes (Budget).

Sources:

- **Analytics Engine SQL:** the events above.
- **GraphQL:** Worker and Durable Object usage, and the zone's traffic.
- **The deployments and namespaces APIs.**
- **Health checks** of the three sites.

One read-only API token reads all of it: Account Analytics Read, Workers Scripts Read and Zone Analytics Read (secret `CLOUDFLARE_API_TOKEN`).

Protection fails closed. With nothing set, it serves only a page saying it is not set up. Any one of these lets people in:

- **Cloudflare Access:** the JWT is checked against the team's keys, issuer, audience and time;
- **a password** (secret `OPS_PASSWORD`, HTTP Basic, compared in constant time);
- **local development:** localhost only.

`pnpm --filter @ptcgsim/ops dev` runs the page and the Worker's handler under Vite with this machine's wrangler login. `dev:demo` serves generated data with no login.

## Not done

- **Server-side timing of a move.** A Worker's clock moves only while it waits on I/O (Cloudflare's Spectre mitigation), so a room's own processing reads 0 ms. The events still carry the durations, but the dashboard shows the players' measured round trips instead. A request's duration is its waits, on a room, storage or the network.

- **Alerts** (a daily check that mails when a limit is near) and **uptime history** (a cron probe). The Live view shows both at a glance, and a cron trigger would spend one of the account's five.
- **Retention cohorts** (day-1, day-7). They need an identifier per player, which this deliberately does not have. The visit flags give daily, weekly and monthly players and the returning share.
- **v1's own numbers.** v1 is not on Cloudflare; the dashboard only checks that it answers.

## Verification

- **Unit tests:**
  - the layout's fit;
  - every event's row;
  - sampling;
  - the beacon's checks and its row;
  - user-agent families;
  - the page reporter: visits, timings once, counters per report, no report for a page hidden from load, at most twelve;
  - the session observer;
  - the dashboard's queries (one dataset each, columns that exist, time-bounded, GraphQL windows within 31 days);
  - Access JWTs (forged, expired, wrong audience or issuer, key rotation) and the password;
  - the API (per-source failures, caching, demo, validation);
  - every view's shaping, and a render of every view.
- **On the real account:** the GraphQL queries ran against it before shipping.
