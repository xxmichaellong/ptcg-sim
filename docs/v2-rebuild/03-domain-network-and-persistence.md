# Domain, network, and persistence

## Domain design goals

The core must make illegal structural states difficult to represent and easy to
detect. “Illegal” means internally contradictory—not illegal under Pokémon
rules. The simulator must still allow users to perform arbitrary tabletop moves.

The same pure transitions run in:

- authoritative multiplayer rooms;
- an in-process authority for solo play;
- replay/import conversion;
- unit and property tests; and
- migration verification against legacy fixtures.

## Identity model

All identifiers are opaque strings with branded TypeScript types. No operation
uses an array index as identity.

| Identifier         | Lifetime and purpose                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| `MatchId`          | One canonical match, independent of a particular connection             |
| `PlayerId`         | One seat in a match; not a username                                     |
| `ConnectionId`     | One socket attachment and visibility recipient                          |
| `SessionId`        | Reconnectable command session for sequencing/idempotency                |
| `CardDefinitionId` | External card printing/metadata identity                                |
| `CardInstanceId`   | One physical card copy for the entire match                             |
| `StackId`          | One active/bench in-play aggregate containing evolution and attachments |
| `ViewCardId`       | Recipient-safe, visibility-generation-scoped reference used by clients  |
| `ZoneId`           | Stable zone identity containing owner and kind                          |
| `CommandId`        | Client-generated idempotency key unique within a session                |
| `EventId`          | Server-generated accepted fact identity                                 |
| `Revision`         | Monotonic canonical-state version                                       |
| `SaveId`           | Internal persisted snapshot identity, never the public token            |

Usernames are display metadata. A room cannot authorize a command by username.

## Canonical state

The exact schema is finalized by an ADR and executable schema tests. It must
represent at least:

```text
MatchState
  schemaVersion
  matchId, revision, lifecycle
  seats[playerId] -> display name, settings, connected status
  definitions[definitionId] -> name, printed category, image variants
  cards[cardInstanceId]
    ownerId, definitionId
    originalCategory, currentCategory
    face, per-card/BREAK orientation, per-card ability marker
    visibilityGeneration
  zones[zoneId]
    ownerId?; kind; ordered card IDs
  stacks[stackId]
    boardPlayerId; slot (active | bench)
    ordered evolution card IDs (bottom -> top)
    ordered attachment card IDs
    stack rotation, damage, condition, ability markers
  active[playerId] -> stackId?
  bench[playerId] -> ordered stack IDs
  workAreas[playerId]
    inspectionSession?
    attachmentResolution?
      source stack ID; suggested active/bench slot
      ordered evolution card IDs (bottom -> top)
      ordered attachment card IDs
  turn/logical markers
    turnNumber, currentPlayer?, VSTAR/GX state, match options
  rng/audit metadata
    algorithm version and authority state needed for future choices
```

Card definitions and card instances are separate. Repeated copies share static
definition metadata. Per-card face/category/BREAK and attachment/discard/stadium
ability-marker state belongs to instances; damage, conditions, group rotation,
host ability markers, and attachment/evolution membership belong to explicit
play stacks where applicable.

### Zones and work areas

Each player's persistent card zones include deck, hand, prizes, discard, lost
zone, and free board. Active and bench contain stack IDs; stadium is a shared
card zone. Order is explicit even when the UI only displays a count or cover.

Legacy `attachedCards` and `viewCards` arrays are not ordinary permanent zones:

- an **inspection session** records the source, ordered cards being inspected,
  allowed viewer(s), and return/move policy; and
- an **attachment-resolution work area** records the removed host stack, its
  suggested slot, ordered lower evolutions, and separately ordered attachments
  while the player chooses discard, hand, lost zone, shuffle, or leave-in-play.

These are canonical when unresolved because reconnect and multiplayer must not
lose them. Opening a visual deck/discard popup without moving cards is local
presentation state. A known client/protocol reachability debt remains:
`CloseInspection` requires the canonical inspection token, but the public work
area projection exposes only the work-area handle. Authority/core coverage uses
the canonical token explicitly; browser reachability must be resolved before
claiming full command parity (R-020).

### Play stacks and ownership

Active/bench play is modeled as explicit `PlayStack` aggregates instead of a flat
zone plus relative pointers. Evolution layers and attachments are ordered lists;
stack-level rotation, damage, condition, and ability markers move atomically with
the play object. BREAK/per-card orientation remains explicit where current
behavior differs from whole-stack rotation. Visual offsets and display parents
are derived.

Card ownership is immutable and separate from the player whose board currently
holds the card/stack. This supports the current permissive tabletop, including a
card owned by one player attached or moved to the other player's public board.
Moving a stack out of play has an explicit atomic policy for evolution layers and
attachments, including creation of the detached-card work area.

Ordinary direct non-Pokémon attachment ingress has a frozen v1 ordering rule. A
Trainer appends to the existing attachment list. An incoming Energy stable-
partitions a fully supported Energy/Trainer list so every Energy precedes every
Trainer while preserving arrival order within each category. If an incoming
attachment is not Energy, or any member is missing or has another current
category, the operation fails closed to append order rather than guessing at
legacy relationships. The rule reads `currentCategory`; changing the category
of a card already inside a play stack or its attachment-resolution work area is
therefore rejected at the internal command boundary and requires a semantic
departure first.

Newly decided ordinary attachments persist `CardAttachedToPlayStack` with
literal `attachmentOrderVersion: 1`, the exact expected source and prior
attachment order, and the resolved destination order. Replay dispatches through
that frozen version and rejects unsupported versions, stale prior order, wrong
board ownership, invalid membership, Pokémon ingress, or a forged destination.
Previously stored `CardMovedToPlay` events with `mode: attachment` deliberately
retain their append-only reducer behavior. This compatibility can reproduce an
older reverse `[Trainer, Energy]` list; a later Trainer still appends, while a
later incoming Energy normalizes the fully supported list under version 1.

Newly decided `RestoreStagedStack` commands persist the distinct
`StagedStackRestoredToPlayStack` event. It carries literal
`attachmentOrderVersion: 1`, the exact staged evolution and attachment inputs,
and the resolved attachment output. The reducer recomputes the full-list v1
stable partition from current categories before it creates the live stack and
rejects a forged version, result, placement, work-area snapshot, or board
layout. This is the source-backed `leaveAll` boundary: staged Trainer-then-
Energy re-enters live play as Energy-then-Trainer while preserving arrival order
within both supported categories.

Previously stored `StagedStackRestored` events keep their literal recorded-order
reducer behavior, just as old direct-attachment events do. Departure into a work
area, staged removals, staged deck-top replacement, bulk resolution, whole-stack
movement, snapshots, and undo preserve their exact arrays and are not implicit
normalization boundaries. A fully supported list is normalized only when the
current restore command creates a new live stack; lists containing Pokémon or
Unknown members retain their input order, while a genuinely missing staged card
is rejected. Reverse and unsupported lists therefore remain valid historical
states outside the v1 normalized transition subset rather than violating a
global invariant.

## Required invariants

The invariant checker runs after every reducer in tests and after every accepted
command on the server. At minimum:

1. Every card instance appears exactly once in a card zone, a stack's evolution
   list, a stack's attachment list, or a work area.
2. Every referenced card, definition, player, and zone exists.
3. Zone lists and work-area lists contain no duplicate IDs.
4. Every play stack is non-empty, appears in one active/bench slot, and has no
   duplicate or cyclic card relationship.
5. Immutable card ownership and current placement/board ownership are both valid;
   cross-owner placement is allowed where the manual tabletop permits it.
6. A face-down or concealed card still has a definition in canonical state.
7. Damage is a bounded positive integer or absent; zero/negative UI outcomes
   normalize to removal. Rotation and marker values are from their declared
   domains.
8. Active and stadium cardinality rules match the current tabletop behavior.
9. Inspection/work-area sessions reference cards actually located in them and
   have a valid owner/viewer/source.
10. Command/event/revision numbers are monotonic and match the room journal.
11. Canonical serialization is stable and has a deterministic state hash.
12. Projection output contains no canonical-only object or accidental reference.

Any legacy behavior that conflicts with an invariant must be captured as
`BUG_COMPATIBLE_PENDING_DECISION`, then either modeled intentionally or approved
as a corrected defect.

## Commands

Commands are a discriminated union with named object fields. Positional argument
arrays are forbidden. Wire commands target opaque `ViewCardId` values from the
sender's current projection—never canonical IDs or hidden zone indices. The
authority resolves and authorizes these references before producing an internal
canonical command. Semantic selectors such as top, bottom, or random are resolved
by the authority.

Every command envelope contains:

```text
protocolVersion, commandId, sessionId, clientSequence,
lastSeenRevision, type, payload
```

Resolved internal commands identify canonical cards/zones by stable IDs and include semantic
preconditions where needed, such as expected source zone, expected parent, or
target anchor. `lastSeenRevision` helps detect stale clients, but does not by
itself force rejection: the authority may accept a command if all entity-level
preconditions still hold. Otherwise it returns `STALE_VIEW` with the current
revision.

### Initial command families

The Phase 1 action catalog maps every legacy action to one of these families.
Names may change, but semantic coverage may not.

| Family                | Representative commands                                                                                                                                                                    | Notes                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Match/deck lifecycle  | `ConfigureSeat`, `LoadDeck`, `SetupPlayer`, `ResetPlayer`, `ResetMatch`                                                                                                                    | Deck replacement and per-seat setup/reset use one current-revision transaction with deterministic displaced-card recovery.                       |
| Card movement         | `MoveCard`, `MoveCards`, `MoveZoneContents`, `ResolveLooseBoardCards`, `MoveCardToDeckTop`, `MoveCardToDeckBottom`, `ShuffleCardIntoDeck`, `SwapCardWithDeckTop`, `MovePrizesToDeckBottom` | Broad loose-board actions require an exact ordered source snapshot and one normalized transactional event.                                       |
| Randomized movement   | `ShuffleZone`, `DrawCards`, `ShuffleAndDraw`, `PlayRandomCardFaceDown`, `FlipCoin`                                                                                                         | Random choices are made by the authority, never trusted from client payloads.                                                                    |
| Table actions         | `StartTurn`, `DeclareAttack`, `PassTurn`                                                                                                                                                   | Whole-table cleanup requires a current view revision and resolves as one persisted batch plus a typed presentation fact.                         |
| Card properties       | `SetCardFace`, `SetCardOrientation`, `ChangeCardCategory`                                                                                                                                  | Per-card rotation is separate from stack rotation; category change atomically departs to the loose board.                                        |
| Markers               | `SetDamage`, `SetSpecialCondition`, `SetAbilityUsed`, `SetCardAbilityUsed`, `SetOncePerGameMarker`                                                                                         | Host/card ability and independent GX/VSTAR markers use target values; opponent-board targets remain policy-gated.                                |
| Relationships         | `AttachCard`, `EvolveCard`, `RestoreStagedStack`, `ResolveStagedCards`, `ResolveInspectionCards`                                                                                           | Departure, restoration, and bulk work-area resolution remain transactional.                                                                      |
| Inspection/visibility | `BeginInspection`, `EndInspection`, `RevealCards`, `EndReveal`                                                                                                                             | Authority controls viewer set and opaque handles.                                                                                                |
| Turn/table signals    | `StartTurn`, `DeclareAttack`, `PassTurn`                                                                                                                                                   | Preserve current logs/signals; do not enforce rules.                                                                                             |
| History               | `ApplySoloUndo`                                                                                                                                                                            | Preserve current solo-only undo by restoring a checkpoint and appending an audit event. Multiplayer undo is deferred unless separately approved. |

A composite UX action can be one transactional command. It should not be split
into several client-submitted primitives if intermediate states would violate
invariants or make reconnect observable. `SetupSeat`, shuffle-and-draw, moving a
Pokémon with its stack, and board-wide moves are examples.

`PlayRandomCardFaceDown` is intentionally selector-free on the wire. It names
only the target player; the authority validates the current revision and room
policy, selects from the canonical hand with its cryptographic random source,
and persists a resolved event containing exact pre-action hand/board snapshots.
The chosen card moves to the loose board face-down in one revision and receives
a new visibility generation. Only the trusted event contains its canonical ID;
recipient snapshots use fresh opaque handles, and the presentation fact carries
only actor and target player IDs.

Chat, presence, heartbeat, opening a popup, sorting a local visual view, hover,
selection, preview, drag coordinates, animation, and theme changes are not game
commands. Chat still uses an authenticated, rate-limited room message path.

## Command decision and event application contract

Conceptually, the core is split into:

```text
decideCommand(state, internalCommand, authorityContext)
  -> ResolvedDomainEvent[] | CommandRejection
applyEvents(state, resolvedEvents)
  -> nextState
projectView(state, viewerCapability)
  -> ViewState
assertInvariants(state)
```

One accepted command produces one atomic resolved event batch and increments the
revision once. A shuffle event persists the resulting private order; a flip event
persists both its authority-resolved result and trusted session actor. The public
`FlipCoin` wire intent remains parameterless, so a client cannot spoof that
attribution. Replaying history never relies on a future PRNG, guessed actor, or
changed decision algorithm.

Decision and application functions:

- are synchronous and pure;
- never mutate the input;
- receive time and random results through an explicit authority context;
- validate semantic preconditions;
- update the whole logical transaction or nothing;
- emit/apply facts using stable canonical IDs, not localized UI text; and
- do not determine screen positions, sounds, or animation duration.

The command pipeline validates the runtime schema before resolving view IDs and
invoking the core, applies the candidate event batch, and checks invariants before
committing the result. In production, an invariant
failure quarantines the room mutation, records diagnostic context without
secrets, and returns an internal error; it never publishes partial state.

## Visibility and hidden information

The server stores complete canonical state. For every publication it calls a
pure projection function with canonical state and a viewer capability:

```text
project(matchState, viewerRole) -> ViewState
```

Viewer roles are seat A, seat B, public spectator, authorized coach if retained,
and server-only. A username or board orientation does not select a role.

### Visibility rules

- A player sees identities in their own hand and in inspection sessions granted
  to them.
- Opponents and public spectators see hand counts and opaque concealed cards,
  never definitions.
- Deck identity and order remain server-only except for explicitly authorized
  inspection. Even the owner normally receives only the allowed view, not a
  durable full-order payload.
- Prize identities follow current reveal/look semantics but default to
  concealed.
- A private whole-zone look is limited to the exact current hand or prize order.
  A private per-card look binds one projected card handle to its exact zone,
  stack, or work-area source. The player may inspect their own private cards;
  opponent-private inspection requires mutual persisted `coachingConsent` and
  is not enabled by the public opponent-interaction policy.
- Private inspection grants are canonical, bounded, replay-validated records of
  source player, exact source container, card set, and viewer set. A grant
  survives reconnect/restoration until the viewer closes it, but movement out
  of its recorded source removes the moved cards and deletes an empty grant.
  Setup/reset therefore revoke affected grants through the same movement rule.
- Grant metadata and newly visible definitions are projected only to a named
  viewer. Other players and spectators receive no grant ID/card list. Safe
  presentation facts may disclose only source player, viewer player, and count.
  Consent revocation cannot erase knowledge already delivered, so ADR-017 still
  requires product ratification of this draft policy.
- Public reveal/hide commands bind to an exact source and revision. Whole-zone
  commands are limited to the complete ordered prize zone; selective reveal of
  an unknown opponent card is forbidden even when public opponent interaction
  is enabled.
- Public zones expose identity unless a card is intentionally face down.
- Temporary reveals are scoped by exact viewers and end atomically.
- A spectator view is computed independently; it is not copied from either
  player's client state.
- Chat, logs, errors, events, analytics, state hashes, and asset-prefetch requests
  must not encode concealed definition IDs.

All projected cards use recipient-safe view IDs. Concealed handles are regenerated
on shuffle or any operation that should break tracking, so a recipient cannot
follow a particular unknown card across a randomized zone. An implementation may
derive handles from a room secret, viewer, canonical card ID, and persisted
visibility generation, or maintain a persisted alias table; it must survive room
hibernation without exposing the canonical ID. Counts and visible ordering are
disclosed only where the current UI requires them.

Card definitions and face-image URLs are cataloged to a connection only while
visible. A known card becoming concealed removes its definition from subsequent
view state and rotates the view handle according to policy. Projected cards
carry a boolean public-reveal status, never a canonical identity. Viewer-private
grant metadata uses recipient-safe card handles and is omitted entirely from
unauthorized projections.

### Projection tests are security tests

Fixtures must serialize every message for every role and recursively assert that
forbidden card definition IDs, names, URLs, and stable canonical instance IDs are
absent. Differential tests compare two canonical states that differ only in a
secret: an unauthorized projection must be byte-identical after normalized
opaque handles.

## Room authority

One logical authority owns each room. The recommended Durable Object runtime
serializes room commands and keeps hot state in memory backed by durable storage.
An adapter boundary keeps `game-core` and the protocol deployable to another
room runtime.

### Connection and role lifecycle

1. Creator custody may derive a high-entropy, expiring, one-use guest invitation
   from a seat/spectator master capability through a same-origin bounded POST.
   The joining client exchanges either that invitation or its own master
   capability for a short-lived one-time socket ticket.
2. Client opens a credential-free transport URL with protocol/build metadata.
3. `Hello` consumes the socket ticket to establish a new session or proves a
   reconnect with its resume capability; room code and
   display username are never authorization.
4. Server replies with `Welcome`: room metadata, role, session/sequence, current
   revision, and a full role-specific snapshot.
5. Heartbeats detect dead links; short disconnects reserve a seat for a bounded
   grace period.
6. Reconnect replaces the connection binding but retains session command
   deduplication and sends a fresh projection.
7. Explicit leave revokes the binding/capability and publishes presence.

Anonymous guest play can remain. It still requires unguessable seat/reconnect
capabilities rather than trusting a display name.

The implemented creation boundary accepts only an empty, bounded, strict,
same-origin JSON `POST` to `/v2/rooms`; room configuration remains server-owned.
It returns a runtime-validated, `no-store` room code plus three distinct
high-entropy credentials only after durable initialization. A faulty entropy
source cannot persist duplicate or out-of-bounds credentials. The browser
validates its lobby input before creation, immediately exchanges the creator's
seat credential, and retains the player-two and spectator master credentials
only in a non-serializing in-memory custodian. That custodian can mint a
15-minute role-bound handoff via a second strict, bounded, same-origin `POST` to
`/v2/rooms/:roomCode/invitations` without returning the master credential to its
caller. Player issuance rotates the prior invitation for that seat; spectator
issuance creates distinct invitations up to the room cap. Creation, issue, and
bootstrap failures are redacted. This closes the creation and guest-claim
protocol paths without deciding how the bearer handoff crosses to another
browser.

The implemented admission boundary accepts a long-lived seat/spectator master
capability or a derived guest invitation only in a bounded, strict, same-origin
JSON `POST` to `/v2/rooms/:roomCode/admission-tickets`. It returns a `no-store`
30-second socket ticket. Authority schema v6 stores at most 32 unexpired
invitation digests and 32 ticket digests, never bearer values; invitation grants
are role-bound and ticket records also bind the normalized display name.
Issuance and redemption are serialized with room messages. If an invitation
exchange response is lost, retrying it revokes the previous unconsumed ticket
and returns a new one. WebSocket redemption removes the invitation and every
linked ticket in the same compare-and-swap transaction that claims the session
and rotates to a fresh resume capability. Player invitation rotation also
revokes any ticket linked to the old claim. Expired, replayed, wrong-role,
wrong-name, cross-origin, oversized, and malformed inputs fail without
reflecting credential material. The browser uses redirect-error, no-referrer,
omitted-credential fetch semantics, derives credential-free HTTP and WebSocket
URLs from the same origin, validates the untrusted handoff before exchange, and
hands only the resulting runtime and route descriptor to React.

Creation is limited at the Worker edge to 12 valid allocation requests per
hashed anonymous network identity per 60 seconds. Because the Cloudflare binding
is location-local and eventually consistent, it is only a coarse allocation
guard. Each Durable Object independently enforces persisted, transactional
60-second fixed-window limits of 24 invitation issues, 60 admission-ticket
exchanges, 120 WebSocket upgrades, and 120 `Hello` attempts. These records are
bounded operational state, not canonical game state or authorization evidence;
normal authority validation still applies after the budget check.

A newly initialized room is `unclaimed` for five minutes. Its lifecycle record,
authority snapshot/frontier pair, and Durable Object alarm are installed
atomically. The first successful seat or spectator admission changes the
lifecycle to `claimed`, rotates the snapshot/frontier pair, and cancels the alarm
in the same admission transaction. A due alarm validates and, if safe, repairs
the pair before it changes `unclaimed` to `expiring`; all later mutations and
allocations then fail closed before `deleteAll()`. If deletion fails,
Cloudflare's at-least-once alarm retry sees the tombstone and retries deletion.
An early alarm is rescheduled, an obsolete alarm for a claimed room is
cancelled, and a stale unclaimed marker paired with an existing session is
repaired to claimed. Rooms created before the lifecycle record existed are never
retroactively deleted. See the documented
[Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
and [alarm API](https://developers.cloudflare.com/durable-objects/api/alarms/).

ADR-020 blocks visible create/join wiring. The v1 room ID is both discovery and
authorization; retaining that behavior would negate SEC-001/SEC-003. The v2
guest invitation protocol and validated handoff now exist, but their
cross-browser presentation/transport still needs an explicitly approved choice
(for example manual transfer versus a trusted relay). Raw credentials must not
be added to URLs, logs, analytics, storage, React state, or hidden DOM fields as
a convenience.

### Message families

| Direction        | Messages                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client to server | `Hello`, `Command`, `SendChat`, `Ping`, `RequestReplay`, `Leave`, save requests                                                                                           |
| Server to client | `Welcome`, `StatePublication`, `CommandResult`, `ReplayStarted`, `ReplayFrame`, `ReplayCompleted`, `ChatMessage`, `Presence`, `Pong`, `ServerNotice`, maintenance notices |

`StatePublication` initially carries the full projected state plus revision and
small presentation events. PTCG state is discrete and small enough that this is
the safest reconnect and reconciliation model. Card definitions/image metadata
are deduplicated and cached separately. Patch/delta transport is a later
optimization only if measured payloads exceed the budget; any patch design must
retain periodic/full-snapshot recovery.

Reveal/hide and private-inspection presentation facts carry the trusted actor or
viewer, target/source player, card-versus-zone scope, and a fixed semantic
source (`hand`, `prizes`, `deck`, stack slot, or work-area kind). A single-card
public reveal may additionally carry its bounded display name, but only after
the resulting canonical state proves that identity is visible to a spectator.
Hide and private-inspection facts never carry card names, handles, definition
IDs, image URLs, or canonical IDs. This least-privileged event list is identical
for every recipient and is rebuilt from the matching resulting state during
projected replay.

This state/event shape change advances wire protocol to v2, match state to
schema v2, and the Durable Object snapshot/storage envelope to v4. Migration
adds explicit scope to active inspection grants, choosing generic single-card
scope for the old ambiguous one-card case. Prior authority schemas root fresh
replay/solo-undo histories at the migrated current state because older resolved
visibility events lack the trusted actor/scope fields required for deterministic
application. Current-schema snapshots missing scope fail invariant validation.

`RequestReplay` has no role, player, revision, or canonical-history selector.
The server derives the perspective from the capability-bound active session and
streams one bounded projected snapshot per message between `ReplayStarted` and
`ReplayCompleted`. Streaming keeps each frame under the same transport boundary
as a live full projection and lets the client publish only a complete,
contiguous artifact. A malformed, incomplete, wrong-perspective, or out-of-order
stream is discarded; an interrupted transfer is not resumed across reconnect.

### Ordering and delivery

- The authority serializes accepted game commands.
- `(sessionId, commandId)` is idempotent; duplicate submissions return the
  original result without applying again.
- `clientSequence` detects gaps or replayed commands and has a bounded dedupe
  window persisted across hibernation/restart.
- An accepted command receives a new revision exactly once.
- The sender's `CommandResult(accepted)` is sent only after a publication that
  covers that revision has been queued for that sender.
- The client removes its pending overlay only when acceptance/rejection is known
  and reconciles to the authoritative view.
- Unknown messages, protocol versions, or command discriminants are rejected
  without invoking application code.

WebSocket transport does not magically provide application-level exactly-once
delivery. The identifiers, deduplication, snapshots, and sequencing above create
the required semantics.

### Authorization and abuse controls

The authority validates:

- connection belongs to the room and claimed session;
- role is player rather than spectator for state-changing commands;
- actor may control the target seat/card under solo, multiplayer, coaching, and
  opponent-action-request policies. Current permitted manipulation of an
  opponent's public board must be represented in this permission matrix. The
  current resolver uses card-based authorization, so a player may move a card
  they control into an opponent-owned destination even when
  opponent-public interaction is disabled; R-015 tracks the product decision
  and the missing source/destination/action matrix;
- payload depth, strings, arrays, deck size, chat size, and batch size;
- per-connection and per-room rate/burst budgets;
- active inspection/reveal/undo capability where relevant; and
- origins, upgrade headers, and deployment environment.

Logs are structured and redact room tokens, save capabilities, deck contents,
hidden IDs, and chat content by default. Production admin access must fail closed
when credentials are missing; there is no default password.

## Persistence

### Room journal

Persist:

- metadata and schema/protocol versions;
- current canonical snapshot and revision;
- append-only resolved domain event batches and safe command audit metadata in
  bounded chunks;
- idempotency window/session metadata needed for safe reconnect; and
- save/replay indexes and expiry.

Snapshot on a measured cadence (for example every 25 accepted commands), on
important lifecycle boundaries, before hibernation when needed, and at explicit
save. The cadence is tuned by load tests; the example is not a hard-coded
constant. Recovery loads the newest valid snapshot and replays only the bounded
tail, then verifies the state hash.

Events are chunked, compressed if worthwhile, and subject to retention limits.
No client receives the canonical journal merely to reconnect.

For each accepted command, the resolved event batch, new revision, session
frontier, idempotency outcome, and required audit metadata commit atomically
before the in-memory state is installed and before any publication or success
result. An explicit serial command queue prevents async storage awaits from
interleaving room decisions. If the process dies after commit, restore/reconnect
publishes the applied state; if a result is lost, retry returns the persisted
outcome without reapplying.

The current isolated server foundation atomically replaces the authority
snapshot on every command/admission commit and retains separate recent audit
rows. Those rows are not a second recovery source: canonical state, replay,
session sequence frontiers, and the bounded idempotency outcomes live in the
validated snapshot. A transactionally updated retention index keeps at most 128
command rows/512 KiB and 64 admission rows/128 KiB. Adding a row, advancing the
snapshot/index frontier, and deleting every displaced row are one transaction;
if pruning fails, none of them commit. A missing or malformed index is rebuilt
from paginated 128-row scans and stale rows are deleted in batches no larger
than Cloudflare's documented multi-key API limit. Journal keys contain only a
zero-padded authority version, not session, command, ticket, invitation, or
digest material. See the
[SQLite-backed Durable Object storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

This closes monotonic audit-row growth, but per-command full-snapshot replacement
is still an interim checkpoint strategy. The first bounded-history `workerd`
measurement showed three whole-snapshot invariant scans. Exact-object validation
proofs removed the current and adapter duplicates, and verified incremental
replay removed retained-history reconstruction. The multiplayer path clones one
canonical event batch, reapplies only that batch to derive the next state, and
uses cached canonical UTF-8 entry sizes to remove the minimum replay prefix
required by count and byte bounds. Only an actually removed prefix is applied to
advance the base; the retained frozen suffix is carried by construction and is
not replayed. A single-use opaque proof binds the exact predecessor/proof, batch,
result state/history roots, and replay limits. Rejected commands retain the
predecessor's state and replay roots and validate only their session/outcome
delta.

After the cheap non-replay invariant families pass, the candidate is recursively
frozen and receives the ordinary opaque snapshot proof, additionally bound to
its exact source snapshot and validation, outcome, session, and canonical batch.
That same canonical batch drives presentation, replay, persistence, and the
command journal even when it is immediately compacted into the replay base.
These proofs are internal correctness evidence, not credentials or portable
signatures, and are never persisted or sent over the wire. Missing, forged,
stale, reused, cross-room, mutated, or mismatched evidence cannot take the fast
path. Proofless or mismatched persistence performs complete candidate validation
and checks the full accepted/rejected transition against the fully validated
durable predecessor.

The storage adapter now maintains an exact store-local validated head alongside
a strict `ptcgsim-authority-frontier-v1` record. The existing v6 snapshot
envelope accepts an optional 128-bit generation; the frontier binds it to the
envelope and domain schema versions, match, mode, authority version, and state
revision. An exact cache/source-proof/frontier match lets the normal proven
multiplayer commit transaction read the small frontier without reading the
snapshot. The generation is created once outside the retryable transaction,
must rotate from the actual predecessor, and the new snapshot/frontier, journal,
retention index, and pruning commit atomically.

Restore, migration, retry reload, external snapshot install, proofless calls,
and every fast-path mismatch remain full-validation boundaries. Missing or
strictly malformed frontier data is repaired only after a complete snapshot
validation. A well-formed frontier that diverges from its generated snapshot
fails closed without writes. The additive v6 field is deliberately
rollback-compatible: the old v6 reader ignores it, an old writer omits it, and
the next new runtime fully validates the generation-free snapshot before
atomically replacing the stale pair. Admission commits always read and validate
their predecessor; their snapshot/frontier, journal, retention, lifecycle/alarm,
and pruning changes remain paired. The generation/frontier is coherence
evidence, not a bearer credential. This changes no game-domain, wire, or
production telemetry schema; only the local performance artifact advances to
v3.

The canonical authority-frontier run took 8.766 seconds for its scenario and
12.12 seconds for the complete Vitest invocation; fixture setup took 664 ms.
Mature command-to-publication minimum/p50/p95/p99/max was 29/43/50/53/53 ms;
server handling was 21/34/42/44/44 ms. Authority, projection, persistence,
publication
serialization, and socket-send p50/p95 were 18/22, 7/11, 8/12, 1/1, and 0/1 ms.
Inner input, resolution/execution, history/candidate, candidate validation,
adapter validation, predecessor validation, and transaction p50/p95 were 0/0,
3/6, 9/11, 6/8, 0/0, 0/0, and 8/12 ms. All 32 plateau commands hit the frontier;
none fell back. Against the incremental-replay run, p95 moved from 252 to 50 ms
end to end, 243 to 42 ms server-side, and 207 to 12 ms for persistence; scenario
time moved from 26.204 to 8.766 seconds. Both provisional 250 ms p95 objectives
are met locally by 200 and 208 ms. The next gate is managed-preview and soak
validation, without weakening complete restore/fallback validation.

The post-hibernation command was 181 ms end to end and 43 ms server-side, with a
16/14/12/0/1 ms authority/projection/persistence/publication/socket split and
0/3/7/6/0/0/1/11 ms input/resolution/history/candidate/adapter/predecessor/hit/
transaction detail. The largest frame and aggregate publication were 62,431 and
149,276 bytes. Storage peaked at 139 entries/368,318 bytes and ended at
139/358,243, including a 297-byte frontier.

### Saved games and links

- Use at least 128 bits of cryptographically secure random capability material.
- Hash public capabilities at rest where feasible.
- Never overwrite on collision; retry creation.
- Apply TTL, size, count, and request-rate limits.
- Validate schema and decompressed size before storage or import.
- Provide revocation/deletion and operational cleanup.
- Store immutable save schema version, source build, and integrity checksum.

Solo saves may contain the complete state because the local user controls both
sides. Multiplayer export is a blocking product/security decision: a client must
not receive an opponent's concealed deck just to preserve the current export
mechanism. Preferred options are an opaque encrypted/server-hosted resume token
for full continuation and a role-projected downloadable replay for viewing.

### Replay and undo

Replay is reconstructed from an initial snapshot plus accepted resolved domain
event batches under a pinned event/state version. New clients never execute
arbitrary legacy function names. Public replay uses projected frames and cannot
reveal secrets that were not public at that revision.

The implemented authority schema v6 persists one hashed canonical replay base
plus a contiguous accepted resolved-event tail bounded by both 128 batches and
512 KiB of serialized event data. Rejected commands do not enter replay
history. When either bound is exceeded, the oldest event is applied to the base
before it is dropped, so the retained suffix still reconstructs and hash-checks
the current canonical state. A single oversized batch safely compacts into the
base instead of making retention unbounded. A first-time seat claim rebases the
ledger because display-name metadata changes outside gameplay revisions. Stored
schema-v1, schema-v2, and schema-v3 rooms migrate to a replay rooted at their
current state. Schema-v4 rooms retain that replay while gaining empty ticket and
invitation registries; schema-v5 rooms preserve their outstanding tickets while
gaining an empty invitation registry. A nonzero root is explicitly exposed as
`truncated` rather than pretending earlier revisions are available.

Projection happens only inside the authority boundary. Each request starts a
fresh artifact-local opaque identity registry, preserves aliases while the same
visibility generation remains active, and clears the registry after
`UndoApplied` so identities from a discarded branch cannot correlate with the
restored branch. The canonical base, batches, hashes, card IDs, and definition
IDs never appear in replay protocol messages. Player sessions receive only that
player's historical projection; spectator sessions receive only the public
projection. The client session assembles the bounded frames atomically. A
separate renderer-neutral playback controller validates and installs that
projected artifact without gaining transport, command, or canonical-history
access.

Playback consumes the retained snapshots directly; it never reruns domain
events or randomness. `restart`, `previous`, `next`, and `fastForward` preserve
the four legacy replay-control meanings while remaining bounded at both ends.
Every installed frame exposes the deterministic presentation-event timeline up
to that frame. A separate forward-crossing list lets render effects run once per
controller generation: rewind/restart emit no effects, stepping forward emits
the entered frame's effects, and fast-forward emits all crossed effects in
revision order. The application presentation dispatcher consumes each replay ID
and playback generation once, preserves cross-revision fast-forward order, and
isolates an individual effect-adapter failure without suppressing later facts.
It queues reentrant generations behind the batch already being presented and
seeds from the current snapshot without replaying effects merely because a UI
surface mounted. These effects intentionally stay outside renderer
`installScene`, whose event inputs must all match its one installed revision.
A parallel live dispatcher uses retained immutable event identity as its cursor,
which remains correct as the session's bounded timeline drops older entries.
`GamePresentationCoordinator` owns both paths and selects the effective mode:
live facts arriving during replay are marked consumed but remain invisible, so
they cannot bleed into replay or burst into the activity log after exit. Both
paths use the same exhaustive pure mapper and isolated activity,
accessibility-announcement, and animation adapters. One failed adapter or
diagnostics callback cannot suppress later effects or facts. Coin animation is
a standalone effect carrying actor and resolved outcome; it is never rerolled.
The concrete local runtime bounds each independently subscribable channel,
assigns local monotonic identities, and requires FIFO acknowledgement for
one-shot announcements and animations. Replay activity is synchronized from the
complete timeline through the effective frame instead of being appended as an
effect: backward seeks remove future entries, while only forward-crossed facts
produce announcements or animations. Mode changes, replay replacement, and
backward seeks atomically cancel queued one-shot work.
The runtime binds to the effective match/viewer identity, retaining state across
same-identity remounts but atomically purging it after identity change or a
terminal live session.
The optional consumer runtime derives stable keyed activity rows without
copying DOM state and drains each transient channel serially. Queue overflow,
clear/reset, replay lifecycle changes, and consumer disposal abort obsolete
work; settlement from an obsolete promise cannot acknowledge a newer entry.
Handler and diagnostics failures are isolated and the failed head is removed so
later work is not wedged. A live reduced-motion preference aborts the animated
path and settles the same resolved result through a non-animated callback.
A truncated artifact starts at its retained base revision and cannot seek into
history the authority did not send. React subscribes through a thin
external-store adapter. An application coordinator correlates each request to
the artifact present when it began, enters only a fresh completed artifact, and
exposes either the live projection or one replay projection as the effective
view. It never replaces or rewinds the live session. Exiting during transfer
marks the eventual artifact for discard; refresh keeps the current replay until
a valid replacement installs atomically. Completed playback survives a
same-session reconnect, while terminal sessions and changed match/viewer
identities clear it. The remote board binding selects the coordinator's
effective view and blocks command submission while replay is loading, active,
or draining. `RemoteRoomRuntime` now constructs the session, replay coordinator,
and presentation owner before connecting, then disposes them outside-in before
closing transport. The lazy `RemoteRoomRoute` composes that runtime with the
board, exact replay chrome, multiplayer/replay activity IDs, live region, and
Options/Exit path. `RemoteRoomBootstrap` now creates that trusted connection
handoff by exchanging an in-memory long-lived capability for a one-time ticket;
no credential enters a URL, storage, DOM, React state, or log.
`RemoteRoomCreation` keeps guest master credentials private while minting
bounded handoff values, and the guest bootstrap validates and exchanges such a
handoff through the same ticket path. The renderer-spike entry remains the
default until ADR-020 selects the cross-browser transfer/presentation adapter,
so the current UI/UX remains unchanged.

The Worker now publishes only the closed `ptcgsim-server-telemetry-v2` union.
Its safe facts cover route status/latency, room lifecycle and bounded counts,
rate outcomes, admission role/outcome, command type/revision/outcome and
publication size, numeric command-phase durations, socket lifecycle, and fixed
failure subsystems. Command phases separate authority processing, recipient
projection, durable persistence, publication serialization, and socket send;
they carry no identifiers or payload contents. Every record
includes sanitized build/protocol/authority/match-schema versions and random
event/source-instance correlations unrelated to room or session authority. The
emitter reconstructs fields instead of spreading caller objects, bounds labels
and numbers, and cannot receive raw errors. It excludes payloads, chat, names,
card/deck/definition/view IDs, URLs, room/session/command IDs, all credentials
and digests, IP identity/hash, close reasons, error messages, and stacks.
Authority timing is optional and a failed timing clock collapses its observation
to zero without affecting the transaction. Telemetry clock/ID/sink failure is
also isolated from game behavior. A no-store
`GET /v2/health` exposes only status and sanitized build/schema versions;
production destinations, dashboards, preview baselines, and alert/runbook
rehearsal remain rollout gates documented in `apps/server/OPERATIONS.md`.

This bounded ledger, stream, and playback state machine are the runtime replay
foundation, not the final archive/export contract. Phase 7 still owns
long-retention journal chunks, download/import schemas, share capabilities,
quotas, full-sidebar replay integration, and the unresolved multiplayer export
policy in ADR-012.

Solo undo is a new authoritative transition with a monotonically increasing
revision: it restores the prior approved logical checkpoint, records
`UndoApplied`, and publishes the resulting view. Audit history is not deleted.
The v2 authority snapshot records an explicit `solo` or `multiplayer` mode; live
connection count is never used to infer permission. Authority schema v6 stores
one hashed base state plus a bounded active-branch tail of resolved event
batches. It reconstructs the selected checkpoint inside the trusted boundary,
then persists the exact restored canonical state in the resolved undo event so
ordinary event replay remains self-contained. The event must be alone in its
batch. The client supplies only the announcement target and cannot select or
upload history.

The tail contains at most 128 entries by default and advances its base through
the oldest resolved event when compacted. Deck replacement and first-time seat
metadata mutation clear it; rejected commands and undo itself never create a
new checkpoint. Random decisions are therefore restored exactly and are never
rerun. Undo rotates every projection alias before publication to prevent
correlation with a discarded hidden branch. Audit history is not deleted,
reconnect restores the new branch without replaying the presentation fact, and
multiplayer undo is not added by this rebuild. Stored authority-v1 rooms migrate
explicitly to multiplayer schema v6, while schema-v2 and schema-v3 rooms retain
their explicit mode. All prior schemas receive empty solo history and a replay
base rooted at their migrated current canonical state because their older event
tails do not contain the v2 match-state visibility scope required for safe
deterministic replay. Schema-v4 rooms keep their compatible state and replay
history while receiving empty one-time-ticket and invitation registries.
Schema-v5 rooms retain their compatible ticket registry and receive an empty
invitation registry.

The provisional command order is whole-match authority order, not v1's two
independent client action arrays. This avoids replaying one seat's JavaScript
side effects over later shared-state changes. The target player remains only a
presentation/announcement field. ADR-014 keeps this narrow interleaved-history
difference visible for product parity ratification.

## Legacy conversion

`packages/legacy-import` is the only code allowed to understand v1 action names,
positional parameters, array indices, export versions, or card-node-era quirks.

Conversion procedure:

1. Runtime-validate and bound the legacy payload.
2. Select a converter by explicit legacy version; never guess silently.
3. Replay in a sandboxed legacy-state interpreter without DOM or dynamic
   function lookup.
4. Assign stable v2 IDs while preserving ordered zones, play stacks, and work
   areas.
5. Normalize to canonical v2 state and run all invariants.
6. Produce a conversion report listing warnings, dropped presentation-only
   fields, source hash, and target hash.
7. Save only the v2 result. The new runtime does not continue appending v1
   actions.

Unsupported or corrupt inputs fail safely with an actionable report; partial
conversion is never silently loaded into a live room. Immutable fixtures cover
every known exported version and representative complex states.

## Schema evolution

- Wire protocol, canonical state, persisted snapshot, event, and legacy import
  versions are separate explicit numbers.
- Additive wire changes remain compatible only when the runtime schemas and
  capability negotiation prove it.
- Persisted-state migrations are pure, ordered, testable functions with fixtures
  for every supported hop.
- Destructive migrations require backup/restore rehearsal and a rollback window.
- A deployment may run mixed web versions only across the explicitly supported
  protocol range; otherwise the server asks the client to refresh before join.
