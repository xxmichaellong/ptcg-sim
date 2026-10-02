# ADR-014: preserve bounded authoritative solo undo

- Status: **ACCEPTED**
- Decision date: 2026-09-14
- Last reviewed: 2026-09-14
- Scope: undo semantics, history, and hidden identity

## Context

V1 exposes undo only in one-player play and maintains independent client action
arrays. Replaying one side's JavaScript effects over later shared changes is not
safe in a single authoritative ordered match. Random results must not be rerun,
and a discarded hidden branch must not remain correlatable.

## Decision

Preserve undo only for a durably declared Solo room. Order checkpoints by the
whole room's accepted command order. Store one hashed base plus an active-branch
tail of at most 128 resolved event batches by default, compacting the oldest
entries into the base.

An undo request identifies no uploaded state. Authority reconstructs the prior
checkpoint, verifies it, and persists one `UndoApplied` event containing the
exact restored canonical result at a new monotonically increasing revision.
Randomness is not rerun. Every projection alias rotates before publication.
Undo itself and rejected commands create no checkpoint; state-replacing
operations reset history where specified. Audit history remains append-only.

## Alternatives considered

- Independent per-seat undo is ambiguous once operations interleave and is
  rejected as a reliability defect, not preserved bug compatibility.
- Rerunning commands/randomness can produce a different match.
- Unbounded snapshots or event tails create storage and recovery risk.
- Multiplayer undo is a separate future product decision.

## Evidence and consequences

Game-core solo-undo commands, room-authority undo history, schema migrations,
process-command integration, replay projection, and client/runtime controls are
implemented. Tests cover exact randomized restoration, tamper rejection, new
revision creation, compaction, alias rotation, reconnect/replay, and multiplayer
rejection.

The 128-entry default is an operational bound, not a promise that every match
action remains undoable forever. Changing it requires storage/performance
evidence and compatible migration. This intentionally fixes v1's ambiguous
interleaved-history behavior without changing the visible Solo control.

## Migration and rollback

Authority migrations initialize or preserve only schema-compatible Solo history;
incompatible old tails are safely cleared while the current canonical state is
retained. A compatible rollback keeps the stored base/tail contract. The control
can be disabled for new commands, but committed undo revisions are never erased
or reinterpreted.
