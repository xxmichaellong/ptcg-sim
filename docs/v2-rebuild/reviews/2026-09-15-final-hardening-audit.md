# Final hardening audit

- Blueprint revision/commit: `9aa1a56`
- Review lanes: authority/security, renderer/layout, browser/release operations
- Reviewer: primary integrator with parallel specialist reports
- Date: 2026-09-15
- Overall verdict: **implementation-ready; release-blocked on external evidence and named decisions**

## Scope

This pass reviewed the complete v2 production graph and its retained v1
characterization boundary. It covered authority/session resource ownership,
durable-state validation, socket and replay ingress, DOM renderer failure and
paint/hit behavior, overlays and focus, custom images/backgrounds, public API
containment, production artifacts, dependency auditing, browser gates, and the
draft PR handoff.

The review did not authorize a production deployment, alter the default v1
route, redesign visible UI/UX, or treat local/hosted simulation as managed-cloud
or physical-device release evidence.

## Closed findings

| Finding                                        | Severity | Disposition and evidence                                                                                                                                  |
| ---------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unbounded retained spectator sessions          | High     | Capped at 32 with invariant, room-full rejection, lifecycle tests, and documentation (`9c63c05`).                                                         |
| Post-mount renderer faults left stale UI       | High     | Runtime and React faults now cancel, dispose, blank the host, suppress overlays/chrome, and publish failed state (`15b5ca0`).                             |
| Foreign inspection drops could form commands   | Medium   | Drop resolution now verifies that the inspection work area belongs to the viewer (`e977ae2`).                                                             |
| Persisted match shape was under-validated      | Medium   | Load invariants now reject extra/misaligned players, zones, stacks, work areas, faces, owners, kinds, and images (`4758969`).                             |
| Socket/replay ingress lacked hard ceilings     | Medium   | Per-connection pending/window limits and a durable room replay budget reject overload before more work (`4210072`).                                       |
| Nested board dialogs leaked focus/semantics    | Medium   | Preview traps Tab; covered zone browser becomes inert, hidden, and non-modal (`b4b26b8`).                                                                 |
| Arbitrary overlay image failure collapsed UI   | Medium   | Preview, stack, and zone images retain 5:7 geometry, hide failed pixels, and recover on URL replacement (`017cb82`).                                      |
| Renderer obscured route-owned backgrounds      | Medium   | Board paint remains transparent in dark mode; lifecycle status is visually hidden but testable (`3c9a1ee`).                                               |
| Equal-z hit order disagreed with paint order   | Medium   | Shared hit/drop ordering now selects the later-painted equal-z node in DOM and Pixi (`7ef97cc`).                                                          |
| Security gates failed open or missed artifacts | Medium   | Registry outages now fail dependency audit; artifact scans reject environment secrets and credential formats with redacted errors (`f015e45`, `39eb5df`). |
| Hardening helpers leaked into public API       | Low      | Paint-order and ingress-limit helpers remain internal; the locked 606-symbol surface passes (`9aa1a56`).                                                  |

## Current verification

At `9aa1a56`, the local non-browser gate passed:

- 79 frozen-v1 tests;
- 2,397 v2 tests across 238 files;
- 30 Worker-runtime tests across the default, enabled-continuation, and drain configurations;
- formatting, lint, strict TypeScript, browser-harness typechecking, source
  boundaries, 606-symbol public API lock, cycle detection, and tooling tests;
- production Vite and Wrangler dry-run builds, 23 web source maps, one Worker
  source map, asset/fixture provenance, and tracked-file cleanliness; and
- a fake `CONTINUATION_KEYRING` present during the build but absent from every
  emitted artifact and source map.

Local Playwright cannot launch in this workspace because Chromium cannot load
`libglib-2.0.so.0`. That environment failure is not recorded as browser proof or
as an ignored application failure. Current-head Chromium, Firefox, and WebKit
evidence must come from the hosted draft-PR jobs.

## Deliberately open findings

### FHA-001 — unauthenticated socket-upgrade budget remains shared

- Severity: **Medium**
- Evidence: a browser WebSocket upgrade carries no admission bearer. The room
  therefore cannot reserve an abuse bucket for a legitimate principal before
  accepting the socket and receiving `Hello`.
- Risk: sustained invalid upgrades can consume the room-wide fixed-window
  budget and delay a legitimate join.
- Constraint: putting the bearer in a URL is forbidden; simply removing the
  shared limit enables unbounded pre-admission sockets. Per-credential limiting
  after `Hello` does not repair an already rejected upgrade.
- Required decision: choose and review an edge identity/rate limit, a
  credential-derived WebSocket subprotocol/header design, or explicit
  acceptance of the bounded availability risk. Do not disguise this as a
  limiter reorder.

### FHA-002 — MagicCircle legal provenance is not inferable from source

- Severity: **Medium**
- Evidence: the local MagicCircle checkout has no top-level license/notice
  file. Project authorization is recorded in ADR-019, and adapted server
  patterns cite source commit `39f871cd63800e2317326425345a26e4d61846de`,
  but repository evidence cannot establish every contributor's ownership or
  notice obligations.
- Required decision: the rights holder/legal owner must confirm applicable
  terms for directly copied units. Behavior-level reimplementation may proceed
  under PTCG-owned contracts, but direct-copy release remains blocked without
  that confirmation.

### FHA-003 — release evidence is external and incomplete

- Severity: **High for release; not an implementation defect**
- Required evidence: current-head hosted browsers, managed Cloudflare preview,
  WebSocket/persistence/hibernation/rollback rehearsal, physical ADR-015 runs,
  24-hour soak, manual ADR-024 record, production topology/capacity/alerts, and
  named rollout/rollback/security/cost owners.

## PR and deployment disposition

Draft PR 39 remains the only integration target. Its description was reduced
from approximately 62,000 chronological characters to a current architecture,
verification, deployment-boundary, and blocker summary; the detailed history
remains in canonical repository documents.

The checked-in Wrangler topology remains local/default-off with
`BUILD_ID: local-development`. Managed-preview tooling requires an isolated
name, explicit commit-bound build ID, non-overlapping namespaces, private
credentials, and phased activation. No production route, domain, cohort,
capacity, or credential was created by this audit.

## Recommendation

After current-head hosted CI is green, stop implementation churn and conduct a
review/decision checkpoint. The next work is evidence and ownership, not another
renderer or rules rewrite: resolve FHA-001 and FHA-002, assign release roles,
then execute the managed-preview, physical-performance, accessibility, and soak
records. Keep the PR draft until those gates are deliberately dispositioned.
