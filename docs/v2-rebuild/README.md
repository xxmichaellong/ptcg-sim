# PTCG Sim v2 rebuild blueprint

- Status: **approved implementation in progress on the isolated v2 feature branch**
- Last updated: 2026-09-04
- Primary objective: replace the internals while preserving the current UI and UX.

This directory is the implementation contract for the PTCG Sim v2 rebuild.
Isolated implementation and characterization are authorized on the draft feature
branch. Production routing, user-facing migration, and rollout remain blocked on
the relevant product decisions and phase exit criteria.

## Recommended target

- A React + TypeScript application shell for the existing side panels, dialogs,
  menus, settings, chat, and deck tooling.
- A renderer-neutral two-sided tabletop with normalized stable-keyed React DOM
  selected for the first production renderer by ADR-004. The hardened raw
  PixiJS spike remains unwired as contract and regression evidence.
- A framework-independent, strict TypeScript game core containing normalized
  state, commands, reducers, invariants, visibility projections, and replay.
- An authoritative room server. The preferred deployment is a Cloudflare Worker
  with one Durable Object per room; Colyseus remains the documented fallback if
  its operational model is a better fit after the spike.
- Per-recipient state projections so private hands, deck identities/order, and
  private looks never reach unauthorized clients.
- A bounded authoritative replay ledger, session-bound streamed projected
  replay, renderer-neutral deterministic playback, and an application
  coordinator/board binding that never rewinds or submits through the live
  session. A headless legacy-chrome shell and generation-safe presentation
  pipeline now map live or replay facts into isolated activity,
  accessibility, and animation effects. Bounded narrow-channel stores preserve
  live history, rebuild replay history on seek, and cancel stale one-shot work.
  Recipient-safe activity facts preserve trusted actor, card-versus-zone scope,
  semantic source, and only spectator-public single-reveal names, restoring the
  legacy reveal/hide/look wording without exposing canonical or private card
  data.
  Renderer-neutral consumers project keyed feed rows and serialize polite
  announcements and cancellable animation work. A route-scoped legacy
  presentation owner and tested React surface now preserve `#chatbox` colors,
  scrolling, replay replacement, and an off-screen live region. The legacy coin
  action is log-only, so its resolved animation request is drained without new
  motion. An externally owned remote-room runtime now composes the real session,
  replay, presentation, effective board, legacy multiplayer/replay feed IDs,
  replay controls, and Exit path behind a lazy application branch. It requires a
  trusted in-memory connection handoff. ADR-018 now supplies that handoff through
  a bounded same-origin no-store POST: authority stores only a short-lived
  role/name-bound ticket digest, atomically consumes it into a fresh resume
  capability, and the browser passes only the runtime/route descriptor to React.
  Room creation is also a strict bounded same-origin no-store exchange. The
  creator is bootstrapped immediately while the other master credentials remain
  in a non-serializing in-memory custodian. That custodian now mints bounded,
  expiring, one-use player or spectator claims; an untrusted guest handoff is
  validated and exchanged through the existing short-lived ticket boundary.
  Durable schema v6 stores only invitation digests and atomically consumes the
  invitation with its final ticket. Creation now atomically schedules a
  five-minute unclaimed-room alarm, first admission cancels it, retry-safe
  tombstones prevent resurrection, and layered edge/per-room budgets bound
  creation, credential exchange, socket allocation, and repeated `Hello`
  attempts. A public no-store health probe and closed versioned telemetry union
  now expose safe HTTP/lifecycle/rate/admission/command/socket facts with random
  non-authority correlations; field-by-field construction excludes payloads,
  identifiers, credentials, user/card data, URLs, and thrown errors. A
  development-only creator route now exercises that full stack behind Vite; a
  20-cycle StrictMode integration gate proves one creation and exact ownership
  teardown per mount, while production bundle provenance rejects the entire dev
  module. A separate Chromium gate starts local Wrangler and Vite and proves the
  live creation → ticket → WebSocket → projected DOM board path, safe transport
  URLs, a bidirectional response, and clean closure. Visible create/join wiring
  waits on ADR-020's decision about how the handoff moves between browsers;
  normal sidebar/chat/navigation and downloadable/export formats remain later
  parity work.
- A strangler migration: v1 stays available while v2 reaches parity behind a
  route/feature flag. There is no in-place big-bang rewrite.

The server is authoritative about tabletop integrity, access, ordering,
randomness, and visibility. It is **not** a Pokémon rules engine. PTCG Sim remains
a manual tabletop simulator.

## Non-negotiable constraints

1. No intentional UI or UX redesign is part of this project.
2. Logical state must never be stored in the DOM, Pixi display objects, or React
   component state.
3. Every card instance has a stable identity independent of its array position.
4. The reducer is deterministic and has no browser, renderer, network, clock, or
   random-number dependencies.
5. Multiplayer commands are authenticated, validated, ordered, idempotent, and
   applied by the server before acceptance.
6. A client only receives the state it is allowed to know.
7. Reconnect uses an authoritative snapshot, not replay of an unbounded client
   action array.
8. The legacy runtime is frozen except for security fixes, characterization
   hooks, and changes required to keep the migration viable.
9. Every phase has measurable entry and exit gates and a rollback path.
10. No v1 runtime module may be imported into v2 production code. Compatibility
    is isolated in adapters and fixtures.

## Documents

| Document                                                                               | Purpose                                                                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [01-current-system-and-parity-contract.md](./01-current-system-and-parity-contract.md) | Current architecture, known hazards, and the UI/UX compatibility contract                                    |
| [02-target-architecture.md](./02-target-architecture.md)                               | Package boundaries, runtime data flow, technology choices, and dependency rules                              |
| [03-domain-network-and-persistence.md](./03-domain-network-and-persistence.md)         | Canonical state, commands, invariants, hidden information, room protocol, persistence, replay, and security  |
| [04-client-renderer-and-parity.md](./04-client-renderer-and-parity.md)                 | React/Pixi boundary, renderer systems, input, assets, accessibility, and visual parity                       |
| [05-migration-and-delivery-plan.md](./05-migration-and-delivery-plan.md)               | Incremental phases, prerequisites, artifacts, exit gates, rollout, and rollback                              |
| [06-verification-and-success-criteria.md](./06-verification-and-success-criteria.md)   | Test pyramid, failure injection, performance budgets, and release gates                                      |
| [07-file-map-and-workstreams.md](./07-file-map-and-workstreams.md)                     | Current-to-target file mapping, work ownership, and dependency order                                         |
| [08-decisions-risks-and-alternatives.md](./08-decisions-risks-and-alternatives.md)     | Decisions, alternatives, open questions, risk register, and stop conditions                                  |
| [REQUIREMENTS.md](./REQUIREMENTS.md)                                                   | Stable requirement IDs and blueprint-level traceability                                                      |
| [LEGACY_ACTION_MAP.md](./LEGACY_ACTION_MAP.md)                                         | Preliminary mapping of all 50 synchronized v1 actions into v2 responsibilities                               |
| [MAGICCIRCLE_REUSE.md](./MAGICCIRCLE_REUSE.md)                                         | Exact reuse/adaptation boundary for the local MagicCircle client, Pixi, and room patterns                    |
| [RENDERER_SPIKE.md](./RENDERER_SPIKE.md)                                               | Live DOM/Pixi implementation evidence, research, current result, and remaining decision gates                |
| [ADR-004-BOARD-RENDERER.md](./ADR-004-BOARD-RENDERER.md)                               | Accepted first-production renderer decision, evidence, consequences, and revisit triggers                    |
| [SERVER_PERFORMANCE_BASELINE.md](./SERVER_PERFORMANCE_BASELINE.md)                     | Reproducible `workerd` payload/resource gate, named local timing observation, and remaining preview evidence |
| [PUBLIC_API_SURFACE.json](./PUBLIC_API_SURFACE.json)                                   | Compiler-resolved reviewed workspace entrypoints and exported symbol/type-value kinds                        |
| [QUALITY_GATES.md](./QUALITY_GATES.md)                                                 | Canonical local/CI commands, enforced architecture and asset boundaries, and explicit residual gaps          |
| [AUDIT.md](./AUDIT.md)                                                                 | Multi-agent review process, change protocol, and audit checklists                                            |

## How to read and approve this blueprint

Reviewers should start with this page and the parity contract, then review only
the concern they own. Findings are recorded using the format in `AUDIT.md`.
Changes that affect multiple documents require a decision-record entry and links
to each affected section.

The first three-lane review and its dispositions are recorded in
[`reviews/2026-08-31-initial-parallel-audit.md`](./reviews/2026-08-31-initial-parallel-audit.md).

The following remain release gates even though the owner has authorized
incremental implementation behind the isolated v2 route and draft PR:

- every item marked `BLOCKING` has an owner and accepted resolution;
- the current behavior inventory and visual baselines exist;
- the state schema, command envelope, visibility rules, and persistence format
  have no unresolved semantic gaps;
- the renderer and backend spikes pass their defined gates;
- migration, rollback, and v1 compatibility fixtures are demonstrated; and
- the project owner explicitly approves Phase 1.

## Definitions

- **Canonical state**: complete server-owned match state, including secrets.
- **View state**: a role-specific projection safe to send to one connection.
- **Command**: a validated request to change canonical state.
- **Domain event**: an accepted fact used for audit, replay, messages, and
  presentation; it is not the source of truth on the client.
- **Presentation state**: selection, hover, drag preview, open menus, animation,
  and other local-only UI state.
- **Parity**: the current feature remains discoverable and behaves the same to a
  user, within documented rendering tolerances.
- **Legacy import**: one-way conversion of a v1 save/action stream into v2 state.
