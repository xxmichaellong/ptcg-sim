# Server performance and payload baseline

Status: local `workerd` payload gate, bounded journal plateau, numeric
command-phase observation, validated-snapshot/incremental-replay proofs, and the
authority-frontier fast commit implemented; provisional local server-latency
gate achieved

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
different destination is needed. The local report schema is
`ptcgsim-runtime-performance-v3`; production structured telemetry remains v2.
The report contains only aggregate storage categories; it does not emit room,
session, command, card, capability, or digest values.

## CI regression envelopes

`runtime-payload-budget.test.ts` runs as part of `test:v2:runtime`. For the
six-command fixture it enforces:

| Resource                                              | CI envelope | Named observation |
| ----------------------------------------------------- | ----------: | ----------------: |
| Largest server frame                                  |     256 KiB |      62,304 bytes |
| Three-recipient aggregate publication                 |     768 KiB |     148,899 bytes |
| Serialized Durable Object keys and JSON values        |       2 MiB |     327,365 bytes |
| Durable Object storage entries                        |          32 |                17 |
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

| Observation                                                           |                                         Result |
| --------------------------------------------------------------------- | ---------------------------------------------: |
| Fixture construction, including room/admission and six commands       |                                         664 ms |
| Individual fixture command to all publications                        |                                       45–62 ms |
| Early `FlipCoin` command to all publications, 24 samples              |            p50 42 ms; p95 49 ms; p99/max 54 ms |
| Tail of journal/outcome fill, 24 samples                              |            p50 41 ms; p95 46 ms; p99/max 47 ms |
| Mature bounded-history plateau, 32 samples                            | min 29 ms; p50 43 ms; p95 50 ms; p99/max 53 ms |
| Hibernating eviction wake, ping to pong, 9 samples                    |                 p50 120 ms; p95/p99/max 186 ms |
| First post-hibernation command at the mature plateau                  |                                         181 ms |
| Largest `LoadDeck` request                                            |                                   15,386 bytes |
| Largest observed server frame, including the post-hibernation command |                                   62,431 bytes |
| Largest three-recipient aggregate publication                         |                                  149,276 bytes |

Nearest-rank percentiles are used. Command time begins immediately before the
WebSocket send and ends after all three projected publications plus the actor's
result arrive. It therefore covers local runtime dispatch, durable commit,
projection, serialization, and delivery, but not an Internet round trip or
client rendering. Serialized storage bytes are a stable JSON/key-size proxy,
not SQLite file size or Cloudflare billable storage.

These wall-clock values are observations, not universal CI assertions. The
mature command-to-publication p95 is 50 ms and server p95 is 42 ms, respectively
200 and 208 ms below the provisional 250 ms objective before any Internet or
browser reconciliation cost is added. The provisional local gate is achieved;
managed preview measurements remain mandatory.

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
| Representative fixture, revision 6                   |      17 |              327,365 bytes |                    6 |
| Mature retention boundary, revision 131              |     139 |              368,318 bytes |                  128 |
| 32 more commands, revision 163                       |     139 |              358,232 bytes |                  128 |
| Forced eviction plus committed command, revision 164 |     139 |              358,243 bytes |                  128 |

The slight size reduction is expected: large initial deck/setup audit rows age
out and are replaced by small coin rows. Most importantly, neither entry count
nor serialized size grows monotonically after the bound, and the same plateau
survives eviction and another durable command.

At the retention boundary, the exact category sizes were 1,471 admission,
297 frontier, 11,966 retention-index, 63,464 command-journal, 290,733 snapshot,
126 lifecycle, and 261 rate-limit bytes. The final post-wake values were 1,471,
297, 11,996, 58,190, 285,902, 126, and 261 bytes respectively. The frontier adds
one bounded entry and does not alter the plateau conclusion.

## Result: authority frontier removes hot-path predecessor replay

The authority snapshot is 249,861 serialized bytes after fixture construction,
290,733 bytes at the retention boundary, 285,899 bytes after the mature advance,
and 285,902 bytes after the post-hibernation commit. The adapter still atomically
replaces that complete snapshot, but a proven normal multiplayer command now
checks the 297-byte frontier instead of loading and replaying its predecessor.
All 32 mature samples hit that path; none fell back, and predecessor validation
was 0 ms throughout.

Telemetry v2 now splits the 32-command mature plateau inside the Worker:

| Server phase                                     | Minimum | p50 | p95 | p99/max |
| ------------------------------------------------ | ------: | --: | --: | ------: |
| Total command handling through socket enqueue    |      21 |  34 |  42 |      44 |
| Authority processing                             |       9 |  18 |  22 |      23 |
| Recipient projection/protocol view serialization |       4 |   7 |  11 |      11 |
| Durable persistence                              |       5 |   8 |  12 |      13 |
| Publication JSON size serialization              |       0 |   1 |   1 |       1 |
| Socket JSON serialization and enqueue            |       0 |   0 |   1 |       2 |

Durations are milliseconds and percentile rows are independent distributions,
so percentile columns must not be added as though they describe the same
sample. The first post-eviction command took 181 ms end-to-end and 43 ms inside
the command handler: 16 ms authority processing, 14 ms projection, 12 ms
persistence, 0 ms publication serialization, and 1 ms socket send.

The local-only inner diagnostic divides those two dominant phases further:

| Inner server operation                  | p50 | p95 | p99/max |
| --------------------------------------- | --: | --: | ------: |
| Validate current authority snapshot     |   0 |   0 |       1 |
| Resolve and execute command             |   3 |   6 |       6 |
| Build history and candidate snapshot    |   9 |  11 |      11 |
| Validate candidate authority snapshot   |   6 |   8 |       8 |
| Persistence adapter validates candidate |   0 |   0 |       0 |
| Validate durable predecessor            |   0 |   0 |       0 |
| Atomic Durable Object transaction       |   8 |  12 |      13 |

The post-eviction sample has the same proof/frontier behavior: input, adapter,
and predecessor validation were 0 ms, candidate validation was 6 ms, and the
transaction was 11 ms. Resolution/execution was 3 ms, history/candidate
construction was 7 ms, and the frontier hit flag was 1.

## Result: verified proof chain and rollback-compatible authority frontier

The authority carries a full-validation proof for the exact recursively frozen
current snapshot. For each accepted multiplayer command it clones one canonical
event batch, reapplies only that batch, and uses cached canonical UTF-8 entry
sizes to select the minimum replay prefix required by the count/byte limits.
Only an actually removed prefix is applied to advance the base; the retained
frozen suffix is not replayed. A single-use opaque transition proof binds the
exact predecessor/proof, canonical batch, resulting state/history roots, and
limits. Rejections instead retain exact state/history roots and prove the
session/outcome delta. The candidate is recursively frozen and receives the
ordinary snapshot proof plus exact source-snapshot/source-validation/session/
outcome/batch binding for persistence.

The proofs are internal correctness evidence, not security credentials,
portable signatures, or persisted fields. Missing, forged, stale, reused,
cross-room, mutated, or mismatched evidence cannot take the optimized path.
Proofless adapter calls fully validate the candidate, then validate its complete
accepted or rejected transition against the fully validated durable predecessor;
this includes a canonical batch compacted immediately into the replay base.
Restore, migration, retry reload, and external snapshot install remain full
trust-boundary validations.

Persistence now keeps an exact store-local validated head and a strict
`ptcgsim-authority-frontier-v1` record. The existing v6 snapshot envelope gains
an optional 128-bit generation, which the frontier binds to the envelope/domain
schemas, match, mode, authority version, and state revision. A proven command
must bind the exact cached snapshot and validation plus its session, outcome,
canonical batch, expected authority version, and expected revision. When that
evidence and the stored frontier match, the transaction does not read the
snapshot. It creates one generation outside any automatic transaction retry,
checks that it differs from the actual predecessor generation, and writes the
new snapshot/frontier, journal, retention index, and pruning atomically.

Missing or malformed frontier data is repaired only after full snapshot
validation. A well-formed divergent pair fails closed without writes. The
additive field is rollback-compatible: the pre-frontier v6 reader accepts and
ignores it, its writer emits v6 without it, and a subsequent new runtime fully
validates that generation-free snapshot before atomically replacing the stale
pair. Admissions always read and validate the predecessor and pair the frontier
with journal, retention, lifecycle/alarm, and pruning updates; expiry validates
the pair before lifecycle repair or deletion. The generation is coherence
evidence, not a security credential. There is no domain-state, wire-protocol, or
production-telemetry schema change; v3 applies only to the local performance
artifact. The transaction and alarm behavior follow Cloudflare's
[Durable Object storage API](https://developers.cloudflare.com/durable-objects/api/storage-api/)
and [alarm API](https://developers.cloudflare.com/durable-objects/api/alarms/).

The same-host comparison is:

| Metric                                 | Post-proof historical | Incremental replay | Authority frontier |
| -------------------------------------- | --------------------: | -----------------: | -----------------: |
| Mature command-to-all-publications p95 |                357 ms |             252 ms |              50 ms |
| Mature server command handling p95     |                343 ms |             243 ms |              42 ms |
| Candidate authority validation p95     |                184 ms |              16 ms |               8 ms |
| Durable persistence p95                |                     — |             207 ms |              12 ms |
| Complete measured scenario             |                35.4 s |           26.204 s |            8.766 s |
| Complete Vitest invocation             |                     — |            30.50 s |            12.12 s |

The immediately preceding freeze-hardened proof result had itself improved
historical pre-proof p95 from 648 to 357 ms end to end and 636 to 343 ms
server-side; its full measurement fell from 58.6 to 35.4 seconds. The subsequent
incremental-replay result reduced mature p95 to 252/243 ms and candidate
validation to 16 ms. The authority-frontier result now reduces mature p95 from
252 to 50 ms end to end, 243 to 42 ms server-side, and persistence from 207 to 12
ms; measured scenario time falls from 26.204 to 8.766 seconds. The provisional
250 ms p95 objective is achieved locally by 200 ms end to end and 208 ms
server-side.

The next performance step is not another unsafe validation shortcut. Repeat the
observation for stability, then gather managed-preview/network, platform
resource/cost, and long-running soak evidence while retaining full snapshot
validation at restore, migration, repair, external-install, and proofless or
mismatched fallback boundaries.

## Evidence still required

- managed Cloudflare preview p50/p95/p99 split by command family and phase;
- repeated named-host observations and a ratified managed-preview latency
  objective;
- reconnect-to-usable timing over a real transport;
- platform CPU, memory, storage, request, and cost distributions;
- approved room concurrency/load targets and rate-limit behavior;
- 100,000-attempt deterministic load and two-hour/24-hour soak gates;
- renderer/browser latency, heap, GPU texture, long-task, and recovery evidence;
  and
- the full reference fixture with stacks, markers, every zone/work area, board
  geometry, and 120 decoded assets.
