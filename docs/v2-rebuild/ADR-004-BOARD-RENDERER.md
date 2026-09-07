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

The source layout evidence now executes the full v1 runtime for fullscreen and
flipped/asymmetric checkpoints, while the direct CSS matrix includes the
compact viewport. Real DOM handle events cover both normal directions,
flip-time rebinding covers both flipped directions, and double flip/fullscreen
reversal prove cleanup and ownership restoration. The renderer contract owns
the corresponding pure four-branch resize transition, including v1 clamps,
collision arithmetic, edge-handle expansion, and first-event inline fallbacks.
The opt-in board runtime can apply it to either renderer; production routes and
the existing UI remain unchanged. A full-runtime Chromium boundary matrix now
pins the adjacent collision pixels, strict handle-growth edges, normal/flipped
clamps, and expanded-handle history. The React DOM runtime additionally offers
deny-by-default capture-phase pointer ownership over the existing non-painting
handle geometry, with scaled coordinates, upper-handle overlap priority,
flipped physical identity, and deterministic teardown. An isolated Chromium
harness now drives that exact opt-in path with native mouse-generated pointer
events on a scaled surface, covering normal/flipped movement, overlapping-hit
priority, all four clamps, measured DOM refresh, capture isolation, and disposal
during an active gesture. The harness is development-only and no production
route opts in. A follow-up Chromium case now drives actual viewport changes
during and after gestures: stale ownership cancels before route-owned viewport
synchronization, current split/flip state survives, DOM dimensions refresh, and
fresh normal/flipped gestures use the new scale. A route-owned
`LegacyBoardChrome` now follows a failure-isolated immutable-layout subscription
and paints the unchanged source handles, five controls, hover state, and
tooltips without entering the renderer contract. An isolated Chromium gate
compares real-v1 and candidate screenshots at 1280×720 for light, light-hover,
dark, dark-hover, sequential resize, flipped asymmetric resize, and fullscreen.
It allows at most 1,536 of 921,600 pixels in the compositor fringe, with
separate 512-pixel handle and 1,280-pixel control caps plus a 128/255 channel
delta across Chromium builds. It attaches both images plus metrics and proves each non-layout callback is
delegated once. Neither the component nor harness is wired into a production
route; complete control workflows and the broader browser matrix are still exit
gates. The flipped one-pixel source clamp
also retains an explicit caveat: Chromium's nested iframe child layout diverges
from normalized inner-region geometry while the outer resize geometry matches.

The next development-only Chromium gate composes the selected DOM renderer with
the complete runtime/controller/adapter path. Native drags prove exact `no_op`
and `unsupported_source` semantic rejection with zero submissions and cleared
presentation, followed by one legal hand-to-discard `MoveCard` submission.
Native selection, preview, zone-open, and context gestures reach protected
controller state. Route-owned `LegacyBoardOverlays` now projects context,
card/stack preview, and zone-browser DOM from that same safe state. Chromium
pins native keyboard/focus/dismissal, duplicate-card anchoring, light/dark
paint, exact recipient-safe card IDs, and zero command leakage. A real-v1 gate
also matches source-ordered context rows and computed paint plus the full-card
preview shell/image metrics, attaching source/candidate evidence. The renderer
still rejects hidden surface-card input; a distinct controller action admits
only cards belonging to the currently opened safe zone. The module remains
absent from production bundles. Its typed callbacks now traverse the
controller's currently-open target check, ready/live-player policy, pure overlay
resolver, serialized `SubmitCommand` effect, and adapter submit-time recheck.
Complete actions reuse existing safe semantic resolvers. Controller-bound
marker input overlays one temporary React editor on immutable scene output.
Damage and condition submit defaults `10`/`P` only when absent, accept bounded
edit/removal, preserve the live condition palette, retain malformed drafts
locally, and purge on reconnect. Hand replacement/draw and deck draw/inspection
retain the native source prompts behind typed action/card/zone descriptors,
strict complete-integer validation, safe capacity clamping, and quiet
cancellation. Both unchanged nested menus now submit typed choices: category
reuses stale-safe `ChangeCardCategory`, while all five move rows reuse the
existing loose-board or deck-relative movement commands. The route-owned keymap
now binds characterized marker/category/visibility key/code and Alt combinations
to the selected stable card, rechecks that selection in the controller, and
reuses the same bounded semantic resolvers while suppressing editable targets.
`C` toggles one card inspection without collapsing a multi-card zone grant;
`Z` and Alt-`Z` carry explicit public hide/reveal targets. These gestures retain
selection, and known-without-grant or duplicate states remain no-ops. Four
non-Alt deck-relative keys reuse the already-approved top, bottom, top-swap,
and shuffle commands and dismiss accepted selection. The source's `S` key
falls through into a redundant second whole-deck shuffle after deselection;
the protected path deliberately emits one atomic shuffle. `H`, `D`, `L`, and
Space reuse one per-card hand/discard/lost-zone/loose-board resolver shared with
the existing context-menu board move; non-Alt `P` reuses the same resolver for
the current board-side prizes, while Alt-`P` retains category behavior.
Accepted requests dismiss selection and retain exact source and work-area
preconditions. Prize entry uses the existing concealed-zone event semantics to
rotate visibility identity and expose fresh distinct opaque aliases to each
recipient. `A`/`B` delegate to a closed
active/bench placement resolver using existing zone-to-play, whole-stack, or
staged-restore commands; v1 incumbent-active displacement stays one atomic v2
transition. `G` now delegates to an atomic singleton stadium resolver. The wire
pins both source and recipient-opaque incumbent-or-null state, authority derives
canonical ownership, and one domain batch discards the incumbent to its
immutable owner's discard before installing the selected card. The deck,
generic-zone, and stadium paths share one view-card source locator; stale,
lower-evolution, foreign-work-area, malformed-stadium, and same-stadium paths
fail closed.
The board-wide Enter/Alt-Enter/Slash family now also crosses the same protected
document bridge without a selected card. It derives the viewer-owned board and
ordered aliases from the installed projection, then reuses the existing
`ResolveLooseBoardCards` discard, hand, or shuffle destination. Editable and
read-only input remains silent and the request cannot nominate another player.
The unselected digit/`S` deck family likewise derives the viewer's deck and
uses the existing draw, private inspection, and shuffle commands. Counts remain
bounded to one digit and clamp to the current projection. Selected-card routing
retains precedence, while Alt-Control-digit is intentionally silent instead of
reproducing v1's dual-branch, unlogged second mutation and DOM exception.
Non-Alt `F` also crosses the global bridge as a payload-free `FlipCoin`
request, independent of card selection. The selected card stays selected;
Alt-`F` stays reserved for the separate renderer-local board-flip path.
Authority derives the actor and random result, while replay, spectator,
stale-viewer, overlay, and editable boundaries remain silent or fail closed
before submission.
The bridge now distinguishes those always-global actions from unselected-only
deck/lifecycle actions. Alt-`N`, Alt-`R`, and Alt-`T` carry no seat identity and
reuse the existing viewer-derived setup/reset/start-turn resolvers. Selected
keys cannot fall into lifecycle routing. V2 intentionally rejects all three in
replay, fixing the source guard bug that lets them mutate historical state.
Alt-`D`, Alt-`S`, and Alt-ArrowDown reuse the same unselected tier but install a
controller-owned count prompt before producing an existing atomic hand command.
The prompt keeps v1 text, default, invalid/cancel alert, and Alt-`D` default
suppression; its second stage is action-bound, reparsed, and clamped from the
current viewer projection. Replay fails before prompting and authority owns
shuffle randomness.
Plain `U` is the solo-only unselected continuation. A route must explicitly
enable the key, its payload-free request derives the viewer through the existing
solo-undo resolver, and replay still fails before resolution. Remote session
submission suppresses a second pending `ApplySoloUndo` without allocating a
sequence or transport write, matching the source async in-progress boundary;
authority mode/history remains definitive.
`M` remains the neighboring modifier-agnostic unselected gesture, but crosses a
separate non-command seam. The board adapter admits it only for a ready live
player; the client sends no player or message text, and the server derives the
actor before broadcasting a typed, ephemeral mulligan fact. That fact enters
the same neutral activity/accessibility presentation path as other safe events,
without changing authority state, command sequence, or replay history. Replay
consumes the live fact without delivery. This preserves the existing row and
avoids coupling the shortcut to the still-stubbed general-chat migration.
`R` retains its context-sensitive source contract without putting refresh state
in either renderer. Unselected plain/Control/Shift `R` asks the runtime to
reinstall a scene from its current recipient-safe view; unselected Alt-`R` does
that first and then takes the existing reset path. Selected `R`/Alt-`R` instead
resolve stable card identity to existing stack/per-card target-value commands.
Replay, full-card preview, spectator, and editable-input boundaries fail closed.
The canonical model does not acquire legacy inline-angle, margin, or
per-evolution BREAK history merely to reproduce refresh-dependent defects.
Local zone sorting is
controlled by the mounted zone browser:
it derives a stable copy from disclosed labels and never enters the controller
or mutates its projection; forged requests still fail closed as `local_only`.
Native Chromium pins exact damage and condition edit/removal plus ability-marker
commands, all six count prompts/commands, all three category choices, all five
move choices, all twenty-six selected-card shortcut commands, all three global
loose-board commands, all four intended unselected deck commands, the global
coin command, all three lifecycle commands, all three staged hand commands, the
solo undo key, and reversible sorting with zero action/effect/command traffic.
Replay-local prize/hand disclosure now uses an isolated solo-player-only
projection. Its opaque catalog never enters the historical view. Prize menus
offer their two source zone rows plus `Reveal/hide card`; opponent-hand menus
offer hand look plus the same card row. Zone and per-card overrides emit
replacement scenes without commands, reconcile only on forward playback, and
clear at seek/resync/reconnect/exit/identity/terminal boundaries. Native
Chromium covers real-v1 menu/card paint, exact face assets, stable face-swap
geometry, semantic roles/names, keyboard traversal and wrap, focus-visible
paint, focus return, selected-card-only disclosure, and zero submission. Source
raster parity for transformed stack/zone dialogs now uses the immutable player
frames to reproduce the source iframe containing blocks. A real-v1/candidate
gate pins both player orientations, physical surface/card geometry, paint,
assets/order, modal semantics, Tab containment, focus return, and zero command
traffic. A manual screen-reader audit, production routing, and non-Chromium
approval remain unresolved.

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
lifecycle exists. Marker IDs derive from the visible top card's stable
recipient alias and participate in scene diffs; Pixi
reuses keyed views without card texture churn but has no native paint/hit claim.
A real owner/opponent/spectator path proves stable distinct aliases, identical
normalized marker geometry, and no canonical card/definition leakage. The
source's q1/q2/q3/q0-return history, wrapper-margin drift, direct editing and
hit behavior remain evidence rather than production state. Because no DOM
history is projected, an eligible returned-q0 current state receives the same
canonical geometry; only the pristine source phase is used for browser parity.

### Evolution-host marker identity policy

Keep logical damage, condition, and ability state on the stable `PlayStack`, but
key rendered stack markers by the visible top card's recipient-safe alias. This
keeps IDs stable for active/bench movement while matching the source evolution
lifecycle: old host damage, condition, and ability nodes depart; damage is
recreated on the incoming top; and an incoming card's existing ability marker
can retain its identity as it becomes the stack marker. The public stack ID
remains stable, while card and marker aliases remain distinct per recipient.

Evolution atomically preserves damage, clears the condition and group rotation,
and sets stack ability state from the incoming card only. It clears the
incoming card-level field once that card joins the evolution chain. The scene
builder suppresses independent ability markers on every evolution card so a
malformed projection cannot create duplicate marker IDs. The direct v1 runtime,
game-core command, scene-diff, and owner/opponent/spectator session tests cover
both marked and unmarked incoming cards. This policy changes renderer object
ownership only; geometry, paint, menus, labels, and shortcuts are unchanged.

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
  both owner-readable stadium states. The top-owner branch holds the bottom
  player and explicit card turn fixed while changing only projected stadium
  ownership. Separate strict gates match all 12
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
  transient departure DOM, rotated/history-dependent markers, marker-editor
  integration (source lifecycle and the safe v2 resolver are characterized),
  production BREAK/compound rotation (the split source history is pinned but
  proves projected state insufficient), overflow,
  Tool-specific Pixi paint parity, full paint or interaction parity, cover-open
  UX, or opened-zone layout, and the sidebar content rectangle is derived from
  measured shell/tab edges);
- a manual screen-reader audit beyond the automated replay-local and transformed
  stack/zone-dialog semantic roles, names, keyboard traversal/wrap, focus
  paint/return, face-swap paint, lifecycle, dismissal, and protected command
  gate;
- finish resource evidence beyond the current green 100-cycle warmed-host
  Chromium DOM-node/listener gate and the deterministic same-origin
  120-distinct-SVG cache/request/decode gate and green 20-cycle in-process
  remote-route ownership gate plus a live local-`workerd` creator session:
  deployed browser navigation churn plus real-raster decoded-byte and
  retained-heap accounting on the ratified profile;
- the ratified physical-device/browser performance matrix; and
- Chromium automation plus Firefox and Safari approval.

Pixi-only WebGL recovery and GPU-texture gates are no longer blockers for the
first production renderer, but remain required before any future Pixi rollout.

The selected DOM path now also has a canonical-state-to-browser privacy gate.
It scans concealed recipient projections and scenes for canonical identifiers,
names, and face URLs, then intercepts image requests across public reveal/cover,
private inspection/close, renderer recreation, and a deliberately late face
response. Only currently authorized board-tier faces are requested; hidden DOM
returns to the card back before the stale response settles. The fixture is
deterministic same-origin SVG evidence, not external-host, real-raster memory,
manual assistive-technology, or cross-browser approval.

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
