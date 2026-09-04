# Legacy characterization locks

These tests freeze externally visible v1 surfaces while v2 is developed beside
it. They deliberately read the legacy source as data; they do not import its DOM
modules or make the new engine depend on v1.

If a legacy action, replay exception, or key binding changes, update the manifest
only after recording its explicit preserve/fix decision in
`docs/v2-rebuild/LEGACY_ACTION_MAP.md`. These inventory locks are the first layer;
scenario fixtures will add state, message, visibility, and ordering outcomes.

Renderer geometry locks additionally pair a manually reviewed numeric fixture
with source digests. Text sources are normalized to LF for portable hashing;
image fixtures are hashed as raw bytes. The browser harness loads those sources
through a deny-by-default origin and records CSS geometry without contacting the
legacy application server.

`legacy-contained-card-layout.test.ts` pins the narrower pile/stadium contract:
deck-first versus discard/lost-zone-last covers, single-card owner-readable
stadium orientation, closed-cover marker placement, and the exact HTML/CSS/JS/
asset sources behind those claims. Its browser companion compares contained
cover/stadium boxes with the React DOM candidate while retaining explicit
exclusions for cover-open UX, opened-zone layout, top-owner candidate browser
parity, undersized assets, Pixi geometry, and rotated hit regions.

`legacy-evolution-reflow-layout.test.ts` pins the separate ordinary-evolution
boundary. Four isolated local/opponent active/bench cases record a second
attachment-free evolution both immediately after `evolveCard` and after the
unconditional `refreshBoard` reconstruction settles. The fixture preserves
integer `clientWidth` offsets, logical versus DOM versus hit order, transient
rotation margins, and the MutationObserver-delayed empty-wrapper removal. The
transient phase is diagnostic rather than user-visible. Attachments, counters,
BREAK/rotation, overflow/flex shrink, history-dependent restore paths, face
hide/reveal/source mutation, and Pixi parity remain excluded. Its browser
companion now compares the exact stable three-card boundary with a separately
mounted React DOM candidate; this does not broaden the source oracle's scope.

`legacy-energy-attachment-reflow-layout.test.ts` pins the next, smaller
attachment boundary separately from the older mixed five-card transcription.
It records exactly one face-up Energy attached to one unrotated active Pokémon
on both physical sides, immediately after attach and after the unconditional
refresh reconstruction settles. The source-only fixture preserves the integer
`clientWidth / 6` offset, stable `adjustCards` wrapper width, attachment
target/relative/layer state, logical/DOM/hit order, and delayed ghost-wrapper
cleanup. Trainer-as-Tool, multiple or reordered attachments, departures,
evolution layers, bench/overflow, rotated hit regions, and interaction behavior
remain excluded. Its browser companion now compares the exact stable four-card
boundary with a separately mounted React DOM candidate using public canonical
card geometry; this does not broaden the source oracle's scope or claim Pixi,
wrapper-identity, or sibling-order parity.

`legacy-trainer-tool-attachment-reflow-layout.test.ts` pins the corresponding
current-category `Trainer` presentation as a separate source checkpoint.
It records the shared non-Pokémon `clientWidth / 6` offset plus the
Trainer-specific 90-degree turn and `2%` right wrapper margin, preserving both
the authored pre-transform layout box and the transformed painted box. The
stable oracle also covers rotated paint overflow, z/DOM/hit order, attachment
state, and observer-settled wrapper cleanup. Its browser companion now compares
the strict one-base/one-Trainer production scene and React DOM paint to all four
source boxes, rotations, z ranks, and hit regions. Shared center-rotated hit/drop
containment is independently verified in both candidates. Energy and
mixed/multiple attachments, category history, departure and stale margins,
evolution combinations, bench/flex competition, markers, BREAK/compound
rotation, alternate layouts, wrapper/sibling identity, and Tool-specific Pixi
paint parity remain excluded.

`legacy-two-energy-attachment-compaction-layout.test.ts` then isolates four
source-only departure histories: local and opponent active stacks each remove
either the inner/first or outer/second Energy from a stable two-Energy stack.
It preserves the legacy integer-width contraction, inner-survivor truncation,
removed-card reset, sibling and hit order, synchronous ghost wrapper, and real
MutationObserver cleanup. The immediate departure and synchronous refresh
phases are diagnostic; the observer-settled state is the parity oracle. Both
histories converge to the already characterized one-Energy source geometry, so
canonical post-departure state can use the existing strict production path.
Its browser companion also compares the stable pre-departure two-Energy source
boxes, rotations, z ranks, and four hit regions with a narrowly gated production
scene and separately mounted React DOM renderer. This comparison does not apply
to the diagnostic departure/ghost phases or claim transition animation,
candidate wrapper/sibling identity, or Pixi paint/hit parity. Mixed/Tool
attachments, three or more Energy, category history, evolution or base
departures, staged restore, bench/flex contention, markers, BREAK/rotation,
alternate layouts and assets, destination UX, candidate click/drag behavior,
and server/network behavior remain excluded.

`legacy-mixed-energy-trainer-tool-attachment-order-geometry.spec.ts` checks the
source
`tests/legacy-fixtures/renderer/mixed-energy-trainer-tool-attachment-order-v1.json`
fixture. Four independent attachment
histories cover Energy-then-Trainer and
Trainer-then-Energy on the local and opponent active stacks; four more histories
start from the same stable mixed stack and independently remove the Energy or
the current-category Trainer-as-Tool on each side. Both attachment orders settle
to logical `[base, Energy, Trainer]`, DOM `[base, Trainer, Energy]`, and source z
`[0, -1, -2]`. With the 90.5625×126 px source card and its 91 px integer
`clientWidth`, the stable offsets are `91 / 6 = 15.1667` px and
`2 * 91 / 6 = 30.3333` px, the authored wrapper width is `121.333` px, and the
Tool retains its 90-degree local turn and `2%` right wrapper margin. The
opponent frame applies its enclosing half-turn, so effective rotations are
`[180, 180, 270]` rather than changing the frame-local layout.

The capture also keeps mutation-history diagnostics out of the parity contract.
Trainer-first/Energy-second briefly moves the Energy to `14.8333` px while the
Tool is recursively detached and reattached; Energy departure applies the same
`parseInt` drift to the surviving Tool, and Tool departure temporarily leaves
its old wrapper margin behind. Refresh reconstructs the respective strict
single-Tool or single-Energy source state, first with the superseded wrapper
still connected and then with one wrapper after the real MutationObserver
settles. Removed cards are reset in an independent sink, and every case records
zero fixture cards/wrappers after cleanup. These phases are diagnostic only.
The same fixture now includes reversed two-card and interleaved four-card
`leaveAll` restoration plus a multi-card staged deck-top swap on both sides.
It proves that source restoration replays the flat staged list through the
incoming-Energy rule, while source swap removes and appends the old deck top.
Every deck checkpoint pins logical and direct-child DOM order plus reset card
state, while a phase/card trace makes every source-transcribed reset invocation
observable; restored checkpoints pin one live wrapper, no superseded wrapper,
and a hidden staging popup before and after two animation frames.
The v2 exact-position swap is an explicit semantic exception; its versioned
restore still applies the supported category partition to the resulting list.
The stable canonical output contributes to the narrow production gate described
below. Unsupported attachment membership, base-only restoration, broader
work-area restores, and overflow/flex competition remain generic or deferred.
Reverse arrays remain valid historical state outside the v1 normalized
transition subset.

`legacy-mixed-stack-movement-category-cycle-layout.test.ts` pins the separate
`mixed-stack-movement-category-cycle-v1.json` source checkpoint. Six isolated
cases cover both physical sides: native canonical active construction,
whole-stack movement seeded from the preceding oracle's exact reverse-restored
geometry, and Energy/Trainer current-category cycles through board departure
and ordinary reattachment. The movement path exercises no-target automatic
promotion and return to occupied active, then freezes canonical settled active
and sole-bench geometry, logical/DOM order, rotations, z/hits, wrapper cleanup,
and harness-operation/reset traces. It deliberately does not replay `leaveAll`
or claim its setup trace; that transition is pinned by the preceding fixture.
The category path records original categories and proves final settled
equivalence without turning legacy reflow history into game state. The browser
test now also mounts React for only the settled sole-bench and returned-active
movement phases on both sides. It compares all mixed-card scene/pre-transform
and painted boxes, q1/q3 Tool rotation, z `300/299/298`, renderer order, and four
native hit regions within 2 px / 1% / 0.1 degrees.

The strict gate uses only the exact public current shape: one known same-owner
face-up Pokémon base plus `[Energy, Trainer]`, all unrotated/marker-free, in the
default layout and the characterized sole-active or one-control active/bench
placements. Scene-diff, Pixi consumption, and real owner/opponent/spectator
projection tests preserve identities, avoid geometry-only texture churn, and
protect opaque aliases. Broader bench competition, extra/evolution
attachments, reverse/unsupported order, alternate layouts,
nonstandard-intrinsic asset parity, and Pixi paint/hit remain deferred.

`legacy-marker-rotation-layout.test.ts` pins the full source active-marker
history. Independent local and opponent cases record damage and condition
circles, the empty ability tab, every condition palette branch, painted-width
reflow through q0→q1→q2→q3→q0, the history-retained active-wrapper margin,
live and post-removal resize callback counts, hit order, and complete marker/
card/wrapper cleanup. The opponent circle counter-rotation and ability-tab
half-turn remain explicit.

Production now consumes only the strict canonical active-q0 current-state
subset: one known
same-owner face-up Pokémon in the sole unrotated active stack, no bench,
evolution, or attachments, at the default 1600×900 DPR-1 sidebar/even/unflipped
layout, with at least one stack marker and no per-card ability marker. The
renderer contract uses the public 63:88 card ratio, explicit local/opponent
circle/tab geometry and stable marker diffs. Chromium compares React geometry
to pristine source q0 within the declared 2 px anchor / 1% size thresholds;
palette and text are exact, typography remains proportional, and marker z is
exactly card z plus one. It separately asserts the intentionally
non-interactive candidate boundary because source markers remain editable and
pointer-hit. Eligible returned-q0 current state is canonicalized to the same q0
geometry because no DOM history is projected. Pixi reuses keyed marker views
without card asset churn, and a real owner/opponent/spectator test protects
stable opaque aliases and identical normalized geometry. Rotated and
source-history-dependent active layout, BREAK/compound and
attachment rotation, movement/evolution/refresh transfer, text-entry gestures,
alternate layouts, and Pixi-native paint/hit parity remain deferred.

`legacy-bench-marker-rotation-layout.test.ts` independently pins the narrower
sole-bench source history. Local and opponent cases contain one ordinary card,
one damage circle, and one ability-used tab; canonical visible controls,
keyboard handling, and movement cleanup establish that no special-condition
marker belongs in this state. The capture records q0→q1→q2→q3→q0, including
the bench-only `3%` right/`2%` left q1/q3 margins, return to the CSS-equivalent
q0 geometry with explicit `1%`/`0%` inline history, and ability-over-damage
equal-z hit order where the rotated markers overlap.

Window resize listeners and the bench initializer's native `ResizeObserver`
are counted separately. Its initial delivery refreshes both live markers;
empty-wrapper cleanup delivers again without refreshing removed markers. The
source observer is still live immediately before the harness performs its sole
explicit disconnect, so this fixture does not claim a legacy teardown path.

Production composes only the strict pristine-q0 current-state subset with the
already-characterized clean-active control: exactly one known same-owner
face-up current-category Pokémon in active and exactly one such unrotated base
card in bench, with no evolution, attachments, per-card ability marker, or
special condition, at the default 1600×900 DPR-1 sidebar/even/unflipped
layout. The bench card keeps the public-ratio 80.5398×112.5 px box even while
markerless, so removing the last marker cannot shift it. Damage and ability use
an explicit `legacyBenchQ0` presentation, 26.8466 px circle and
80.5398×16.1080 px side-colored tab; equal-z scene order follows source append
order (`damage`, then `abilityUsed`). Chromium compares the marked q0 React
geometry and paint to source within the declared tolerances and proves the
intentional non-interactive marker/card-hit-through boundary. Keyed DOM/Pixi
tests cover updates and cleanup without resource churn, while real owner,
opponent, and spectator projections protect distinct stable opaque card
aliases, the shared canonical public stack ID, and identical normalized
geometry.

Additional bench siblings/contention, rotated production q1/q2/q3, source DOM
history, BREAK/compound stacks, movement transfer, marker editing, alternate
layouts, and Pixi-native paint/hit parity remain deferred.

`legacy-compound-group-rotation-layout.test.ts` and
`legacy-compound-break-rotation-layout.test.ts` split the next source-only
checkpoint into independently auditable ordinary-group and BREAK-composition
contracts. One browser load constructs fresh three-Pokémon evolution chains in
local/opponent active and sole-bench slots, then records top-selected
q0→q1→q2→q3→q0 histories. Both contracts capture q1 before and after source-
shaped refresh reconstruction, including the synchronous two-wrapper state,
two-frame cleanup, stable card identity, native observer construction and
delivery, harness-retained source-shaped handles and cleanup, golden frame-local
phase rectangles and hit coordinates, margins, topology, and six native hit
regions.

The BREAK contract additionally pins the canonical upright top-card toggle,
the `[top, middle, base]` local quarter-turn composition
`[1,0,0]→[2,1,1]→[3,2,2]→[0,3,3]→[1,0,0]`, and the final toggle back to all
q0. The first and returned active BREAK-q0 states expose the same projected
rotation tuple but different wrapper geometry, while the bench states are
physically equivalent. BREAK refresh at group q0/q2 and q3, Alt-R at nonzero
group rotation, and attachment rotation are excluded from that checkpoint.
They are named hazards, not candidate behavior.

No new compound/BREAK-specific gate or presentation enters production in this
checkpoint. Rotated and BREAK-on states remain generic; qualifying all-q0 states
retain the existing ordinary-evolution path. Current projection lacks the legacy
BREAK flag, selected-rotation initiator, inline-margin history, and enough
ingress provenance to choose exact legacy geometry until those semantics are
canonicalized or explicitly represented.

`legacy-compound-break-refresh-layout.test.ts` closes only the q0/q2 portion of
that evidence gap. Its dependent oracle inherits and live-verifies the complete
compound BREAK source manifest, then directly pins the refresh and rotation
entry sources. Twelve independently constructed local/opponent active/sole-
bench histories cover fresh BREAK q0, returned q0 after four group turns, and
q2 after two turns. The browser companion measures pre-refresh, synchronous
two-wrapper, and settled phases, preserving exact operation/replay traces, card
node identity, observer delivery and harness-only observer cleanup, margins,
authored/painted/physical rectangles, topology, and six native hit regions.

Fresh and returned q0 replay zero turns and retain `[q1,q0,q0]`; q2 replays two
and retains `[q3,q2,q2]`. Active fresh, returned, and reconstructed q0 expose
three inline-margin histories, although returned and reconstructed anchors are
only 0.015625 px apart. Fresh-to-returned and fresh-to-reconstructed are
1.921875/1.9375 px apart respectively, so all anchors remain within the 2 px
gate. Bench histories converge, and active q2 settles to its pre-refresh
geometry. This remains source-only: q3 negative-count collapse, nonzero-group
Alt-R, lower-card initiators, attachments, movement/evolution/removal, and
candidate parity remain excluded. No production geometry or domain state
changes.
