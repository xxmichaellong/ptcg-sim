# Initial parallel architecture audit

- Blueprint revision: initial 2026-08-31 draft
- Review lanes: domain/network/security; renderer/UI/performance; migration/quality/operations
- Reviewers: three independent repository-audit agents
- Repository evidence: `/home/xxl/ptcg-sim` and local `/home/xxl/magiccircle.gg`
- Overall verdict: **accept with blocking decisions and incorporated changes**

The reviewers made no implementation changes. The canonical blueprint was updated
by the integrator from their evidence.

## Domain, network, and security disposition

Accepted findings:

- The rebuild must replace the state/synchronization model, not only rendering.
- Canonical state, recipient view, and presentation state are separate.
- Client commands use visibility-generation-scoped view IDs; canonical card IDs
  never leave the authority.
- Active/bench play uses explicit stack aggregates, with card ownership separate
  from board placement and work areas for `viewCards`/`attachedCards` behavior.
- The core decides resolved event batches and applies them purely; resolved
  shuffle/random outcomes persist for deterministic replay.
- Per-recipient full snapshots are the initial synchronization unit.
- Event batch, revision, sequence frontier, and idempotency outcome commit before
  publication/success; an explicit queue prevents async room interleaving.
- Current opponent-public-board manipulation requires a permission matrix and
  cannot be blocked accidentally as “anti-cheat.”
- Room code/display name are not authority; seat/resume/socket capabilities are.
- MagicCircle's shared patch broadcaster, live-connection command session, and
  write-behind assumptions cannot be copied unchanged.

Correction made during integration: the original draft allowed a future
multiplayer undo flow inside first-v2 commands. Repository/UI evidence says undo
is currently one-player only, so v2 preserves solo-only undo and treats any
multiplayer version as a separate future product decision.

## Renderer, UI, and performance disposition

Accepted findings:

- React + raw Pixi is viable but must remain provisional until a normalized
  stable-keyed React DOM renderer loses a representative competitive spike.
- The deepest current failures stem from logical state living in DOM/order and
  circular mutations; DOM is not proven intrinsically too slow for ~120 cards.
- Most overlays—zone browsers, menus, preview and counter editor—remain React DOM
  for native scroll/input/accessibility/custom-image parity.
- The parity contract now records current play/sidebar proportions, half-board
  inversion, flip semantics, split handles, full-screen behavior, stack/preview
  double-click, and direct counter editing as characterization targets.
- Asset tests must cover known providers/languages, redirects, arbitrary URLs,
  CORS failure, tracking risk, bad/large content, async role/session races, and
  context recovery.
- The provisional texture budget changed from a single 192 MiB pool to 128 MiB
  board tier plus 16 MiB preview tier, with measured revision allowed.
- Renderer lifecycle must survive StrictMode/stale initialization, 100 teardown
  cycles, context loss, 0×0 host, DPR changes, pointer cancellation, and private
  texture purge.

The selected renderer remains behind a neutral contract. A React DOM result does
not invalidate core, protocol, server, parity fixtures, or migration work.

## Migration, quality, and operations disposition

Accepted findings:

- The strangler boundary is the complete session/room: separate v1/v2 routes,
  protocol generations, room assignment, and sticky rollout cohorts.
- Never mix a live positional/index v1 action stream with stable-ID v2 commands.
  The bridge is bounded transactional one-way data conversion only.
- Existing v1 rooms finish on v1; rollback affects new sessions and does not live
  downgrade v2 rooms.
- Characterization precedes production code and must cover all 50 dispatcher
  actions, keybinds, geometry, workflows, real save/replay shapes, and network
  failure behavior.
- Stable requirement IDs, traceability, isolated review reports, single schema
  ownership, and vertical slices make parallel audit/implementation manageable.
- Correctness, privacy, persistence crash, browser/WebGL, visual geometry,
  performance, resource churn, 100,000-command and 24-hour soak gates are
  release requirements.
- Observability and incident/rollback runbooks precede any multiplayer cohort.

## Consensus findings

All three reviews independently supported:

- strict TypeScript and framework-independent pure core;
- server-authoritative manual-tabletop semantics;
- stable IDs and normalized state;
- independent hidden-information projections;
- full projected snapshots before patch optimization;
- patterns rather than wholesale code reuse from MagicCircle;
- on-demand rather than continuous rendering;
- strangler rollout with legacy converter; and
- implementation blocked until parity/decision/spike gates are accepted.

## Remaining blocking decisions

Tracked in `../08-decisions-risks-and-alternatives.md`:

- Pixi versus React DOM board result;
- Durable Object versus fallback room runtime result;
- external/custom image proxy/fallback/restriction policy;
- multiplayer save/export privacy;
- coaching/private inspection semantics;
- browser/hardware and legacy support windows; and
- ownership/license permission before copying any MagicCircle implementation.

These are deliberate decision gates, not missing implementation TODOs.
