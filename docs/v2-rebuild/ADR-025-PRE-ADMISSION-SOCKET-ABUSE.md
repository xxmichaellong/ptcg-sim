# ADR-025: layer edge throttling over room socket admission

- Status: **ACCEPTED**
- Decision date: 2026-09-16
- Last reviewed: 2026-09-16
- Scope: unauthenticated WebSocket upgrades, availability abuse, and public
  rollout
- Release status: local/PR preview behavior accepted; public exposure requires
  managed-edge configuration and evidence

## Context

A browser WebSocket upgrade cannot attach the room admission bearer as a custom
authorization header. The server therefore accepts a credential-free upgrade
before the first validated `Hello`. The implemented durable room budget limits
socket upgrades to 120 per minute, and an unadmitted socket has a 30-second
deadline plus bounded frame and pending-message budgets.

That room-level ceiling bounds work, but it is shared. A sustained invalid
source can spend the room's budget and temporarily delay a legitimate join.
Removing the limit would make pre-admission work unbounded. Moving a bearer into
the URL, query, or WebSocket subprotocol would increase disclosure through
browser, proxy, platform, diagnostic, and support surfaces.

## Decision

Keep the durable shared room-level upgrade budget as a defense-in-depth bound
for local development, draft-PR validation, and public operation. Before any
public cohort is enabled, configure Cloudflare's edge to rate-limit WebSocket
upgrade attempts by an edge-observed source identity before the request reaches
the room Durable Object.

The edge policy must:

- apply only to the v2 room WebSocket upgrade route;
- use edge-held source information without forwarding, persisting, hashing, or
  logging that source identity in application state or telemetry;
- allow the characterized legitimate initial-connect and reconnect burst while
  preventing one source from consuming the entire 120-per-minute room budget;
- return a bounded retry response before Durable Object routing when limited;
- retain the room budget, unauthenticated deadline, and per-connection ingress
  limits as independent inner layers; and
- be versioned as environment-owned release configuration with a named operator,
  rollback procedure, and redacted evidence.

Admission credentials remain forbidden in URLs, query strings, browser
persistence, logs, analytics, and WebSocket subprotocol values. `Hello` remains
the first credential-bearing application message. Per-ticket and per-session
limits after `Hello` complement but cannot replace the pre-admission edge layer.

The exact edge threshold is an operational capacity value, not a source-code
default. Managed-preview evidence must select it below the level at which one
source can exhaust a room's shared budget, while showing that valid initial
joins, immediate reconnect, and recovery-stress reconnects remain successful.
Failure to install or verify the edge policy blocks a public cohort; it does not
block local or isolated draft-PR testing.

## Alternatives considered

- Accepting the shared room budget as the only public defense leaves a simple
  single-source availability denial.
- Removing the room budget turns edge misses or distributed traffic into
  unbounded Durable Object work.
- Putting a bearer in the URL or WebSocket subprotocol improves early identity
  at the cost of a larger and less controllable credential disclosure surface.
- Limiting only after `Hello` cannot protect upgrades rejected before a valid
  credential is presented.
- Adding accounts changes the anonymous product model and is not justified by
  this availability control.

## Evidence and consequences

The managed-preview record must include the redacted edge rule identifier and
version, selected threshold and rationale, route match, timestamps, exact build
commit, valid join/reconnect results, sustained invalid-upgrade results, room
telemetry showing the outer layer acted before room-budget exhaustion, and a
disable/rollback rehearsal. The evidence must not contain source identifiers,
room credentials, invitation envelopes, tickets, or resume bearers.

Shared networks can cause false positives, and distributed sources can still
reach the inner room limit. Dashboarding must distinguish edge rejections from
room-limit events without creating an application identity from network data.
An incident may tighten or disable new v2 cohort allocation, but must not move
credentials into the handshake or silently remove the durable inner bound.

## Migration and rollback

No protocol or persisted-room migration is required. Preview first installs the
edge policy disabled or on an isolated hostname, records baseline reconnect
traffic, selects and verifies the threshold, then enables it before public
cohort routing. Rollback pauses new v2 allocation and reverts the edge policy to
its last verified version; the durable room and connection limits remain active.

Revisit only if browser APIs gain a reviewed confidential upgrade credential,
the product adopts authenticated account identity, or managed evidence proves
the layered design cannot meet both availability and legitimate reconnect
requirements.
