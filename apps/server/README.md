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
snapshot proof, additionally bound to its exact source snapshot and validation,
session, outcome, and canonical batch for persistence.

The persistence adapter keeps an exact store-local validated head and a small
`authority:frontier` record. The rollback-compatible v6 snapshot envelope now
has an optional 128-bit generation, while the strict v1 frontier binds that
generation to the envelope/domain schemas, match, mode, authority version, and
state revision. A proven multiplayer command whose source object, proof, and
metadata match both the cache and stored frontier reads no durable snapshot.
It rotates the generation and atomically writes the snapshot/frontier pair with
the journal, retention index, and displaced-row deletion. Admissions still read
and fully validate their predecessor and pair lifecycle/alarm changes with the
same write. Expiry also validates the pair before lifecycle repair or deletion.

Neither proof is a security credential, portable signature, durable field, or
wire value. Missing, forged, stale, reused, cross-room, mutated, or mismatched
evidence cannot enter the optimized path. Proofless persistence validates the
complete candidate and its transition against the fully validated durable
predecessor, including a batch compacted immediately into the replay base.
Restore, migration, old-writer repair, external install, and retry reload remain
full-validation boundaries. A missing or malformed frontier is repaired only
after that validation; a well-formed divergent pair fails closed. Proof-bound
graphs are recursively frozen. The game-domain, wire, and production telemetry
schemas are unchanged; only the local performance artifact advances to v3.

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
local artifact v3 split accepted commands into authority processing, recipient
projection, durable persistence, publication serialization, and socket-send
phases. The local diagnostic adds non-telemetry detail for input/candidate
invariants, resolution/execution, history/candidate construction, adapter
validation, predecessor validation, frontier hits/fallbacks, and the atomic
storage transaction. Production structured telemetry remains v2.

The current authority-frontier named run took 8.766 seconds for the measured
scenario and 12.12 seconds for the complete Vitest invocation; fixture setup was
664 ms. At the mature plateau, command-to-publication minimum/p50/p95/p99/max
was 29/43/50/53/53 ms and server handling was 21/34/42/44/44 ms. Authority,
projection,
persistence, publication serialization, and socket-send p50/p95 were 18/22,
7/11, 8/12, 1/1, and 0/1 ms. Inner input validation was 0/0 ms;
resolution/execution, history/candidate, candidate validation, and the storage
transaction were 3/6, 9/11, 6/8, and 8/12 ms. Candidate-adapter and predecessor
validation were both 0/0 ms, with 32 frontier hits and zero fallbacks. The first
post-hibernation command was 181 ms end to end and 43 ms server-side; its
authority/projection/persistence/publication/socket split was 16/14/12/0/1 ms,
and its input/resolution/history/candidate/adapter/predecessor/hit/transaction
detail was 0/3/7/6/0/0/1/11 ms. The largest frame and aggregate publication were
62,431 and 149,276 bytes. Storage peaked at 139 entries/368,318 bytes and ended
at 139/358,243, including a 297-byte frontier. Relative to the
incremental-replay run, mature p95 fell from 252 to 50 ms end to end, 243 to 42
ms server-side, and 207 to 12 ms in persistence; scenario time fell from 26.204
to 8.766 seconds. The provisional 250 ms p95 objective is met locally by 200 ms
end to end and 208 ms server-side. The next performance work is managed preview
validation and soak evidence, not another trust-boundary shortcut.
