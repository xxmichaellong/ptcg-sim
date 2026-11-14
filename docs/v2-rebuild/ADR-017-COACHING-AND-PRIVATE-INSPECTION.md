# ADR-017: require mutual consent for cross-player private inspection

- Status: **ACCEPTED**
- Decision date: 2026-09-10
- Last reviewed: 2026-09-14
- Scope: coaching, private looks, withdrawal, reconnect, and replay

## Context

PTCG Sim permits self-inspection and has coaching workflows where players may
allow an opponent to look at private cards. Treating every opponent-private
operation as ordinary tabletop control leaks secrets; removing the workflow
would break intentional parity. Orientation or client UI state cannot safely
grant authority.

## Decision

Self-private inspection remains available to the owning authenticated seat.
Cross-player private inspection requires both involved seats' current,
server-owned coaching consent. Each seat can change only its own consent.
Consent is distinct from public-opponent interaction, replay/export consent,
room admission, and physical board orientation.

Withdrawal atomically closes every active cross-player private grant involving
that seat, retains self-inspection, rotates affected visibility identity, and
publishes identity-safe close facts. It cannot erase knowledge already delivered.

An unclean disconnect retains consent and grants during the 30-second
server-owned reconnect grace. Timely resume restores the same authority; expiry
releases the session and seat authorization. Explicit leave remains immediate.
Movement, reset, or explicit close can end an inspection under normal domain
preconditions.

## Alternatives considered

- Unilateral or client-owned consent permits unauthorized disclosure.
- Treating board flip/orientation as authorization couples privacy to rendering.
- Revoking consent on every transient network loss breaks the accepted reconnect
  workflow; retaining it beyond session expiry leaves orphan authority.

## Evidence and consequences

The canonical match model, coaching commands/events, room-authority permission
resolver, recipient projection, session lifecycle, presentation facts, replay,
and schema migrations implement this policy. Tests cover self-inspection, mutual
grant, unilateral rejection, immediate withdrawal, reconnect/expiry, stale
handles, movement/reset closure, replay, and absence from unauthorized payloads.

The UI can preserve the existing coaching controls without sending secrets in a
shared snapshot. Any broader private disclosure or different consent lifetime is
a product/privacy change requiring a new ADR and non-interference tests.

## Migration and rollback

Persisted consent and inspection work areas migrate through explicit canonical
schemas; incompatible historical replay/undo tails are truncated rather than
guessed. Rollback requires a build with the same consent semantics. Disabling
the UI cannot grant access, and emergency rollback must close—not broaden—private
grants it cannot safely interpret.
