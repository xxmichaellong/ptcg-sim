# ADR-007: persist authority outcomes before publication

- Status: **ACCEPTED**
- Decision date: 2026-09-14
- Last reviewed: 2026-09-14
- Scope: authoritative command durability and idempotency

## Context

A player must never receive success for a move that disappears after a crash.
Async room execution also must not let later commands observe an uncommitted
candidate or consume a sequence inconsistently.

## Decision

For every admitted command, resolve against the exact authoritative predecessor,
construct recipient publications, and atomically commit the new authority
snapshot, resolved event batch when present, sequence/idempotency outcome,
replay/undo state, and storage frontier before returning deliveries or success.

Rejected admitted commands persist the consumed sequence and safe outcome when
required for deterministic retry. A persistence failure installs nothing and
acknowledges nothing. If storage committed but the response path failed, retry
returns the persisted outcome and current covering publication without applying
the command twice.

## Alternatives considered

- Publish-then-write and write-behind permit acknowledged loss and are rejected.
- Client acknowledgements or command logs cannot substitute for authoritative
  atomic persistence.
- Weakening durability for latency is allowed only through a new ADR with an
  explicit loss window after measurements prove the need.

## Evidence and consequences

`packages/room-authority/src/process-command.ts` builds deliveries before but
returns them only after `persistence.commit`. Its transaction and coordinator
tests prove commit ordering, failure-before-commit behavior, response-loss retry,
dedupe, sequence gaps, rejection persistence, and ordered delivery. The Durable
Object adapter stores snapshot, journal, frontier, retention, and lifecycle
changes in one SQLite storage transaction.

Storage latency is part of user-visible command latency and stays instrumented.
Rollback must use the last schema-compatible deployment and may redirect only
new rooms; an active canonical room is never downgraded to a client action log.

## Migration and rollback

Every authority-schema migration must retain committed outcomes, revision,
sequence frontiers, and replay facts or fail before room activation. Rollback
uses a schema-compatible writer and sticky rooms. Write-behind or publish-first
behavior is not an emergency fallback.
