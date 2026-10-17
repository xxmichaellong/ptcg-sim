# ADR-016: persist a bounded event ledger and project replay by perspective

- Status: **ACCEPTED**
- Decision date: 2026-09-14
- Last reviewed: 2026-09-14
- Scope: crash recovery, replay, and replay delivery
- Release status: ledger and perspective replay implemented; archival policy and
  server-held continuation remain separate gates

## Context

V1 replays growing client action arrays containing positional intent and mixed
presentation behavior. Authoritative recovery needs resolved facts and canonical
checkpoints, while a downloadable or streamed replay must not expose state the
viewer was never authorized to know.

## Decision

Persist resolved domain-event batches with canonical checkpoints and verified
result hashes. Bound the active replay ledger to 128 batches and 512 KiB by
default, compacting a reconstructable prefix into the base checkpoint. Version
and migrate the ledger independently from the wire and match schemas.

When a connected session requests replay, reconstruct inside authority and
project every frame independently for that session's role and historical
visibility. Stream the bounded artifact separately from live publications with
request correlation, explicit start/end revisions, fresh artifact aliases, and
atomic client installation. Replay is inert: it cannot submit through or rewind
the live session or renderer. ADR-012 governs downloads and server-held
continuation.

## Alternatives considered

- Snapshots alone weaken audit, replay, and undo.
- Raw commands can change meaning under new reducer/randomness versions.
- Broadcasting canonical history leaks hidden information.
- Mixing replay and live transport state permits stale work and accidental
  submissions.

## Evidence and consequences

Room-authority replay history, projected replay, persistence migrations,
protocol frames, client assembly/playback, coordinator/board guards, replay
chrome, and perspective-file validation implement the design. Tests cover
compaction by count and bytes, corrupt hashes, old-schema migration, deterministic
playback, aliases, hidden-ID absence, interruption, out-of-order streams, seek,
cancellation, and return to the latest live view.

Compaction can mark early replay unavailable; retention/export promises require
their own approved policy. The accepted architecture does not claim that
canonical server-held continuation, long-term archival storage, or full hidden
state export is complete.

## Migration and rollback

Each persisted-ledger and replay-file version has an explicit migration or
closed rejection path with retained fixtures. Rollback requires a build that can
read the room ledger and must not regenerate facts from raw commands. Replay UI
can be gated off independently without deleting canonical recovery history.
