# Client session

Transport-neutral ownership of the v2 browser session. This package bridges the
validated WebSocket protocol into an immutable external store that React, the
DOM renderer, and the Pixi renderer can consume without owning networking.

## Guarantees

- exactly one active socket generation; late events from replaced sockets are ignored
- one in-flight command and a bounded FIFO, with gap-free client sequences
- retries reuse the byte-for-byte command envelope and never allocate a new identity
- accepted commands complete only after both their result and covering publication
- stale publications are ignored and divergent equal-revision views fail closed
- reconnects use the in-memory resume capability and reconcile against the Welcome sequence
- transport loss clears replay transfer state in the same non-ready publication, so reentrant observers cannot submit against a socket that is already gone
- Welcome publishes the ready phase, role, view, sequence, and reconciled queue together; advancing state publications likewise publish their view and presentation events together
- command allocation publishes its next sequence and queued summary together, so observers never see one without the other
- every send, handshake, reconnect-timer, or socket-open continuation after a public notification revalidates its phase and socket generation
- locally initiated closes invalidate the socket generation before calling transport, so synchronous and asynchronous close delivery are both stale and cannot spend a second reconnect attempt
- inconsistent replay termination publishes only the failed state with replay loading cleared
- retryable notices bind to the phase, socket generation, and command head present at receipt; a reentrant observer cannot retarget an old notice onto a newly created command
- admission and resume capabilities never enter the public store, command history, or notices
- failed, cleanly closed, and superseded sessions clear replay loading; superseded sessions become terminal read-only sessions and never reconnect

Capabilities are deliberately memory-only in this slice. Durable credential storage must
be introduced later behind an explicit secret-storage policy; ordinary application state
and browser logs are not acceptable storage locations.
