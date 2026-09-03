# v2 room runtime

Cloudflare Worker/Durable Object adapter for the platform-neutral room
authority. It owns strict HTTP creation/credential exchange, hibernating
WebSocket admission, serialized command delivery, lifecycle/rate limits,
telemetry, and the transactionally tested persistence boundary.

Operational patterns are adapted from MagicCircle commit
`39f871cd63800e2317326425345a26e4d61846de`: bounded ingress, server-derived
identity, explicit message tracking, admission freeze, and lifecycle race tests.
PTCG Sim does not reuse MagicCircle's debounced per-user persistence because an
accepted game command requires an atomic per-room journal commit.

Recent audit rows are transactionally bounded independently from the authority
snapshot: 128 command rows/512 KiB and 64 admission rows/128 KiB. The snapshot,
new row, retention frontier, and displaced-row deletion commit or roll back
together. The journal is recent operational evidence; room reconstruction and
exact retries use the validated snapshot's canonical state, replay, sequence
frontiers, and bounded outcomes.

The hot multiplayer command path carries opaque in-process evidence from the
exact recursively frozen predecessor snapshot into a verified candidate
transition. Accepted commands clone one canonical event batch, apply that batch
to the validated current state, and update bounded replay history using cached
canonical UTF-8 entry sizes. Compaction removes the minimum prefix needed by the
configured count/byte limits and validates only that removed prefix; the retained
frozen suffix does not replay. Single-use transition evidence is bound to the
exact current proof, resulting state/history objects, and limits. Rejected
commands retain the exact state/history roots and validate only their session
outcome delta. The completed candidate then receives the ordinary exact-object
snapshot proof, additionally bound to its source frontier, session, outcome, and
canonical batch for persistence.

Neither proof is a security credential, portable signature, durable field, or
wire value. Missing, forged, stale, reused, cross-room, mutated, or mismatched
evidence cannot enter the optimized path. Proofless persistence validates the
complete candidate and its transition against the fully validated durable
predecessor, including a batch compacted immediately into the replay base.
Restore, migration, external install, and retry reload remain full-validation
boundaries. Proof-bound graphs are recursively frozen. This optimization changes
no durable schema.

`pnpm run test:runtime` executes the isolated Cloudflare runtime suite through
`@cloudflare/vitest-plugin`. It covers the deployed Worker boundary, SQLite
Durable Object storage and alarms, WebSocket admission, real eviction with a
hibernated socket, attachment reconstruction, concurrent admission/command
traffic, pre-commit and ambiguous post-commit persistence failures, exact
retries, payload/resource envelopes, and post-wake idempotency. The
repository-level `check:v2` gate runs this suite after the fast unit tests.

`pnpm run measure:runtime` is the longer, non-CI timing/plateau observation. It
fills the command outcome and audit windows, advances beyond them, forces
hibernating evictions, commits once more after wake, and writes a sanitized
machine-readable artifact through the repository runner. Telemetry v2 and the
artifact split accepted commands into authority processing, recipient
projection, durable persistence, publication serialization, and socket-send
phases. The local diagnostic adds non-telemetry detail for input/candidate
invariants, resolution/execution, history/candidate construction, adapter
validation, and the atomic storage transaction.

The current incremental-replay named run took 26.204 seconds for the measured
scenario and 30.50 seconds for the complete Vitest invocation. At the mature
plateau, command-to-publication was p50/p95/p99/max 207/252/262/262 ms and server
handling was 199/243/255/255 ms. Authority, projection, and persistence p50/p95
were 25/29, 7/10, and 165/207 ms; candidate validation was 12/16 ms and adapter
snapshot validation remained 0/0 ms. Against the immediately preceding
freeze-hardened proof run, mature p95 fell from 357 to 252 ms end to end, 343 to
243 ms in server handling, and 184 to 16 ms for candidate validation. Server p95
now clears the provisional 250 ms objective by 7 ms; end-to-end p95 misses it by
2 ms. The next target is a small atomically maintained authority frontier that
removes the storage transaction's full predecessor replay while retaining full
validation whenever a snapshot is restored or otherwise crosses a trust
boundary.
