# ADR-001: preserve the manual-tabletop product boundary

- Status: **ACCEPTED**
- Decision date: 2026-09-14
- Last reviewed: 2026-09-14
- Scope: domain validation and product semantics

## Context

PTCG Sim is a permissive tabletop for playing and testing the Pokémon Trading
Card Game. V1 lets players perform intentional shortcuts and unusual board
manipulations. Rebuilding the internals must not silently turn the product into
a card-rules judge or require a complete card-effects database.

The server still has to prevent malformed state, unauthorized control, hidden
information disclosure, stale commands, and impossible structural references.
Those integrity rules are different from Pokémon legality rules.

## Decision

Keep v2 a manual tabletop. The game core and room authority enforce structural
invariants, authenticated role and card control, visibility, ordering,
idempotency, and resolved randomness. They do not determine whether a deck,
attack, retreat, evolution, attachment, turn sequence, or testing shortcut is
legal under Pokémon rules.

Composite conveniences may remain atomic, but their availability follows the
parity contract rather than a card-effects engine. Public opponent-card
interaction and mutually consented private coaching remain explicit authority
policies, not inferred game legality.

## Alternatives considered

- A complete Pokémon rules engine was rejected as a product change and an
  unbounded maintenance dependency.
- A permissive client with only relay validation was rejected because it leaves
  integrity, privacy, reconnect, and divergence failures unresolved.

## Evidence and consequences

`packages/game-core/src/decide-command.ts` validates command structure and state
preconditions without card-text rules. `packages/room-authority/src/resolve-command.ts`
adds authenticated control and visibility policy. Domain, authority, generated,
and browser tests exercise manual movements through those boundaries.

This keeps the existing UI and player freedom while making state transitions
deterministic. Any future automation of Pokémon legality is a separate product
proposal and ADR. Rollback is removal of the affected automation, not weakening
integrity or privacy validation.

## Migration and rollback

Migration replaces positional v1 behavior only at the whole-session boundary in
ADR-008; no live room mixes validation models. Roll back by routing new rooms to
v1 or removing an unapproved rules restriction from v2. Never roll back by
removing structural, authorization, or visibility checks.
