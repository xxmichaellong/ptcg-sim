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

The hot command path carries opaque in-process evidence that the exact readonly
snapshot object was already validated. Proof-bound snapshots are recursively
frozen, and the proof is bound to that object identity, its recorded top-level
references, and authority/state revision; it is neither a security credential
nor a content signature. It is never persisted or placed on the wire. Missing,
forged, stale, or mismatched proofs do not match, while attempted mutation of a
proof-bound graph fails at runtime. Unproven direct persistence calls fail closed
by running the complete invariant suite and recursively freezing the accepted
authority-commit snapshot. The coordinator validates each new candidate once
before passing that same object and proof to storage.

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

The freeze-hardened post-proof named run reduced mature command-to-publication
p95 from 648 ms to 357 ms and server handling p95 from 636 ms to 343 ms.
Current-snapshot and adapter-revalidation p95 both fell to the timer's 0 ms
resolution, and the measured scenario fell from 58.6 seconds to 35.4 seconds
(about 40%). The 357 ms result still misses the provisional 250 ms objective by
107 ms. The next measured target is verified incremental candidate replay
validation while full validation remains mandatory at restore and external
trust boundaries.
