# ADR-026: derive undo from the replay history and allow it in multiplayer

- Status: **ACCEPTED**
- Decision date: 2026-10-06
- Last reviewed: 2026-10-06
- Scope: undo in both room modes, its history, its event payload, and the
  per-command validation path
- Supersedes: the storage design and the Solo-only scope of ADR-014; ADR-014's
  whole-match ordering, exact restoration, and alias rotation stand

## Context

V1 removed Undo from two-player play. ADR-014 kept it Solo-only and stored it
as a second history beside the replay history: a full base state plus up to
128 resolved event tails, each with its own checkpoint hash. Measuring a room
with two 60-card decks at the 128-move bound showed what that cost:

- Every Solo command fully revalidated the snapshot, rebuilding both histories
  with a whole-state hash per step: about 45 ms of candidate validation per
  move and 85 ms per command end to end on a development machine, against
  about 3 ms for a multiplayer command on the incremental path.
- An undo rebuilt its checkpoint the same way, about 110 ms.
- The undo event embedded the whole restored state, about 43 KB, against
  about 0.1 KB for an ordinary move.
- The snapshot carried a second full state and a second copy of every event.

The owner asked for undo in multiplayer as well, working instantly as in Solo.

## Decision

**One history.** The authority snapshot no longer has a separate undo history.
Undo reads the replay history every snapshot already keeps (ADR-016): a
hashed base plus a contiguous tail bounded by 128 batches and 512 KiB.
Scanning the tail from its base gives the undo stack: an ordinary batch is
pushed, an `UndoApplied` batch pops the move it reverted, and a `DeckLoaded`
batch clears the stack because it replaces every card identity. The
checkpoint before the top move is rebuilt by applying the tail to the base and
checked once against the hash the replay entry already recorded.

**Who may undo.** Solo's one controller takes back whatever happened last, as
before. A multiplayer player takes back only their own move, and only while it
is still the newest one standing; once the opponent acts on top of it, it is
part of the shared game. Repeated undos step back through the player's own
consecutive moves. Spectators cannot undo. Each batch records its `issuer`
(seat and command id), because `actorPlayerId` names the seat a command was
aimed at and the default policy lets a player act on the opponent's public
cards. A multiplayer undo must name the requester's own seat; the client sends
its own seat even on a flipped board.

**Instant, by owner decision.** No approval is asked of the opponent. Randomness
comes fresh from the authority, so undoing a coin flip or shuffle and redoing
it is a new roll, and undoing a draw or search does not erase what the player
saw. The owner accepted both for play between people who trust each other.

**Small events.** `UndoApplied` carries a `restorePatch`, the difference from
the current state to the checkpoint, instead of the whole state. Applying it
checks the result against `checkpointHash`, so a wrong or tampered patch is
refused. Events written before this change carry `restoredState` and are still
applied.

**One validation path.** With no second history changing on every Solo move,
Solo commands use the same incremental replay transition and command-candidate
validation as multiplayer, and therefore the durable frontier fast path. The
validator is renamed `validateAuthorityCommandCandidate`.

Measured with the same 128-move room, carrying the validation proof as the
coordinator does: a Solo move takes about 2.5 ms (from 85), a Solo undo about
6 ms (from 110), and a multiplayer move or undo about 3 and 6 ms. The undo
itself, deriving and applying the checkpoint, is under 2 ms of that.

## Consequences

- Undo depth is whatever the replay window still holds. An undo is itself a
  replay entry, so a long run of undos consumes the window it reads: after 128
  moves a player can take back at least 64 of them. ADR-014 already treated
  128 as an operational bound rather than a promise.
- A first-time seat claim rebases the replay history (ADR-016), so moves made
  before the opponent joins cannot be undone afterwards. A reconnect does not
  claim a seat and keeps them.
- An undo rotates every projection alias, now for both players and spectators,
  so a command the opponent sent against the old aliases is refused rather than
  applied to the wrong card.
- Authority snapshot schema 8 drops `soloUndoHistory`; schemas 1 to 7 migrate by
  discarding it. Undo after migration reads the replay history those rooms
  already have.

## Alternatives considered

- **Keep a separate undo history and extend it to multiplayer.** Keeps two
  copies of every event and the full-revalidation cost, and still needs the
  issuer and the multiplayer validator changes.
- **Store a full snapshot per move.** No rebuild at all, but up to 128 states of
  about 43 KB each in a snapshot written on every command.
- **Ask the opponent to approve each take-back, or only those involving
  randomness or hidden cards.** Closes the re-roll and peek exploits. The owner
  chose instant undo instead; the rule lives in `undoCheckpointFor`, so an
  approval step can be added there later.

## Rollback

Setting multiplayer undo back to v1's absence is one guard in
`resolveWireCommand`. Returning to a separate history would need a new schema;
schema-8 snapshots carry no undo history to migrate back.
