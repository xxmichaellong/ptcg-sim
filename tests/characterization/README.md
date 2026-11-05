# Legacy characterization locks

These tests freeze externally visible v1 surfaces while v2 is developed beside
it. They deliberately read the legacy source as data; they do not import its DOM
modules or make the new engine depend on v1.

If a legacy action, replay exception, or key binding changes, update the manifest
only after recording its explicit preserve/fix decision in
`docs/v2-rebuild/LEGACY_ACTION_MAP.md`. These inventory locks are the first layer;
scenario fixtures will add state, message, visibility, and ordering outcomes.

`legacy-export-envelope.test.ts` also pins the direct loose-board bulk source
contract: all four actions export after their guarded movement loops, preserve
index-zero move order, retain the saved initiator/message tuple, and expose
discard/hand/shuffle keyboard bindings plus all four shipped context-menu
buttons. The real-runtime browser companion separately proves destination
arrays and the empty-board shuffle's JSON `null` permutation sentinel.

The same source-envelope lock pins V1's independent GX/VSTAR implementation:
all four player/marker controls call the one-parameter toggle, repeat clicks
remove the same class, and exact reset/used message branches remain distinct.
Its real-runtime browser companion executes an interleaved both-player sequence
and verifies classes, messages, split undo logs, chronological export, and
network/page-error boundaries.

The source-envelope lock also pins ability-marker use/removal tuples, repeated
source behavior, the four zones reachable through `W`, and the active/bench
context-menu toggle. The existing real-runtime marker-editing companion proves
the unchanged card marker node, exact `useAbility`/`removeAbilityCounter`
sequence, saved-perspective exports, resize cleanup, and clean page boundary.
The private importer maps top cards to stack markers and attachment/discard/
stadium cards to per-card markers, retains already-matching state as zero-batch
source records, and rejects lower-evolution coordinates without partial state.

Damage source locks cover exact add/update/remove tuples, the JSON-null default
that renders as `10`, editable text and blur removal, active/bench digit
shortcuts, and context-menu ingress. The real-runtime marker editor already
pins the full `30 → 50 → 10 → removed` keyboard sequence plus `10 → 70 → 0 →
removed` input sequence and exact exports. The private importer accepts only
bounded canonical values on exact stack tops, preserves repeated source no-ops,
and rejects free-form values or lower/attachment coordinates transactionally.

Special-condition source locks cover exact add/update/remove tuples, the `P`
default and recognized color cycle, active-only context/shortcut ingress,
editable text, empty/zero blur removal, and automatic movement/evolution
cleanup. The real-runtime editor and shortcut oracles already pin default,
`P → B → Pa → C → A → P`, bounded free-form edits, removal, chronological
exports, and stable marker identity. The private importer preserves source
node no-ops and transient null edits only on the exact active top, and rejects
bench, lower/attachment, malformed, or over-bound records transactionally.

Renderer geometry locks additionally pair a manually reviewed numeric fixture
with source digests. Text sources are normalized to LF for portable hashing;
image fixtures are hashed as raw bytes. The browser harness loads those sources
through a deny-by-default origin and records CSS geometry without contacting the
legacy application server.

`legacy-contained-card-layout.test.ts` pins the narrower pile/stadium contract:
deck-first versus discard/lost-zone-last covers, single-card owner-readable
stadium orientation, closed-cover marker placement, and the exact HTML/CSS/JS/
asset sources behind those claims. Its browser companion compares contained
cover/stadium boxes, including both owner-readable stadium states, with the
React DOM candidate. It now also isolates all six pile covers plus the final
opponent-readable stadium against a top-owner candidate and attaches
source/candidate screenshots plus foreground metrics under the shared 97.5%,
three-pixel, and 24-channel-value paint contract. Cover-open UX is source-backed
separately, and the overlay oracle now pins opened deck/discard/lost-zone density
at the source's 8%/10%/12% widths on both player frames. Deterministic 60-card
variants cover exact row wrapping, scroll extent/end position, sticky toolbar,
Escape teardown, and focus restoration in all six browsers. Opened-zone action
histories, undersized assets, Pixi geometry, and rotated hit regions remain
excluded.

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
mounted React DOM candidate. It also isolates the twelve source and candidate
card images over white, attaches both screenshots and a JSON comparison, and
requires 97.5% bidirectional foreground agreement within a three-pixel,
24-channel-value compositor tolerance while retaining the structured
2 px / 1% / 0.1-degree gate. The reusable comparator lives in
`tests/browser/support/foreground-paint-comparison.ts`. This does not broaden
the source oracle's scope.

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
card geometry. It now also attaches isolated source/candidate screenshots and
bidirectional foreground metrics under the same 97.5%, three-pixel, and
24-channel-value paint contract as ordinary evolution. This does not broaden
the source oracle's scope or claim transient-phase, Pixi, wrapper-identity, or
sibling-order parity.

`legacy-trainer-tool-attachment-reflow-layout.test.ts` pins the corresponding
current-category `Trainer` presentation as a separate source checkpoint.
It records the shared non-Pokémon `clientWidth / 6` offset plus the
Trainer-specific 90-degree turn and `2%` right wrapper margin, preserving both
the authored pre-transform layout box and the transformed painted box. The
stable oracle also covers rotated paint overflow, z/DOM/hit order, attachment
state, and observer-settled wrapper cleanup. Its browser companion now compares
the strict one-base/one-Trainer production scene and React DOM paint to all four
source boxes, rotations, z ranks, and hit regions. Shared center-rotated hit/drop
containment is independently verified in both candidates. It also attaches
isolated source/candidate screenshots and foreground metrics under the shared
97.5%, three-pixel, and 24-channel-value paint contract. Energy and
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
candidate wrapper/sibling identity, or Pixi paint/hit parity. The stable
pre-departure browser path now also retains an isolated six-card source paint
scene and attaches source/candidate screenshots plus foreground metrics under
the shared 97.5%, three-pixel, and 24-channel-value contract. Mixed/Tool
attachments, three or more Energy, category history, evolution or base
departures, staged restore, bench/flex contention, markers, BREAK/rotation,
alternate layouts and assets, destination UX, candidate click/drag behavior,
and server/network behavior remain excluded.

The three `legacy-runtime-mixed-attachment-*-oracle.spec.ts` browser gates check
the immutable
`tests/legacy-fixtures/renderer/mixed-energy-trainer-tool-attachment-order-v1.json`
fixture against v1's real modules. Four independent attachment
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
state. The real-runtime gate treats the exported synchronous swap's before and
after states as authoritative; the fixture's hand-stepped reset trace remains
historical detail rather than an independent runtime claim. Restored checkpoints
pin one live wrapper, no superseded wrapper, and a hidden staging popup before
and after two animation frames.
The v2 exact-position swap is an explicit semantic exception; its versioned
restore still applies the supported category partition to the resulting list.
The stable canonical output contributes to the narrow production gate described
below. Unsupported attachment membership, base-only restoration, broader
work-area restores, and overflow/flex competition remain generic or deferred.
Reverse arrays remain valid historical state outside the v1 normalized
transition subset.

`legacy-mixed-stack-movement-category-cycle-layout.test.ts` pins the separate
`mixed-stack-movement-category-cycle-v1.json` numeric checkpoint. Six isolated
cases cover both physical sides: native canonical active construction, a real
`leaveAll` reverse restore followed by whole-stack movement, and real
`changeType` Energy/Trainer category cycles through board departure and
ordinary reattachment. The runtime path exercises no-target automatic
promotion and return to occupied active, then freezes canonical settled active
and sole-bench geometry, logical/DOM order, rotations, z/hits, wrapper cleanup,
and original categories. The old hand-authored operation/reset traces and
stub-network fulfillment have been removed from the JSON because they were not
runtime evidence. The browser test mounts React
for only the settled sole-bench and returned-active movement phases on both
sides. It compares all mixed-card scene/pre-transform
and painted boxes, q1/q3 Tool rotation, z `300/299/298`, renderer order, and four
native hit regions within 2 px / 1% / 0.1 degrees. After all cleanup records are
captured, the harness retains a fresh returned-active scene and the test
compares its six base/Energy/Trainer images to React over white using the shared
97.5%, three-pixel, 24-channel-value foreground paint contract.

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

The source-to-React browser path also retains a fresh pristine q0 state only
after recording the source cleanup, pins both card definitions to the exact
cardback, and compares the two cards plus all six markers over white. Attached
screenshots and foreground metrics must satisfy the shared 97.5%, three-pixel,
24-channel-value contract in both directions.

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
marker/parent aliases, the stable public stack ID, and identical normalized
geometry.

The source-to-React browser path also reconstructs pristine q0 only after the
source cleanup and observer evidence are recorded. It hides the unrelated
active controls and compares the two bench cards plus their four damage/ability
markers over white using the shared 97.5%, three-pixel, 24-channel-value
foreground contract.

Additional bench siblings/contention, rotated production q1/q2/q3, source DOM
history, BREAK/compound stacks and rotation, marker editing, alternate layouts,
and Pixi-native paint/hit parity remain deferred.

`tests/browser/legacy-runtime-evolution-marker-transfer.spec.ts` executes the
real legacy discard-to-active evolution path with and without an incoming
ability marker. It pins damage copy-by-value into a distinct node, removal of
the zeroed host damage/condition and host ability nodes, identity-preserving
reparenting of an incoming ability node, array/DOM topology, relative links,
wrapper count, live/export action owner rewriting, asset service, and errors.
The paired v2 tests key stack markers by each recipient's stable top-card alias,
so active/bench movement keeps identity while evolution replaces old host
markers and can retain the incoming ability identity. Owner, opponent, and
spectator receive distinct aliases with identical normalized geometry and no
canonical-ID leakage. This adds no UI or UX behavior.

`tests/browser/legacy-runtime-layout-interactions.spec.ts` executes the complete
v1 layout interaction path rather than an inert CSS transcription. Real DOM
events cover both normal resize handles, flip-time handler rebinding and both
flipped branches, resize-overlay attach/remove, double-flip ownership, and the
fullscreen control's reversible shell change. Those events reproduce the
recorded asymmetric DPR-2 and fullscreen fixtures within 2 CSS px. The paired
pure `resizeBoardLayoutState` transition includes the source's independent
frame math, collision predicate, clamps, edge growth, and initial `49%`/`51%`
inline handle fallbacks; the opt-in runtime projects it without route or visual
changes. Compact 1024×768 CSS is now directly measured in the viewport matrix.
The same real-runtime gate now pins adjacent-pixel collision changes in all four
branches, strict 5%/95% growth thresholds, normal overscan and flipped
one-pixel clamps, plus a second-event collision that depends on the prior 10%
handle height. Near/far source clamps retain identical complete captures. The
flipped one-pixel endpoint exposes a bounded nested-iframe child-layout delta,
so the normalized model comparison there is intentionally outer-only while the
source equality check still includes all regions. The React DOM runtime's
disabled-by-default pointer bridge has focused scaled-coordinate, overlap,
flip, wrong-pointer, release, cancel, blur, resize, and disposal coverage.
`react-dom-resize-interaction.spec.ts` dynamically mounts a development-only
opt-in runtime on a translated 75%-scale surface and drives real Chromium
pointer gestures through normal/flipped movement, upper-handle overlap
priority, all four clamps, DOM geometry refresh, capture isolation, and active
disposal. No application route imports the harness. A follow-up case supplies
the candidate viewport portion: an active native gesture is canceled before
route-owned 1280×720→1440×810 synchronization, its held movement is ignored, the
resized DOM accepts a fresh normal gesture, the split survives 1024×768, and
flipped ownership plus a fresh flipped gesture survive the return to 1280×720.
`react-dom-board-chrome.spec.ts` now adds the painted source-to-candidate layer:
fresh real-v1 pages and the development-only candidate are compared at
1280×720 for light, light-hover, dark, dark-hover, sequential resize, flipped
asymmetric resize, and fullscreen. Each RGBA screenshot pair is capped at 1,536
of 921,600 antialiased fringe pixels, with separate 512-pixel handle and
1,280-pixel control caps plus a 128/255 maximum channel delta across Chromium
builds. Both images and the per-state metrics are attached. Native candidate handles and
visible flip/fullscreen callbacks establish the states, and the remaining three
callbacks delegate exactly once. Production wiring, complete action workflows,
and non-Chromium approval remain separate.

`react-dom-protected-input.spec.ts` adds the next candidate-only interaction
boundary. Its development-only harness mounts the actual React DOM session
runtime and records controller effects plus live submissions. Native same-zone
and lower-evolution-to-discard drags produce exact `no_op` and
`unsupported_source` rejections, clear drag state, suppress click selection, and
submit nothing; a legal hand-to-discard drag queues exactly one preconditioned
`MoveCard`. Native click, card/zone double-click, and right-click then prove
controller-owned selection, preview, opened-zone, and context state before
idempotent teardown. It does not claim legacy-source interaction parity, visible
overlay paint, keyboard/focus, reconnect snap-back, production wiring, or
non-Chromium approval.

The overlay follow-up mounts `LegacyBoardOverlays` through that same unwired
runtime. Context menu, full-card preview, stack preview, and zone browser render
only recipient-safe scene images. A separate opened-zone action accepts a
hidden card only beneath the currently open safe zone, while renderer-surface,
closed-zone, and cross-zone forgeries remain rejected. Native Chromium covers
Shift+F10, Enter/Space, menu arrows/Home/End, Escape/outside dismissal, focus
return, exact card IDs, duplicate-card anchoring, light/dark paint, and zero
command leakage. `react-dom-overlay-paint.spec.ts` mounts the real v1 `Card` and
compares source-ordered menu rows/computed paint plus full-preview shell/image
metrics, attaching source/candidate screenshots and JSON. At that checkpoint,
mutation-backed actions and replay availability still remained separate from
the paint/input proof.

The following protected-input checkpoint connects those typed action callbacks
to `LegacyOverlayActionRequested`. The controller rejects any card other than
the currently open menu target and any zone other than the currently open
browser, then requires a ready live-player projection before the pure action
resolver is callable. Complete actions reuse the existing semantic resolvers
and the adapter's guarded submission path. At that checkpoint, the native test
proved an active card ability toggle queues exactly one `SetAbilityUsed`; the hand
action instead records `requires_input` with zero commands/results. The
exhaustive requirements table pins all 23 context actions and three zone actions
as command, input, choice, or local. The next local-sort checkpoint keeps the
real checkbox wholly inside the mounted overlay: a deliberately reversed
fixture proves checking renders stable disclosed-label order, unchecking
restores canonical scene order, and neither direction records an overlay
action, controller effect, or submission. Forged sort requests retain the
`local_only` resolver rejection. It also pins the three initially scoped v1
replay-local zone-disclosure actions; at that checkpoint the V2 replay menu
remained empty and the controller returned `read_only` before resolver/submit
until a separate local disclosure projection was implemented.

The protected marker-input checkpoints complete damage and special-condition
editing without mutating renderer-owned nodes. The unchanged context items
install one typed controller editor over the recipient-safe marker bounds.
Missing markers emit characterized defaults `10`/`P`; existing markers open
with no command. The temporary `contenteditable` accepts bounded integer damage
or 16-character condition text, applies the live condition palette, maps
zero/empty text to removal, rejects malformed drafts locally, and routes valid
text only through the matching kind/card identity. Unit coverage pins default
creation, malformed/runtime-forged values, no-op and Escape cancellation,
cross-kind submission, reconnect cleanup, exact overlay geometry, and immutable
scenes. The native route proves invalid `70.5`, accepted `70`, damage removal,
overlong condition retention, `Pa`, condition removal, then an ability toggle at
client sequences 1/2/3/4/5 exactly once. The later selected-card checkpoint
completes the keyboard path.

The frozen export-envelope source contract now also pins `rotateCard`'s exact
three-value tuple, quarter-turn arithmetic, active/bench/stadium shortcut
boundary, play-group sibling rule, single-card `PokémonBreak` toggle, and
reset/synchronization helpers. The existing real-runtime rotation suites remain
the behavioral oracle for its history-dependent DOM angles and margins; this
static lock only prevents source drift while the importer applies the approved
canonical target-value normalization.

The same frozen export-envelope contract now pins `changeType`'s exact
four-value tuple and initiator perspective rewrite, original-category storage, three
keyboard categories, active/bench context choices, face-down-safe messaging,
and unconditional loose-board departure. These source facts bound the private
legacy importer: it resolves the record owner's exact selected card, treats the
initiator as provenance only, and reuses the canonical category-change command
without changing the legacy UI/UX.

The frozen contract also pins `playRandomCardFaceDown` from hand-menu ingress
through its resolved `Math.random` index, concealment, loose-board movement,
message, both `processAction` paths, and final export perspective rewrite. This
proves that an import must consume the saved index once and retain independent
actor/target provenance rather than rerun randomness or expose a card selector.

The same source lock now pins V1 undo's per-player filtering, deck-bootstrap
replacement, final action removal, and two calls that export the wrapper's
unchanged history argument. The exporter then serializes its `undefined` array
entry as `null`; the real-runtime shortcut oracle records both the in-memory
undefined and exact saved JSON-null forms. The importer accepts only that native
tuple, restores one of at most 128 retained same-player whole-match checkpoints
without rerunning randomness, retains exporter `self` as actor and record `user`
as the board-flipped target, and rejects the unsafe interleaved-seat case required by V1's split
logs. This also proves that all eight reveal/look actions are socket-only and
that `exchangeData` is filtered from saved history. `changeCardBack` remains a
genuine export: a focused source lock pins its prompt/default, image-load gate,
perspective-specific mutable fields, and saved-history ordering. The current
unwired V2 importer validates its exact tuple but discards the arbitrary value;
broadened ADR-013 supersedes that checkpoint and requires bounded ordered
card-back preservation before route installation. Candidate tests hold the nine
injected names to `non_exported_action` and give malformed saved card-back tuples
their own typed diagnostics.

The protected count-input checkpoint completes all six context-menu numeric
prompts while retaining the browser-native v1 UI. A typed controller descriptor
binds the exact action, card, and source zone; StrictMode can invoke its effect
only once. Hand discard/shuffle variants use `Draw how many cards?` default `0`,
direct draw uses default `1`, and top/bottom inspection uses its source question
with default `1`. Complete integers clamp to current safe capacity and the
200-card protocol bound. Hand actions accept zero; draw/inspection require one;
own inspection is private and opponent inspection public. Quiet cancellation
and complete-integer parsing replace v1's alert-on-cancel and permissive
`parseInt` prefix bugs. Unit coverage pins all mappings, malformed/runtime
values, cross-action identity, and source departure. Native Chromium proves all
six prompt/default and command pairs with capacity clamps and client sequences
6 through 11, following the existing marker/ability sequence without gaps.

The protected category-submenu checkpoint completes the separate three-choice
context action. The route-owned overlay preserves `Change type...` with exact
source-ordered `to Energy`, `to Tool`, and `to Pokémon` rows; Tool maps to the
authoritative `Trainer` value. Pointer hover/click and nested-menu keyboard
entry, traversal, return, and dismissal stay local until one row supplies its
typed value. The resolver then rechecks the open top-stack-card identity and
delegates to the existing stale-safe category command path. Missing/forged
values, lower evolutions, loose cards, stale context cards, and post-dismissal
requests submit nothing. The real-v1 paint companion now compares nested-menu
dimensions, offsets, padding, border, shadow, colors, typography, and labels.
Native Chromium proves Energy, Trainer/Tool, and Pokémon commands at client
sequences 12 through 14 without gaps.

The protected move-submenu checkpoint completes the adjacent five-choice
context action. It preserves `Move card...` and exact source-ordered `to Board`,
deck-top, deck-bottom, deck-switch, and deck-shuffle rows. A closed typed choice
must still match the exact open card. Board movement selects the card owner's
loose-board zone and emits the existing source-specific zone, top-stack,
inspection, or staged command; the four deck choices reuse the existing deck-
relative resolver. Missing/forged values, stale cards, lower evolutions,
already-board targets, empty decks, and post-dismissal requests submit nothing.
The shared nested-menu component preserves hover/click behavior and keyboard
entry, traversal, return, and dismissal for both compound menus. The real-v1
paint companion compares labels, dimensions, offsets, padding, separator,
shadow, colors, and typography. Native Chromium proves all five exact move
commands at client sequences 15 through 19 without gaps.

The protected selected-card shortcut checkpoint completes the numeric/Alt-
numeric/`0` damage gestures, `Y`/Alt-`Y` condition gestures, `W` ability toggle,
and Alt-`E`/`T`/`P` category changes. A route-owned key/code mapper emits one
closed request containing the selected stable card ID; the controller rechecks
that exact selection and live-player policy before delegating to the existing
bounded stack or annotation resolver. The source's immediate deselection rules
and missing-marker Alt behavior are explicit. Editable, composing, consumed,
unselected, forged, stale, unsupported, invalid, and replay requests emit no
command. Native Chromium proves nine exact submissions plus zero traffic while
an input is focused. No visible key reference, layout, or production route is
changed.

The protected visibility-shortcut checkpoint extends that same route-owned
boundary with the remaining `C`, `Z`, and Alt-`Z` selected-card gestures. A
real-v1 Chromium run executes the checked-in keybind and reveal/hide modules:
`C` and Alt-`C` toggle only the local front/back image and saved alt/source
pair, while `Z` marks the selected active card face-down and nonpublic and
Alt-`Z` restores its face and public flag. Selection remains active throughout,
and all external legacy requests remain blocked by the runtime harness. The v2
mapper emits one opaque-card request and reuses the existing private-inspection
or public-reveal resolver. It refuses to close a multi-card grant, treats known
cards without a grant and duplicate target values as no-ops, preserves all
editable-target suppression, and retains selection. Candidate Chromium proves
exact `BeginCardInspection`, `SetPublicReveal(false)`, and
`SetPublicReveal(true)` submissions after the prior nine commands, with no new
protocol, domain, route, label, layout, or styling behavior.

The protected deck-shortcut checkpoint covers the next four non-Alt selected-
card gestures without absorbing broader loose-zone movement. A real-v1
Chromium oracle rebuilds a selected active card and two-card deck on four clean
pages, then pins ArrowUp/ArrowDown/ArrowRight/`S` array order, selection cleanup,
exact live/export action payloads, and deterministic shuffle permutations.
That measurement records another source fallthrough defect: selected `S`
performs `shuffleIntoDeck`, deselects, and then the unselected branch performs
and logs `shuffleAll` during the same keydown. The protected mapper emits one
runtime-validated deck-relative request and the existing resolver produces one
stale-safe `MoveCardToDeckTop`, `MoveCardToDeckBottom`,
`SwapCardWithDeckTop`, or `ShuffleCardIntoDeck` command. Candidate Chromium
proves those four commands after the preceding twelve continuous shortcuts,
dismisses accepted selection, suppresses Alt/editable variants, and never
reproduces the redundant second shuffle. No protocol, domain, authority, route,
label, layout, styling, UI, or UX surface changes.

The protected generic-zone shortcut checkpoint covers `H`, `D`, `L`, and Space
without absorbing active/bench, stadium, or prize placement policy. Four clean
real-v1 Chromium pages reconstruct one selected active card and pin exact hand,
discard, lost-zone, and loose-board arrays, selection cleanup, live/export
`moveCardBundle` payloads, asset service, and a clean page-error boundary. One
closed runtime-validated destination tuple now drives a per-card resolver shared
with the existing context-menu `to Board` path. It selects `MoveCard`,
`MoveCardFromStack`, `MoveInspectedCard`, or `MoveStagedCard` from the current
recipient-safe source. Every live stack card is supported; same-zone, foreign-
work-area, stale-card, missing-target, replay, controller, and submit-time
rejection remains fail closed. Candidate Chromium proves a native lower-
evolution drag emits exactly one `MoveCardFromStack`, then proves the four
shortcut commands after the prior sixteen continuous shortcuts; focused editable
input remains silent. No protocol, domain,
authority, route, label, layout, styling, UI, or UX surface changes.

The action-export source characterization also pins individual
`attachedCards` movement without treating that temporary container as a
persistent zone. V1 captures the selected card's current flat array index and
forwards it unchanged through drag or keyboard `moveCardBundle`; recursive top
departure fills the array newest-to-oldest across lower evolutions, followed by
the settled attachment order. The private importer can therefore resolve a
changing staged coordinate to a canonical work-area card for a loose-zone move
or a numeric existing-stack placement while continuing to reject other staged
action shapes.

The same static source envelope now pins `leaveAll` separately: its exported
three-tuple includes the resolved active/bench destination, its first two loops
scan the flat staging array from the tail for current-category Pokémon, and its
final loop repeatedly moves index zero onto the reconstructed target before the
popup is hidden. This supports the private importer's narrow atomic
`RestoreStagedStack` conversion while keeping missing, attachment-only, and
category-ambiguous staged state fail-closed. The pre-existing browser oracle
continues to own the Energy/Trainer normalization and no-refresh layout facts.

Static source characterization now also freezes the three non-random staged
bulk buttons on both player sides. `discardAll`, `lostZoneAll`, and `handAll`
snapshot the popup count, repeatedly move index zero to the named destination,
hide the popup, and export exactly `[initiator, "attachedCards"]`. The
private importer resolves that flat order to stable work-area IDs before
draining it transactionally.

The adjacent static shuffle checkpoint freezes the distinct permutation bases.
`shuffleAll` drains the source at index zero, then records a permutation over
the resulting deck; for staged cards that basis is existing deck followed by V1
flat popup order. `shuffleBottom` permutes the source first and then drains index
zero to the deck tail, so its basis is only the flat popup. The current UI has
self/opponent staged `shuffleAll` buttons but no staged `shuffleBottom` button;
the latter remains an accepted general action/dispatcher shape. Importer tests
prove that both exact staged tuples translate positions by stable identity into
canonical work-area order rather than reusing incompatible indices.

The shared work-area deck/stadium characterization now pins Arrow-Up,
Arrow-Down, `S`, and generic stadium dispatch to the selected card's current
flat popup index for both `attachedCards` and `viewCards`. The staged importer
path resolves that index through the frozen newest-to-oldest-evolution then
versioned-attachment order and executes canonical deck-top, deck-bottom,
single-card shuffle, or atomic stadium replacement commands. Fixtures pin
source classification, changing coordinates, exact events, both deck edges,
the remaining-deck-plus-selected-card shuffle basis, residual/final work-area
cleanup, concealment, retry, replay, invariants, and rollback. Target-free play
from either work area now composes the existing individual departure through
the owner's loose board with `MoveCardToPlay`, preserving current-coordinate
selection, arbitrary-category-to-Pokémon normalization, deterministic stack
IDs, occupied-active demotion, bench append, work-area/grant cleanup, an empty
intermediate board, retry, and full replay. The frozen relocation path resets
staged cards to `relative = 0` and `attached = false` before they enter
`attachedCards`, proving that an individual play move does not restore sibling
staged cards. A two-page real-V1 Chromium oracle separately proves a Trainer
from `viewCards` replacing active and an Energy from `attachedCards` appending
to bench, including exact source records, single-card removal, category
normalization, selection cleanup, and unchanged sibling zones. The staged
`switchWithDeckTop` path is also pinned by the source-authentic mixed-attachment
fixture and a real-V1 Arrow-Right oracle: selected-card removal precedes deck
rotation, and the prior top appends to the flat popup tail. The importer admits
that result only when it round-trips through the canonical Pokémon-prefix and
non-Pokémon-suffix sequences, carries both returned lists in the event, and
preserves a following `leaveAll`. Category-interleaved results stay closed.

Static source characterization now freezes deck-inspection creation as well.
The prompt path records the target relationship before clamping to the current
deck count; top views repeatedly remove index zero, while bottom views walk the
recorded last index downward and therefore append cards edge-first. The source
exports all five witnesses after movement and reveals the temporary array only
to the initiating perspective. Keyboard and context-menu ingress plus replay
dispatch are pinned. Because V1 does not clear `viewCards` when opening again,
a second same-viewer top or bottom view appends its newly moved cards to the
popup tail. The canonical importer now records that exact transition through
`InspectionExtended`, while a compatible zero-card export remains a no-op.
Source characterization also pins the privacy boundary: every newly moved card
is revealed before the non-viewing client may hide the complete popup, and a
later call does not re-reveal older popup cards. The real-runtime cross-viewer
oracle executes both player perspectives: the former viewer loses all previous
faces, the new viewer sees only the newly appended batch, and a zero-card viewer
change still hides the old batch. Canonical per-card viewer entries now reproduce
those positive and zero-card transitions with replay-safe opaque-ID rotation.

The adjacent work-area characterization also pins the visible `viewCards`
buttons on both player sides for `discardAll`, `lostZoneAll`, `handAll`,
`shuffleAll`, and the inspection-only `shuffleBottom` ingress. The importer now
chains a first `viewDeck` into one atomic whole-inspection resolution. It keeps
the popup's top or edge-first bottom order for non-random moves, validates the
full remaining-deck-plus-inspection basis for `shuffleAll`, and validates only
the inspection basis for `shuffleBottom`. Candidate fixtures pin exact events,
replay, concealment generations, deterministic retry, missing-work-area
rollback, and stale-permutation rollback.

The individual work-area characterization pins that both `attachedCards` and
`viewCards` participate in the same drag source list, while generic click
identification records the selected card's current flat array index. V1's
shared move path removes exactly that index and appends the card to its
destination. The importer therefore resolves every `viewCards` coordinate
against the current inspection after prior moves, emits `MoveInspectedCard` for
loose destinations, or emits `PlaceCardOnPlayStack` for an exact numeric
active/bench top target. Candidate fixtures pin changing indices, every loose
destination family and cover alias, category-derived evolution/attachment,
last-card closure, viewer-grant cleanup, exact events, replay, stable hashing,
and whole-candidate rollback. The adjacent source characterization pins
Arrow-Up, Arrow-Down, `S`, and generic stadium dispatch to that same current
popup coordinate. The importer executes canonical deck-top/deck-bottom
departures, passes through the exact remaining-deck-plus-selected-card shuffle
basis, and performs atomic stadium replacement. Candidate fixtures pin exact
events, last-card closure, residual inspection order, concealment generations,
retry, replay, invariants, and stale input rollback. A real-V1 Chromium oracle
now also pins Arrow-Right against `viewCards`: the selected inspection card
becomes deck top and the prior deck top appends to the popup tail. The importer
reproduces that ordering with the atomic inspection swap's internal source-tail
mode, updates the viewer grant identically, and uses a single deck-top move for
the empty-deck branch. Default native and historical swaps keep same-position
replacement. Target-free active/bench inspection moves remain closed.

The table-action checkpoint pins the shipped `Attack` and `Pass` buttons against
the real V1 runtime. Both actions reset ability counters, discard only the
acting player's loose board through an internal non-emitting helper, retain the
opponent board and current turn, append the expected player message, and export
exact empty parameter arrays. The private importer strictly decodes those two
records and routes each through one existing atomic table command; candidate
coverage pins both source owners, exact batches, deterministic retry/replay,
stable hashing, invariants, and malformed-tuple rollback.

The protected active/bench shortcut checkpoint covers non-Alt `A` and `B`
without absorbing stadium or prize rules. Two fresh real-v1 Chromium pages
place a selected hand Pokémon beside one incumbent active, then pin active and
bench arrays, selection cleanup, exact live/export `moveCardBundle` payloads,
asset service, and a clean page-error boundary. `A` moves the incumbent active
to bench within the same outer action; `B` preserves it and adds the selected
card to bench. A closed runtime-validated play union emits existing
`MoveCardToPlay`, fully board-order-preconditioned `MovePlayStack`, or
`RestoreStagedStack` commands. Attachments, lower evolutions, inspections,
foreign or partial staged work, stale cards/boards, active no-ops, replay, and
submit-time races fail closed. Candidate Chromium proves both commands after
the prior twenty continuous shortcuts and focused editable input remains
silent. No protocol, domain, authority, route, label, layout, styling, UI, or
UX surface changes.

The protected stadium shortcut checkpoint covers non-Alt `G` without absorbing
prize concealment policy. Three fresh real-v1 Chromium pages reconstruct a
selected hand Stadium plus an empty, self-owned, or opponent-owned incumbent
state. They pin the singleton array, correct owner's discard, selection cleanup,
stadium orientation, one outer `moveCardBundle` live/export payload, asset
service, and a clean page-error boundary. V2 adds one explicit
`MoveCardToStadium` intent with exact source and recipient-opaque incumbent-or-
null preconditions. Authority resolves both aliases and derives source
ownership; one domain revision discards the incumbent before moving the
selected card. The generic-zone, deck-relative, and stadium resolvers now share
one recipient-view source locator. Zone, top-evolution, attachment, viewer-owned
inspection, and staged sources are supported; lower evolutions, foreign work
areas, stale or malformed stadiums, and same-stadium requests fail closed.
Candidate Chromium proves the command after the prior twenty-two continuous
shortcuts while focused editable input remains silent. No visible control,
label, key reference, route, layout, styling, UI, or UX changes.

The protected prize shortcut checkpoint completes non-Alt `P` without changing
Alt-`P`'s Pokémon category behavior. Two clean real-v1 Chromium pages select a
self- or opponent-owned public board card and pin movement to that card's own
prize zone, card-back rendering, cleared `faceDown`/`public` flags, selection
cleanup, the single outer `moveCardBundle` live/export payload, asset service,
and a clean page-error boundary. V2 extends the closed generic-zone destination
tuple and reuses its existing source-specific `MoveCard`, `MoveCardFromStack`,
`MoveInspectedCard`, or `MoveStagedCard` commands. The established concealed-
zone domain path marks the event `concealIdentity`, advances visibility
generation, and supplies owner and opponent projections with distinct fresh
opaque aliases. Same-prize, stale, foreign-work-area, replay, and submit-time
races remain fail closed. Candidate Chromium proves the command
after the prior twenty-three continuous shortcuts and focused editable input
remains silent. No protocol, domain, authority, route, label, layout, styling,
UI, or UX surface changes.

The solo replay disclosure checkpoints close the three zone-level replay
exceptions pinned by `client/src/setup/general/replay-block.js`—prize reveal,
prize look, and opponent-hand look—and the source menu's local per-card
`Reveal/hide card` operation. They preserve the exact source labels and
show/cover behavior but replace v1's canonical browser state with a separately
bounded, opaque, frame-alias-keyed catalog that authority emits only to a solo
player.
The historical view is never mutated, multiplayer and spectators receive no
catalog, and local actions emit no command. Forward playback retains per-zone
visibility; seek, resync, reconnect, exit, identity replacement, and terminal
state cover it again. A card override survives only the same opaque alias on a
forward frame; a zone operation clears card overrides in that zone. Protocol/
authority/playback/controller tests pin strict shape, scope, ownership,
collision, payload, and lifecycle failure cases. Native Chromium proves all
cards in a selected prize/opponent-hand zone change face, per-card reveal leaves
siblings covered, the prize and opponent-hand menus contain their exact source
rows, advance/seek/exit behave deterministically, and submission remains empty.
The real-v1 paint oracle additionally pins source menu order and computed paint,
exact front/back asset swaps, stable card boxes/aspect ratio, keyboard traversal
and wrap, focus-visible action paint, focus return, semantic roles/names, and
empty child-image alt text. Production routing, non-Chromium approval, and a
manual screen-reader audit remain separate.

The BREAK and compound-rotation recordings
(`tests/legacy-fixtures/renderer/compound-*.json`) have no lock here: no v2
code reads them, and each is checked against the running v1 client by a
`tests/browser/legacy-runtime-*-oracle.spec.ts`. No compound/BREAK-specific
layout enters production; rotated and BREAK states stay generic.
