# Decisions, risks, and alternatives

## Decision states

- `ACCEPTED`: blueprint treats this as binding; changing it requires an ADR.
- `PROPOSED`: recommended and used for planning; ratify in Phase 0.
- `SPIKE_REQUIRED`: blocking evidence must select/confirm an option.
- `PRODUCT_REQUIRED`: product/privacy semantics must be explicitly selected.
- `DEFERRED`: outside first v2 release.

## Decision register

| ID      | State              | Decision                                                                                                                                     | Rationale / required evidence                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-001 | `PROPOSED`         | Keep PTCG Sim a manual tabletop; authority enforces integrity/permissions/visibility, not Pokémon rules.                                     | Preserves product purpose and constrains core scope.                                                                                                                                                                                                                                                                                                                                                                                                             |
| ADR-002 | `PROPOSED`         | Strict TypeScript, pure event-producing `game-core`, stable identities, no UI/network/storage dependencies.                                  | Removes the current circular, DOM-owned state model and enables deterministic tests.                                                                                                                                                                                                                                                                                                                                                                             |
| ADR-003 | `PROPOSED`         | React owns existing DOM UI/chrome and a renderer-neutral board host.                                                                         | Appropriate for forms, chat, menus, settings, deck tools, accessibility, and lifecycle.                                                                                                                                                                                                                                                                                                                                                                          |
| ADR-004 | `SPIKE_REQUIRED`   | Choose raw PixiJS or normalized keyed React DOM for the board behind one `BoardRenderer` interface.                                          | Pixi is promising, but current bottlenecks are primarily state coupling; prove parity/performance/CORS/accessibility benefit.                                                                                                                                                                                                                                                                                                                                    |
| ADR-005 | `PROVISIONAL`      | Prefer Worker + one SQLite-backed Durable Object per room; compare Colyseus if preview-runtime or cost gates fail.                           | Wrangler dry-run, transactional adapter, hibernation reconstruction, and lifecycle tests pass; preview eviction, load, cost, and rollback evidence remain required.                                                                                                                                                                                                                                                                                              |
| ADR-006 | `PROPOSED`         | Start with full recipient-specific projected snapshots after accepted commands.                                                              | Simplest safe reconnect/privacy model. Optimize to per-recipient patches only after measurements.                                                                                                                                                                                                                                                                                                                                                                |
| ADR-007 | `PROPOSED`         | Persist resolved event batch and command idempotency outcome atomically before state publication/success.                                    | Prevents acknowledged move loss across crash; command frequency is low.                                                                                                                                                                                                                                                                                                                                                                                          |
| ADR-008 | `ACCEPTED`         | Migrate at whole-session boundary: separate `/v2` build/protocol/rooms; one-way data conversion only.                                        | Mixing positional v1 and stable-ID v2 actions is not safely auditable.                                                                                                                                                                                                                                                                                                                                                                                           |
| ADR-009 | `PROPOSED`         | Canonical server state projects independently for every player/coach/spectator; canonical card IDs never leave authority.                    | Hiding artwork after sending identity is not privacy.                                                                                                                                                                                                                                                                                                                                                                                                            |
| ADR-010 | `PROPOSED`         | Model active/bench as explicit `PlayStack` aggregates; ordered card zones/work areas hold other cards.                                       | Matches evolution/attachment/counter/rotation semantics better than DOM-relative pointers or a generic renderer graph.                                                                                                                                                                                                                                                                                                                                           |
| ADR-011 | `PROVISIONAL`      | Separate authoritative view, pending overlay, and presentation stores; use a small external store (Zustand vanilla acceptable).              | The dependency-free bounded runtime now proves independent channels, atomic reset, keyed activity projection, exact-head serial consumption, cancellation, reduced-motion switching, narrow React bindings, and one correctly wired lifecycle owner without making React/Pixi a second truth.                                                                                                                                                                    |
| ADR-012 | `PRODUCT_REQUIRED` | Define multiplayer save/export privacy and resume capability behavior.                                                                       | A full canonical export reveals opponent deck/order; current UX cannot justify leakage.                                                                                                                                                                                                                                                                                                                                                                          |
| ADR-013 | `SPIKE_REQUIRED`   | Choose controlled proxy/CDN, hybrid DOM fallback, or bounded CORS-only policy for arbitrary card/back/background URLs.                       | WebGL CORS and opponent-controlled request privacy can break Pixi parity/security.                                                                                                                                                                                                                                                                                                                                                                               |
| ADR-014 | `PROVISIONAL`      | Preserve solo-only undo using a hashed base plus bounded resolved-event tail; restore exact outcomes in a new revision and rotate aliases.   | Implemented without UI scope; whole-match last-command ordering and the 128-entry default remain reviewable before release.                                                                                                                                                                                                                                                                                                                                      |
| ADR-015 | `PRODUCT_REQUIRED` | Ratify browser, viewport, reference hardware, accessibility, and legacy import support windows.                                              | Quantitative gates require named environments and retention promises.                                                                                                                                                                                                                                                                                                                                                                                            |
| ADR-016 | `PROVISIONAL`      | Persist resolved domain events and canonical checkpoints; project a connected session's own replay perspective and stream frames separately. | A 128-batch/512-KiB ledger, v1/v2/v3-to-v4 migration, fresh aliases, atomic assembly, deterministic playback, request-correlated coordination, guarded board binding, explicit renderer rewind, replay chrome, trusted-actor presentation facts, recipient-safe legacy detail, seek-synchronized activity, cancellable consumers, and an explicit-input remote room screen are implemented; full sidebar/admission and archival retention/export remain Phase 7. |
| ADR-017 | `PRODUCT_REQUIRED` | Decide coaching/private-look permission and reconnect lifetime exactly.                                                                      | Mutual consent cannot revoke knowledge already delivered; threat promise must be honest.                                                                                                                                                                                                                                                                                                                                                                         |
| ADR-018 | `PROPOSED`         | Keep room code UX but authorize with high-entropy seat/resume capabilities and one-time WebSocket tickets.                                   | Display names and guessable room IDs are not identities.                                                                                                                                                                                                                                                                                                                                                                                                         |
| ADR-019 | `ACCEPTED`         | Project owner explicitly authorized direct MagicCircle implementation reuse on 2026-08-31; preserve provenance and any required notices.     | Resolves the code-copy blocker while retaining PTCG-owned contracts and tests.                                                                                                                                                                                                                                                                                                                                                                                   |

Phase 0 turns each non-deferred row into an ADR file containing context, options,
decision, consequences, evidence, migration, rollback, and review date.

ADR-017 now has a deliberately replaceable implementation default for audit:
self-private inspection is allowed; opponent-private inspection requires mutual
persisted coaching consent; grants survive reconnect and replay; explicit close
or movement/reset out of the recorded source revokes them. Grant data is
projected only to its viewer, while presentation facts expose only player IDs
and counts. The row remains `PRODUCT_REQUIRED`: changing this policy should be a
narrow authority decision, and no software can revoke knowledge already shown.

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
| Cloudflare Durable Object per room | Serialized locality, hibernating WebSockets, colocated durable state, MagicCircle operational reuse | Vendor/runtime constraints, async interleaving still needs queue, local tooling/cost model                          | Preferred spike.                                                     |
| Colyseus                           | Mature room lifecycle/state sync abstractions, portable Node ecosystem, StateView options           | Must customize privacy/idempotent durable event flow; separate hosting/scaling/storage                              | Primary fallback/comparison.                                         |
| Rebuilt Socket.IO/Node authority   | Familiar current transport, flexible hosting                                                        | Must implement room ownership/scaling/durability/recovery; Socket.IO ordering does not create exactly-once delivery | Viable only with a clear deployment advantage; not a relay retrofit. |
| Peer replication                   | Low server state                                                                                    | Existing divergence, privacy, reconnect, replay, authorization problems remain                                      | Rejected.                                                            |

### Synchronization

| Option                           | Benefits                                                                 | Costs/risks                                                                     | Position                                                         |
| -------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Full per-recipient view snapshot | Simple recovery, skipped frames harmless, easy hashing/privacy/debugging | More bytes per action                                                           | Initial choice; definitions/images sent separately and measured. |
| Per-recipient JSON Patch         | Lower bytes                                                              | Separate baseline per connection, patch recovery/validation, privacy complexity | Optimize later only if payload budget fails.                     |
| Client event replay              | Small steady messages                                                    | Recreates missed-event/catch-up/version/determinism burden                      | Replay/persistence tool, not primary client sync.                |
| Shared room snapshot             | One broadcast                                                            | Cannot represent hidden information safely                                      | Rejected.                                                        |

### Domain representation

| Option                                               | Benefits                                                                              | Costs/risks                                                               | Position                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Explicit zones + `PlayStack` aggregates + work areas | Atomic stack semantics, markers/rotation live with the play object, direct invariants | Requires carefully modeling cross-owner attachment and stack departure    | Recommended.                                                                |
| Flat cards + generic relationship graph              | Uniform and flexible                                                                  | Easy to recreate implicit relative pointers and scatter stack-level state | Retain only as an implementation detail if aggregate API/invariants remain. |
| DOM/Pixi display tree as state                       | Immediate visual access                                                               | Current root failure: identity/order/lifecycle coupling                   | Rejected.                                                                   |
| Full Pokémon rules model                             | Could automate legality                                                               | Massive scope, changes product semantics, constant card-rule maintenance  | Rejected.                                                                   |

### Persistence and replay

| Option                               | Benefits                                                | Costs/risks                                                                  | Position                                          |
| ------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| Resolved event batches + checkpoints | Deterministic replay, audit, crash recovery, compaction | Event versioning/migrations                                                  | Recommended.                                      |
| Snapshots only                       | Simple restore                                          | Weak replay/audit/undo; more frequent writes                                 | Keep snapshots as optimization, not sole history. |
| Raw commands + rerun reducer         | Compact intent log                                      | Future reducer/randomness changes alter history; rejected commands ambiguous | Not authoritative replay.                         |
| Client action arrays                 | Matches v1                                              | Unbounded, positional, forgeable, privacy/reconnect risk                     | Legacy conversion input only.                     |

## Blocking product questions

These cannot be answered purely by engineering:

1. Which historical v1 save/action formats are promised support, and for how
   long should old share links remain readable?
2. In two-player mode, what exactly should Export produce: opaque resumable save,
   player-perspective replay, full private match only with both players' consent,
   or some combination?
3. Does coaching mode reveal complete hands/decks, permit board flipping only, or
   retain current behavior exactly? How is mutual consent revoked?
4. Which opponent-private manipulations are intentional tabletop features and
   which are accidental privacy leaks?
5. Should private inspection survive a disconnect/reconnect, and when does it
   expire?
6. Are arbitrary custom card, card-back, and background URLs a guaranteed feature
   or can they be restricted/proxied for security and WebGL compatibility?
7. Which known behavioral bugs may be corrected during parity work, and who signs
   each exception?
8. What is the v1 fallback/deprecation observation window?

Until answered, implement fixtures and interfaces but do not lock the affected
production behavior.

## Seed parity-exception register

Phase 1 expands this into its own document. These known behaviors must not be
silently copied or silently changed:

| Candidate                                                                | Evidence/problem                                | Initial classification                                            |
| ------------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------- |
| Alt key guard references `!isAltKeyPressed` rather than invoking it      | Shortcut/replay logic can take the wrong branch | `BUG_COMPATIBLE_PENDING_DECISION`                                 |
| Drag target compares an element to `draggedImage[0]`                     | Element is not an array-like collection         | `BUG_COMPATIBLE_PENDING_DECISION`                                 |
| Image preview/counter code installs repeated global/resize listeners     | Resource growth across use                      | Correct as reliability defect if UX is unchanged                  |
| Failed preloaded images may not be removed                               | Detached resource/request leak                  | Correct as reliability defect                                     |
| `refreshBoard()` moves/reorders state to repair visuals                  | Can alter identity/order and cause sync work    | Must be eliminated; preserve visual result only                   |
| UI displays v1.6 while package/export says 1.5.1                         | Import/version ambiguity                        | Fix through separate build/data schema versions                   |
| Import applies actions incrementally and ignores reliable version gating | Corrupt input can partially mutate game         | Security/reliability exception; transactional conversion required |
| Four-character save key overwrites on collision                          | Guessing/collision/data loss                    | Security exception; do not preserve                               |
| Default admin password                                                   | Unsafe production configuration                 | Security exception; fail closed                                   |

## Risk register

| ID    | Risk                                                                                    | Likelihood / impact | Mitigation and trigger                                                                                                |
| ----- | --------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| R-001 | Hidden legacy behavior causes late parity drift                                         | High / High         | Phase 1 catalog, normalized extractor, real fixtures; stop a slice when behavior is unclassified.                     |
| R-002 | Rewrite scope becomes a UI redesign or rules engine                                     | Medium / High       | Non-goals, parity matrix, separate product ADR; reject unrelated UX in v2 PRs.                                        |
| R-003 | Pixi adds CORS/accessibility/recovery cost without speed benefit                        | Medium / High       | Competitive spike and renderer-neutral interface; choose DOM if gates fail.                                           |
| R-004 | Hidden card identities leak through snapshots, errors, logs, asset loads, or stable IDs | High / Critical     | Canonical IDs server-only, non-interference tests, request interception, redacted telemetry; any leak blocks rollout. |
| R-005 | Active room loses an acknowledged move on crash                                         | Medium / Critical   | Atomic durable event+dedupe before publish/result; boundary fault tests.                                              |
| R-006 | Event/schema evolution makes old rooms/replays unreadable                               | Medium / High       | Separate explicit versions, pure migrations, fixture per hop, checkpoint/hash verification.                           |
| R-007 | Legacy import recreates old arbitrary function dispatch or partial application          | Medium / Critical   | Frozen allowlist interpreter, bounded input, temporary result, invariant validation, atomic install.                  |
| R-008 | MagicCircle code is copied with wrong assumptions/complexity                            | Medium / High       | Reuse patterns only; PTCG-owned contracts; reject shared broadcast, continuous loop, giant manager/engine.            |
| R-009 | Texture/heap/listener resources grow over long sessions                                 | High / High         | Leases, byte LRU, lifecycle counters, 100-cycle churn and 24h soak gates.                                             |
| R-010 | Full projected snapshots exceed bandwidth/latency budgets                               | Low–Medium / Medium | Deduplicate definitions, measure compression/payloads; add per-recipient patches only behind tests if needed.         |
| R-011 | Durable Object/hosting cost or tooling blocks maintainers                               | Medium / Medium     | Runtime spike, adapter boundary, cost/load model, Colyseus fallback.                                                  |
| R-012 | Parallel contributors create schema drift and merge conflicts                           | High / Medium       | Single schema/integrator owner, isolated audit reports, requirement IDs, small vertical PRs.                          |
| R-013 | External image provider/proxy outage breaks play                                        | High / Medium       | Controlled cache, placeholders, timeouts, no logical dependence, provider outage runbook.                             |
| R-014 | Image proxy enables SSRF, oversized decode, tracking, or unsafe SVG                     | Medium / Critical   | HTTPS allowlist/validated redirects, private-network blocking, MIME/byte/dimension/time limits, no SVG, rate limits.  |
| R-015 | Authorization blocks legitimate manual opponent interactions                            | Medium / High       | Characterize permission matrix by role/zone/action; authority validates capability not card rules.                    |
| R-016 | Optimistic client becomes a second reducer and diverges                                 | Medium / High       | Pending presentation overlay only; no prediction for random/hidden/bulk; snapshot reconciliation tests.               |
| R-017 | Deployment mixes v1/v2 clients in one room                                              | Medium / Critical   | Namespaced protocol generation, admission rejection, sticky session cohort.                                           |
| R-018 | Contributor complexity rises despite better architecture                                | Medium / High       | Small public packages, examples/readmes, no giant ECS/store/manager, architecture lint and onboarding test.           |

Each risk receives a named person, current status, evidence link, review date, and
residual rating before Phase 1 starts.

## Stop/change conditions

- Stop production implementation if the command/action catalog or visibility
  matrix has unresolved semantic holes affecting the current slice.
- Select React DOM if Pixi misses parity/resource/recovery gates or cannot support
  promised custom images safely.
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
