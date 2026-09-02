# `@ptcgsim/room-authority`

Transport-neutral authoritative room transaction pipeline. It translates
recipient-safe wire references, enforces role and target permissions, executes
the pure game core, and atomically persists state, session sequencing, and the
idempotency outcome before producing any delivery.

Room admission uses high-entropy long-lived seat/spectator capabilities only at
the HTTP exchange boundary. The authority persists at most 32 short-lived
socket-ticket digests, prunes expired records, and consumes a role/name-bound
ticket in the same durable transaction that creates or resumes its session.
Successful redemption rotates to a separate resume capability; raw ticket,
seat, spectator, and resume credentials never enter canonical state.

Presentation facts are derived from the matching resulting canonical revision.
They retain trusted actor/viewer attribution and semantic source detail, but a
card name is emitted only for a single-card reveal already visible to the
least-privileged spectator projection. Private-look and hide facts are
identity-free and shared safely across recipients.

Cloudflare Durable Objects and local/integration servers are adapters around
this package. No WebSocket or platform API belongs here.
