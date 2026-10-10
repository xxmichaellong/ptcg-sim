# ADR-018: authorize rooms with capabilities and one-use tickets

- Status: **ACCEPTED**
- Decision date: 2026-09-14
- Last reviewed: 2026-09-14
- Scope: room creation, invitation, admission, resume, and seat lifecycle
- Release status: architecture and local implementation accepted; ADR-025 edge
  abuse control plus preview load, alarm, and operational evidence remain open

## Context

A memorable room code and display name are locators and presentation, not proof
of authority. Credentials in WebSocket URLs, DOM, storage, logs, or normal React
state are likely to leak. Admission also has to survive an ambiguous lost reply,
runtime eviction, disconnect grace, and one-seat Solo rooms.

## Decision

Preserve the familiar room-code UX while authorizing through distinct,
high-entropy bearer capabilities:

- room creation returns role-specific master custody through a bounded no-store
  same-origin exchange;
- creator custody mints bounded expiring one-use player or spectator invitations;
- an invitation or master capability exchanges for a 30-second one-use socket
  ticket and a distinct server-minted resume bearer bound to that ticket;
- the WebSocket URL is credential-free;
- initial `Hello` presents the exact ticket/resume pair and later reconnect uses
  only resume authority; and
- durable state stores credential digests, role/name binding, seat claims,
  sequence/idempotency state, and expiry—not raw bearers.

Ticket redemption, seat claim, session creation, and recovery are atomic and
retry-safe. Explicit leave revokes the session and releases its seat. Unclean
loss retains it for the 30-second reconnect grace, then alarm-driven expiry
releases authorization without deleting seat-owned game state. Persisted Solo
mode admits one human player seat. ADR-020 governs anonymous clipboard handoff.

## Alternatives considered

- Room-code-only authorization is guessable and cannot distinguish roles.
- Credentials in URLs or browser persistence expand disclosure and replay risk.
- Reusable socket tickets multiply authority after interception.
- Accounts are outside this rebuild's product scope.

## Evidence and consequences

`packages/room-authority/src/admission.ts`, protocol schemas, client session and
bootstrap custody, Durable Object HTTP/WebSocket handlers, schema-v7 migrations,
rate limits, alarms, and telemetry implement the boundary. Unit, fault, runtime,
credential-leak, browser, multi-context invitation, reconnect, expiry, and
hibernation tests cover it.

Bearer custody remains security-sensitive even when non-serializing. Production
rollout still requires managed-preview abuse/load/alarm evidence, operational
ownership, ADR-025's per-source edge throttle, and rollback rehearsal. These
gates can block exposure without reopening the capability architecture.

## Migration and rollback

Authority schema migrations validate digest registries, sessions, seats, mode,
and expiry before activation and fail closed on contradiction. Rollback keeps
existing rooms on a schema-compatible deployment and can stop new admission.
Room-code-only or raw-credential URL admission is never a fallback.
