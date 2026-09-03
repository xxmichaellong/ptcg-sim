# Server performance and payload baseline

Status: initial local `workerd` observation and CI payload gate implemented

Recorded: 2026-09-03

Branch: `codex/v2-engine-rebuild`

## What is measured

The server harness executes the deployed Worker and SQLite-backed Durable
Object through the Cloudflare Vitest pool. It creates one room, admits two
players and one spectator, loads two distinct 60-card decks, sets up both
players, and opens two 47-card public inspection work areas. Every command is
persisted, projected independently for all three recipients, serialized, and
delivered over real runtime WebSockets.

This is a server payload fixture, not the complete renderer reference fixture.
It supplies 120 canonical card instances and 120 distinct face URLs plus hidden
and public projections, but it does not claim populated play stacks, markers,
or browser/GPU coverage. Those remain renderer evidence.

Run the repeatable observation with:

```sh
corepack pnpm run measure:v2:server
```

The command writes a machine-readable, gitignored report to
`artifacts/performance/server-local.json`. Pass
`--output <repository-relative-path>` after the server package script when a
different destination is needed. The report contains only aggregate storage
categories; it does not emit room, session, command, card, capability, or digest
values.

## CI regression envelopes

`runtime-payload-budget.test.ts` runs as part of `test:v2:runtime`. For the
six-command fixture it enforces:

| Resource                                              | CI envelope | Initial observation |
| ----------------------------------------------------- | ----------: | ------------------: |
| Largest server frame                                  |     256 KiB |        62,306 bytes |
| Three-recipient aggregate publication                 |     768 KiB |       148,903 bytes |
| Serialized Durable Object keys and JSON values        |       2 MiB |       326,314 bytes |
| Durable Object storage entries                        |          32 |                  15 |
| Serialized hibernating WebSocket attachment           |       1 KiB |           120 bytes |
| Delivered frames per accepted three-recipient command |   exactly 4 |                   4 |

Client and server frames must also remain within the protocol's existing 64 KiB
client and 512 KiB server code-unit limits. The fixture separately asserts 120
canonical cards, 120 definitions, three durable sessions, three active sockets,
94 cards across the two work areas, and a converged revision for every view.

The envelopes deliberately leave room for valid schema growth while catching a
multi-fold payload or persistence regression. Changing one requires an updated
measurement, a reason, and review; raising it solely to accommodate an
unexpected regression is not acceptable.

## Initial local observation

Environment:

- Linux x64, Node 24.19.0;
- Intel Xeon Platinum 8581C at 2.30 GHz, 24 logical CPUs visible to the runner;
- Vitest 4.1.11, `@cloudflare/vitest-plugin` 1.1.3, Wrangler 4.128.0;
- Worker compatibility date 2026-08-31; and
- local `workerd`, with no real network hop or browser reconciliation.

The first named run reported:

| Observation                                                     |                                 Result |
| --------------------------------------------------------------- | -------------------------------------: |
| Fixture construction, including room/admission and six commands |                                 766 ms |
| Individual fixture command to all publications                  |                               59–95 ms |
| `FlipCoin` command to all publications, 24 samples              | p50 125 ms; p95 215 ms; p99/max 222 ms |
| Hibernating eviction wake, ping to pong, 9 samples              |           p50 57 ms; p95/p99/max 65 ms |
| Largest `LoadDeck` request                                      |                           15,386 bytes |
| Largest observed server frame                                   |                           62,306 bytes |
| Largest three-recipient aggregate publication                   |                          148,903 bytes |

Nearest-rank percentiles are used. Command time begins immediately before the
WebSocket send and ends after all three projected publications plus the actor's
result arrive. It therefore covers local runtime dispatch, durable commit,
projection, serialization, and delivery, but not an Internet round trip or
client rendering. Serialized storage bytes are a stable JSON/key-size proxy,
not SQLite file size or Cloudflare billable storage.

These wall-clock values are observations, not universal CI assertions. They are
consistent with the provisional 250 ms p95 server/network objective, but cannot
ratify that objective because local `workerd` omits managed-service scheduling,
region/network latency, and browser reconciliation. Preview measurements on a
named Cloudflare region and client profile remain mandatory.

## Finding: journal growth remains a release gate

At revision 6 the room occupied 15 entries and 326,314 serialized bytes. After
24 additional accepted commands it occupied 39 entries and 344,231 bytes. The
authority journal category grew from 6 to 30 entries: one persisted journal row
per accepted command.

The snapshot is atomically replaced and already contains the bounded command
outcome window, while the separate storage journal currently has no compaction
path. This is useful fault evidence but violates the blueprint requirement that
journal tails have an enforced bound during soak. A retention/compaction design,
crash-boundary tests, and a long-run storage plateau measurement are required
before load or rollout sign-off.

## Evidence still required

- managed Cloudflare preview p50/p95/p99 split by command family and phase;
- reconnect-to-usable timing over a real transport;
- platform CPU, memory, storage, request, and cost distributions;
- approved room concurrency/load targets and rate-limit behavior;
- 100,000-attempt deterministic load and two-hour/24-hour soak gates;
- renderer/browser latency, heap, GPU texture, long-task, and recovery evidence;
  and
- the full reference fixture with stacks, markers, every zone/work area, board
  geometry, and 120 decoded assets.
