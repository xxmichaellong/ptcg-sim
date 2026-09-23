# ADR-022: require a measured v1 fallback and retirement window

- Status: **ACCEPTED**
- Decision date: 2026-09-14
- Scope: v2 cohort cutover, v1 fallback availability, and retirement eligibility

## Context

V2 is intentionally deployed beside v1 and assigns an engine for an entire
room. Rollback changes only future room creation; an active room is never
live-converted or downgraded. ADR-021 also defers v1 saved-game and old
share-link import from the first v2 release, so removing v1 immediately at
cutover would strand the only runtime capable of opening those artifacts.

A vague promise to retain v1 "for a while" cannot drive monitoring, rollback,
or deletion decisions. The project needs a minimum observation period long
enough to see more than one v2 release under full traffic, while still requiring
a separate human decision before any irreversible retirement.

## Decision

V1 remains available as an explicit fallback until both of these minimums have
been satisfied after full v2 cutover:

1. 30 consecutive calendar days have elapsed; and
2. two stable v2 production release cycles have completed.

Full cutover begins only when v2 is the default and receives 100% of new-room
cohort allocation. A stable release cycle is a distinct production v2 release
that completes its planned observation at full new-room traffic without a
rollback, a release-blocking pause, an unresolved severity-1/2 incident, or a
confirmed data/privacy failure.

The 30-day clock and qualifying-release count restart when allocation falls
below full traffic because of a rollback or release-blocking pause, or when a
severity-1/2 data/privacy incident invalidates the observation. Routine
maintenance that does not reduce the cohort or invalidate release evidence does
not restart them.

Satisfying the window makes v1 eligible for retirement; it does not retire v1
automatically. The product owner must still explicitly approve retirement. The
first retirement operation disables new v1 room creation while leaving existing
v1 rooms available to finish or reach their documented normal expiry. Runtime,
data, and deployment removal occur only after that drain and in separately
reviewed changes. Deleting stored data is a separate destructive decision.

## Consequences

- V2 can become the default without removing the immediate rollback path.
- Users retain temporary access to v1-only saved matches during the fallback
  window even though v2 does not import them.
- A release cannot qualify merely by remaining deployed while traffic has been
  rolled back or a serious incident is unresolved.
- Keeping v1 available has an operational and security-maintenance cost for at
  least the observation window.
- The window may be extended without weakening safety. Shortening either
  minimum requires a replacement ADR and explicit product approval.

## Required evidence

- Record the UTC full-cutover timestamp, qualifying v2 release identifiers, and
  any reset event.
- Keep a synthetic v1 health check and v2-to-v1 cohort rollback rehearsal green
  throughout the window.
- Demonstrate sticky engine assignment and prove no active room is migrated
  between protocols.
- Attach 30-day telemetry and incident summaries plus the two release sign-offs
  to the Phase 10 retirement review.
- Archive a tagged v1 build, immutable fixtures, and the quarantined converter
  before removing runtime dependencies.

Rollback during the observation window routes new rooms back to v1 according to
the cohort controls and restarts retirement eligibility. After v1 runtime or
data removal, recovery may require restoring an archived deployment or backup;
those destructive steps therefore remain outside this ADR's authorization.
