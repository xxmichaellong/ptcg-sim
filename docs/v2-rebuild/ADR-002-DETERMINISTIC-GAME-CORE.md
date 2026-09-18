# ADR-002: use a deterministic framework-independent game core

- Status: **ACCEPTED**
- Decision date: 2026-09-14
- Last reviewed: 2026-09-14
- Scope: canonical domain state and transitions

## Context

V1 spreads game state across arrays, DOM hierarchy, image-node properties, and
positional action logs. That coupling makes local changes nondeterministic and
prevents reliable replay, authority, and isolated tests.

## Decision

Use strict TypeScript for a framework-independent `@ptcgsim/game-core` package.
Canonical state uses stable branded identities independent of array position.
Commands are immutable intent; decision produces resolved domain-event batches;
event application is pure and deterministic. Clock, randomness, identifiers,
hashing, persistence, network, browser, React, and renderer concerns enter only
through explicit outer adapters.

Every accepted transition validates its predecessor and result invariants. A
resolved batch records random outcomes so replay never reruns randomness.

## Alternatives considered

- DOM or renderer objects as state repeats the root v1 failure and is rejected.
- A React store as canonical state makes the server and replay depend on UI
  lifecycle and is rejected.
- Persisting raw commands and rerunning a future reducer changes historical
  outcomes and is rejected as authoritative replay.

## Evidence and consequences

`packages/game-core/README.md`, `src/model.ts`, `src/execute-command.ts`, and
`src/decide-command.ts` implement and document the boundary. Unit, generated
model, event replay, invariant, and randomized-outcome tests run without a DOM or
network. Workspace boundary, cycle, public-API, and strict type checks prevent
dependency erosion.

All clients and renderers must consume projections rather than mutate canonical
state. Schema or event changes require explicit versions, migrations, fixtures,
and replay verification. Replacing the UI, room runtime, or renderer does not
require replacing the core contract.

## Migration and rollback

Persisted state and events move only through explicit pure schema migrations;
legacy positional input stays in the quarantined converter. A deployment may
roll back only to a build that understands the room's stored schema. An active
v2 room is never converted back into mutable DOM/action-array state.
