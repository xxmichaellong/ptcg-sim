# MagicCircle reuse plan

## Conclusion

MagicCircle contains useful battle-tested patterns for a React/Pixi client and a
Cloudflare room service, but its game assumptions are materially different.
PTCG Sim should reuse knowledge and narrowly extracted infrastructure only after
PTCG-owned contracts and tests exist. It must not depend directly on MagicCircle
terminal application source or fork its large Quinoa/room classes.

The project owner explicitly authorized direct MagicCircle implementation reuse
on 2026-08-31 (ADR-019). Preserve provenance and any required notices when code
is copied; still extract only the smallest PTCG-owned unit whose dependencies and
failure behavior are covered by this repository's contracts.

## Client and renderer candidates

| MagicCircle source                                                 | Useful pattern                                                                                               | PTCG adaptation                                                                              | Do not copy                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `client/src/games/Quinoa/components/QuinoaCanvas/QuinoaCanvas.tsx` | React owns an imperative engine mount/lifecycle                                                              | A small `BoardViewport` hosts the selected renderer behind an abortable idempotent lifecycle | Quinoa game/store/config coupling                                             |
| `.../QuinoaCanvas/pixi/PixiAppHost.ts`                             | Generation-safe async initialization, startup failure, context loss/rebuild, bounded retry and deep teardown | Extract behavior into PTCG adapter tests, including StrictMode and stale asset completion    | Quinoa ticker/asset/game dependencies or unreviewed texture ownership         |
| `.../QuinoaCanvas/ResizeTracker.ts`                                | Observe actual host, coalesce and flush resize work                                                          | Track board host, sidebar/fullscreen and split handles; preserve flip semantics              | Assumed world/camera geometry                                                 |
| `.../QuinoaCanvas/utils/capturePointerDrag.ts`                     | Window/pointer capture, renderer coordinate conversion, pointer-cancel/blur/visibility safety                | Stable view-ID drag intents and DOM-overlay boundary handling                                | Movement/network streams                                                      |
| `.../QuinoaCanvas/QuinoaEngine.ts`                                 | Explicit lifecycle and scene/system organization as lessons                                                  | Several small PTCG systems with narrow ownership                                             | The ~2k-line engine, continuous update loop, ECS/world/camera/tile/Rive logic |

PTCG's board is discrete and usually idle. It needs invalidation rendering, not
Quinoa's permanent simulation ticker. Most PTCG overlays stay in React DOM to
retain scrolling, inputs, accessibility, arbitrary images, and exact parity.

## Connection candidates

### `client/src/connection/RoomConnection.ts`

Reuse as design evidence for:

- welcome/full snapshot lifecycle;
- heartbeat and connection visibility behavior;
- reconnect/supersession state;
- command request IDs/sequences/frontiers; and
- accepted state publication before success result.

PTCG must redesign:

- the class is coupled to MagicCircle stores, audio, native shells, config, and
  several protocols; do not subclass or import it;
- validate **incoming server messages at runtime** rather than parse-and-cast;
- use an immediate-first exponential reconnect backoff with jitter and a bounded
  attempt/terminal UI policy;
- persist/bound the pending outbox and reconcile it with the server's durable
  executed frontier;
- install full recipient-specific view snapshots first instead of a single
  room-wide patch baseline; and
- purge role/session-private definitions/textures/presentation when switching
  rooms or roles.

The target is a small PTCG `ReliableRoomConnection` implementing
`GameSessionPort`, not a general multi-game connection framework.

MagicCircle's visible room-code travel is not a drop-in anonymous invitation
design. Its room connection is bound to authenticated user identity (including
JWT-backed admission), so a shareable room code can remain discovery rather than
seat authority. PTCG Sim currently promises account-free named guests. ADR-020
must therefore choose how the implemented high-entropy, expiring, one-use
invitation handoff is presented and moved between browsers; copying
MagicCircle's code-only navigation would silently restore v1's room-ID
authorization flaw.

## Server candidates

| MagicCircle source                                          | Useful pattern                                                             | Required PTCG change                                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/clientMessages.ts`                              | Bounded envelope-first ingress and schema validation concepts              | PTCG command/role/payload limits; rate-limit before expensive deep validation; redacted errors/logs                              |
| `server/src/games/Room/ClientCommandSession.ts`             | Command sequence/frontier and duplicate reasoning                          | Persist per-seat/session outcomes across reconnect, hibernation and authority restart; do not scope only to a live socket        |
| `server/src/games/Room/RoomManager.ts`                      | Serialized room ownership and state-publication-before-result ordering     | PTCG-specific small command queue; durable event+dedupe commit before publication; independent projection/baseline per recipient |
| `server/src/RoomDurableObject.ts`                           | Worker/DO lifecycle, admission/upgrade and room-bound authority experience | Small `MatchRoom`; explicitly test async interleaving, alarms/expiry and WebSocket hibernation restoration                       |
| `common/types/messages.ts`, `common/games/Room/messages.ts` | Isomorphic discriminated message/schema organization                       | PTCG protocol types and Valibot schemas with separate wire/state/event/export versions                                           |

MagicCircle's standard `server.accept()` socket path is a conceptual reference,
not proof of the planned Durable Object WebSocket Hibernation behavior. The PTCG
spike must demonstrate its own attachment restoration, room-state recovery,
projection identity regeneration, alarms, and close/reconnect semantics.

## Critical differences

### Hidden information

MagicCircle's common room-state JSON Patch broadcast cannot be reused for PTCG.
PTCG must compute a separate `GameViewState` and definition catalog for every
viewer. Every future patch optimization would need a distinct baseline per
connection, a leak-tested projector, and full-snapshot recovery.

### Durability

Do not inherit write-behind acceptance. PTCG persists the resolved event batch,
revision, command outcome, and session frontier atomically before publishing
state or success. A tabletop action is low-frequency and highly visible; a
crash-loss window provides little benefit and large trust cost.

### Game loop and prediction

Do not reuse movement streaming, server clock, prediction fences, continuous room
ticks, animation simulation, or world-camera logic. PTCG sends one command on
drop and reconciles a small pending presentation overlay to a snapshot.

### State management

Do not clone a large room tree into a broad atom graph. PTCG keeps one immutable
recipient view, bounded pending records, and local presentation, with narrow
selectors. The renderer maintains view objects only.

### Platform/account infrastructure

Do not bring in account checkout, release affinity, router, Neon/Prisma,
native-shell, analytics, audio, or multi-game infrastructure unless a later
product requirement independently justifies it.

## Safe extraction procedure

For each candidate:

1. Write the PTCG public contract, requirements, failure matrix, and tests first.
2. Identify the smallest behavior in the MagicCircle file that satisfies it.
3. Confirm license/ownership and dependencies.
4. Reimplement or extract into a small PTCG-owned adapter with no terminal-app
   deep import.
5. Run PTCG parity/security/durability tests, not only MagicCircle's tests.
6. Record provenance, meaningful deviations, and future upstream-sync policy.
7. Stop extracting when unrelated MagicCircle configuration/types enter the
   dependency graph; duplicate a small general idea instead of coupling apps.

## Reuse acceptance matrix

| Candidate capability                        | Expected disposition         | Required proof                                                               |
| ------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| React imperative host lifecycle             | Adapt                        | 100 mount/destroy cycles, StrictMode, stale init and failure tests           |
| Pixi context recovery/teardown              | Retain in unwired spike      | Context-loss matrix, resource counters, private-texture purge                |
| Resize/pointer capture helpers              | Extract/adapt                | Flip/split/fullscreen and pointercancel/overlay E2E                          |
| Welcome/heartbeat/reconnect concepts        | Reimplement to PTCG contract | Runtime message validation, outbox/frontier, supersession and recovery tests |
| Command sequence/frontier                   | Adapt with durability        | Duplicate/gap/crash/hibernation fault suite                                  |
| Publication-before-result                   | Reuse rule, strengthen       | Durable commit then projected snapshot then result ordering test             |
| Envelope/rate/schema ingress                | Extract/adapt                | Byte/depth/count/fuzz/role/log-redaction tests                               |
| Durable Object room ownership               | Adapt                        | Runtime spike, explicit queue, storage failure, alarm/hibernation recovery   |
| Global JSON Patch broadcast                 | Reject                       | Incompatible with `VIS-*` requirements                                       |
| Quinoa engine/game loop/ECS                 | Reject                       | Unnecessary for a discrete tabletop                                          |
| Quinoa prediction/movement/server clock     | Reject                       | One-command-on-drop model                                                    |
| Giant room manager/connection/store classes | Reject                       | Violates small package/ownership requirements                                |

## Revisit triggers

- If PTCG and MagicCircle need the same independently testable infrastructure in
  three or more places, consider a separately versioned shared package after
  license and release-coupling review.
- If PTCG-specific adaptations exceed the original helper size, reimplement
  locally rather than maintaining a fork with hidden assumptions.
- If MagicCircle changes its room/privacy/durability model, compare behavior
  through contracts and tests; do not automatically sync implementation.
