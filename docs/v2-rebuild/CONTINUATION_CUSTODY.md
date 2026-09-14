# Server-held continuation custody

Status: storage/cryptography plus inert Durable Object runtime implemented;
create/open/restore remain deliberately unwired

Decision owner: ADR-012

Implementation: `apps/server/src/continuation-custody.ts`,
`apps/server/src/continuation-configuration.ts`, and the inert
`PtcgContinuation` export in `apps/server/src/worker.ts`

## Purpose and release boundary

This slice establishes the durable custody boundary for canonical multiplayer
continuations without making continuation reachable from an HTTP route, object
RPC, socket message, client package, or UI control. A dedicated
`PtcgContinuation` SQLite Durable Object namespace is now declared through
Wrangler's current `exports` lifecycle, but it exposes only platform alarm
cleanup. It does not change the live room namespace or the default/v2 route
behavior. Production activation still requires the source-room authorization
and quota transaction, the one-time restore/fork state machine, deployment
secret provisioning, abuse limits, recovery evidence, and the unchanged-UI
integration described below.

The implementation is intentionally a one-record storage adapter, instantiated
only against the dedicated continuation namespace; passing an active room's
storage is outside the contract. This keeps room lifecycle deletion, authority
journals, and hot command storage independent from the longer-lived save
record. Expiring an unclaimed or original room must not delete a continuation,
and expiring a continuation must not touch a room.

## Threat model

Protected assets are the canonical authority snapshot, both players' concealed
card identities and order, admission state, session/idempotency history, the
requester's original seat binding, and the continuation bearer. The relevant
attackers are an unauthenticated network caller, a spectator, a player from the
wrong seat, a caller guessing or replaying credentials, a reader of stored
records/backups, and a caller exploiting retry, collision, expiry, revocation,
or corrupt-record behavior. Operator access to live encryption keys remains a
privileged trust boundary and is handled through deployment secret custody and
incident procedures, not by application cryptography.

The current guarantees are:

- A capability is `ptcgsave.v1.<locator>.<bearer>`. The locator contains 128
  random bits and exists only to select a dedicated save object; it grants no
  authority. The bearer contains an independent 256 random bits.
- Storage retains only the public locator and SHA-256 capability digest, never
  the raw capability. Digest comparison is length-aware and constant-work with
  respect to the compared strings.
- Creation validates an invariant-safe multiplayer authority snapshot and
  derives the role binding only from an active player session that currently
  owns its claimed seat. Spectators, disconnected sessions, unclaimed seats,
  and solo snapshots cannot create this payload through the adapter.
- The source build, requester player ID, canonical state hash, entire authority
  snapshot, and an inner SHA-256 integrity record are inside AES-256-GCM
  ciphertext. Record identity, capability digest, creation/expiry timestamps,
  key ID, plaintext length, and format/algorithm versions are authenticated as
  associated data.
- AES-GCM uses a fresh 96-bit random nonce. Imported keys must be 32 bytes,
  non-extractable, and explicitly usable. A bounded key ID selects the active
  encrypt key while older decrypt-only-compatible keys may remain in the
  in-memory keyring for retention-window rotation. Keys and raw key bytes are
  never persisted by the adapter.
- The exact bounded `ptcgsim-continuation-keyring-v1` configuration accepts one
  active encrypt/decrypt key plus at most three distinct prior decrypt keys.
  Missing, oversized, malformed, wrong-version, duplicate, non-canonical, or
  incomplete configuration raises one redacted fail-closed error. Decoded raw
  key buffers are zeroed after non-extractable Web Crypto import. There is no
  default or checked-in production key.
- Plaintext is deterministic JSON, bounded to 1 MiB before encryption, decoded
  with fatal UTF-8, checked against an exact versioned schema, SHA-256 digest,
  canonical state hash, authority invariants, multiplayer mode, and original
  player-seat membership before it is returned. Ciphertext and base64url input
  are independently bounded before allocation/decryption.
- A record is immutable after initialization. An occupied locator is never
  overwritten. An exact create retry succeeds only after the stored record
  authenticates, decrypts, validates, and equals the requested checkpoint;
  every other collision fails closed.
- Creation writes the record and 30-day-default alarm in one storage
  transaction. The TTL may be shortened to no less than one minute but cannot
  be extended beyond 30 days by this format. Transaction retry reuses one
  prepared ciphertext. A post-commit ambiguous failure can be retried against
  the same request without creating a second or different record.
- Open returns one generic unavailable result for absent, malformed capability,
  wrong bearer, revoked, and expired records. Exact expiry deletes record and
  alarm transactionally. An authenticated open repairs a missing/incorrect
  early alarm; an unauthenticated probe cannot modify a live record.
- Revocation authenticates the same role-bound capability, transactionally
  replaces active ciphertext with a digest-only tombstone, and keeps the expiry
  alarm. Retrying the same revocation is idempotent; another bearer learns no
  state and cannot revoke. Expiry removes active records and tombstones. Alarm
  processing deletes malformed records rather than attempting recovery or
  returning plaintext.
- The real `PtcgContinuation` alarm path survives object eviction, reschedules
  an early delivery at the exact record expiry, and deletes an expired record
  plus alarm. Cleanup deliberately does not require a decrypt key, so missing
  key configuration cannot extend retention. No edge path is routed to this
  namespace and the class exports no create/open/revoke/restore RPC.

The bearer model does not protect a capability after the player intentionally
or accidentally shares it with a clipboard manager, extension, device, or
third party. AES-GCM does not protect plaintext after a runtime with the live
key decrypts it. Availability attacks, operator compromise, traffic analysis,
and object-count/storage metadata are residual risks handled by rate limiting,
quotas, platform controls, monitoring, and incident response.

## Stored formats

Each dedicated object has exactly one `continuation:record` entry and one alarm.
An active `ptcgsim-continuation-record-v1` contains:

- `state: active`;
- save locator and SHA-256 capability digest;
- integer creation and expiry times;
- `ptcgsim-continuation-cipher-v1` metadata: AES-256-GCM, key ID, 96-bit nonce,
  ciphertext/tag, and bounded plaintext byte length.

Revocation replaces this with a `state: revoked` tombstone containing locator,
digest, creation/expiry time, and revocation time. It contains no ciphertext.
Unknown fields, formats, algorithms, invalid lengths/times, non-canonical
base64url, missing keys, failed authentication tags, bad UTF-8/JSON, integrity
mismatch, and invalid authority snapshots fail closed.

The encrypted `ptcgsim-continuation-checkpoint-v1` is an exact current-head
authority checkpoint. Because capture is at the head, its reconstruction tail
is empty; the snapshot already contains the bounded replay/undo material needed
by current authority invariants. If later measurements require chunked capture,
that is a new checkpoint format and migration, not an implicit reinterpretation
of v1.

## Transaction and future restore protocol

This custody slice deliberately supports authenticated open, not restore. A
future route must not treat `open()` as permission to initialize an arbitrary
room. The restore implementation needs its own durable state machine so a
retry, crash, or ambiguous cross-object response cannot fork twice:

1. The source room validates the requesting live session and enforces
   per-player/per-room creation rate and count limits before minting a distinct
   save locator/bearer. Save creation uses a stable operation ID so an ambiguous
   object RPC repeats the identical capability, timestamp, and checkpoint.
2. Restore presents the full capability to the dedicated save object. That
   object authenticates it and transactionally reserves one restore operation
   with a deterministic target-room ID. Concurrent/different operations fail
   closed; the exact operation may retry.
3. The target room idempotently initializes a transformed snapshot. The
   transform preserves canonical game state but rotates match/room identity,
   projection aliases, sessions, invitations, tickets, resume credentials,
   command outcome/idempotency history, and all other admission authority. Only
   a fresh capability for the requesting player's original seat is returned;
   the other seat is unclaimed and receives a newly issued invitation through
   the ordinary flow.
4. The save object records the completed target and encrypted retry response,
   then consumes/revokes the checkpoint. Repeating the exact operation returns
   the same target/credentials; another operation cannot create a second fork.
   The original room and restored room have no shared mutable authority.

No distributed claim of atomicity is made until that reservation/completion
protocol and its crash matrix exist. The dedicated object serializes each save,
while deterministic target initialization and encrypted result custody provide
idempotent completion across the object boundary.

## Verification implemented in this slice

The focused model suite covers capability entropy/grammar, key validation and
non-extractability, byte bounds, digest-only encrypted storage, active-player
authorization, malformed input, collision refusal, exact ambiguous-create
recovery, storage transaction retry, record/alarm rollback, ciphertext and AAD
tampering, wrong/missing decrypt keys, key rotation, transactional/idempotent
revocation, exact expiry, alarm repair, corrupt-record cleanup, exact keyring
configuration, bounded rotation, and redacted failure. The real Worker suite
also proves declarative namespace provisioning, absent edge routing,
post-eviction alarm restoration, exact rescheduling, and deletion.

## Gates still closed

Continuation remains unavailable until all of the following are implemented
and attached to the draft PR/release evidence:

- production secret provisioning, key-rotation/retirement rehearsal, and
  wiring the fail-closed keyring loader only into future cryptographic RPCs;
- source-room authenticated creation RPC plus stable idempotency operation,
  per-player/per-room/global count limits, request/body limits, and independent
  rate limits;
- transactional one-time restore state machine, canonical transform, new-room
  initialization, complete credential/identity rotation, exact projection/hash
  equivalence tests, and crash/ambiguous-response matrix;
- delete/revoke and restore HTTP contracts with same-origin/no-store controls,
  generic external errors, telemetry redaction, and no capability logging;
- managed-preview storage/load/eviction/alarm/key-rotation/rollback exercises,
  cleanup and incident runbooks, cost evidence, and security/privacy review;
- the source-shaped UI wiring and browser journeys, without changing the
  existing UI/UX beyond activating the approved continuation behavior.

Wrangler `exports` lifecycle changes cannot be crossed by an ordinary Worker
rollback. Before activation, rollback therefore leaves the inert class,
binding, and live `exports` declaration in place and reverts only executable
call sites; the namespace contains no application-created records. Do not
delete or omit the export as a rollback shortcut. After saves exist, disabling
new create/restore must preserve the last compatible decrypt keyring and
read/delete path until every record expires or is explicitly revoked. See
Cloudflare's
[Durable Object class exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
contract.
