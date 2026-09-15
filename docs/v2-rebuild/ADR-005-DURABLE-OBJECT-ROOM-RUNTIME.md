# ADR-005: use one SQLite Durable Object per v2 room

- Status: **ACCEPTED**
- Decision date: 2026-09-14
- Last reviewed: 2026-09-14
- Scope: first-release authoritative room runtime
- Release status: selected architecture; managed-preview and operational gates
  remain open

## Context

Each room needs one logical writer, durable atomic transactions, reconnectable
WebSockets, alarms, bounded cleanup, and recovery after runtime eviction. The
domain and authority packages must remain portable even though a concrete
first-release deployment is required.

The Worker/SQLite Durable Object spike now covers room creation, hibernating
WebSockets, transactional authority storage, schema migration, admission,
disconnect expiry, alarms, telemetry, and one-origin static application routing.

## Decision

Deploy the first v2 authority as a Cloudflare Worker with one SQLite-backed
Durable Object instance per room. The object serializes operations through the
transport-neutral room authority and commits through its persistence adapter.
WebSocket hibernation attachments contain only bounded reconnect metadata.

Keep game core, protocol, room authority, and client session independent of the
Cloudflare runtime. Colyseus remains a documented replacement option if managed
preview demonstrates an unacceptable reliability, cost, tooling, or rollback
constraint; it is not a second implementation maintained in parallel.

## Alternatives considered

- Colyseus offers a portable Node room model but would still need the same
  recipient projection, durability, admission, and idempotency contracts.
- A rebuilt Socket.IO relay does not by itself supply single-writer authority or
  durable recovery.
- Peer replication retains the v1 divergence and privacy failures.

## Evidence and consequences

`apps/server/wrangler.jsonc`, the `PtcgRoom` runtime, durable storage adapter,
room lifecycle tests, runtime WebSocket suites, migrations, local `workerd`
performance harness, and operations contract prove the implementation boundary.

This decision does not waive ADR-015 managed-network evidence, preview load and
eviction testing, alarm/rollback rehearsal, observability ownership, cost
validation, or soak gates. Those can block production rollout without reopening
the architecture. A runtime change must preserve the authority/persistence
contracts and migrate only at a whole-room boundary.

## Migration and rollback

Durable snapshot versions migrate explicitly inside the storage adapter before
room use. Deployments retain the last compatible Worker during rollout. Rollback
stops assigning new v2 rooms and keeps existing v2 rooms on a compatible runtime;
moving an active room to Colyseus or v1 is not a rollback mechanism.
