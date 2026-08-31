# `@ptcgsim/room-authority`

Transport-neutral authoritative room transaction pipeline. It translates
recipient-safe wire references, enforces role and target permissions, executes
the pure game core, and atomically persists state, session sequencing, and the
idempotency outcome before producing any delivery.

Cloudflare Durable Objects and local/integration servers are adapters around
this package. No WebSocket or platform API belongs here.
