# `@ptcgsim/room-authority`

Transport-neutral authoritative room transaction pipeline. It translates
recipient-safe wire references, enforces role and target permissions, executes
the pure game core, and atomically persists state, session sequencing, and the
idempotency outcome before producing any delivery.

Room admission uses high-entropy long-lived seat/spectator capabilities only at
the HTTP exchange boundary. A master capability can mint bounded 15-minute
one-use guest invitations; player issuance rotates the prior seat invitation,
while spectator invitations remain distinct up to the room cap. The authority
persists at most 32 invitation digests and 32 short-lived socket-ticket digests,
prunes expired records, and permits a lost ticket response to be retried by
rotating the prior unconsumed ticket. Successful redemption consumes the
invitation and ticket in the same durable transaction that creates the session
and rotates to a separate resume capability. Raw invitation, ticket, seat,
spectator, and resume credentials never enter canonical state.

Presentation facts are derived from the matching resulting canonical revision.
They retain trusted actor/viewer attribution and semantic source detail, but a
card name is emitted only for a single-card reveal already visible to the
least-privileged spectator projection. Private-look and hide facts are
identity-free and shared safely across recipients.

Cloudflare Durable Objects and local/integration servers are adapters around
this package. No WebSocket or platform API belongs here.
