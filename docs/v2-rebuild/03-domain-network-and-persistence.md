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
presentation state.

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
persists the resolved result. Replaying history never relies on a future PRNG or
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

1. Client opens a transport with protocol/build capability metadata.
2. Server validates origin and bounded room code, then atomically allocates a role
   through a high-entropy seat/resume capability and short-lived one-time socket
   admission ticket.
3. `Hello` establishes a new session or proves a reconnect session; room code and
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
  opponent's public board must be represented in this permission matrix;
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

The implemented authority schema v3 persists one hashed canonical replay base
plus a contiguous accepted resolved-event tail bounded by both 128 batches and
512 KiB of serialized event data. Rejected commands do not enter replay
history. When either bound is exceeded, the oldest event is applied to the base
before it is dropped, so the retained suffix still reconstructs and hash-checks
the current canonical state. A single oversized batch safely compacts into the
base instead of making retention unbounded. A first-time seat claim rebases the
ledger because display-name metadata changes outside gameplay revisions. Stored
schema-v1 and schema-v2 rooms migrate to a v3 replay rooted at their current
state; a nonzero root is explicitly exposed as `truncated` rather than
pretending earlier revisions are available.

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
revision order. A truncated artifact starts at its retained base revision and
cannot seek into history the authority did not send. React subscribes through a
thin external-store adapter. An application coordinator correlates each request
to the artifact present when it began, enters only a fresh completed artifact,
and exposes either the live projection or one replay projection as the effective
view. It never replaces or rewinds the live session. Exiting during transfer
marks the eventual artifact for discard; refresh keeps the current replay until
a valid replacement installs atomically. Completed playback survives a
same-session reconnect, while terminal sessions and changed match/viewer
identities clear it. Visible replay controls and parity binding remain a later
UI slice, so this implementation changes no current UI/UX.

This bounded ledger, stream, and playback state machine are the runtime replay
foundation, not the final archive/export contract. Phase 7 still owns
long-retention journal chunks, download/import schemas, share capabilities,
quotas, visible replay integration, and the unresolved multiplayer export
policy in ADR-012.

Solo undo is a new authoritative transition with a monotonically increasing
revision: it restores the prior approved logical checkpoint, records
`UndoApplied`, and publishes the resulting view. Audit history is not deleted.
The v2 authority snapshot records an explicit `solo` or `multiplayer` mode; live
connection count is never used to infer permission. Authority schema v3 stores
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
explicitly to multiplayer schema v3 with empty solo history and a replay base
rooted at their current canonical state; schema-v2 rooms preserve their explicit
mode and solo history while receiving the same safe replay rebase.

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
