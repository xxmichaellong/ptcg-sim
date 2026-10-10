# ADR-008: migrate only at a whole-session boundary

- Status: **ACCEPTED**
- Decision date: 2026-08-31
- Last reviewed: 2026-09-14
- Scope: v1/v2 coexistence, rollout, and rollback

## Context

V1 identifies cards by mutable position and synchronizes positional JavaScript
actions. V2 uses stable identities, typed commands, server authority, and
recipient projections. Translating either representation continuously inside an
active match would create two authorities and ambiguous hidden-state history.

## Decision

Keep v1 and v2 as separate application builds/routes, protocol generations,
room namespaces, persisted schemas, and rollout cohorts. A room chooses one
generation at creation and stays on it for its lifetime. Existing v1 rooms
finish on v1; v2 clients cannot join them and v1 clients cannot join v2 rooms.

Compatibility is one-way, bounded, transactional data conversion at an explicit
pre-session boundary. ADR-021 excludes v1 saved-match/action-history and old
share links from the first production v2 bridge. Supported deck data and v2
perspective replay remain independent formats.

Rollback routes only newly created sessions back to v1. It never live-downgrades
an active canonical v2 room or converts it into a v1 action stream.

## Alternatives considered

- Per-action or per-module migration creates split authority and is rejected.
- A big-bang replacement removes safe comparison and rollback.
- Loading live v1 modules inside v2 reintroduces the dependency graph and
  positional state model.

## Evidence and consequences

Protocol/build/schema constants, package boundaries, bundle provenance, separate
routes, Durable Object room creation, admission rejection, and isolated legacy
conversion enforce the boundary. CI rejects v1 runtime imports in production v2
artifacts. Rollout and browser tests keep the default route unchanged.

Operating two generations is temporary overhead governed by ADR-022's minimum
fallback window and explicit retirement approval. A migration change requires
cohort, persistence, privacy, rollback, and compatibility review.

## Migration and rollback

Only bounded supported artifacts cross from v1 to v2, and conversion succeeds
atomically before a v2 session begins. Cohort rollback changes creation routing
while existing rooms stay sticky to their generation. Retirement and stored-data
deletion remain separately authorized under ADR-022.
