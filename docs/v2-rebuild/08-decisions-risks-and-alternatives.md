# Decisions, risks, and alternatives

## Decision states

- `ACCEPTED`: blueprint treats this as binding; changing it requires an ADR.
- `PROPOSED`: recommended and used for planning; ratify in Phase 0.
- `SPIKE_REQUIRED`: blocking evidence must select/confirm an option.
- `PRODUCT_REQUIRED`: product/privacy semantics must be explicitly selected.
- `DEFERRED`: outside first v2 release.

## Decision register

| ID      | State      | Decision                                                                                                                                                                                              | Rationale / required evidence                                                                                                                                                                                                                                                                                                                                                                                            |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADR-001 | `ACCEPTED` | Keep PTCG Sim a manual tabletop; authority enforces integrity/permissions/visibility, not Pokémon rules.                                                                                              | Implemented and ratified by the 2026-09-14 closeout. See `ADR-001-MANUAL-TABLETOP-BOUNDARY.md`.                                                                                                                                                                                                                                                                                                                          |
| ADR-002 | `ACCEPTED` | Strict TypeScript, pure event-producing `game-core`, stable identities, no UI/network/storage dependencies.                                                                                           | Implemented and enforced by strict builds, dependency boundaries, invariants, and deterministic tests. See `ADR-002-DETERMINISTIC-GAME-CORE.md`.                                                                                                                                                                                                                                                                         |
| ADR-003 | `ACCEPTED` | React owns existing DOM UI/chrome and a renderer-neutral board host.                                                                                                                                  | Implemented behind the isolated route with explicit external-store and lifecycle ownership. See `ADR-003-REACT-APPLICATION-SHELL.md`.                                                                                                                                                                                                                                                                                    |
| ADR-004 | `ACCEPTED` | Use normalized stable-keyed React DOM for the first production board behind one renderer-neutral `BoardRenderer` interface; retain Pixi unwired.                                                      | Both candidates work, Pixi is faster in a synthetic full update, and DOM shows diagnostic headroom while preserving native UI/image/accessibility behavior with materially less failure surface. ADR-015 still requires physical CPU evidence. See `ADR-004-BOARD-RENDERER.md`.                                                                                                                                          |
| ADR-005 | `ACCEPTED` | Use a Worker plus one SQLite-backed Durable Object per room for the first v2 runtime; reconsider Colyseus only if managed operational gates expose a platform blocker.                                | Runtime, transactional adapter, hibernation, migrations, alarms, lifecycle, and local performance tests pass. Preview eviction/load/cost/rollback evidence remains a release gate, not an unresolved architecture choice. See `ADR-005-DURABLE-OBJECT-ROOM-RUNTIME.md`.                                                                                                                                                  |
| ADR-006 | `ACCEPTED` | Use full recipient-specific projected snapshots after accepted commands, on admission, and on reconnect.                                                                                              | Implemented across protocol, authority projection, and atomic client installation. Optimize to patches only if retained measurements fail. See `ADR-006-RECIPIENT-SNAPSHOT-SYNCHRONIZATION.md`.                                                                                                                                                                                                                          |
| ADR-007 | `ACCEPTED` | Persist resolved event batch and command idempotency outcome atomically before state publication/success.                                                                                             | Implemented with commit failure and ambiguous-reply recovery tests. See `ADR-007-PERSIST-BEFORE-PUBLISH.md`.                                                                                                                                                                                                                                                                                                             |
| ADR-008 | `ACCEPTED` | Migrate at whole-session boundary: separate `/v2` build/protocol/rooms; one-way data conversion only.                                                                                                 | Mixing positional v1 and stable-ID v2 actions is not safely auditable. See `ADR-008-WHOLE-SESSION-MIGRATION.md`.                                                                                                                                                                                                                                                                                                         |
| ADR-009 | `ACCEPTED` | Canonical server state projects independently for every player/coach/spectator; canonical card IDs never leave authority.                                                                             | Implemented with recipient aliases, independent definitions, projected replay, and recursive leak tests. See `ADR-009-RECIPIENT-SAFE-PROJECTION.md`.                                                                                                                                                                                                                                                                     |
| ADR-010 | `ACCEPTED` | Model active/bench as explicit `PlayStack` aggregates; ordered card zones/work areas hold other cards.                                                                                                | Implemented across normalized state, commands, invariants, projections, conversion, and render scenes. See `ADR-010-PLAY-STACK-DOMAIN-MODEL.md`.                                                                                                                                                                                                                                                                         |
| ADR-011 | `ACCEPTED` | Separate authoritative view, pending overlay, and presentation channels through bounded dependency-free external stores and narrow React bindings.                                                    | Implemented with atomic reset, keyed activity, serial consumption, cancellation, reduced-motion switching, and one lifecycle owner without making React/Pixi a second truth. See `ADR-011-CLIENT-STATE-CHANNELS.md`.                                                                                                                                                                                                     |
| ADR-012 | `ACCEPTED` | Download only role-projected view-only replays; keep resumable multiplayer state server-held behind a role-bound capability; require both players' explicit consent for any full hidden-state export. | The owner approved the split on 2026-09-10. An ordinary download never contains canonical state or credentials; exact continuation never sends both hidden decks to a browser. See `ADR-012-MULTIPLAYER-SAVES-AND-EXPORTS.md`.                                                                                                                                                                                           |
| ADR-013 | `ACCEPTED` | Preserve direct player-selected arbitrary image URLs for local backgrounds, custom card faces, and custom card backs through native DOM image loading.                                                | The owner explicitly prioritized legacy compatibility on 2026-09-10 and accepted direct-host request metadata. Background URLs stay page-local; bounded custom-face URLs reach only recipients authorized to see that face; custom backs are public player presentation metadata. No allowlist, proxy, or CORS opt-in is required. See `ADR-013-ARBITRARY-IMAGE-URLS.md`.                                                |
| ADR-014 | `ACCEPTED` | Preserve solo-only undo using whole-match authority order, a hashed base, and a bounded resolved-event tail; restore exact outcomes in a new revision and rotate aliases.                             | The owner-approved reliability scope permits correcting v1's ambiguous split histories while retaining the visible Solo-only control. The 128-entry default is accepted and measurable. See `ADR-014-SOLO-UNDO.md`.                                                                                                                                                                                                      |
| ADR-015 | `ACCEPTED` | Use a four-physical-core, 8-GiB, integrated-GPU laptop class plus controlled same-region and recovery-stress network profiles for first-release performance evidence.                                 | The owner accepted the vendor-neutral lower-end target on 2026-09-14. Three retained physical runs on an exact recorded device and managed preview must satisfy the ratified absolute, v1-relative, resource, and network gates; CI/software-rendered/local-runtime values remain diagnostic. See `ADR-015-REFERENCE-PERFORMANCE-PROFILE.md`.                                                                            |
| ADR-016 | `ACCEPTED` | Persist resolved domain events and canonical checkpoints; project a connected session's own replay perspective and stream frames separately.                                                          | The bounded ledger, migrations, fresh aliases, atomic assembly, deterministic playback, guarded board binding, replay chrome, and recipient-safe presentation are implemented. Archival policy and server-held continuation remain separate release work. See `ADR-016-EVENT-LEDGER-AND-PERSPECTIVE-REPLAY.md`.                                                                                                          |
| ADR-017 | `ACCEPTED` | Preserve mutual opt-in coaching/private looks with server-owned consent, immediate withdrawal, and the accepted reconnect lifetime.                                                                   | Each authenticated seat controls only its own persisted consent. Withdrawal closes affected grants; disconnect retains them only for the 30-second reconnect grace. See `ADR-017-COACHING-AND-PRIVATE-INSPECTION.md`.                                                                                                                                                                                                    |
| ADR-018 | `ACCEPTED` | Keep room code UX but authorize with high-entropy seat/resume capabilities and one-time WebSocket tickets.                                                                                            | Creation, invitation, ticket, retry/recovery, resume, schema-v7 admission, seat ceilings, rate limits, expiry, and failure tests are implemented. ADR-020 owns clipboard presentation; preview abuse/load/alarm evidence remains a release gate. See `ADR-018-CAPABILITY-BASED-ROOM-ADMISSION.md`.                                                                                                                       |
| ADR-019 | `ACCEPTED` | Project owner explicitly authorized direct MagicCircle implementation reuse and confirmed the necessary project-source authority; preserve provenance and third-party dependency notices.             | The 2026-09-16 confirmation closes the project-source permission blocker while retaining PTCG-owned contracts, tests, source commit/file provenance, and dependency review. See `ADR-019-MAGICCIRCLE-REUSE.md`.                                                                                                                                                                                                          |
| ADR-020 | `ACCEPTED` | Use a manual foreground clipboard handoff for anonymous player-two and spectator invitations while preserving the familiar room-code workflow.                                                        | Creator custody writes a strict bounded envelope without returning it to UI code; native paste prevents bearer insertion and gives private non-serializing custody only to guest bootstrap. Player copies rotate, spectator copies are distinct, and room-code-only/manual bearer typing, URLs, storage, React state, DOM, logs, analytics, and a new relay are rejected. See `ADR-020-ANONYMOUS-INVITATION-HANDOFF.md`. |
| ADR-021 | `ACCEPTED` | Do not expose or promise v1 saved-game/action-history file or old `/import?key=` share-link import in the first v2 release.                                                                           | The owner approved deferral on 2026-09-12. The tested converter remains quarantined for evidence or a future separately approved compatibility project; deck import and v2 perspective-replay import are unaffected. See `ADR-021-DEFER-V1-SAVE-IMPORT.md`.                                                                                                                                                              |
| ADR-022 | `ACCEPTED` | Keep v1 available after full v2 cutover for at least 30 consecutive days and two stable v2 production release cycles, whichever takes longer; retirement still requires explicit approval.            | The owner accepted the window on 2026-09-14. Rollback, a release-blocking pause, or a severity-1/2 data/privacy incident restarts eligibility; new-room shutdown, active-room drain, runtime removal, and data deletion remain separate steps. See `ADR-022-V1-FALLBACK-AND-RETIREMENT-WINDOW.md`.                                                                                                                       |
| ADR-023 | `ACCEPTED` | Support current stable Chrome, Edge, Firefox, and Safari on desktop/laptop at a minimum 1280×720 CSS-pixel viewport; phones and tablets are best effort for the first v2 release.                     | The owner accepted the boundary on 2026-09-14. Chromium remains the broad quantitative/parity lane, a real-room Firefox/WebKit journey is release-blocking, and actual current stable browser products require a recorded release-candidate smoke. See `ADR-023-DESKTOP-BROWSER-SUPPORT.md`.                                                                                                                             |
| ADR-024 | `ACCEPTED` | Preserve characterized accessibility behavior for the first v2 release without claiming formal WCAG conformance, universal keyboard equivalence, or a separate 200% zoom/reflow guarantee.            | The owner accepted parity-first scope on 2026-09-14. Native semantics, characterized keyboard/focus behavior, ordered announcements, reduced-motion consumers, and hidden-data safety are release-blocking; a recorded keyboard/screen-reader smoke complements automation. See `ADR-024-FIRST-RELEASE-ACCESSIBILITY-PARITY.md`.                                                                                         |
| ADR-025 | `ACCEPTED` | Keep the shared durable room socket-upgrade cap and require per-source Cloudflare edge throttling before public exposure, without putting admission credentials in URLs or WebSocket subprotocols.    | The owner accepted the layered availability boundary on 2026-09-16. Managed preview must select and verify the edge threshold against valid reconnect bursts and sustained invalid upgrades; the room, deadline, and connection limits remain inner defenses. See `ADR-025-PRE-ADMISSION-SOCKET-ABUSE.md`.                                                                                                               |

The 2026-09-14 closeout completed standalone records through ADR-024. ADR-025
records the owner's 2026-09-16 pre-admission abuse decision. A future change
must update its ADR, this register, and affected requirements before
implementation. See `reviews/2026-09-14-adr-readiness-closeout.md`.

ADR-012 was accepted by the project owner on 2026-09-10. The existing Export
game state action becomes a versioned, integrity-checked, non-resumable replay
from the requesting player or spectator perspective. Canonical multiplayer
continuation remains encrypted and server-held behind a separate role-bound,
expiring, revocable capability and restores by forking a new room with fresh
credentials. No ordinary file contains both hidden decks. A future full-state
file requires independent, current consent from both authenticated players for
that exact export; coaching consent cannot substitute. See
`ADR-012-MULTIPLAYER-SAVES-AND-EXPORTS.md`.

ADR-013 was broadened and accepted by the project owner on 2026-09-10. A player
may explicitly paste any bounded image URL for the local background or a custom
card face. Native DOM images load it directly without a host allowlist, proxy,
or CORS opt-in. A background stays page-local. A custom-card URL is persisted as
card-definition metadata and is sent only to a recipient authorized to see that
face; a hidden card never discloses or requests it. A custom card back is public
player presentation metadata and is projected for concealed cards. The owner
accepts that each displaying browser contacts the chosen host and exposes
ordinary request metadata. Missing/corrupt assets retain an interactive neutral
card and may recover in the same stable node. The shipped v2 card back remains
the default, while quarantined legacy-converter tests preserve the last saved
custom back for each side. See `ADR-013-ARBITRARY-IMAGE-URLS.md`.

ADR-017 was accepted by the project owner on 2026-09-10. Self-private inspection
is allowed; opponent-private inspection requires both seats' current persisted
coaching consent. Each authenticated player can change only their own consent.
Withdrawal is one replay-validatable state transition that atomically removes
every active cross-player inspection grant involving that seat, retains
self-inspection, and emits identity-free close facts. Grants otherwise survive
reconnect and replay until explicit close or movement/reset out of their source.
No software can erase knowledge already shown before withdrawal. Its session
lifetime was accepted on 2026-09-09: transport loss durably reserves the
session/seat for 30 seconds; timely resume clears the deadline; expiry revokes
the session and releases the seat without deleting seat-owned canonical match
state; and explicit Leave remains immediate.

ADR-020 was accepted on 2026-09-10. Anonymous authority moves only through an
explicit foreground clipboard operation. Creator APIs return safe receipt
metadata, not the bearer; guest paste is intercepted before DOM insertion and
held only by a private in-memory custodian through successful ticket exchange.
The visible Room ID remains discovery metadata. Player copies rotate, repeat
spectators receive distinct claims, and a room code alone never authorizes.
The accepted path is now wired behind the production-built, non-default
`?room-lobby=1` route. Manual Room ID state is bounded to the public code
alphabet, drops are rejected, a failed replacement paste disarms the prior
claim, and component ownership closes creator/guest runtimes on teardown.
The connected sidebox now uses the same route owner: authenticated chat/flower
remain available to players and spectators, player-only buttons form existing
atomic commands from the recipient projection, replay hides live inputs, and
confirmed Leave disposes the runtime and replaces private join custody before
showing the lobby. The live Solo header tab retains its separate exact source
confirmation and delegates acceptance to the same teardown; rejection and the
selected Replay tab do nothing. This does not expose room authority or change
the default route.
The restored live/replay Options subset initially exported only the
already-visible effective bounded activity feed, cleared only local live
presentation, and requested browser full screen. ADR-012 now authorizes the
separate perspective-replay file slice. Canonical multiplayer continuation
stays unavailable until its server-held capability, encryption, retention,
recovery, and abuse gates pass.

## Major alternatives

### Board renderer

| Option                      | Benefits                                                                                                           | Costs/risks                                                                          | Decision rule                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Raw PixiJS + React overlays | Stable sprite identity, batching/transforms/hit testing, explicit resource lifetime, strong MagicCircle experience | CORS/WebGL, texture memory, context recovery, canvas semantics, dual-layer anchoring | Select only if spike meets all parity gates and materially beats DOM on measured bottlenecks. |
| Normalized React DOM/CSS    | Closest visual parity, native images/scroll/accessibility, fewer rendering technologies, arbitrary image support   | Layout/reconciliation can be costly if implemented naively; drag/z-index complexity  | Select if stable keyed components + pure state meet performance/reliability budgets.          |
| `@pixi/react`               | Declarative component model and React integration                                                                  | More reconciliation, lifecycle ambiguity, rapidly changing integration surface       | Consider only if raw Pixi host complexity is the measured blocker.                            |
| Phaser                      | Packaged scene/input/game loop                                                                                     | More engine than a discrete tabletop needs; less direct parity/control               | Reject unless both primary spikes fail for a Phaser-specific reason.                          |
| Canvas 2D custom renderer   | Broad fallback and simple output model                                                                             | Reimplements scene graph, asset lifetime, hit testing and batching                   | Not preferred; possible compatibility fallback only.                                          |

The renderer-neutral interface is deliberate architectural insurance. Choosing
React DOM would not invalidate the rebuild's core, networking, or state benefits.

### Room runtime

| Option                             | Benefits                                                                                            | Costs/risks                                                                                                         | Position                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Cloudflare Durable Object per room | Serialized locality, hibernating WebSockets, colocated durable state, MagicCircle operational reuse | Vendor/runtime constraints, async interleaving still needs queue, local tooling/cost model                          | Selected for the first v2 runtime by ADR-005.                        |
| Colyseus                           | Mature room lifecycle/state sync abstractions, portable Node ecosystem, StateView options           | Must customize privacy/idempotent durable event flow; separate hosting/scaling/storage                              | Revisit only if managed gates expose a platform blocker.             |
| Rebuilt Socket.IO/Node authority   | Familiar current transport, flexible hosting                                                        | Must implement room ownership/scaling/durability/recovery; Socket.IO ordering does not create exactly-once delivery | Viable only with a clear deployment advantage; not a relay retrofit. |
| Peer replication                   | Low server state                                                                                    | Existing divergence, privacy, reconnect, replay, authorization problems remain                                      | Rejected.                                                            |

### Synchronization

| Option                           | Benefits                                                                 | Costs/risks                                                                     | Position                                                         |
| -------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Full per-recipient view snapshot | Simple recovery, skipped frames harmless, easy hashing/privacy/debugging | More bytes per action                                                           | Selected by ADR-006; definitions/images remain bounded/measured. |
| Per-recipient JSON Patch         | Lower bytes                                                              | Separate baseline per connection, patch recovery/validation, privacy complexity | Optimize later only if payload budget fails.                     |
| Client event replay              | Small steady messages                                                    | Recreates missed-event/catch-up/version/determinism burden                      | Replay/persistence tool, not primary client sync.                |
| Shared room snapshot             | One broadcast                                                            | Cannot represent hidden information safely                                      | Rejected.                                                        |

### Domain representation

| Option                                               | Benefits                                                                              | Costs/risks                                                               | Position                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Explicit zones + `PlayStack` aggregates + work areas | Atomic stack semantics, markers/rotation live with the play object, direct invariants | Requires carefully modeling cross-owner attachment and stack departure    | Selected by ADR-010.                                                        |
| Flat cards + generic relationship graph              | Uniform and flexible                                                                  | Easy to recreate implicit relative pointers and scatter stack-level state | Retain only as an implementation detail if aggregate API/invariants remain. |
| DOM/Pixi display tree as state                       | Immediate visual access                                                               | Current root failure: identity/order/lifecycle coupling                   | Rejected.                                                                   |
| Full Pokémon rules model                             | Could automate legality                                                               | Massive scope, changes product semantics, constant card-rule maintenance  | Rejected.                                                                   |

### Persistence and replay

| Option                               | Benefits                                                | Costs/risks                                                                  | Position                                          |
| ------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| Resolved event batches + checkpoints | Deterministic replay, audit, crash recovery, compaction | Event versioning/migrations                                                  | Selected by ADR-007 and ADR-016.                  |
| Snapshots only                       | Simple restore                                          | Weak replay/audit/undo; more frequent writes                                 | Keep snapshots as optimization, not sole history. |
| Raw commands + rerun reducer         | Compact intent log                                      | Future reducer/randomness changes alter history; rejected commands ambiguous | Not authoritative replay.                         |
| Client action arrays                 | Matches v1                                              | Unbounded, positional, forgeable, privacy/reconnect risk                     | Legacy conversion input only.                     |

## Product-question closeout

There are no unresolved architecture/product questions in this register. This
does not mean all release evidence is complete.

- ADR-017 resolves private inspection: self-inspection remains available;
  opponent-private inspection requires both seats' current coaching consent.
  ADR-009 and the explicit authority policy cover public/known opponent cards and
  cards the actor owns in an opponent destination.
- The project's approved under-the-hood reliability scope permits narrowly
  documented correctness and lifecycle fixes without redesigning UI/UX.
  `PARITY_EXCEPTIONS.md` is the canonical signed-off exception register.
- ADR-021 resolves first-release v1 saved-game/share-link compatibility, and
  ADR-022 resolves the fallback/retirement observation window.

Named release authorities, managed-preview infrastructure, and physical/manual
evidence are organizational or execution gates. They are tracked in the
closeout review and verification plan rather than represented as undecided
architecture.

## Parity-exception register

See `PARITY_EXCEPTIONS.md`. A behavior cannot be silently copied or changed; new
exceptions require source evidence, explicit classification, regression tests,
and the required security/product review.

## Risk register

| ID    | Risk                                                                                                       | Likelihood / impact | Mitigation and trigger                                                                                                                                                                                                                                                                    |
| ----- | ---------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-001 | Hidden legacy behavior causes late parity drift                                                            | High / High         | Phase 1 catalog, normalized extractor, real fixtures; stop a slice when behavior is unclassified.                                                                                                                                                                                         |
| R-002 | Rewrite scope becomes a UI redesign or rules engine                                                        | Medium / High       | Non-goals, parity matrix, separate product ADR; reject unrelated UX in v2 PRs.                                                                                                                                                                                                            |
| R-003 | Pixi adds CORS/accessibility/recovery cost without speed benefit                                           | Medium / High       | Competitive spike and renderer-neutral interface; choose DOM if gates fail.                                                                                                                                                                                                               |
| R-004 | Hidden card identities leak through snapshots, errors, logs, asset loads, or stable IDs                    | High / Critical     | Canonical IDs server-only, non-interference tests, request interception, redacted telemetry; any leak blocks rollout.                                                                                                                                                                     |
| R-005 | Active room loses an acknowledged move on crash                                                            | Medium / Critical   | Atomic durable event+dedupe before publish/result; boundary fault tests.                                                                                                                                                                                                                  |
| R-006 | Event/schema evolution makes old rooms/replays unreadable                                                  | Medium / High       | Separate explicit versions, pure migrations, fixture per hop, checkpoint/hash verification.                                                                                                                                                                                               |
| R-007 | Legacy import recreates old arbitrary function dispatch or partial application                             | Medium / Critical   | Frozen allowlist interpreter, bounded input, temporary result, invariant validation, atomic install.                                                                                                                                                                                      |
| R-008 | MagicCircle code is copied with wrong assumptions/complexity                                               | Medium / High       | Owner confirmed project-source authority on 2026-09-16; retain commit/file provenance, audit third-party dependencies, use PTCG-owned contracts, and reject shared broadcast, continuous loop, and giant manager/engine.                                                                  |
| R-009 | Texture/heap/listener resources grow over long sessions                                                    | High / High         | Leases, byte LRU, lifecycle counters, 100-cycle churn and 24h soak gates.                                                                                                                                                                                                                 |
| R-010 | Full projected snapshots exceed bandwidth/latency budgets                                                  | Low–Medium / Medium | Deduplicate definitions, measure compression/payloads; add per-recipient patches only behind tests if needed.                                                                                                                                                                             |
| R-011 | Durable Object/hosting cost or tooling blocks maintainers                                                  | Medium / Medium     | Runtime spike, adapter boundary, cost/load model, Colyseus fallback.                                                                                                                                                                                                                      |
| R-012 | Parallel contributors create schema drift and merge conflicts                                              | High / Medium       | Single schema/integrator owner, isolated audit reports, requirement IDs, small vertical PRs.                                                                                                                                                                                              |
| R-013 | External image host failure or oversized decode degrades the board                                         | High / Medium       | Native-load failure containment, stable neutral placeholders, no logical dependence, bounded URL strings, lifecycle/resource gates, and an incident switch that disables external loading without changing state.                                                                         |
| R-014 | A player-selected custom image host tracks authorized viewers                                              | Medium / High       | Explicitly accepted by ADR-013 for compatibility. Never server-fetch or log URLs; disclose/project a face URL only when its card identity is authorized; document direct-host contact; keep hidden-asset request interception as a release blocker.                                       |
| R-015 | Authorization blocks legitimate manual opponent interactions or permits unintended cross-seat destinations | Medium / High       | Resolved policy: authority keys control to the actor/card, not destination ownership; public/known opponent manipulation follows the explicit room policy, and private inspection follows ADR-017 mutual consent. ADR-009 records the boundary and tests cover cross-seat destinations.   |
| R-016 | Optimistic client becomes a second reducer and diverges                                                    | Medium / High       | Pending presentation overlay only; no prediction for random/hidden/bulk; snapshot reconciliation tests.                                                                                                                                                                                   |
| R-017 | Deployment mixes v1/v2 clients in one room                                                                 | Medium / Critical   | Namespaced protocol generation, admission rejection, sticky session cohort.                                                                                                                                                                                                               |
| R-018 | Guest invitation leaks authority or failed creator bootstrap accumulates orphan rooms                      | Medium / High       | Implemented digest-only bounded claims, redacted boundaries, layered creation/admission limits, atomic retry-safe unclaimed-room expiry, and ADR-020 foreground copy/private-paste custody; finish preview load/alarm evidence before lobby rollout.                                      |
| R-019 | Contributor complexity rises despite better architecture                                                   | Medium / High       | Small public packages, examples/readmes, no giant ECS/store/manager, architecture lint and onboarding test.                                                                                                                                                                               |
| R-020 | A stale or foreign client attempts to close a canonical inspection work area                               | Low / Medium        | Resolved end to end: client, wire, authority, and domain command use the projected work-area handle as the precondition; only the resulting event names the internal inspection ID, and generated plus targeted tests reject stale/cross-player handles.                                  |
| R-021 | Invalid pre-admission upgrades spend a room's shared availability budget                                   | Medium / Medium     | ADR-025 retains the durable room cap and requires per-source edge throttling before public routing; managed preview proves legitimate reconnect bursts, invalid-upgrade rejection, route scope, and rollback without exposing admission credentials or application-level source identity. |

Role ownership, current status, evidence, review date, and residual severity are
required throughout implementation. Named individuals for product, security,
parity/accessibility, operations/performance, and rollback authority must be
recorded before a release candidate enters a production cohort; the repository
does not invent organizational assignees.

## Stop/change conditions

- Stop production implementation if the command/action catalog or visibility
  matrix has unresolved semantic holes affecting the current slice.
- Retain React DOM if Pixi misses parity/resource/recovery gates or cannot
  preserve ADR-013 arbitrary custom-image behavior.
- Select/retain another authoritative runtime if the Durable Object spike cannot
  meet durability, tooling, cost, or recovery requirements.
- Do not weaken durability to meet latency until batching/storage measurements
  prove a problem and an ADR states the accepted loss window.
- Do not introduce patches until full projected snapshots demonstrably exceed the
  ratified payload/latency budget.
- Pause rollout immediately on an invariant failure, hidden-data leak,
  acknowledged loss, corrupting import, session-version mix, or P0 parity defect.
- If characterization expands the rebuild beyond the planning range by more than
  30%, re-scope/defer explicitly rather than hiding it in estimates.

## Research and reference material

Use primary documentation when ratifying implementation decisions:

- [React documentation](https://react.dev/)
- [PixiJS v8 guides](https://pixijs.com/8.x/guides)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare Durable Objects WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Colyseus rooms](https://docs.colyseus.io/room)
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees)
- [Vite documentation](https://vite.dev/guide/)
- [Vitest documentation](https://vitest.dev/guide/)
- [Playwright documentation](https://playwright.dev/docs/intro)
- [Valibot documentation](https://valibot.dev/)

Local MagicCircle files listed in the architecture and renderer documents are
implementation references. Their current behavior must be tested before reuse;
their existence is not evidence that an assumption fits PTCG Sim.
