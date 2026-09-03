# Server performance and payload baseline

Status: local `workerd` payload gate, bounded journal plateau, numeric
command-phase observation, validated-snapshot handoff, and incremental replay
candidate validation implemented

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
| Largest server frame                                  |     256 KiB |      62,427 bytes |
| Three-recipient aggregate publication                 |     768 KiB |     149,270 bytes |
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
| Fixture construction, including room/admission and six commands       |                                 593 ms |
| Individual fixture command to all publications                        |                               41–77 ms |
| Early `FlipCoin` command to all publications, 24 samples              |  p50 83 ms; p95 105 ms; p99/max 122 ms |
| Tail of journal/outcome fill, 24 samples                              | p50 194 ms; p95 235 ms; p99/max 242 ms |
| Mature bounded-history plateau, 32 samples                            | p50 207 ms; p95 252 ms; p99/max 262 ms |
| Hibernating eviction wake, ping to pong, 9 samples                    |         p50 158 ms; p95/p99/max 204 ms |
| First post-hibernation command at the mature plateau                  |                                 401 ms |
| Largest `LoadDeck` request                                            |                           15,386 bytes |
| Largest observed server frame, including the post-hibernation command |                           62,427 bytes |
| Largest three-recipient aggregate publication                         |                          149,270 bytes |

Nearest-rank percentiles are used. Command time begins immediately before the
WebSocket send and ends after all three projected publications plus the actor's
result arrive. It therefore covers local runtime dispatch, durable commit,
projection, serialization, and delivery, but not an Internet round trip or
client rendering. Serialized storage bytes are a stable JSON/key-size proxy,
not SQLite file size or Cloudflare billable storage.

These wall-clock values are observations, not universal CI assertions. The
mature server p95 is 243 ms, 7 ms below the provisional 250 ms objective; the
252 ms command-to-publication p95 remains 2 ms above it before any Internet or
browser reconciliation cost is added. Managed preview measurements remain
mandatory.

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

## Finding: durable predecessor validation is the remaining local hot path

The authority snapshot is 249,813 serialized bytes after fixture construction,
290,685 bytes at the retention boundary, 285,851 bytes after the mature advance,
and 285,854 bytes after the post-hibernation commit. The adapter atomically
replaces that complete snapshot on every authority commit and still reads and
fully validates/replays the proofless durable predecessor inside the transaction.
This now dominates the mature local distribution.

Telemetry v2 now splits the 32-command mature plateau inside the Worker:

| Server phase                                     | p50 | p95 | p99/max |
| ------------------------------------------------ | --: | --: | ------: |
| Total command handling through socket enqueue    | 199 | 243 |     255 |
| Authority processing                             |  25 |  29 |      29 |
| Recipient projection/protocol view serialization |   7 |  10 |      11 |
| Durable persistence                              | 165 | 207 |     217 |
| Publication JSON size serialization              |   0 |   1 |       1 |
| Socket JSON serialization and enqueue            |   1 |   3 |       3 |

Durations are milliseconds and percentile rows are independent distributions,
so percentile columns must not be added as though they describe the same
sample. The first post-eviction command took 401 ms end-to-end and 270 ms inside
the command handler: 29 ms authority processing, 42 ms projection, 198 ms
persistence, 1 ms publication serialization, and 0 ms socket send.

The local-only inner diagnostic divides those two dominant phases further:

| Inner server operation                  | p50 | p95 | p99/max |
| --------------------------------------- | --: | --: | ------: |
| Validate current authority snapshot     |   0 |   0 |       1 |
| Resolve and execute command             |   2 |   6 |       6 |
| Build history and candidate snapshot    |   9 |  12 |      12 |
| Validate candidate authority snapshot   |  12 |  16 |      17 |
| Persistence adapter validates candidate |   0 |   0 |       0 |
| Atomic Durable Object transaction       | 165 | 207 |     217 |

The post-eviction sample has the same proof behavior: input and adapter snapshot
validation were 0 ms, candidate validation was 12 ms, and the transaction was
198 ms. Resolution/execution was 6 ms and history/candidate construction was 11
ms.

## Result: verified incremental replay removes retained-history reconstruction

The authority carries a full-validation proof for the exact recursively frozen
current snapshot. For each accepted multiplayer command it clones one canonical
event batch, reapplies only that batch, and uses cached canonical UTF-8 entry
sizes to select the minimum replay prefix required by the count/byte limits.
Only an actually removed prefix is applied to advance the base; the retained
frozen suffix is not replayed. A single-use opaque transition proof binds the
exact predecessor/proof, canonical batch, resulting state/history roots, and
limits. Rejections instead retain exact state/history roots and prove the
session/outcome delta. The candidate is recursively frozen and receives the
ordinary snapshot proof plus exact source-frontier/session/outcome/batch binding
for persistence.

The proofs are internal correctness evidence, not security credentials,
portable signatures, or persisted fields. Missing, forged, stale, reused,
cross-room, mutated, or mismatched evidence cannot take the optimized path.
Proofless adapter calls fully validate the candidate, then validate its complete
accepted or rejected transition against the fully validated durable predecessor;
this includes a canonical batch compacted immediately into the replay base.
Restore, migration, retry reload, and external snapshot install remain full
trust-boundary validations. No durable schema changed.

The same-host comparison is:

| Metric                                 | Historical post-proof | Incremental replay |
| -------------------------------------- | --------------------: | -----------------: |
| Mature command-to-all-publications p95 |                357 ms |             252 ms |
| Mature server command handling p95     |                343 ms |             243 ms |
| Candidate authority validation p95     |                184 ms |              16 ms |
| Complete measured scenario             |                35.4 s |           26.204 s |
| Complete Vitest invocation             |                     — |            30.50 s |

The immediately preceding freeze-hardened proof result had itself improved
historical pre-proof p95 from 648 to 357 ms end to end and 636 to 343 ms
server-side; its full measurement fell from 58.6 to 35.4 seconds. The new
incremental result further reduces mature p95 to 252/243 ms and candidate
validation to 16 ms. Server p95 clears 250 ms by 7 ms, while end-to-end p95
misses by 2 ms.

The next target is a small atomically maintained authority-frontier record. The
transaction should compare that bounded record instead of loading and replaying
the complete durable predecessor merely to verify authority/state versions. The
frontier must be written atomically with the snapshot, journal, retention index,
and deletions; missing or malformed frontier data must fail closed or be repaired
only after a complete stored-snapshot validation. Any snapshot restored into
memory still receives the full invariant/replay suite. Atomic accepted-state
recovery, exact retries, visibility, and fail-closed migration remain
non-negotiable.

## Evidence still required

- managed Cloudflare preview p50/p95/p99 split by command family and phase;
- the small atomic authority-frontier optimization and a mature end-to-end local
  p95 below the ratified objective;
- reconnect-to-usable timing over a real transport;
- platform CPU, memory, storage, request, and cost distributions;
- approved room concurrency/load targets and rate-limit behavior;
- 100,000-attempt deterministic load and two-hour/24-hour soak gates;
- renderer/browser latency, heap, GPU texture, long-task, and recovery evidence;
  and
- the full reference fixture with stacks, markers, every zone/work area, board
  geometry, and 120 decoded assets.
