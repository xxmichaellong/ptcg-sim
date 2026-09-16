# ADR-019: permit bounded MagicCircle implementation reuse

- Status: **ACCEPTED**
- Decision date: 2026-08-31
- Last reviewed: 2026-09-16
- Scope: direct source reuse, adaptation, provenance, and coupling

## Context

MagicCircle contains relevant React/Pixi lifecycle, pointer/resize, command
session, message-boundary, and Durable Object experience. It also contains a
continuous game engine, shared state broadcasting, account infrastructure, and
application-specific managers that do not fit PTCG Sim's manual hidden-information
tabletop.

The project owner explicitly authorized direct reuse. On 2026-09-16, the owner
also confirmed that the project has the necessary authority for that reuse and
directed that no additional MagicCircle project-source permission blocker be
retained. That confirmation does not waive licenses or notices attached to
third-party dependencies, nor the repository's security and provenance rules.

## Decision

Directly copy or adapt the smallest MagicCircle implementation unit when it
satisfies a PTCG-owned contract and its reuse is more maintainable than a local
rewrite. Record the source commit and file. Preserve licenses/notices carried by
third-party dependencies, and audit those dependencies at extraction time. The
owner confirmation above closes the project-source permission gate.

PTCG Sim owns the resulting public contract and tests. Do not import or subclass
MagicCircle terminal application code, maintain a broad source fork, or copy its
shared JSON Patch broadcast, write-behind durability, continuous loop, ECS,
prediction, room manager, account, commerce, analytics, or release infrastructure
without a separate requirement and review.

## Alternatives considered

- Clean-room reimplementation only discards permission and useful tested detail.
- Wholesale reuse imports incompatible privacy, durability, product, and
  dependency assumptions.
- A shared package is premature until the same independently testable contract
  has three real consumers and independent versioning is justified.

## Evidence and consequences

`MAGICCIRCLE_REUSE.md` records the candidate-by-candidate adaptation matrix and
safe extraction procedure. Renderer/session/authority contracts, boundary checks,
and PTCG tests remain the acceptance evidence regardless of source origin.

Every copied unit increases provenance and upstream-divergence obligations. A
unit can be replaced locally without changing domain/protocol behavior. If a
candidate brings a dependency whose applicable terms cannot be established, do
not import that dependency; reimplement the documented behavior behind the same
contract.

## Migration and rollback

Copied helpers enter through ordinary reviewed package changes with provenance
and compatibility tests; no runtime migration depends on the MagicCircle source
tree. Rollback replaces or removes the helper behind the PTCG-owned contract and
preserves any license/notice obligations for distributed revisions that used it.
