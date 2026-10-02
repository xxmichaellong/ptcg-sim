# ADR-009: project canonical state independently for every recipient

- Status: **ACCEPTED**
- Decision date: 2026-09-14
- Last reviewed: 2026-09-14
- Scope: hidden information, identities, and role authorization

## Context

Drawing a hidden card face-down does not protect information if its identity,
definition, image URL, stable identifier, error detail, replay fact, or asset
request has already reached an unauthorized browser. A shared room payload cannot
represent two players' private hands and decks safely.

## Decision

Canonical state and canonical card/definition/work-area identities remain inside
the authority boundary. For every player, spectator, and authorized coaching
view, construct a separate `MatchViewState` containing only currently permitted
information and recipient-scoped opaque handles.

Concealment removes private definitions and rotates handles according to the
visibility policy. Authority resolves every submitted view handle against the
authenticated session's current registry; clients never nominate canonical
identities. Errors, presentation events, replays, telemetry, accessibility, and
image URLs follow the same recipient boundary.

Self-private inspection remains available. Cross-player private inspection
requires the current mutual consent defined by ADR-017. Public/known opponent
cards may be manipulated only through the explicit public-opponent interaction
policy. A player may still move a card they control into another player's zone;
destination ownership does not transfer control.

## Alternatives considered

- Shared canonical or shared redacted state risks direct and side-channel leaks.
- Client-side hiding trusts an unauthorized recipient with the secret.
- Globally stable pseudonyms permit correlation across conceal/reveal cycles.

## Evidence and consequences

`packages/game-core/src/project-state.ts`, the room-authority identity registry,
`resolve-command.ts`, projected replay, and recipient-specific publication paths
implement the boundary. Recursive serialization, non-interference, hidden-ID,
private-inspection, spectator, image-request, replay, and browser tests treat
projection as a security property.

Independent projection costs CPU and bytes but makes disclosure auditable. Any
confirmed leak blocks rollout. Changing private-look or opponent-control product
semantics requires an ADR and updated role/visibility fixtures.

## Migration and rollback

Projection registries migrate only inside authority and never become persisted
client identity. Schema changes regenerate recipient aliases and re-run leak
fixtures. A projection regression pauses rollout and returns new sessions to v1;
it never authorizes sending canonical state as a compatibility fallback.
