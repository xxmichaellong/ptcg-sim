# Server performance and payload baseline

Status: local `workerd` payload gate, bounded journal plateau, numeric
command-phase observation, and validated-snapshot handoff implemented

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

| Resource                                              | CI envelope | Named observation |
| ----------------------------------------------------- | ----------: | ----------------: |
| Largest server frame                                  |     256 KiB |      62,443 bytes |
| Three-recipient aggregate publication                 |     768 KiB |     149,298 bytes |
| Serialized Durable Object keys and JSON values        |       2 MiB |     327,023 bytes |
| Durable Object storage entries                        |          32 |                16 |
| Serialized hibernating WebSocket attachment           |       1 KiB |         120 bytes |
| Delivered frames per accepted three-recipient command |   exactly 4 |                 4 |

Client and server frames must also remain within the protocol's existing 64 KiB
client and 512 KiB server code-unit limits. The fixture separately asserts 120
canonical cards, 120 definitions, three durable sessions, three active sockets,
94 cards across the two work areas, and a converged revision for every view.

The envelopes deliberately leave room for valid schema growth while catching a
multi-fold payload or persistence regression. Changing one requires an updated
measurement, a reason, and review; raising it solely to accommodate an
unexpected regression is not acceptable.

## Named local observation

Environment:

- Linux x64, Node 24.19.0;
- Intel Xeon Platinum 8581C at 2.30 GHz, 24 logical CPUs visible to the runner;
- Vitest 4.1.11, `@cloudflare/vitest-plugin` 1.1.3, Wrangler 4.128.0;
- Worker compatibility date 2026-08-31; and
- local `workerd`, with no real network hop or browser reconciliation.

The current named run reported:

| Observation                                                           |                                 Result |
| --------------------------------------------------------------------- | -------------------------------------: |
| Fixture construction, including room/admission and six commands       |                                 786 ms |
| Individual fixture command to all publications                        |                               52–83 ms |
| Early `FlipCoin` command to all publications, 24 samples              |  p50 90 ms; p95 129 ms; p99/max 131 ms |
| Tail of journal/outcome fill, 24 samples                              | p50 285 ms; p95 353 ms; p99/max 363 ms |
| Mature bounded-history plateau, 32 samples                            | p50 288 ms; p95 357 ms; p99/max 411 ms |
| Hibernating eviction wake, ping to pong, 9 samples                    |         p50 147 ms; p95/p99/max 162 ms |
| First post-hibernation command at the mature plateau                  |                                 499 ms |
| Largest `LoadDeck` request                                            |                           15,386 bytes |
| Largest observed server frame, including the post-hibernation command |                           62,443 bytes |
| Largest three-recipient aggregate publication                         |                          149,298 bytes |

Nearest-rank percentiles are used. Command time begins immediately before the
WebSocket send and ends after all three projected publications plus the actor's
result arrive. It therefore covers local runtime dispatch, durable commit,
projection, serialization, and delivery, but not an Internet round trip or
client rendering. Serialized storage bytes are a stable JSON/key-size proxy,
not SQLite file size or Cloudflare billable storage.

These wall-clock values are observations, not universal CI assertions. The
early-history sample is below the provisional 250 ms p95 server/network
objective, but the mature bounded-history p95 is still 107 ms above it locally
before any Internet or browser cost is added. Managed preview measurements
remain mandatory, but they cannot excuse the local regression.

## Result: bounded audit-journal plateau

The storage adapter now retains recent audit evidence under two independent
count and serialized-byte ceilings:

- command journal: at most 128 rows and 512 KiB; and
- admission journal: at most 64 rows and 128 KiB.

The snapshot, new row, retention frontier, and deletion of displaced rows are
one transaction. A failed prune rolls all of them back. Missing/corrupt indexes
are rebuilt with 128-row pages and old rows are pruned in batches within the
platform's 128-key multi-delete limit. Unit evidence covers 160 command commits,
80 admission commits, count and byte eviction, a 200-row legacy rebuild, skipped
frontiers, and injected deletion failure.

The real runtime plateau reported:

| Frontier                                             | Entries | Serialized key/value proxy | Command journal rows |
| ---------------------------------------------------- | ------: | -------------------------: | -------------------: |
| Representative fixture, revision 6                   |      16 |              327,023 bytes |                    6 |
| Mature retention boundary, revision 131              |     138 |              367,973 bytes |                  128 |
| 32 more commands, revision 163                       |     138 |              357,887 bytes |                  128 |
| Forced eviction plus committed command, revision 164 |     138 |              357,898 bytes |                  128 |

The slight size reduction is expected: large initial deck/setup audit rows age
out and are replaced by small coin rows. Most importantly, neither entry count
nor serialized size grows monotonically after the bound, and the same plateau
survives eviction and another durable command.

## Finding: mature full-snapshot commits remain a release gate

The authority snapshot itself was about 244 KiB after fixture construction and
about 279–284 KiB once replay and idempotency histories matured. The current
adapter atomically replaces that complete snapshot on every authority commit.
The mature local p95 of 357 ms and post-hibernation command time of 499 ms are
not acceptable against the provisional 250 ms reconciliation objective.

Telemetry v2 now splits the 32-command mature plateau inside the Worker:

| Server phase                                     | p50 | p95 | p99/max |
| ------------------------------------------------ | --: | --: | ------: |
| Total command handling through socket enqueue    | 281 | 343 |     405 |
| Authority processing                             | 146 | 190 |     195 |
| Recipient projection/protocol view serialization |   5 |   9 |      10 |
| Durable persistence                              | 131 | 179 |     199 |
| Publication JSON size serialization              |   0 |   1 |       1 |
| Socket JSON serialization and enqueue            |   1 |   1 |       1 |

Durations are milliseconds and percentile rows are independent distributions,
so percentile columns must not be added as though they describe the same
sample. The first post-eviction command took 499 ms end-to-end and 325 ms inside
the command handler: 134 ms authority processing, 19 ms projection, 171 ms
persistence, less than 1 ms publication serialization, and 1 ms socket send.

The local-only inner diagnostic divides those two dominant phases further:

| Inner server operation                  | p50 | p95 | p99/max |
| --------------------------------------- | --: | --: | ------: |
| Validate current authority snapshot     |   0 |   0 |       1 |
| Resolve and execute command             |   3 |   6 |       6 |
| Build history and candidate snapshot    |   5 |   7 |       9 |
| Validate candidate authority snapshot   | 136 | 184 |     188 |
| Persistence adapter validates candidate |   0 |   0 |       0 |
| Atomic Durable Object transaction       | 131 | 179 |     199 |

The post-eviction sample has the same proof behavior: current validation and
adapter revalidation were 0 ms, candidate validation was 128 ms, and the
transaction was 171 ms. Resolution was 3 ms and history/candidate construction
was 3 ms.

## Result: validated snapshot handoff removes redundant scans

The authority now mints opaque in-process evidence that one exact recursively
frozen snapshot object has passed the complete invariant suite. The proof is
bound to object identity, its recorded top-level references, and
authority/state revision. It is not a security credential, a portable content
signature, or persisted data. The serialized coordinator owns the current
proof; it fully validates and recursively freezes every new candidate, then
supplies that same object and proof to the storage adapter. Missing, forged,
stale, or mismatched proofs do not match. Unproven direct adapter calls fall
back to complete validation and recursive freezing, while attempted mutation of
a proof-bound graph fails at runtime. Restore, migration, and external snapshot
install remain full-validation trust boundaries.

The same-host comparison is:

| Metric                                    | Pre-proof | Post-proof |
| ----------------------------------------- | --------: | ---------: |
| Mature command-to-all-publications p95    |    648 ms |     357 ms |
| Mature server command handling p95        |    636 ms |     343 ms |
| Current-snapshot invariant validation p95 |    186 ms |       0 ms |
| Persistence-adapter revalidation p95      |    155 ms |       0 ms |
| Complete runtime measurement wall time    |    58.6 s |     35.4 s |

The wall-time reduction is about 40%. The candidate still receives one complete
validation plus recursive freezing, and its p95 was 184 ms in the post-proof
run. This preserves the correct trust boundary while showing the next bottleneck
clearly. The mature
end-to-end p95 still misses the 250 ms objective by 107 ms, so this optimization
does not close the release gate.

The next target is verified incremental candidate replay validation: starting
from an already validated snapshot, validate the resolved event batch and the
state it affects without rescanning unrelated history. Complete invariant
validation remains mandatory after restore, migration, external installation,
or any path lacking matching internal proof. Atomic accepted-state recovery,
exact retries, visibility, and fail-closed migration remain non-negotiable.

## Evidence still required

- managed Cloudflare preview p50/p95/p99 split by command family and phase;
- verified incremental candidate replay validation and a mature-history local
  p95 below the ratified objective;
- reconnect-to-usable timing over a real transport;
- platform CPU, memory, storage, request, and cost distributions;
- approved room concurrency/load targets and rate-limit behavior;
- 100,000-attempt deterministic load and two-hour/24-hour soak gates;
- renderer/browser latency, heap, GPU texture, long-task, and recovery evidence;
  and
- the full reference fixture with stacks, markers, every zone/work area, board
  geometry, and 120 decoded assets.
