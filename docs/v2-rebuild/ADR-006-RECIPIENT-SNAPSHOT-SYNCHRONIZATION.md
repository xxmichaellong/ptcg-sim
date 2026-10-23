# ADR-006: synchronize with full recipient-specific snapshots

- Status: **ACCEPTED**
- Decision date: 2026-09-14
- Last reviewed: 2026-09-14
- Scope: live client synchronization and reconnect

## Context

V1 catches peers up by replaying growing positional action arrays. Patches would
require an independently correct baseline and recovery chain per connection.
Shared snapshots cannot safely represent different hidden-information views.

## Decision

After an accepted state-changing command, publish a complete role-specific view
snapshot independently to every active recipient. `Welcome`, reconnect, and
projection refresh also install complete snapshots. Include bounded presentation
facts for the covered revision, but keep them separate from view state.

Snapshots contain opaque recipient handles and only definitions authorized for
that recipient. Clients reject stale, divergent equal-revision, wrong-viewer,
and presentation-mismatched publications. Skipped transport frames recover at
the next valid snapshot without replaying client actions.

Do not add JSON Patch or another incremental protocol until retained release
measurements show the full-snapshot payload or latency budget failing. Any patch
design must retain periodic full recovery snapshots and recipient privacy tests.

## Alternatives considered

- Per-recipient patches reduce bytes but add baseline, ordering, resync, and
  privacy complexity before evidence requires it.
- Client event replay recreates catch-up/version coupling.
- One shared room state leaks role-private information.

## Evidence and consequences

Protocol `Welcome`, `StatePublication`, and projection-refresh schemas carry
`MatchViewState`; room-authority projection constructs each delivery separately;
`packages/client-session/src/session.ts` validates and atomically installs it.
Projection non-interference, hidden-ID, reconnect, stale-frame, fanout, payload,
and browser tests cover the contract.

Bandwidth is deliberately traded for simple recovery and auditable privacy.
Definitions are deduplicated within each view and payload/resource budgets remain
release gates under ADR-015.

## Migration and rollback

Wire-version admission prevents clients with another synchronization contract
from joining a room. A future patch protocol ships as a new compatible wire
version with full-snapshot recovery and can roll back to complete snapshots for
new connections. It cannot reuse an ambiguous patch baseline after downgrade.
