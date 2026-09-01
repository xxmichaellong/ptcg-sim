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
    face, per-card/BREAK orientation
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
definition metadata. Per-card face/category/BREAK state belongs to instances;
damage, conditions, group rotation, and attachment/evolution membership belong
to explicit play stacks where applicable.

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

| Family                | Representative commands                                                                                                                                          | Notes                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Match/deck lifecycle  | `ConfigureSeat`, `LoadDeck`, `SetupSeat`, `ResetSeat`, `ResetMatch`                                                                                              | Deck validation and instance creation are atomic.                                                                                                |
| Card movement         | `MoveCard`, `MoveCards`, `MoveZoneContents`, `MoveCardToDeckTop`, `MoveCardToDeckBottom`, `ShuffleCardIntoDeck`, `SwapCardWithDeckTop`, `MovePrizesToDeckBottom` | Explicit source/target IDs and attachment policy.                                                                                                |
| Randomized movement   | `ShuffleZone`, `DrawCards`, `ShuffleAndDraw`, `PlayRandomFaceDown`, `FlipCoin`                                                                                   | Random choices are made by the authority, never trusted from client payloads.                                                                    |
| Card properties       | `SetCardFace`, `RotateCard`, `SetCategoryOverride`                                                                                                               | Covers reveal/hide/rotate/change-type behavior.                                                                                                  |
| Markers               | `SetDamage`, `SetSpecialCondition`, `SetAbilityUsed`, `SetOncePerGameMarker`                                                                                     | Prefer target values over increment-only operations for idempotency.                                                                             |
| Relationships         | `AttachCard`, `EvolveCard`, `RestoreStagedStack`, `ResolveStagedCards`, `ResolveInspectionCards`                                                                 | Departure, restoration, and bulk work-area resolution remain transactional.                                                                      |
| Inspection/visibility | `BeginInspection`, `EndInspection`, `RevealCards`, `EndReveal`                                                                                                   | Authority controls viewer set and opaque handles.                                                                                                |
| Turn/table signals    | `StartTurn`, `DeclareAttack`, `PassTurn`                                                                                                                         | Preserve current logs/signals; do not enforce rules.                                                                                             |
| History               | `ApplySoloUndo`                                                                                                                                                  | Preserve current solo-only undo by restoring a checkpoint and appending an audit event. Multiplayer undo is deferred unless separately approved. |

A composite UX action can be one transactional command. It should not be split
into several client-submitted primitives if intermediate states would violate
invariants or make reconnect observable. `SetupSeat`, shuffle-and-draw, moving a
Pokémon with its stack, and board-wide moves are examples.

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
view state and rotates the view handle according to policy.

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

| Direction        | Messages                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Client to server | `Hello`, `SubmitCommand`, `SendChat`, `Ping`, `Leave`, save/replay requests                                                  |
| Server to client | `Welcome`, `StatePublication`, `CommandResult`, `ChatMessage`, `Presence`, `Pong`, `ProtocolError`, maintenance/close notice |

`StatePublication` initially carries the full projected state plus revision and
small presentation events. PTCG state is discrete and small enough that this is
the safest reconnect and reconciliation model. Card definitions/image metadata
are deduplicated and cached separately. Patch/delta transport is a later
optimization only if measured payloads exceed the budget; any patch design must
retain periodic/full-snapshot recovery.

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
event batches under a pinned event/state version. New clients never execute arbitrary
legacy function names. Public replay uses projected frames and cannot reveal
secrets that were not public at that revision.

Solo undo is a new authoritative transition with a monotonically increasing
revision: it restores the prior approved logical checkpoint, records
`UndoApplied`, and publishes the resulting view. Audit history is not deleted.
The effect on hidden random outcomes must match characterized v1 behavior or be
an approved integrity exception. Multiplayer undo is not added by this rebuild.

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
