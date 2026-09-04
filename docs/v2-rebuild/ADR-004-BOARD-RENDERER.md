# ADR-004: select normalized React DOM for the board

- Status: **ACCEPTED**
- Decision date: 2026-09-03
- Scope: the first production v2 board renderer
- Production wiring: not yet enabled

## Context

PTCG Sim needs new internals without a UI or UX redesign. The v1 board is hard
to maintain primarily because logical state, DOM identity, array position,
network actions, and presentation behavior are coupled. Replacing the drawing
technology does not by itself remove that coupling.

The rebuild now has a renderer-neutral immutable `BoardScene`, semantic intent
boundary, headless live/replay session runtime, and two working candidates:

1. stable-keyed React DOM/CSS; and
2. raw imperative PixiJS v8 behind the same `BoardRenderer` contract.

The agreed decision rule was intentionally asymmetric: Pixi must pass every
parity/reliability gate and demonstrate a material win on a measured product
bottleneck. Otherwise the lower-risk DOM candidate wins.

## Decision

Use normalized, stable-keyed React DOM/CSS as the first production v2 board
renderer. React also continues to own the unchanged application chrome,
dialogs, menus, zone browsers, chat, settings, deck tools, focus, and live
announcements.

Keep `BoardRenderer` and `BoardSessionRuntime` renderer-neutral. Retain the raw
Pixi candidate as a non-production experiment and regression oracle; do not
wire it into a player route or expand it into a second production engine.

This selects a rendering implementation, not a state architecture. Canonical
game state remains in the deterministic core/authority, recipient-safe state in
the session projection, and transient interaction in presentation state. DOM
nodes never become logical state.

### Mixed attachment history policy

Do not add legacy DOM-reflow provenance or per-card pixel offsets to
`MatchState`, saved matches, or the wire projection. A refreshed ordinary
`[Energy, Trainer]` stack and a no-refresh `leaveAll` restoration can expose the
same recipient-safe cards, order, categories, slot, and markers while retaining
slightly different v1 integer-compaction offsets. Revision, definition
category, stack ID, and current slot cannot recover that history after
checkpoint compaction or reconnect, and an ordering-version enum alone would
not describe it.

Treat those subpixel, history-dependent offsets as a v1 rendering defect. The
strict mixed path derives one deterministic canonical settled layout only from
the current recipient-safe view and remains within the existing 2 CSS px
source-parity envelope for every included history. It preserves logical order,
Tool rotation, z order, and native hit behavior, and fails closed to the generic
path for every uncharacterized shape.

The enabled boundary is exactly one known, same-owner, face-up Pokémon base
with current-category attachments `[Energy, Trainer]`, all unrotated and
marker-free, at the default 1600×900 DPR-1 sidebar layout. It admits the sole
active stack, that active stack with one clean base-only bench control, or the
sole bench stack with one clean base-only active control. Definition category,
name, image URL, revision, and prior DOM history do not select the path. Reverse
attachment order, broader benches, extra/evolution attachments,
bases whose current projected category is not Pokémon, alternate layouts, and
transient wrappers remain generic or source-only. Original category history is
not projected and cannot select geometry. Nonstandard-intrinsic asset parity
remains unclaimed; asset metadata cannot select geometry.

The source comparison covers the settled sole-bench and returned-active phases
on both physical sides after a seeded reverse-history round trip. React DOM
matches pre-transform and painted boxes, Tool quarter turns, z order, and four
native hit regions within the declared tolerances. Pixi tests prove that the
same shared scene descriptors update stable sprites without texture churn; they
do not claim native Pixi paint/hit or arbitrary-URL parity. A real
owner/opponent/spectator session also proves recipient-specific aliases,
cross-view normalized geometry, and alias stability through movement and a
category cycle without exposing canonical card or definition IDs.

### Canonical active-q0 marker policy

Do not infer rotated or history-dependent marker placement from pristine
geometry. The strict marker branch accepts only one known same-owner face-up
Pokémon in the sole unrotated active stack, no bench/evolution/attachments, at
the default 1600×900 DPR-1 sidebar/even/unflipped layout, with at least one
stack marker and no per-card ability marker. It derives the base from the
public 63:88 ratio and emits explicit local/opponent q0 circle/tab descriptors.
Every other shape keeps the generic renderer path.

React DOM matches source geometry within 2 px anchors / 1% sizes; palette and
empty ability text are exact, typography remains proportional, and marker z is
exactly card z plus one. It remains non-interactive until the shared editor
lifecycle exists. Marker IDs participate in scene diffs; Pixi
reuses keyed views without card texture churn but has no native paint/hit claim.
A real owner/opponent/spectator path proves stable distinct aliases, identical
normalized marker geometry, and no canonical card/definition leakage. The
source's q1/q2/q3/q0-return history, wrapper-margin drift, direct editing and
hit behavior remain evidence rather than production state. Because no DOM
history is projected, an eligible returned-q0 current state receives the same
canonical geometry; only the pristine source phase is used for browser parity.

## Evidence

### Product and platform fit

| Concern                                             | React DOM                                         | Raw PixiJS                                                | Result |
| --------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------- | ------ |
| Existing visual geometry and CSS                    | Directly preserves the current medium             | Requires recreation and screenshot matching               | DOM    |
| Cards and external images                           | Native `<img>` display and browser lifecycle      | WebGL textures add CORS, decode, cache, and GPU ownership | DOM    |
| Menus, scrolling, inputs, focus, and screen readers | Native platform behavior                          | Requires coordinated DOM overlays                         | DOM    |
| Stable card identity and drag state                 | Proven with keyed nodes and the shared controller | Proven with stable sprites and the shared controller      | Tie    |
| Continuous rendering while idle                     | Zero commits after settling                       | Zero renders after settling                               | Tie    |
| GPU/context failure surface                         | None for ordinary board composition               | Requires startup failure and bounded context recovery     | DOM    |
| Synthetic 120-card reconciliation                   | Within the provisional full-scene budget          | Lower observed latency                                    | Pixi   |
| Initial implementation/bundle complexity            | One UI technology; small adapter                  | Additional engine and lazy implementation chunks          | DOM    |

PixiJS's current documentation identifies WebGL as the recommended stable
renderer, WebGPU as experimental, and its Canvas renderer as not yet available.
Its accessibility support is explicitly opt-in and implemented by positioning
DOM elements over the canvas. Its `Assets` API is a global URL cache with
explicit unload responsibilities. These are reasonable tradeoffs for a
graphics-heavy game, but they duplicate browser facilities that this discrete
tabletop already needs for unchanged UI parity.

Primary references:

- [PixiJS renderers](https://pixijs.com/8.x/guides/components/renderers)
- [PixiJS accessibility](https://pixijs.com/8.x/guides/components/accessibility)
- [PixiJS assets](https://pixijs.com/8.x/guides/components/assets)
- [PixiJS texture lifecycle](https://pixijs.com/8.x/guides/components/textures)
- [PixiJS garbage collection](https://pixijs.com/8.x/guides/concepts/garbage-collection)
- [React external-store subscription](https://react.dev/reference/react/useSyncExternalStore)

### Repository evidence

Both candidates mount the same immutable 61-card fixture, preserve semantic
click and pointer-captured drag/drop behavior, and survive repeated candidate
switching in real Chromium. Pixi additionally reconstructs after a real
`WEBGL_lose_context` event. Native browser coverage characterizes mouse, touch,
secondary-button filtering, and the exact rapid-click preview boundary. A
center-rotated fixture also proves that native selection and shared drag/drop
follow the painted footprint in both candidates; this exposed and removed a
Pixi explicit-hit-area coordinate mismatch.

The controlled automation also installs the same 120-card, 17-zone, 4-marker
scene into each candidate after five paired warmups, records 25 paired
single-card and full-scene samples, waits for an observed successful commit,
and verifies:

- all 120 recipient-safe card aliases are rendered;
- pending texture loads and texture failure counters settle to zero; and
- five idle animation frames create zero additional commits.

One local Chromium 151 / SwiftShader / 1280×720 / DPR 1 observation produced:

| Candidate  | Single update p50/p95 wall-to-commit | Full update p50/p95 wall-to-commit |
| ---------- | -----------------------------------: | ---------------------------------: |
| React DOM  |                         1.5 / 4.2 ms |                      3.7 / 10.8 ms |
| Raw PixiJS |                         1.6 / 2.4 ms |                       1.6 / 2.4 ms |

Those values are diagnostic evidence, not portable release claims: SwiftShader
is not the ratified physical-GPU profile, the 120 cards reuse fixture artwork
rather than 120 distinct decoded images, and browser wall-to-commit time is not
the same as isolated CPU reconciliation time. Pixi is faster in the synthetic
full update, but React DOM remains comfortably inside the provisional 50 ms
full-scene budget. No characterized v1 workflow has established rendering as
the user-visible bottleneck, while state coupling, authority, reconnect,
privacy, and replay defects are already addressed below the renderer.

The DOM candidate also retains native double-click ordering, arbitrary image
display, and semantic button behavior without a second overlay tree. The Pixi
spike required explicit texture leases, unload-failure accounting, touch event
normalization, primary-button filtering, context-loss listeners, and terminal
recovery diagnostics merely to reach the current shared baseline.

## Consequences

- Production board work proceeds in `renderer-dom`; `renderer-pixi` remains
  unwired and must not become an implicit fallback.
- Stable keyed/memoized nodes, pure layout, and the shared drag controller are
  the optimization path. React component state does not absorb game state.
- DOM overlays no longer need cross-surface coordinate arbitration for the
  first release.
- Card/image compatibility does not depend on WebGL texture eligibility.
- MagicCircle's renderer-host and recovery patterns remain useful evidence, but
  its Pixi scene engine is not copied into the production board. Its authority,
  session, durability, and operational patterns remain independently reusable.
- The Pixi package stays tested because it validates the neutrality of the
  contract and provides a ready comparison if a real bottleneck appears.

## Remaining release gates

Acceptance of this ADR does not enable the v2 route. React DOM must still pass:

- source-pinned v1 screenshot and structured geometry parity at the declared
  viewports, split ratios, flip states, themes, and fullscreen mode (the current
  Chromium checkpoint covers all 16 default player-region border/content boxes,
  structural frame/handle/control anchors, all six contained pile covers, and
  the bottom-owner stadium; the source also measures the top-owner stadium but
  that candidate branch is unit-only. Separate strict gates match all 12
  local/opponent active/bench ordinary-evolution boxes and the four-card
  local/opponent one-Energy and Trainer-as-Tool active fixtures plus all six
  stable local/opponent two-Energy boxes at the default 1600×900 DPR-1 sidebar,
  even-split, unflipped state. Tool coverage separates pre-transform and painted
  quarter-turn bounds; the two-Energy path verifies canonical inner/outer z and
  native hit order. Separate mixed Energy/Trainer captures cover both ingress
  orders, both single-attachment departures, reversed and four-card interleaved
  `leaveAll`, a staged deck-top swap, current-category cycles, and active ↔ sole
  bench movement on both sides. Only the exact canonical settled
  one-Energy/one-Trainer shape and characterized placements feed the strict
  renderer helper and React candidate comparison; reorder, compaction, stale-
  margin, ghost-wrapper, broader restore, and departure phases remain
  source-only. These paths do not yet claim alternate layout states,
  three-plus or unsupported attachment geometry, transition animation or
  transient departure DOM, rotated/history-dependent markers, marker editing,
  production BREAK/compound rotation (the split source history is pinned but
  proves projected state insufficient), overflow,
  Tool-specific Pixi paint parity, full paint or interaction parity, cover-open
  UX, or opened-zone layout, and the sidebar content rectangle is derived from
  measured shell/tab edges);
- all protected pointer, keyboard, menu, zone-browser, replay, reconnect, and
  accessibility workflows;
- a 120-distinct-asset cache/network test and hidden-image request scan;
- finish resource evidence beyond the current green 100-cycle warmed-host
  Chromium DOM-node/listener gate: route-host churn, request accounting, and
  retained heap on the ratified profile;
- the ratified physical-device/browser performance matrix; and
- Chromium automation plus Firefox and Safari approval.

Pixi-only WebGL recovery and GPU-texture gates are no longer blockers for the
first production renderer, but remain required before any future Pixi rollout.

## Revisit triggers

Reopen this ADR only when a protected, representative workflow misses its
ratified latency budget after profiling and normal DOM optimizations, or when a
new board feature has a demonstrated graphics requirement that DOM cannot meet.
Any reconsideration must reuse the same scene/intent contract, compare against
the current DOM implementation, pass the complete UI/accessibility/image and
recovery matrix, and show a material end-user improvement on physical target
hardware.

## Migration and rollback

The choice is additive and still unwired. Migrate one complete v2 session route
behind its feature flag after parity gates pass; never replace pieces of a live
v1 match. Rollback directs new sessions to v1. Because session/core/protocol
state is renderer-neutral, this ADR can be revisited without migrating saved
matches or changing the wire protocol.
