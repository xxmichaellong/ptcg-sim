# Migration and delivery plan

## Strategy

Use a strangler migration around complete sessions, not around individual
in-match modules.

- v1 and v2 are separate application routes/builds and separate room protocol
  namespaces.
- A room is created as v1 or v2 and remains that version for its whole lifetime.
- v1 clients never send positional actions to a v2 room; v2 clients never import
  live v1 runtime modules.
- Existing v1 rooms finish on v1 during rollout.
- The only bridge is transactional one-way conversion of deck/save/replay data
  into normalized v2 state.
- Rollback directs new sessions back to v1. It never tries to convert an active
  v2 room back into a live v1 action stream.

This avoids the highest-risk failure mode: two authorities or identity models
mutating the same match.

## Delivery principles

- Characterize before replacing.
- Build vertical slices through core, authority, projection, client, and renderer
  before implementing every action horizontally.
- Keep changes reviewable and package-owned; no phase-long integration branch.
- Persist each accepted multiplayer command/event transaction before publishing
  acceptance. PTCG command volume is low and a lost acknowledged move is highly
  visible; write-behind is not the default.
- Instrument from the first slice, not after feature completion.
- Re-estimate after characterization and both architecture spikes.
- A phase can stop or change technology without invalidating completed domain,
  protocol, fixture, and parity work.

## Phase 0 — Blueprint audit and decision closure

Goal: make the plan safe to implement.

Work:

- Audit every document using `AUDIT.md`.
- Resolve all `BLOCKING` questions in the decision register.
- Decide top-level workspace location and deployment constraints.
- Define browser, viewport, hardware, and supported legacy-version matrices.
- Approve privacy behavior for multiplayer saves/replays and coaching/spectators.
- Confirm ownership/license terms for any direct MagicCircle code extraction;
  otherwise permit only clean reimplementation of documented patterns.
- Identify product owner, architecture owner, security reviewer, parity owner,
  and rollback authority.
- Write ADRs for renderer spike, room runtime, state snapshot strategy, guest
  identity/capabilities, and persistence durability.

Artifacts:

- accepted blueprint revision and decision log;
- risk owners and audit disposition;
- release/non-goal statement; and
- implementation issue hierarchy with dependency links.

Exit gate:

- no unowned blocking issue;
- explicit approval to proceed to characterization only; and
- no production v2 code merged before the gate.

Rollback: documentation-only; revise or stop.

## Phase 1 — Legacy characterization and safety net

Goal: make “same UI/UX and behavior” executable.

Work:

- Inventory every visible control, context-menu item, shortcut, action dispatch,
  socket event, zone transition, message, setting, and import/export format.
- Create the parity classifications and exceptions register.
- Add deterministic card/image/font fixtures and seeded randomness hooks usable
  by tests without changing production behavior.
- Build Playwright workflows/screenshots/geometry capture against v1.
- Capture v1 network traces and state/export fixtures for complex sessions.
- Add smoke tests around the known fragile paths and security probes against the
  relay/save endpoints.
- Profile representative workflows and record reference hardware.
- Freeze v1 feature work. Only critical/security/parity-harness changes continue.

Artifacts:

```text
tests/legacy-fixtures/
tests/e2e/legacy-baselines/
tests/e2e/legacy-workflows/
docs/v2-rebuild/parity-matrix.*
docs/v2-rebuild/legacy-action-catalog.*
docs/v2-rebuild/parity-exceptions.md
```

Exit gate:

- all dispatch actions in `accept-action.js` and relayed events in
  `server/server.js` are classified;
- every key shown by the existing keybind UI has a passing characterization
  test;
- protected workflows have deterministic baselines;
- at least ten representative v1 saves/replays, including attachments,
  inspection/reveal, undo, flip, spectator, and reconnect, are captured;
- known bugs are classified rather than accidentally enshrined; and
- baseline performance and payload/memory trends are recorded.

Rollback: remove/disable test hooks only if they affect production; fixtures and
findings remain useful.

## Phase 2 — Workspace, contracts, and continuous integration

Goal: create enforced boundaries without replacing user flows.

Work:

- Add TypeScript workspace packages and project references.
- Configure formatting, linting, strict type checking, unit/contract/browser
  test lanes, cycle checks, bundle reports, and import-boundary rules.
- Establish schema version constants and branded IDs.
- Build deterministic adapters for clock, randomness, IDs, and state hashing.
- Define the renderer-neutral `BoardRenderer` and transport-neutral
  `RoomAuthority` contracts.
- Add a v2 route shell and feature flag that is inaccessible to normal traffic.
- Retain the implemented structured diagnostic schema, no-store health probe,
  and secret-redaction/failure-isolation tests as later producers are added.

Exit gate:

- CI rejects cycles, forbidden imports, schema drift, lint/type/test failure, and
  unexpected public-package exports;
- every package builds in isolation;
- web/server test bundles do not accidentally include canonical secret helpers;
- a skeleton v2 page and in-memory test room can exchange a versioned welcome;
- production `/` remains behaviorally unchanged.

Rollback: remove the hidden v2 route; package work does not affect v1.

## Phase 3 — Normalized game core and legacy converter

Goal: prove all tabletop state can exist without DOM/image properties.

Work:

- Implement state schema, constructors, serializers, stable IDs, zone ordering,
  relationship graph, work areas, markers, and invariants.
- Implement command decisions/event application in vertical families: lifecycle
  and movement; play stacks; markers/properties; inspection/visibility; randomized/bulk;
  history/table signals.
- Implement role projections and concealed-handle epochs.
- Port the pure deck-builder core and strengthen CSV/dirty/unload behavior.
- Build the isolated v1 interpreter/converter and conversion reports.
- Differentially run characterized action scenarios through v1 fixtures and v2
  reducers, comparing semantic normalized outcomes rather than DOM details.

Exit gate:

- every cataloged v1 domain action maps to a v2 command, local presentation
  intent, chat/presence message, approved exception, or explicit deferred item;
- invariant/property tests cover arbitrary valid command sequences;
- canonical serialization/hash is deterministic across Node and browser;
- projection leak/differential tests pass for every zone and role;
- 100% of supported valid legacy fixtures convert to their expected semantic
  states; invalid fixtures fail without partial state;
- no core package imports browser/network/storage/rendering code.

Rollback: none required; the package is unused by production v1.

## Phase 4 — Renderer and room-runtime decision spikes

Goal: retire the two biggest technology uncertainties before full investment.

### Renderer spike

Implement the same representative fixture behind the renderer-neutral interface
using:

1. normalized keyed React DOM/CSS; and
2. raw imperative PixiJS with React DOM overlays.

Include active/bench/hand/prizes, covers, free board, stadium, attachments,
evolution, rotation, counters, selection, drag/drop, flip, split resize, one zone
browser, image failures/custom CORS behavior, context loss for Pixi, and
accessibility test hooks.

Choose against the gates in the client and verification documents. Pixi must
materially improve consistency/performance enough to justify CORS, texture,
context-recovery, and canvas-accessibility costs. Record the decision; do not
choose based on preference alone.

### Room-runtime spike

Implement hello/welcome, guest seat capability, one command, durable commit,
per-recipient projection, publication-before-result ordering, duplicate command,
disconnect/reconnect, room hibernation/restart, and a spectator in:

- the preferred Worker + Durable Object runtime; and
- a narrowly scoped Colyseus comparison only if hosting/team constraints keep it
  viable.

Measure operational complexity, local development, persistence guarantees,
latency, cost model, observability, deployment rollback, and MagicCircle pattern
reuse.

Exit gate:

- one renderer and room runtime are accepted by ADR;
- every spike success criterion passes on reference environments;
- custom/external image policy and fallback are decided;
- no unresolved context-loss/private-texture leak issue;
- durable recovery proves no acknowledged command loss; and
- estimates and remaining phases are recalibrated.

Rollback: discard spike implementations after preserving measurements and
contracts. A failed Pixi spike may select React DOM without changing the core or
server architecture.

## Phase 5 — Complete solo/local parity

Goal: replace the internal tabletop for single-player use behind `/v2`.

Work in vertical slices:

1. Application shell and exact legacy layout/styles.
2. Deck load, card instances, setup/reset.
3. Select/preview/context/keyboard.
4. Move/drop, covers, zone viewers and sorting.
5. Active/bench, evolution, attachments, temporary work areas.
6. Counters, conditions, abilities, rotation/category/face state.
7. Shuffle/draw/bulk moves, turn/coin/attack/pass, VSTAR/GX.
8. Board flip, split resize, full screen, settings/themes.
9. Solo undo/replay and complete accessibility bridge.

Every slice includes reducer, render model, renderer/UI, event/message mapping,
tests, fixtures, instrumentation, and parity review. Do not create a separate
“testing phase” for missing slice tests.

Exit gate:

- all Solo-mode `MUST_MATCH` behaviors and visual/geometry tests pass;
- no logical mutation exists in React/Pixi/DOM code;
- repeated setup/reset and long solo soak meet resource budgets;
- forced reload/restoration of local authority loses no committed state where
  persistence is promised;
- manual parity review passes in the browser matrix.

Rollback: hide `/v2`; v1 remains default.

## Phase 6 — Authoritative multiplayer and spectator parity

Goal: replace peer replication with safe room authority.

Work:

- Extend the implemented room/session/seat capability lifecycle and version
  negotiation. The current boundary already provides digest-only 30-second
  socket tickets, atomic one-time redemption, resume rotation, same-origin
  no-store HTTP exchange, a strict durable room-creation exchange, immediate
  creator bootstrap, non-serializing master-credential custody, and bounded
  digest-only 15-minute guest invitations. Invitation-to-ticket retries rotate
  the prior ticket; final socket admission atomically consumes both records.
  Resolve ADR-020 before presenting or moving the handoff between browsers or
  wiring the lobby.
- Retain the implemented layered abuse controls: a coarse location-local edge
  creation budget plus exact persisted per-room invitation, ticket, upgrade, and
  `Hello` budgets. Retain the atomic five-minute unclaimed lifecycle/alarm,
  first-admission cancellation, and retry-safe deletion tombstone. Preview load
  evidence and alert thresholds remain required before the lobby can target v2.
- Implement schema validation, role authorization, rate limits, idempotency,
  client sequencing, durable transaction pipeline, projection publication, and
  typed rejection.
- Integrate the implemented `packages/client-session` controller, which owns
  bounded gap-free commands, byte-identical ambiguity retries, heartbeat,
  authoritative replacement, generation-safe reconnect, and supersession.
  Add stale presentation-intent cancellation at the application boundary.
- Implement opponent-action request semantics, coaching/flip behavior, presence,
  chat, spectator projection, and hidden inspection/reveal. Preserve the current
  absence of multiplayer undo unless a separate product ADR authorizes it.
- Build deterministic two/three-client simulations and browser contexts.
- Connect the implemented closed server telemetry/health boundary to operational
  dashboards, destinations, and alerts before external beta use. Ratify the
  provisional thresholds and rehearse `apps/server/OPERATIONS.md`; add
  client/renderer/import/save events only with their owning slices.

Exit gate:

- multi-client state hashes never diverge under reordered/duplicated/dropped
  transport tests;
- no unauthorized role can mutate state or receive secret fixture values;
- reconnect/restart meets recovery objectives with no acknowledged loss;
- pending interactions recover cleanly from rejection/disconnect;
- spectator and coaching parity matrices pass;
- rate/size/abuse tests pass without harming a normal room.

Rollback: disable v2 multiplayer room creation; solo v2 may remain available if
approved. Active v2 rooms may finish or receive a maintenance close with a v2
save; they are never silently moved to v1.

## Phase 7 — Saves, replay, sharing, and compatibility

Goal: make v2 sessions durable and legacy data safe to carry forward.

Work:

- Implement versioned snapshots, journal chunks, recovery, retention, and
  integrity verification.
- Implement high-entropy share/save capabilities, TTL/limits/revocation, and
  encrypted/server-hosted multiplayer continuation policy.
- Extend the implemented authoritative replay ledger, role-projected streaming,
  client artifact assembly, renderer-neutral playback controller, and
  live/replay application coordinator/board guard and implemented
  `RemoteRoomRuntime`/`RemoteRoomRoute` by completing normal sidebar actions,
  chat, create/join form wiring, navigation, and focus/keyboard/visual parity.
  Reuse the implemented ADR-018 browser ticket bootstrap, mounted legacy chrome,
  presentation surface, bounded stores, keyed feed, serial consumers, and
  live-region dwell.
  The legacy coin action is log-only, so retain the implemented no-motion
  acknowledgement adapter; adding a separate coin visual requires an approved
  parity exception. Preserve the
  implemented recipient-safe actor/scope/source facts and spectator-public
  single-reveal names while adding long-retention journal chunks plus
  download/import formats.
- Expose v1 conversion through an isolated upload/import transaction.
- Add storage migration rehearsal, corrupt/truncated data recovery, quotas, and
  cleanup jobs.

Exit gate:

- all persistence and legacy compatibility contract tests pass;
- a saved match resumes to the same canonical hash and role projections;
- restore from newest snapshot plus journal tail survives injected interruption;
- corrupt/oversized/decompression-bomb inputs fail safely;
- public or role-projected replay contains no hidden data;
- share tokens cannot be feasibly guessed and expired/revoked links fail closed.

Rollback: disable new saves/imports separately; existing v2 data remains readable
by the previous compatible server deployment.

## Phase 8 — Hardening, parity closure, and release candidate

Goal: demonstrate the rebuild is faster and more reliable, not merely newer.

Work:

- Close all non-deferred parity differences or approve explicit exceptions.
- Run performance tuning based on traces, not architectural rewrites.
- Conduct security review/threat modeling of rooms, hidden info, image proxy,
  chat, imports, saves, admin/observability, and dependencies.
- Run browser/device checks, accessibility audit, load/fault tests, two-hour CI
  soaks, and 24-hour pre-release soak.
- Exercise deploy/rollback, mixed build/protocol, storage restore, and incident
  runbooks in staging.
- Produce user-neutral release notes: internal changes and any security-required
  behavior exceptions only.

Exit gate: every release criterion in the verification document passes with
attached evidence and named sign-off.

Rollback: deploy the last compatible v2 build or stop new v2 cohorts; v1 remains
available until Phase 10.

## Phase 9 — Cohort rollout and cutover

Goal: increase v2 traffic without risking all sessions at once.

Suggested stages:

1. Maintainers and automated synthetic rooms.
2. Opt-in local/solo users.
3. Opt-in multiplayer rooms with a visible beta flag outside the in-game UX.
4. Sticky 5%, 25%, 50%, then 100% of **new** room creation.
5. Make v2 default while retaining an explicit v1 fallback window.

Cohort assignment is sticky for the complete room and both participants. Pause
automatically/manual on error, reconnect, invariant, latency, memory, hidden-data,
or save-failure thresholds. Compare v1/v2 operational metrics, but never mirror
real hidden commands into an unauthorized shadow client.

Cutover gate:

- at least two stable release cycles at full new-room traffic;
- no unresolved severity-1/2 incident or data/privacy issue;
- success/error/reconnect/resource metrics meet budgets;
- save/replay compatibility and rollback are still exercised; and
- product owner explicitly approves v1 deprecation.

## Phase 10 — Legacy retirement

Goal: remove v1 only after v2 has proven stable.

- Stop creating v1 rooms, then wait beyond maximum room/save compatibility
  window.
- Archive a tagged v1 build and immutable fixtures.
- Keep the supported legacy converter, not the live v1 action runtime.
- Remove legacy client/server dependencies, iframe HTML, relay handlers, and v1
  deployment configuration in separately reviewable commits.
- Re-run dependency, license, security, and dead-code scans.
- Document the last supported v1 import version and retention deadline.

Rollback after final data deletion may be impossible, so deletion/retention is a
separate explicitly approved operation.

## Effort and staffing model

Until Phase 1/4 evidence exists, use a planning range rather than a deadline:

| Workstream                            | Rough engineer-weeks | Main uncertainty                                  |
| ------------------------------------- | -------------------: | ------------------------------------------------- |
| Characterization and foundations      |                  4–6 | Hidden behaviors and deterministic legacy harness |
| Core, projection, conversion          |                  4–6 | Attachment/work-area/undo semantics               |
| Renderer spike and full parity        |                 6–10 | DOM-vs-Pixi result, CORS, browser parity          |
| Authority, persistence, compatibility |                  6–9 | Hosting and multiplayer save/undo policy          |
| Hardening and rollout                 |                  4–6 | Defect rate and real-world assets/devices         |

Total planning range: roughly **24–37 engineer-weeks**, with parallelism between
domain/network and renderer/parity after contracts stabilize. Two experienced
engineers plus review support should plan for approximately four to six calendar
months; one engineer should expect substantially longer. These are confidence
ranges, not commitments, and are re-estimated at both explicit gates.

## Work-in-progress limits

- Only one change at a time may alter a given state or wire schema.
- At most one unintegrated vertical slice per workstream.
- Every slice lands behind a disabled flag with tests and migration notes.
- Avoid long-lived branches that duplicate schema or fixture edits.
- Parallel reviewers may propose changes, but one named owner resolves each
  decision and updates all affected contracts atomically.
