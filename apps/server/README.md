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
