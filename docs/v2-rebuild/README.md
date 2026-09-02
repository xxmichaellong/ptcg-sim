# PTCG Sim v2 rebuild blueprint

- Status: **approved implementation in progress on the isolated v2 feature branch**
- Last updated: 2026-09-02
- Primary objective: replace the internals while preserving the current UI and UX.

This directory is the implementation contract for the PTCG Sim v2 rebuild. The
project should not begin production implementation until the blocking decisions
and Phase 0 exit criteria are accepted.

## Recommended target

- A React + TypeScript application shell for the existing side panels, dialogs,
  menus, settings, chat, and deck tooling.
- A renderer-neutral two-sided tabletop with raw imperative PixiJS as the
  provisional target. React owns the host; a representative React DOM renderer
  must lose the Phase 4 parity/performance spike before Pixi is locked in.
- A framework-independent, strict TypeScript game core containing normalized
  state, commands, reducers, invariants, visibility projections, and replay.
- An authoritative room server. The preferred deployment is a Cloudflare Worker
  with one Durable Object per room; Colyseus remains the documented fallback if
  its operational model is a better fit after the spike.
- Per-recipient state projections so private hands, deck identities/order, and
  private looks never reach unauthorized clients.
- A bounded authoritative replay ledger, session-bound streamed projected
  replay, renderer-neutral deterministic playback, and an application
  coordinator that never rewinds the live session; replay UI and
  downloadable/export formats remain later parity work.
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

| Document                                                                               | Purpose                                                                                                     |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [01-current-system-and-parity-contract.md](./01-current-system-and-parity-contract.md) | Current architecture, known hazards, and the UI/UX compatibility contract                                   |
| [02-target-architecture.md](./02-target-architecture.md)                               | Package boundaries, runtime data flow, technology choices, and dependency rules                             |
| [03-domain-network-and-persistence.md](./03-domain-network-and-persistence.md)         | Canonical state, commands, invariants, hidden information, room protocol, persistence, replay, and security |
| [04-client-renderer-and-parity.md](./04-client-renderer-and-parity.md)                 | React/Pixi boundary, renderer systems, input, assets, accessibility, and visual parity                      |
| [05-migration-and-delivery-plan.md](./05-migration-and-delivery-plan.md)               | Incremental phases, prerequisites, artifacts, exit gates, rollout, and rollback                             |
| [06-verification-and-success-criteria.md](./06-verification-and-success-criteria.md)   | Test pyramid, failure injection, performance budgets, and release gates                                     |
| [07-file-map-and-workstreams.md](./07-file-map-and-workstreams.md)                     | Current-to-target file mapping, work ownership, and dependency order                                        |
| [08-decisions-risks-and-alternatives.md](./08-decisions-risks-and-alternatives.md)     | Decisions, alternatives, open questions, risk register, and stop conditions                                 |
| [REQUIREMENTS.md](./REQUIREMENTS.md)                                                   | Stable requirement IDs and blueprint-level traceability                                                     |
| [LEGACY_ACTION_MAP.md](./LEGACY_ACTION_MAP.md)                                         | Preliminary mapping of all 50 synchronized v1 actions into v2 responsibilities                              |
| [MAGICCIRCLE_REUSE.md](./MAGICCIRCLE_REUSE.md)                                         | Exact reuse/adaptation boundary for the local MagicCircle client, Pixi, and room patterns                   |
| [RENDERER_SPIKE.md](./RENDERER_SPIKE.md)                                               | Live DOM/Pixi implementation evidence, research, current result, and remaining decision gates               |
| [AUDIT.md](./AUDIT.md)                                                                 | Multi-agent review process, change protocol, and audit checklists                                           |

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
