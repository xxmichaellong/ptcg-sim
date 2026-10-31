# ADR and release-readiness closeout

- Blueprint revision/commit: `11434cd89` plus this documentation closeout
- Review lane: cross-cutting architecture, parity, persistence, and operations
- Reviewer: primary integrator
- Date: 2026-09-14
- Files/requirements reviewed: decision register; ADRs; ARCH, STATE, CMD, VIS,
  PROTO, PERSIST, CLIENT, RENDER, MIG, SEC, OPS, PERF, and QA requirements
- Repo evidence inspected: game core, protocol, room authority, client session,
  React bindings, DOM/Pixi renderers, web/server applications, durable storage,
  migrations, unit/model/runtime/browser tests, and release evidence documents
- Overall verdict: **accept with changes**

## Outcome

All twelve formerly proposed or provisional architecture decisions are already
implemented deeply enough to make the choice binding. This closeout accepts
ADRs 001, 002, 003, 005, 006, 007, 009, 010, 011, 014, 016, and 018 and adds the
missing standalone records. It also backfills standalone records for already
accepted ADRs 008, 017, and 019, so every non-deferred decision now has one. It
does not promote incomplete external evidence to “passed.” Production routing
remains blocked by the release gates listed below.

## Decision disposition

| ADR     | Prior state | Disposition | Principal implementation evidence                                          | Remaining gate or revisit trigger                                                                    |
| ------- | ----------- | ----------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| ADR-001 | Proposed    | Accepted    | Structural game-core decisions plus authority permission policy            | Revisit only for a separately approved Pokémon-rules feature                                         |
| ADR-002 | Proposed    | Accepted    | Strict pure game core, stable IDs, invariants, replay and boundary checks  | Normal schema/event migration discipline                                                             |
| ADR-003 | Proposed    | Accepted    | React shell, external stores, renderer/session ownership and browser UI    | Full parity/release matrix; no shell redesign                                                        |
| ADR-005 | Provisional | Accepted    | Worker, SQLite Durable Object, hibernation, alarms and transactions        | Managed preview load/eviction/cost/alarms/rollback; Colyseus only if those expose a platform blocker |
| ADR-006 | Proposed    | Accepted    | Full per-recipient protocol snapshots and atomic client install            | Add patches only if retained release measurements fail                                               |
| ADR-007 | Proposed    | Accepted    | Atomic snapshot/event/outcome/frontier commit before returned deliveries   | Managed fault/recovery evidence remains a rollout gate                                               |
| ADR-009 | Proposed    | Accepted    | Independent projection, opaque aliases, recipient replay and leak tests    | Any hidden-data leak blocks rollout                                                                  |
| ADR-010 | Proposed    | Accepted    | Normalized zones, `PlayStack` aggregates, stadium and work areas           | New structures require domain/invariant/projection coverage                                          |
| ADR-011 | Provisional | Accepted    | Dependency-free authority, pending, presentation and replay channels       | Store library remains replaceable; channels may not collapse                                         |
| ADR-014 | Provisional | Accepted    | Solo-only exact undo, whole-match order, 128-entry tail and alias rotation | Bound changes need storage evidence; multiplayer undo remains out of scope                           |
| ADR-016 | Provisional | Accepted    | Bounded ledger, checkpoints, projected streaming and inert playback        | Archival retention/export and ADR-012 server-held continuation remain separate work                  |
| ADR-018 | Provisional | Accepted    | Digest-only capabilities, one-use tickets, retry-safe resume and expiry    | Managed preview abuse/load/alarm and operational evidence                                            |

## Findings and integrated changes

### ARC-001 — stale decision state and missing ADR artifacts

- Severity: **HIGH**
- Requirements: ARCH-001, QA-006
- Repository evidence: the decision table described twelve choices as proposed
  or provisional even though their contracts, implementations, and tests were
  already used across production v2 packages.
- Failure scenario: reviewers treat binding architecture as optional, or change
  one package without understanding migration, privacy, and rollback effects.
- Resolution: accepted all twelve decisions and created standalone ADRs with
  context, alternatives, evidence, consequences, release gates, and rollback or
  revisit boundaries.
- UI/UX impact: none; these records ratify the existing under-the-hood design.

### ARC-002 — architecture selection was conflated with release evidence

- Severity: **HIGH**
- Requirements: OPS-001, PERF-001, PERF-002, MIG-006
- Repository evidence: Durable Object, admission, and renderer wording used
  provisional status partly because physical-device and managed-preview evidence
  is necessarily external to local implementation.
- Failure scenario: either an implemented contract remains permanently
  “provisional,” or local diagnostics are incorrectly represented as production
  proof.
- Resolution: accept the architecture, explicitly retain managed preview,
  physical hardware/network, soak, cost, alarm, observability ownership, and
  rollback rehearsal as production routing gates. ADR-015 remains the evidence
  authority.

### ARC-003 — blocking product questions were already resolved elsewhere

- Severity: **MEDIUM**
- Requirements: UX-002, VIS-003, SEC-002, QA-003
- Repository evidence: ADR-017 and the authority permission resolver define
  self/private coaching and public opponent interaction, while multiple v2
  regression suites intentionally correct known v1 reliability defects.
- Failure scenario: a stale blocker contradicts accepted behavior or invites a
  future change without an exception record.
- Resolution: replace the stale questions and seed table with the canonical
  `PARITY_EXCEPTIONS.md`; add `APPROVED_FIX` to the parity taxonomy. R-015 now
  points to the accepted permission semantics.

### ARC-004 — release authority is role-defined but not person-assigned

- Severity: **MEDIUM**
- Requirements: MIG-006, OPS-001
- Repository evidence: verification and operations documents define product,
  security/privacy, parity/accessibility, operations, performance, and rollback
  sign-off responsibilities, but the repository cannot name the people who will
  hold them in a deployment organization.
- Failure scenario: all technical gates pass with nobody authorized to approve
  rollout or pause it.
- Resolution: keep named-individual assignment as an external organizational
  release gate. It does not block feature-branch engineering, but it must be
  complete before a release candidate or production cohort. Do not invent names
  in source control.

### ARC-005 — local performance prose overstated its evidence class

- Severity: **LOW**
- Requirements: PERF-001, PERF-002
- Repository evidence: `apps/server/OPERATIONS.md` correctly calls the local
  run diagnostic but also said provisional p95 objectives were met.
- Resolution: describe the local result as headroom against the accepted
  objective while explicitly withholding ADR-015 managed-preview credit.

## Remaining release gates

- Three retained physical-device renderer/resource runs and paired v1 evidence
  on ADR-015's exact recorded profile.
- Managed Cloudflare preview network/load/eviction/alarm/cost evidence, alert
  baselines, notification ownership, and rollback rehearsal.
- The complete ADR-023 browser/OS/viewport matrix and ADR-024 manual
  accessibility audit.
- Full protected-workflow parity disposition with no unexplained differences.
- Named people for product, architecture/integration, security/privacy,
  parity/accessibility, operations, performance, and rollback approval.
- Server-held continuation implementation and its encryption, retention,
  capability, deletion, quota, recovery, and abuse gates if continuation is part
  of the release cohort.

## Recommended next slice

With the architecture register closed, implement the ADR-012 server-held
continuation vertical slice behind its own disabled feature boundary: storage
contract and threat model first, then capability lifecycle, transactional fork,
migrations, authority tests, server routes, and finally unchanged UI wiring.
Do not expose it until its separate operational gates pass.
