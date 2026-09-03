# Verification and success criteria

## Quality model

The rebuild is done when evidence shows it preserves behavior while improving
correctness, privacy, recoverability, responsiveness, and resource bounds. Code
coverage alone is not an acceptance criterion.

All quantitative performance budgets below are provisional until the Phase 1
legacy baseline and Phase 4 spikes run on named hardware. Ratification may make
them stricter or document a justified exception; it may not silently remove a
budget because an implementation missed it.

## Test environments

### Deterministic CI environment

- Chromium at 1366×768, DPR 1 and 1920×1080, DPR 2.
- Pinned fonts and same-origin deterministic card-image server.
- Seeded test ID/random adapters; resolved random events in replay fixtures.
- Fake clock for core/server tests and real clock for browser timing tests.
- A documented four-core mid-tier CPU profile for quantitative renderer runs.
- Software-rendered browser results may catch regressions but do not substitute
  for physical-GPU release evidence.

### Browser release matrix

Current stable Chromium, Firefox, and Safari on supported desktop operating
systems. Chromium provides quantitative CI; Firefox/Safari must pass functional,
visual manual, input, storage, socket, and WebGL recovery checks. The exact
versions and support window are ratified in Phase 0.

### Representative match fixture

- 120 card instances and 120 distinct face assets for cache pressure.
- Both active/bench areas populated with evolution and mixed attachments.
- Face-down/public/private cards and every marker/rotation type.
- Stadium, free-board cards, all persistent zones, both work areas.
- A 60-card opened zone browser.
- Flipped board, non-50/50 split, sidebar and full-screen variants.

## Required test layers

| Layer               | Required evidence                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Static architecture | Strict type check, lint, circular-dependency and forbidden-import checks, package API report, bundle secret scan             |
| Domain unit         | Valid/rejected/boundary/no-op cases for every command and event type                                                         |
| Invariant/property  | Generated valid/invalid sequences; exactly-one location; nonduplicated ordered zones/stacks; rejected state unchanged        |
| Determinism         | Identical state + command + context gives byte-identical resolved events, next state, projection, and stable hash            |
| Visibility/security | Role matrix, non-interference/differential projection, serialized leak scan, private asset request scan                      |
| Protocol            | Runtime codec round trips, unknown versions/types, byte/depth/count limits, sequence/idempotency, authorization, safe errors |
| Authority model     | Simultaneous/conflicting commands, duplicate/lost/reordered frames, stale views, one controller per seat, convergence        |
| Persistence         | Crash at every transaction boundary, checkpoint/tail recovery, compaction, corruption, migration, retention, quota           |
| Legacy conversion   | Every supported version/action, real/golden saves, invalid/truncated/oversized inputs, transactional failure                 |
| Renderer unit       | Pure geometry, stacking, z-order, hit testing, diff/invalidation, texture leases, generation-safe async teardown             |
| Browser/WebGL       | Context loss/restore, zero-size host, DPR changes, image failure/CORS, StrictMode remount, pointer cancellation              |
| E2E parity          | Protected solo/multiplayer/spectator/replay/deck/settings journeys, screenshots and structured geometry                      |
| Accessibility       | Keyboard-only flows, focus/menu/dialog behavior, semantic board bridge, live announcements, reduced motion                   |
| Performance         | Cold/warm load, setup, one-card action, drag, resize, opened zones, reset churn, reconnect, server persistence               |
| Soak/fault          | Long randomized room sessions with drops, reconnect, restarts, hibernation, image errors, and context loss                   |

## Core correctness gates

Release requires all of the following:

1. Zero invariant violations in unit, generated, multiplayer, import, replay, and
   soak suites.
2. Every card appears exactly once after every accepted event batch.
3. A rejected command leaves the canonical serialized state and hash unchanged.
4. One accepted command creates one atomic event batch and one new revision.
5. Duplicate `(seatId, sessionId, clientSequence, commandId)` submissions have exactly one
   state effect and return the recorded outcome.
6. Two conflicting moves resolve as one acceptance and one typed rejection; two
   unrelated moves both succeed when their entity preconditions still hold.
7. Replaying persisted resolved events from the supported checkpoint produces the
   same final canonical hash on all supported runtimes.
8. Client view revisions never regress and all connected clients converge to the
   correct projection of one canonical revision.
9. Unknown discriminants and invalid/oversized values fail closed before reducer
   dispatch.
10. Property suites cover at least 1,000 deterministic seeds with mixed valid and
    invalid command sequences before release; failures persist their seed as a
    regression fixture.
11. Solo undo restores the last retained resolved checkpoint without invoking
    randomness, advances revision, keeps the reverted audit event, and remains
    forbidden in explicit multiplayer mode.
12. Undo after a hidden/random action rotates discarded-branch handles for every
    recipient; reconnect preserves only the restored branch and does not replay
    the presentation fact.
13. Projected replay playback is bounded and deterministic: backward navigation
    never reruns domain logic or randomness, forward effects match only the
    frames crossed, and a rejected replacement leaves the active replay intact.
14. Replay application mode never mutates the live session: only a fresh
    request-correlated artifact is entered, exit discards late completion,
    reconnect/new-room boundaries retain or clear playback as specified, and
    malformed refresh leaves the current replay intact.
15. The remote board renders the effective live/replay projection, blocks every
    command during loading/active/discarding replay phases, and rewinds through
    explicit renderer replacement without weakening monotonic live installs.
16. Replay chrome matches the legacy live/active visibility map, all four
    controls and exit call the coordinator exactly once, and presentation facts
    are delivered once per later playback generation in recorded order across
    fast-forward, reentrancy, adapter errors, remount, rewind, and teardown.
17. Every presentation-event variant maps exhaustively to privacy-safe activity
    and accessibility effects; coin facts carry the trusted actor and persisted
    outcome; live facts are consumed exactly once, including while replay mode
    suppresses them without bleed or delayed backlog.
18. Local presentation channels are independently subscribable and bounded;
    transient consumers acknowledge FIFO entries; reset/disposal block
    reentrant stale writes; replay rewind deterministically removes future
    activity and transient work without replaying effects on remount; changed or
    terminal match/viewer identity purges all local presentation data.
19. Activity feed projection is stable and renderer-neutral; announcement and
    animation consumers are serialized; overflow, clear, replacement, preference
    change, and disposal abort obsolete work; late settlements cannot consume a
    newer head; handler/diagnostic failures cannot wedge the queue; and reduced
    motion never enters the animated path or changes command timing.
20. Reveal/hide/private-look facts preserve the trusted actor or viewer,
    card-versus-zone scope, semantic source, and legacy wording in live and
    replay paths; only a spectator-public single reveal may include a bounded
    card name, while hide/private facts pass hidden-identity non-interference and
    serialized leak scans.
21. The mounted legacy presentation surface renders only recipient-safe keyed
    text, preserves the existing `#chatbox` row classes and bottom-scroll
    behavior, announces FIFO entries through a cancellable polite live region,
    replaces activity and cancels stale dwell across replay seek, drains the
    legacy log-only coin result without adding motion, and releases every
    subscription and scheduled callback on teardown.
22. A remote room route constructs session, replay, and presentation owners
    before connection; renders the effective live/replay view; uses the legacy
    multiplayer/replay feed IDs and chrome; blocks replay submissions; wires
    controls and Exit once; and tears down presentation, replay, then transport
    idempotently. React StrictMode cannot create or dispose that external owner,
    the default spike loads the room branch lazily, and no admission capability
    appears in public snapshots or rendered markup.
23. Browser admission sends a long-lived seat/spectator capability only in a
    bounded same-origin no-store POST body, rejects redirects and unsafe
    response shapes, and derives credential-free room/socket URLs. Authority
    persists only a role/name-bound ticket digest, enforces a 30-second expiry
    and 32-ticket room cap, consumes it atomically with session admission,
    rotates a distinct resume capability, rejects replay/expiry/mismatch, and
    restores its committed frontier after an ambiguous persistence failure.
    Schema-v4 rooms migrate with empty ticket/invitation registries, schema-v5
    rooms preserve their tickets while gaining an empty invitation registry,
    and no bearer is exposed through snapshots, journals, errors, DOM, React
    state, storage, or URLs.
24. Creator custody never releases its long-lived player-two or spectator
    credential. It mints only bounded 15-minute role-bound invitations; player
    issuance revokes prior seat invitations and their tickets, spectator claims
    respect the room cap, and expired claims fail closed. Repeating an
    invitation-to-ticket exchange rotates the prior ticket so an ambiguous HTTP
    response is recoverable. Final WebSocket admission atomically consumes the
    invitation and every linked ticket, and replay is rejected across authority,
    persistence, HTTP, hub-recovery, and client-bootstrap tests.
25. New-room initialization atomically persists its snapshot, unclaimed
    lifecycle, and five-minute alarm; first admission atomically claims it and
    cancels expiry. Early, duplicate, failed-deletion, stale-marker, malformed,
    and admission-race paths are bounded and fail closed. Coarse creation limits
    never substitute for authorization, while exact persisted per-room limits
    survive reconstruction and independently cap invitation, ticket, socket,
    and repeated `Hello` work with tested retry hints.
26. The isolated Cloudflare Vitest gate runs the deployed Worker and
    SQLite-backed Durable Object in `workerd`: it verifies edge routing and
    binding use, persisted creation/alarm state, early and due alarm behavior,
    atomic first-admission claim, and WebSocket attachment/session recovery
    across a forced hibernating eviction. The resumed socket answers an
    application ping and commits the next sequenced command durably. Bounded
    adapter-fault cases cover retryable initial admission, concurrent admission
    with a pre-commit command failure, and a committed-but-unacknowledged
    command; exact retries before and after eviction never create a phantom
    acknowledgement or second mutation. Preview managed-service fault rehearsal,
    load/cost measurement, and platform alarm/rate-limit distribution remain
    explicit pre-rollout gates.

## Privacy and security gates

For every hidden-information fixture:

- recursively scan all player/spectator snapshot, event, error, timeline, chat,
  diagnostic, and definition-catalog JSON;
- assert forbidden canonical IDs, definition IDs, names, image URLs, and deck
  order are absent;
- compare unauthorized projections of states differing only in a secret and
  require normalized serialized equality;
- intercept browser image requests and accessibility nodes to prove hidden faces
  are not fetched or exposed;
- prove concealment handles change after shuffle/newly concealed transitions;
- prove private inspection reaches only granted viewers and public reveal reaches
  exactly the intended roles;
- prove spectators cannot reach the reducer or privileged save/export paths; and
- prove coaching visibility only expands after the characterized mutual-consent
  condition.

Threat tests also cover room-code guessing limits, admission/reconnect token
replay, connection supersession, origin checks, chat rendering, image-proxy SSRF
and decompression/import attacks, log redaction, default/missing admin credentials,
and dependency vulnerabilities.

Zero confirmed hidden-information leaks or unauthorized mutations are allowed.
This gate cannot be waived as a cosmetic parity exception.

## Persistence and failure matrix

Inject failure at each boundary:

| Failure point                                              | Required result                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Before durable event/dedupe transaction                    | No state change; safe retry may execute once                                                 |
| After durable commit, before in-memory install/publication | Restart/reconnect loads the applied revision                                                 |
| After publication, before command result                   | Resend returns prior outcome without reapplying                                              |
| Snapshot write interrupted                                 | Previous checkpoint plus valid journal tail restores                                         |
| Newest checkpoint corrupt                                  | Fail safely or use explicitly verified prior checkpoint; alert with no silent divergent room |
| Room process eviction/hibernation                          | Wake restores identical hash, roles, sequence frontiers, and visibility generations          |
| Send fails for one connection                              | Other recipients progress; failed client recovers by snapshot                                |
| Connection supersession race                               | Exactly one controlling connection remains per seat                                          |
| Import/conversion fails at action N                        | Current match unchanged; report format/version/action/reason                                 |
| Storage quota/unavailable                                  | Command is rejected retryably before acknowledgement; no phantom acceptance                  |

Every acknowledged multiplayer mutation must be recoverable after a room restart.
A change to write-behind or a nonzero acknowledged-loss window requires a new
approved durability ADR.

## UI and interaction parity gates

- Every `MUST_MATCH` parity-matrix row passes in its declared browsers/modes.
- Every keyboard shortcut shown by the current Shift reference is automated,
  including selected/unselected context, reused keys, modifiers, form-field
  suppression, repeat policy, and replay/spectator restrictions.
- Every supported source/destination drag class is covered, including covers,
  both boards, stack attach/evolve, pointer leaving the canvas, cancellation,
  authority rejection, and state replacement mid-drag.
- Context-menu item visibility/enabled state is parameterized by zone, role,
  selection, face, mode, perspective, and replay.
- Deck/discard/lost-zone/view/detached work-area browsers preserve sorting,
  scrolling, density, bulk actions, prompts, and close behavior.
- Board flip, both resizers, full-screen playmat, hand concealment, themes,
  outlines, card preview, stack expansion, counters, and marker editing have
  automated workflows and manual sign-off.
- All existing button labels, prompts, menu text, and battle-log outcomes match
  fixtures unless listed in the approved parity-exceptions register.

### Geometry and screenshot thresholds

At controlled fixtures:

- zone/card anchor positions are within 2 CSS pixels;
- card width/height are within 1%;
- rotation is within 0.1 degrees;
- ordering, face/back, visibility, opacity, and menu contents match exactly;
- screenshot diff stays below a threshold established from repeat legacy runs,
  with only documented font/image antialias regions masked; and
- Chromium baseline is automated, with final Firefox/Safari manual approval.

Screenshot percentage alone cannot pass parity. Structured geometry and semantic
assertions are required so widespread small shifts are not masked.

## Renderer performance budgets

Measured after warmup on the reference fixture/device:

| Metric                                                 |                                    Provisional release budget |
| ------------------------------------------------------ | ------------------------------------------------------------: |
| One-card render-model reconciliation                   |                                                p95 ≤ 4 ms CPU |
| Full 120-card scene reconciliation                     |                                               p95 ≤ 50 ms CPU |
| Drag frame time                                        |                                  p95 ≤ 16.7 ms; p99 ≤ 33.3 ms |
| Input event to changed drag visual                     |                                                   p95 ≤ 25 ms |
| Main-thread long task during warmed single-card action |                                                  none > 50 ms |
| Resize/split work                                      |                 at most one layout/render per animation frame |
| Settled idle render scheduling                         |                                        zero continuous frames |
| Board-tier estimated GPU textures                      |                                                     ≤ 128 MiB |
| Preview-tier estimated GPU textures                    |                                                      ≤ 16 MiB |
| Initial v2 route JavaScript                            | ≤ 500 KiB gzip, excluding images/optional deck-builder chunks |
| Resource churn after 100 setup/reset/open/close cycles |     listeners/views/leases/textures return to warmed baseline |
| Retained heap after the same churn                     |                  ≤ 10% above warmed baseline after collection |
| Successful renderer/context recovery                   |                                                   ≤ 3 seconds |

The selected renderer must also be no worse than v1 at p95 for protected input
latency and must materially improve at least the profiled setup/reset, full-zone,
or single-card update bottlenecks. Phase 1 records the exact improvement target;
the architecture cannot claim “faster” using only synthetic frame rate.

Use performance marks around model creation, diff, layout, texture assignment,
render, persistence, projection, serialization, publication, and reconciliation.
Track invalidation reasons, display objects, textures/leases, listeners, fetches,
decoded bytes, long tasks, payload size, and heap trends.

## Network and recovery objectives

On the ratified reference region/network profile:

| Metric                                                           |          Provisional objective |
| ---------------------------------------------------------------- | -----------------------------: |
| Local intent to immediate local feedback                         |                    p95 ≤ 50 ms |
| Same-region command to authoritative reconciliation              |     p95 < 250 ms; p99 < 500 ms |
| Reconnect to usable projected match after transport is available |                p95 < 2 seconds |
| Duplicate command state effects                                  |                    exactly one |
| Periodic full-action-log transmission                            |                           zero |
| Accepted-command durability                                      | 100% in injected restart suite |

Track p50/p95/p99 by command family and separate network, durable commit,
projection/serialization, send, and client-reconciliation time. A global average
cannot hide slow hidden/bulk actions.

The implemented local `workerd` harness now enforces deterministic structural,
frame, fanout, attachment, and serialized-storage envelopes for a real
120-card/two-player/spectator room. Its optional runner records named-host
command and hibernation observations without treating local wall-clock values as
portable CI thresholds. The initial evidence and its explicit limitations are
recorded in
[`SERVER_PERFORMANCE_BASELINE.md`](./SERVER_PERFORMANCE_BASELINE.md). Managed
preview phase splits, reconnect timing, platform resource/cost distributions,
and a bounded journal plateau remain release gates.

## Load and soak gates

- A deterministic suite executes at least 100,000 accepted/rejected command
  attempts across rooms, with duplicates, gaps, disconnects, restarts, and role
  changes: zero divergence, invariant failure, or unhandled rejection.
- A two-hour automated browser/server soak runs in routine CI or scheduled CI.
- A 24-hour pre-release soak covers representative two-player/spectator sessions,
  repeated joins/leaves, save/checkpoint cycles, external asset failures, and
  renderer churn.
- Heap, room journal tail, idempotency window, pending client outbox, chat/timeline
  history, render views, textures, listeners, and caches have enforced bounds and
  no monotonic growth after compaction/collection.
- Room load tests verify admission and rate limits before public cohort rollout;
  targets are based on hosting budget and expected concurrency approved in Phase
  0 rather than an invented user count.

## Legacy compatibility gates

- Every current and historical supported deck/save/replay fixture converts to the
  expected canonical hash and view snapshots, or fails transactionally with a
  specific diagnostic.
- All 50 legacy dispatch actions have at least one conversion fixture; compound,
  randomized, hidden, and positional edge cases have several.
- The converter validates structural format because current displayed/package
  versions disagree and legacy import does not reliably enforce version.
- Existing `QTY,Name,Type,URL` deck CSV remains readable, including Unicode,
  quoted commas/newlines as approved, and Pocket/legacy set-code collisions.
- Main and alternate deck state/save/unload/dirty behavior is independently
  tested.
- Old `/import?key=` records remain readable for the promised transition window;
  new weak four-character records are never created by v2.
- No converted match retains or executes legacy function names at runtime.

## Observability gates

Before any multiplayer cohort, dashboards and alerts must expose:

- active/created/admitted/rejected/expired rooms and role counts;
- accepted/rejected/duplicate/gap commands by safe type/reason;
- reducer and invariant failures;
- durable append/checkpoint/recovery latency and failure;
- projection/serialization/publication payload and latency;
- reconnect attempts, success, recovery time, seat expiry/supersession;
- legacy import outcomes by inferred/declared version and safe reason;
- renderer initialization/context loss/recovery and texture/asset failure;
- client fatal errors, build/protocol/schema versions, and canary cohort; and
- save creation/read/expiry/quota failures.

Telemetry contains opaque correlations, build/schema versions, command type,
revision, and outcome only. It excludes raw command payloads, chat, card names,
card/deck IDs, image URLs, room/save/seat tokens, and IP-derived identity.

The implemented server foundation provides a public no-store version health
probe and field-by-field structured events for HTTP, room lifecycle/rates,
admission/reconnect, command outcome/revision and request/publication byte
counts, socket state, and fixed failure subsystems. Tests inject credential-,
username-, and exception-like
extras and prove they cannot enter emitted records; malformed labels/numbers are
normalized and emitter failures cannot alter the request/authority path. Actual
Cloudflare destinations, dashboards, preview baselines, alert ownership, and
client/renderer/import/save producers remain required before cohort rollout.

Runbooks are rehearsed for persistence outage, room restart loop, reconnect
spike, image-provider/proxy outage, import regression, hidden-data incident,
canary pause, and v2 rollback.

## Release sign-off checklist

A release candidate requires attached evidence and named approval for:

- domain/invariant owner;
- protocol/security/visibility owner;
- persistence/operations owner;
- renderer/performance owner;
- UI parity/accessibility owner;
- legacy compatibility owner; and
- product owner for all exceptions/deferred items.

Any invariant failure, confirmed hidden leak, acknowledged-state loss, corrupting
import, severity-1/2 defect, or P0 parity regression automatically blocks or
pauses rollout.
