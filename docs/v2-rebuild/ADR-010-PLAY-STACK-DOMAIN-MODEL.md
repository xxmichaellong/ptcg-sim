# ADR-010: model play as stacks, zones, and work areas

- Status: **ACCEPTED**
- Decision date: 2026-09-14
- Last reviewed: 2026-09-14
- Scope: canonical tabletop representation

## Context

Active and benched Pokémon are not just flat card lists. Evolution order,
attachments, markers, rotation, counters, BREAK presentation, and departure
behavior apply to a semantic play object. Decks, hands, prizes, discard, Lost
Zone, loose board cards, stadium, inspections, and attachment resolution have
different ordering and visibility rules.

## Decision

Represent each active or bench slot as an explicit stable `PlayStack` aggregate.
The stack owns ordered evolution cards, typed ordered attachments, markers,
rotation, damage, special conditions, and placement metadata. Card ownership is
immutable and distinct from current board placement.

Represent ordinary containers as explicit ordered zones and transient multi-step
operations as canonical work areas with stable identity and source preconditions.
Commands express semantic movements between these structures; renderer layout
and DOM hierarchy are derived projections only.

## Alternatives considered

- Flat cards plus a generic relationship graph makes stack invariants and atomic
  departure implicit and recreates relative-pointer errors.
- A universal zone abstraction obscures play-level state and work-in-progress
  operations.
- DOM/Pixi parent-child relations as state repeat the v1 coupling failure.

## Evidence and consequences

`packages/game-core/src/model.ts` defines normalized players, zones, play stacks,
stadium, loose cards, definitions, and work areas. Command/event handlers,
invariants, projections, legacy-conversion fixtures, generated transitions, and
renderer scenes cover stack placement, evolution, attachment, reordering,
departure, restoration, and cross-owner cards.

Some operations require more explicit commands than a generic graph, but their
atomicity and visibility become testable. New tabletop structures must first be
representable in the domain and projection; renderers cannot invent logical
relationships.

## Migration and rollback

Legacy positions convert transactionally into stable zones, stacks, and work
areas; persisted revisions use explicit match-state migrations. Rollback is only
to a compatible v2 schema or to v1 for newly created rooms. Renderer hierarchy
is never used to reconstruct canonical state.
