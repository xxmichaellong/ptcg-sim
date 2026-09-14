# Server-held continuation custody

Status: storage/cryptography, source-room creation reservation, encrypted
exact-retry creation receipt, internal create coordination, private Durable
Object create/recovery RPCs, encrypted one-time restore state, pure fork
transform, idempotent target-room storage, internal restore coordination, and
private Durable Object restore runtime implemented; a sharded global quota
lease adapter is implemented but unwired; public create/open/restore remain
deliberately unwired

Decision owner: ADR-012

Implementation: `apps/server/src/continuation-custody.ts`,
`apps/server/src/continuation-configuration.ts`,
`apps/server/src/continuation-create.ts`,
`apps/server/src/continuation-fork.ts`,
`apps/server/src/continuation-quota.ts`,
`apps/server/src/continuation-restore-format.ts`,
`apps/server/src/continuation-rpc.ts`,
`apps/server/src/continuation-restore.ts`,
`apps/server/src/continuation-source.ts`,
`apps/server/src/continuation-target.ts`, and the private `PtcgContinuation` /
`PtcgRoom` RPCs in `apps/server/src/worker.ts`

## Purpose and release boundary

This slice establishes the durable custody boundary for canonical multiplayer
continuations without making continuation reachable from an HTTP route, socket
message, client package, or UI control. A dedicated
`PtcgContinuation` SQLite Durable Object namespace is now declared through
Wrangler's current `exports` lifecycle. The source room now exposes one exact
private create RPC, the named save object exposes exact create/recovery and
restore RPCs, and the target room exposes its exact initializer. No edge
handler, socket message, client package, or UI control can call any of them. It
does not change the default/v2 route behavior. Production activation still
requires a global quota lease, public HTTP contract, deployment secret
provisioning, independent abuse limits, managed recovery evidence, and the
unchanged-UI integration described below.

The implementation is intentionally a single-save adapter with one primary
record and, for source-coordinated creation, one small encrypted retry receipt.
It is instantiated only against the dedicated continuation namespace; passing
an active room's storage is outside the contract. This keeps room lifecycle
deletion, authority journals, and hot command storage independent from the
longer-lived save record. Expiring an unclaimed or original room must not delete
a continuation, and expiring a continuation must not touch a room.

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
- Plaintext storage retains only the public locator and SHA-256 capability,
  operation, and request digests, never the raw capability or operation. The raw
  bearer exists only inside the purpose-bound encrypted creation receipt needed
  to recover an ambiguous response. Digest comparison is length-aware and
  constant-work with respect to the compared strings.
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
- Source-coordinated creation binds the reserved locator and stable operation to
  a digest of the complete creation request. It atomically writes the encrypted
  checkpoint, encrypted bearer receipt, and alarm. A storage-transaction retry
  reuses one prepared capability/ciphertext pair; an ambiguous committed retry
  decrypts and returns the original bearer without regenerating the checkpoint.
  After source compaction, the named save object can recover that same receipt
  from the locator plus operation alone. Another locator, operation, or complete
  request fails closed. The receipt remains available across restore so delayed
  create responses converge, but an authenticated revocation deletes it.
- A separate source-room ledger authorizes only an active, currently claimed
  multiplayer player against the exact canonical authority frontier. It stores
  a domain-separated digest of the stable create operation, a non-secret save
  locator, requester role, lifetime, and an exact detached source snapshot
  while work is pending. It never stores the raw operation ID or a continuation
  bearer. A frontier race, malformed ledger, malformed frontier, or storage
  failure fails closed.
- The source ledger reserves at most four unexpired entries per player and
  eight per room under an injected bounded policy. Exact transaction retries
  and ambiguous committed responses recover the same plan. Completion compacts
  away the pending snapshot, source session, and source build while retaining a
  digest-only reference for retry and conservative quota accounting. Expired
  entries are removed transactionally when the ledger is next used. These are
  local count limits, not the still-required global quota or independent request
  rate limits.
- A separate policy-injected quota adapter partitions global capacity across a
  deterministic fixed shard set derived from a domain-separated digest of the
  public source-room code. Each shard is independently bounded to at most 512
  live entries, so the configured shard capacities sum to a hard global ceiling
  without sending every create through one global singleton. A hot shard may
  reject while another shard has room; it can never borrow capacity and exceed
  the global bound. This follows Cloudflare's current
  [Durable Object coordination guidance](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/),
  which explicitly rejects a single global request coordinator.
- A quota lease is bound to domain-separated source-room and stable-operation
  digests, the non-secret save locator, and the exact source creation/expiry
  lifetime. Neither raw room code nor raw operation ID is persisted. Exact
  retries return the existing lease, locator reuse and changed-operation input
  fail closed, and every new reservation counts conservatively until the save's
  hard expiry. A downstream failure can therefore over-count capacity but can
  never leave a stored save uncounted.
- Each quota shard transactionally prunes expired leases, repairs its single
  earliest-expiry alarm, and removes its ledger/alarm when empty. Cleanup is
  idempotent across transaction retry and ambiguous commit. Malformed,
  duplicate, or oversized ledgers fail closed rather than releasing capacity.
  The adapter has no Durable Object class, production shard count/capacity, or
  create-coordinator call site yet.
- Shard count or per-shard capacity reductions cannot be treated as ordinary
  live tuning. A production reduction requires new-create shutdown plus one
  maximum-retention drain (or verified complete cleanup), because leases in
  shards made unreachable by a smaller count still represent stored saves.
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
  an early delivery at the exact record expiry, and deletes the primary record,
  optional creation receipt, and alarm. Orphan receipt metadata is also removed
  when the primary record is absent or corrupt. Cleanup deliberately does not
  require a decrypt key, so missing key configuration cannot extend retention.
  No edge path is routed to this namespace. Its exact internal create,
  create-recovery, and restore RPCs bind the requested locator to the selected
  object name, load cryptography lazily, and fail closed when the secret binding
  is absent. Open/revoke RPCs remain absent.

The bearer model does not protect a capability after the player intentionally
or accidentally shares it with a clipboard manager, extension, device, or
third party. AES-GCM does not protect plaintext after a runtime with the live
key decrypts it. Availability attacks, operator compromise, traffic analysis,
and object-count/storage metadata are residual risks handled by rate limiting,
quotas, platform controls, monitoring, and incident response.

## Stored formats

Each dedicated object has one `continuation:record` entry, an optional
`continuation:creation-receipt` companion, and one alarm. An active
`ptcgsim-continuation-record-v1` contains:

- `state: active`;
- save locator and SHA-256 capability digest;
- integer creation and expiry times;
- `ptcgsim-continuation-cipher-v1` metadata: AES-256-GCM, key ID, 96-bit nonce,
  ciphertext/tag, and bounded plaintext byte length.

The exact `ptcgsim-continuation-creation-receipt-v1` companion authenticates the
same locator, capability digest, creation/expiry, a stable-operation digest, and
a digest of the complete reserved request. Its purpose-bound ciphertext holds
only the exact `ptcgsim-continuation-creation-result-v1` locator, operation,
bearer, and lifetime returned to the source coordinator. It is never written by
the lower-level caller-supplied-capability test adapter. It survives the primary
record's restoring/completed transitions, is deleted by active revocation, and
is always removed with expiry or corrupt-primary cleanup.

The same exact record format moves through two encrypted restore states without
extending its original expiry:

- `state: restoring` replaces the checkpoint with an operation digest,
  reservation time, and purpose-bound AES-GCM `restore-plan-v1`. The plan owns
  the detached target snapshot, target room code/lifecycle, requester seat
  master, and ordinary opponent invitation. The raw operation ID, credentials,
  target, and canonical state are not plaintext storage metadata.
- `state: completed` replaces that plan with its operation digest,
  reservation/completion times, and a purpose-bound encrypted
  `restore-result-v1`. The result retains only the exact retry response; the
  continuation record no longer contains canonical state.

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

## Pure target-room transform

`prepareContinuationFork()` now implements the persistence-independent portion
of restore. It revalidates the opened checkpoint, role binding, exact canonical
hash, multiplayer mode, two-seat admission, and invitation lifetime before
reading entropy. It produces a detached authority snapshot suitable for a new
room initializer with:

- the exact cloned canonical state and replay history, including the canonical
  match ID and revision;
- authority version zero, empty sessions, empty command-outcome history, empty
  projection aliases, empty tickets, and both seats unclaimed;
- new digest-only master credentials for both seats that cannot collide with
  any prior seat, spectator, invitation, ticket, ticket-resume, or
  session-resume digest;
- only the requester's fresh seat master in the result; the other seat master
  is discarded after hashing and a fresh role-bound ordinary invitation is
  returned instead; and
- no spectator master in the fork. Spectator admission starts closed rather
  than copying or returning the source authority.

Credential generation is bounded to 32 attempts per value and rejects short,
oversized, duplicate-raw, duplicate-digest, prior-authority, and malformed
digest results. The function neither initializes a target Durable Object nor
marks a continuation consumed. Those effects remain owned by the durable
reservation/completion and future target-orchestration boundaries; calling
this pure function alone cannot restore or expose a save.

## Durable restore state and internal cross-object protocol

The lower-level custody adapter supports authenticated open, while restore is
available only through the private coordinator. A future route must not treat
`open()` as permission to initialize an arbitrary room. The adapter implements
the save object's durable state transitions so a retry, crash, or ambiguous
storage response cannot select a second plan:

1. The source room validates the requesting live session and transactionally
   reserves its exact source snapshot and stable create operation under
   per-player/per-room count limits. The internal create coordinator uses that
   reserved locator to select exactly one save object, atomically mint and
   encrypt one distinct bearer/checkpoint there, and compact the source
   reservation. A completed source retry bypasses creation and asks the same
   save object to recover its encrypted receipt. Pre-commit failures, lost
   reservation/create/completion responses, and retries after source compaction
   therefore converge on the identical capability, timestamp, and checkpoint
   instead of recapturing a later room head. The exact private room/save RPC
   chain is wired and rejects malformed input before target work. Global
   quota/rate allowance remains outside this coordinator and is required before
   any public caller is wired.
2. Restore presents the full capability to the dedicated save object. That
   object authenticates it and transactionally reserves one restore operation
   with a deterministic target-room ID. Concurrent/different operations fail
   closed; the exact operation decrypts and returns the already committed plan
   without running its preparation callback again. The transition is
   `active -> restoring` and remains under the original hard expiry.
3. The target room idempotently initializes a transformed snapshot. The
   transform preserves the exact canonical game state, including its canonical
   match ID, while the new route/room code supplies the rotated room identity.
   It also rotates projection aliases, sessions, invitations, tickets, resume
   credentials, command outcome/idempotency history, and all other admission
   authority. Only a fresh master capability for the requesting player's
   original seat is returned; the other seat is unclaimed and receives a newly
   issued ordinary invitation. Spectator admission starts closed rather than
   copying or returning the source room's spectator master capability; a future
   authenticated host control may reopen it without weakening the role-bound
   restore response.
4. The save object records the completed target and encrypted retry response,
   then consumes/revokes the checkpoint. Repeating the exact operation returns
   the same target/credentials; another operation cannot create a second fork.
   The transition is `restoring -> completed`; it removes canonical state from
   the save object. The original room and restored room have no shared mutable
   authority.

There is deliberately no distributed transaction. The internal
`coordinateContinuationRestore()` loop now composes typed save-reservation,
target-initialization, and save-completion ports. It validates the reservation's
save/operation identity, requires the target acknowledgement to name exactly
the reserved room, and verifies that the completion receipt exactly matches the
encrypted plan. A completed retry returns its receipt without touching the
target again. Malformed capabilities and operation IDs stop before either
object.

The retry convergence is object-owned: a save-reservation ambiguity recovers
the same encrypted plan; a target ambiguity replays the digest-marked exact
initialization; a completion ambiguity recovers the encrypted receipt. Failure
before target commit leaves an inaccessible reservation; failure after target
commit but before completion leaves an unclaimed target that the exact
operation can finish. If completion misses the target/invitation deadline, no
credentials are returned and the inaccessible target remains governed by its
unclaimed-room alarm. The coordinator intentionally does not compensate by
deleting or selecting a replacement room.

The same loop is now wired as one private `PtcgContinuation.restore()` RPC. Its
exact two-field codec binds the capability locator to the named continuation
object before key loading. The save object generates and durably reserves the
plan, selects `PTCG_ROOM.getByName(plan.targetRoomCode)`, and calls the room's
generic-rejection target RPC before completing locally. The room independently
revalidates the exact plan, both returned credential digests, authority shape,
and its own named-object identity before storage. Production confidence still
requires managed-preview exercises for transport ambiguity, deadline cleanup,
key rotation, abuse behavior, and deployment rollback.

The target storage half is now implemented independently. It validates the
zero-version multiplayer/unclaimed snapshot, empty session/projection state,
fresh admission shape, lifecycle bound, and a 43-character restore digest. In
one transaction it requires an entirely empty target and writes the canonical
snapshot envelope, frontier, empty journal-retention index, unclaimed lifecycle,
`room:continuation-origin` marker, and lifecycle alarm. The marker contains only
a domain-separated SHA-256 digest of save locator plus restore operation ID.

An exact retry must match that digest, the byte-deterministic snapshot, complete
frontier, empty journal state, lifecycle, and marker. It returns the existing
room and repairs the alarm. A normal occupied room, another restore, partial
write, malformed marker, changed snapshot, changed lifetime, or journal activity
fails closed. The wrapper also requires its selected room code to equal
`plan.targetRoomCode`. The private runtime adapter supplies the target Durable
Object's own name and returns only created/recovered plus that room code.

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

The fork suite additionally proves exact canonical hash/state/replay and
fresh-alias projection equivalence for both players and spectators, detached
source/target object graphs, authority-version reset, removal of every old
session/projection/idempotency/admission identity, original-seat binding,
unclaimed seats, ordinary one-use opponent invitation exchange, closed
spectator admission, policy validation before entropy, old/raw/digest collision
recovery, and bounded fail-closed entropy exhaustion.

The restore-state suite proves digest-only encrypted plan reservation, exact
same-operation recovery without repeated preparation, second-operation and
wrong-bearer exclusion, canonical-plan removal on completion, encrypted exact
retry receipts, revocation exclusion after reservation, storage rollback,
ambiguous committed reservation/completion recovery, lifecycle/operation/plan
validation, phase-specific AAD swap rejection, and original-deadline cleanup
for restoring and completed records.

The source-reservation suite proves active claimed-player authorization,
spectator/disconnected/solo refusal before identity work, exact detached
snapshot capture, digest-only operation storage, complete-frontier atomicity,
independent per-player/per-room count limits, transaction-retry stability,
rollback, ambiguous committed reservation/completion recovery, completion
compaction, conservative completed-reference accounting, expiry pruning, and
fail-closed policy/ledger/frontier validation.

The encrypted creation-receipt suite proves atomic checkpoint/receipt/alarm
creation, complete-request digest binding, no plaintext bearer/operation/state,
exact retry without fresh entropy, post-compaction receipt recovery,
transaction-retry stability, ambiguous committed recovery, occupied/incomplete
locator refusal, ciphertext tamper rejection, retention through one-time
restore, revocation erasure, and primary/orphan expiry cleanup.

The create-coordination suite composes the real source ledger, custody adapter,
cryptography, and durable in-memory stores. It proves exact save-object
selection, canonical checkpoint opening, source compaction, completed-retry
receipt recovery, unauthorized/quota short-circuiting, pre-commit and ambiguous
committed failure recovery at source reservation, save creation, and source
completion, and refusal of mismatched plans, receipts, completion references,
unavailable completed receipts, and invalid clocks.

The coordinator also accepts only Cloudflare's documented `Symbol.dispose` RPC
lifecycle metadata in addition to each exact payload schema, copies the
validated credential receipt into a plain frozen DTO, and disposes every
object-valued save response on success or failure. Focused tests prove wrapper
disposal and that transport metadata cannot escape in the returned credential.

The quota suite proves deterministic bounded shard selection, strict
policy/lifetime/input validation, digest-only room/operation storage, exact
idempotent reservation, save-locator collision refusal, per-shard denial,
transaction retry/rollback/ambiguous-commit recovery, expired-capacity pruning,
alarm repair, atomic cleanup rollback, ambiguous cleanup recovery, and
fail-closed malformed/duplicate/oversized ledger handling.

The target suite proves atomic five-record-plus-alarm initialization, exact
retry and alarm repair, save/operation-bound digest derivation, room collision
refusal, snapshot/lifecycle/marker drift refusal, incomplete/corrupt state
rejection, full rollback on write/alarm failure, and ambiguous committed
initialization recovery without rewrite.

The orchestration suite composes the real custody, fork, target wrapper, and
durable in-memory stores. It proves the happy-path canonical-state identity;
pre-commit reservation/preparation, target, and completion failures; ambiguous
committed reservation, target, and completion recovery; no repeated fork
preparation; exact room selection; completed-retry target bypass; foreign
bearer/operation exclusion; mismatched acknowledgement/receipt refusal; invalid
clock refusal; target-deadline refusal; and the no-credential, alarm-bounded
orphan outcome when original custody expires during target work.

The workerd suite now executes the exact internal create and restore RPCs across
real `PtcgContinuation` and `PtcgRoom` namespaces with a deterministic test-only
key binding. Creation proves active-source authorization, concurrent
same-operation convergence, source-ledger compaction, encrypted checkpoint and
receipt custody without plaintext capability/operation/state, exact restored
source-head capture, and identical recovery after both objects are evicted.
Restore proves exact canonical state in the selected room, encrypted completed
custody, digest-only target origin, generic malformed/wrong-locator refusal
before storage, rejection of malformed room plans, and exact receipt/storage
recovery after eviction. The existing HTTP assertion continues to prove that
no edge route reaches either operation.

## Gates still closed

Continuation remains unavailable until all of the following are implemented
and attached to the draft PR/release evidence:

- production secret provisioning, key-rotation/retirement rehearsal, and
  wiring the fail-closed keyring loader only into future cryptographic RPCs;
- quota-shard Durable Object/configuration and create-coordinator wiring,
  request/body limits, and independent rate limits; the fixed-shard global lease
  adapter, private source-room/named-save creation RPCs, stable source operation,
  active-player authorization, exact-snapshot reservation, bounded
  per-player/per-room count model, encrypted exact-retry bearer recovery,
  cross-object coordinator/crash matrix, and workerd concurrency/eviction proof
  are implemented but have no public caller;
- managed-preview cross-object transport/deadline/eviction/rollback exercises;
  the exact private RPC codecs, reserved-room namespace adapter, save-side state
  machine, idempotent target initializer, pure transform, internal orchestration
  loop, credential/identity rotation, model crash matrix, and workerd
  concurrency/eviction path are implemented without an edge caller;
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
