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
- admission and resume capabilities never enter the public store, command history, or notices
- superseded sessions become terminal read-only sessions and never reconnect

Capabilities are deliberately memory-only in this slice. Durable credential storage must
be introduced later behind an explicit secret-storage policy; ordinary application state
and browser logs are not acceptable storage locations.
