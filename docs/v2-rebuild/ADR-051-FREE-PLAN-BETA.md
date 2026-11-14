# ADR-051: The beta on the Workers Free plan

- Status: **ACCEPTED**
- Decision date: 2026-11-10
- Request: host v2 for real as a beta beside v1, start on the free plan, and make it as cheap to run as possible. Room data may go after a day.
- Amends: ADR-007 (what a commit writes), ADR-025 (the edge rule, now named), ADR-044 (a Solo table is kept a day after its last use, not forever).

## Where it runs

Production (`ptcgsim-v2`) is the beta, at the Custom Domain `beta.ptcgsim.online`. Cloudflare keeps its DNS record and certificate. `ptcgsim.online`, `www` and the Zoho mail records stay as they are: v1 on Linode, DNS-only. Production has no workers.dev address, so every request passes the zone's rate limit. The preview keeps its workers.dev address and never inherits the domain (`"routes": []`).

## The budget

The account stays on Workers Free for now. Its Durable Object limits are per day and shared by every Worker in the account (the preview, the beta and anything else there): 100,000 requests, 13,000 GB-s of duration, 5 million rows read, 100,000 rows written, and 5 GB stored in all. Past any of them, operations of that kind fail until 00:00 UTC ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)). Rows written and duration run out first.

Three changes cut both:

1. **No journal.** Each move wrote five rows: the snapshot, its frontier, a journal row, the journal's retention index, and the oldest journal row's deletion. Nothing read the journal back; reconstruction and retries use the snapshot's state, replay, sequence frontiers and bounded outcomes. A move now writes two rows, the snapshot and its frontier. Admissions likewise. A new room writes no retention index.
2. **The heartbeat doesn't wake the room.** A quiet client pings every 10 s, which kept a room awake for a whole game. The ping is now always the same frame (`HEARTBEAT_PING_FRAME`), and the room registers it with `setWebSocketAutoResponse`, so the runtime answers it without waking the room or billing duration ([docs](https://developers.cloudflare.com/durable-objects/api/state/)). A room sleeps between moves.
3. **Rooms last a day.** A claimed room's lifecycle row carries `idleExpiresAt`, a day after its last use. A move or a player arriving moves it on, at most once an hour, so a busy room writes one more row an hour, not one a move. A dropped connection or a seat given up is not a use. The room's alarm also comes by that deadline. When it fires past the deadline, a room with nobody connected is marked `expiring` and deleted, and its code is given back. A room someone is still in is kept another day. Rooms claimed before this change get the deadline at their next use.

A returning Solo player whose table has gone gets a new one at once: the room's admission request answers 404 and the page opens a new table (ADR-044's fallback).

Roughly, a game of about 500 moves now writes about 1,000 rows, so the free plan holds about 100 games a day. Duration is of the same order. Workers Paid ($5 a month) lifts both by orders of magnitude.

## The edge rule

ADR-025's edge policy, on the Free zone plan, is one rate-limiting rule: requests whose path starts with `/v2/rooms/`, counted per IP over 10 seconds, more than 30 blocked for 10 seconds. Free rules can match only on path. Normal play makes two requests per connection (a ticket and the upgrade). The rule is created in the dashboard (Security, Security rules, Rate limiting rules); wrangler's token can't write zone rules.

## Not done

- Writing one row a move instead of two (folding the frontier into the snapshot) would trade the frontier fast path's guarantees for about a 2x margin on rows that duration would soon cap anyway.
- Batching moves into fewer writes would break persist-before-publish (ADR-007).
- The deck index crawl stays off (ADR-037) until Workers Paid.

## Verification

Unit and model tests check two-row commits, the idle deadline's hourly refresh, bookkeeping that leaves it alone, and expiry. Runtime tests check the heartbeat answered by the runtime (its auto-response timestamp), the alarm kept by a connected player, and deletion of every row with the code given back and admission refused. Both runtime checks fail with their production change removed.
