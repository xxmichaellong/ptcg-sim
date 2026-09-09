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
rotating the prior unconsumed ticket. Ticket issuance also mints a distinct
resume bearer and persists only its digest in the role/name-bound ticket record.
Successful redemption consumes the invitation and ticket in the same durable
transaction that creates the session with that exact resume digest. Retrying
the private pair can therefore resume an already-committed session after a lost
Welcome without making the consumed ticket reusable. Raw invitation, ticket, seat,
spectator, and resume credentials never enter canonical state.

A player admission changes canonical display-name metadata without inventing a
game command or revision. The same admission transaction projects the resulting
view for every active peer and persists any new opaque identities before the
hub emits a closed `authority_reconciled` refresh. Resume reprojects peers too,
so an exact-pair retry repairs a refresh missed after an ambiguous commit.

Admission state persists a mode-bound player-seat ceiling (`1` for solo, `2`
for multiplayer). A first solo claim atomically removes all credentials for the
other canonical seat while preserving spectators and resume. Snapshot
invariants require every player session to be its seat's durable claim and
forbid multiple active player sessions in solo. The persistence-facing
transaction validator binds each declared admission kind to its exact
predecessor, including credential role/name, session, seat, history, and state
deltas.

Presentation facts are derived from the matching resulting canonical revision.
They retain trusted actor/viewer attribution and semantic source detail, but a
card name is emitted only for a single-card reveal already visible to the
least-privileged spectator projection. Private-look and hide facts are
identity-free and shared safely across recipients.

Cloudflare Durable Objects and local/integration servers are adapters around
this package. No WebSocket or platform API belongs here.
