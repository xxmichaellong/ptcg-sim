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
React DOM candidate while retaining explicit exclusions for cover-open UX,
opened-zone layout, undersized assets, Pixi geometry, and rotated hit regions.

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
marker/parent aliases, the stable public stack ID, and identical normalized
geometry.

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
later call does not re-reveal older popup cards. Cross-viewer repeats therefore
retain per-extraction visibility and remain fail-closed until the canonical
model can express it per card.

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

`legacy-compound-break-refresh-q3-layout.test.ts` then isolates the negative-
count case. Four independent local/opponent active/sole-bench stacks enter
refresh at `[top q0, lower q3, q3]`. The top's BREAK adjustment produces
`groupTurns=-1`; the replay loop has zero iterations, and same-zone reset plus
reattachment synchronously collapses the cards to `[q1,q0,q0]`. The settled
phase keeps that state while preserving the BREAK flag and card nodes.

The browser companion proves the exact operation trace has no replay calls,
pins the before/after hit-region class and all geometry on both physical sides,
and checks two-to-one wrapper settlement, native observer delivery, harness-
only observer cleanup, and recursive source provenance. This is explicitly
legacy defect evidence. V2 refresh remains a state-free projection; nonzero-
group Alt-R, lower-card initiators, attachments, movement/evolution/removal,
and candidate parity remain excluded.

`legacy-compound-nonzero-group-single-layout.test.ts` closes the clean
top-selected Alt-R entry matrix next. Twenty-four independently built histories
span ordinary/BREAK, group q1/q2/q3, local/opponent, and active/sole-bench cases.
Each records the pre-action state and the synchronous post-action state without
a refresh. At effective q1/q2/q3, five histories reset only the selected top to
absolute q0 and clear BREAK while preserving both lower group angles. The
exception is BREAK at group q3: its selected top begins at effective q0, so
Alt-R leaves it at q1 with BREAK still true while the lower cards stay q3.

The dependent oracle reuses the exact pre-action stack/card geometry and hit-
region class from the ordinary/BREAK compound manifests, then pins all new
post-action geometry, complete operation/transition traces, selected action,
history-sensitive active/bench margins, topology, opponent physical mapping,
three observer pairs, and harness-only cleanup. This is again source-only
compatibility evidence. It does not replace v2's explicit group plus per-card
orientation model or authorize a strict compound production layout. Lower-card
initiators, refresh after divergent Alt-R, raw/imported per-card q2/q3 states,
repeated Alt-R or subsequent group rotation, attachments,
movement/evolution/removal, and candidate parity remain excluded. Keyboard and
clicked-card ingress are digest-pinned but not executed by this inert harness.

`legacy-compound-lower-group-rotation-layout.test.ts` next isolates whole-stack
rotation initiated from the middle or base evolution. Sixteen independently
constructed histories span both lower roles, ordinary/BREAK composition,
local/opponent frames, and active/sole-bench slots. Each follows a complete
q0→q1→q2→q3→q0 cycle and retains the same q1 refresh point as the top-selected
compound baselines. The selected action proves logical middle/base indices 1/2
despite reversed lower-card DOM ordinals 2/1; native middle/base exposed hit
regions make both selections reachable, while keyboard/click ingress is pinned
but not executed.

All card turns, BREAK flags, topology, links, offsets, identity, and painted
geometry remain coherent with the top-selected dependency phases. Margins do
not: a lower BREAK initiator is one quarter-turn behind the top, so initial q1
keeps empty active and `3%`/`2%` bench margins instead of the top-selected
`1%`/`0%`; top-driven q1 refresh then normalizes both to `1%`/`0%`. Later bench
q2/q3/q0 writes also shift with the selected lower angle. The oracle pins these
anchors, complete traces, dependency-relative geometry/hit evidence, wrapper
replacement, observers, and cleanup. Lower-card single/Alt-R, mixed initiators,
other post-divergence refreshes, attachments, and candidate parity remain
separate source-only work.

`legacy-compound-lower-q0-single-layout.test.ts` next isolates lower-card Alt-R
at pristine group q0. Sixteen independently built histories cover middle/base,
ordinary/top-BREAK composition, local/opponent, and active/sole-bench. The
selected attached lower card alone advances q0→q1 and receives its own legacy
`PokémonBreak=true`: ordinary composition ends with one flagged lower card,
while top-BREAK composition keeps the flagged top and adds a second flagged
evolution. The action proves logical indices middle=1/base=2 despite DOM
ordinals 2/1.

The dependent oracle pins exact pre-action ordinary/BREAK geometry, then all
post-action rectangles, margins, topology/links, physical mapping, complete
traces, lower-specific painted/authored native hit regions, observer ownership,
and harness cleanup. Active margins stay empty; ordinary bench changes to
`3%`/`2%`, and top-BREAK bench remains there. No refresh or wrapper replacement
occurs across the measured pre-single→post-single transition; the setup trace
still contains two construction refreshes. Keyboard/click ingress is pinned but
not executed. This is source-only:
nonzero and returned/history-authored q0 entries, repeated/mixed initiators,
divergent refresh, attachments, movement/removal, candidate parity, and any
production/domain/schema change remain excluded.

`legacy-compound-lower-nonzero-group-single-layout.test.ts` extends that branch
to the clean q1/q2/q3 entries. Forty-eight independently constructed histories
span middle/base selection, ordinary/top-BREAK composition, both physical
sides, and active/sole-bench slots. Each records only `pre-single` and
`post-single`; the two construction refreshes remain in the setup trace, but no
refresh or wrapper replacement occurs across the measured transition.

The selected lower evolution alone resets from its absolute q1/q2/q3 angle to
q0 and remains `PokémonBreak=false`. Its lower sibling retains the group angle,
and a BREAK top retains its flag and effective orientation. Logical indices
middle=1/base=2 remain distinct from DOM ordinals 2/1. The dependent oracle
pins exact pre-action inheritance, complete operation and transition traces,
history-sensitive margins, authored/painted/physical rectangles, and ten native
hit probes. Lower painted/authored-only wedges exist for q1/q3 and disappear
for q2 or the selected post-q0 card, making the q2 trace/state assertion
necessary even though its rectangular footprint is unchanged.

Keyboard/click ingress is digest-pinned but not executed, and the opponent
cases establish only physical-frame mapping. Returned/history-authored q0,
q1-refreshed entry, repeated/mixed initiators, group rotation or refresh after
divergence, already-BREAK lower cards, attachments, movement/removal, candidate
parity, and production/domain/protocol/schema changes remain excluded.

`legacy-compound-lower-returned-q0-single-layout.test.ts` then isolates the
clean returned-q0 branch. Forty-eight independently built histories cross
ordinary/top-BREAK composition, homogeneous top/middle/base initiation of the
prior whole-stack cycle, final middle/base selection, both physical sides, and
active/sole-bench placement. Setup retains the established q1 reconstruction
inside q0→q1→q2→q3→q0; the measured `pre-single`→`post-single`
transition contains only the final lower-card Alt-R.

That selected lower evolution alone advances q0→q1 and gains
`PokémonBreak=true`. The oracle distinguishes top-BREAK bench histories that
return with `3%`/`2%` after top initiation from lower-initiated histories that
return with `1%`/`0%`; every bench post-state is `3%`/`2%`, and active remains
`1%`/`0%`. Exact dependency inheritance, traces, indices/DOM ordinals,
authored/painted/physical rectangles, ten native probes, q1-refresh replacement,
stable measured-transition identity, observers, provenance, and cleanup are
pinned. Refresh-free group cycles, repeated Alt-R, mixed prior initiators,
other q0 origins, later refresh/divergence, attachments, candidate parity, and
all production/domain/protocol/schema/UI changes remain excluded.

`legacy-compound-lower-history-authored-q0-single-layout.test.ts` next pins
same-card repeated Alt-R at history-authored q0. Sixteen independent histories
cross ordinary/top-BREAK composition, middle/base selection, both physical
sides, and active/sole-bench placement. Two setup single actions take that lower
card q0/false→q1/true→q0/false; the measured third action takes it back to
q1/true. The second action's tentative q2 writes `1%`/`0%` before legacy
normalization snaps the card to q0.

The dependent oracle proves exact visual equivalence to the same-role lower-
initiated returned-q0 cases while retaining a different trace and lifecycle.
Every pre-state is `1%`/`0%`; active stays there and bench changes to
`3%`/`2%`. Exact turns/flags, logical indices versus DOM ordinals, authored/
painted/physical rectangles, ten native probes, topology, stable identities,
three observer pairs, provenance, and cleanup are pinned. There is no refresh
after construction. Alternating targets, fourth/later repeats, interleaved
group actions or refresh, imported states, attachments, candidate parity, and
production/domain/protocol/schema/UI changes remain excluded.

`legacy-compound-lower-nonzero-group-single-followup-layout.test.ts` then pins
the immediate same-selected Alt-R after the clean nonzero-group lower-card entry
has already diverged that card to q0/false. Forty-eight independent histories
cross ordinary/top-BREAK composition, original group q1/q2/q3, middle/base
selection, both physical sides, and active/sole-bench placement. Each pre-state
must equal the matching post-state in
`compound-lower-nonzero-group-single-v1.json`; the measured follow-up changes
only the selected card q0/false→q1/true.

The dependent oracle pins exact cross-fixture phase equality, complete traces,
turns/flags, margins, authored/painted/physical rectangles, ten native probes,
topology, stable identities, three observer pairs, provenance, and cleanup.
Active stays `1%`/`0%`. Bench q1/q3 changes from `1%`/`0%` to `3%`/`2%`
with the recorded fractional wrapper-anchor shift, while the bench q2 wrapper
remains `3%`/`2%` without an anchor shift. No refresh occurs after construction.
Every q2 active phase is geometrically and hit-wise identical to the matching
history-authored-q0 case, and BREAK flags also coincide, despite different
sibling turns and full setup traces. Q2 bench converges after the action, while
q1/q3 remain geometrically distinct. Different follow-up targets, third/later
repeats, intervening group actions/refresh/movement,
lower-initiated or refreshed nonzero groups, imported q0, attachments,
candidate parity, and production/domain/protocol/schema/UI changes remain
excluded.

`legacy-compound-lower-nonzero-group-rotation-after-single-layout.test.ts`
next pins one top-driven whole-group R immediately after the clean lower-card
q1/q2/q3 divergence. Forty-eight histories cross ordinary/top-BREAK
composition, prior middle/base single selection, both physical sides, and
active/sole-bench placement. The `pre-group-rotation` payload must equal the
matching checkpoint-eighteen post-state exactly; the measured top/index-zero
`single=false` action advances every Pokémon one quarter-turn without changing
any BREAK flag.

The selected lower card therefore reaches q1 while remaining non-BREAK. Active
margins remain `1%`/`0%`; ordinary bench margins remain inherited. Every BREAK
bench wrapper moves `0.015625px`: q1/q3 changes `1%`/`0%`→`3%`/`2%`, while
q2 changes `3%`/`2%`→`1%`/`0%`. The dependent oracle pins exact traces,
turns/flags, authored/painted/physical rectangles, ten probe signatures,
topology, stable identity, three observer pairs, provenance, cleanup, and no
measured-transition refresh. The inherited setup trace retains both construction
refreshes. Cross-fixture collision checks require matching turns
and geometry while positively distinguishing the selected-card BREAK flag and
full history.

Lower-initiated/repeated group actions, another single before R, refresh,
movement/replay/import, already-BREAK lower cards, markers, attachments,
non-Pokémon cards, extra bench siblings, alternate layout/assets, candidate
parity, and production/domain/protocol/schema/UI changes remain excluded.

`legacy-compound-lower-nonzero-group-refresh-after-single-layout.test.ts`
then pins the immediate source-shaped wrapper refresh from each checkpoint-
eighteen divergent post-state. Forty-eight independent histories cover
ordinary/top-BREAK, q1/q2/q3, prior middle/base selection, both sides, and
active/sole-bench placement. Every pre payload and trace prefix equals its
predecessor. The measured refresh preserves card nodes, replaces the wrapper,
and records both the same-task two-wrapper state and the settled recentered
one-wrapper state.

Ordinary histories normalize to homogeneous q1/q2/q3. Top-BREAK q1/q2 becomes
top q2/q3 with both lowers q1/q2; q3 computes a negative replay count and
collapses to top q1/BREAK with both lowers q0. The fixture pins replay traces,
turns/flags, margins, authored/painted/physical rectangles, ten probes,
topology, wrapper/card identity, four observer pairs, cleanup, and recursive
collision dependencies. Real KeyR image reload/cache/network behavior, later
actions, alternative histories/layouts, candidate parity, and production/
domain/protocol/schema/UI changes remain excluded.

`legacy-compound-lower-nonzero-same-lower-group-after-single-layout.test.ts`
then pins plain R on the same lower card that produced each checkpoint-eighteen
q1/q2/q3 divergence. Forty-eight independent histories cross ordinary/top-
BREAK composition, middle/base initiation, both physical sides, and active/
sole-bench placement. The measured middle/base is logical index 1/2 but DOM
ordinal 2/1; `single=false` advances it q0→q1 and advances both siblings while
preserving every BREAK flag.

Post turns and flags equal the matching top-initiated checkpoint-twenty-two
result. Active geometry is exact as well. The lower initiator writes every
bench result to `3%`/`2%`, so ordinary q1/q3 and top-BREAK q2 are a signed
`-0.015625px` frame-local x translation from the top-initiated result, with all
other cases exact. The fixture pins exact checkpoint-eighteen pre-state and
trace inheritance, the lower-card action/index, authored/painted rectangles,
physical-frame mappings, ten probes, topology, stable wrapper/card identifiers,
cleanup, and no measured-transition refresh. Different-lower or repeated group
actions, intervening operations, alternate q0 origins, attachments, candidate
parity, and production/domain/protocol/schema/UI changes remain separate.

`legacy-compound-lower-nonzero-different-lower-group-after-single-layout.test.ts`
then pins plain R on the other lower card after each checkpoint-eighteen
q1/q2/q3 divergence. Forty-eight independent ordinary/top-BREAK histories
cross prior middle/base selection, local/opponent frames, and active/sole-bench
placement. Prior middle makes base logical index 2 / DOM ordinal 1 the measured
initiator; prior base makes middle logical index 1 / DOM ordinal 2. The selected
q1/q2/q3 other lower advances to q2/q3/q0 with `single=false`, advances both
siblings, and preserves every BREAK flag.

Post turns and flags equal both the top- and same-lower-initiated checkpoints.
The other lower card retains the pre-state bench margin branch: compact
`1%`/`0%` for q1/q3 and spread `3%`/`2%` for q2. Ordinary geometry therefore
equals the top-initiated result. Top-BREAK bench x differs from it by signed
`+0.015625px`, `-0.015625px`, and `+0.015625px`; relative to the same-lower
result, q1/q3 is `+0.015625px` and q2 is exact. The fixture pins both
cross-checkpoint tables, exact predecessor inheritance, cross-role action
metadata, traces, authored/painted rectangles, physical-frame mappings, ten
native probes, stable wrapper/card identifiers, cleanup, and no measured-
transition refresh. Repeats, intervening operations, alternate origins,
attachments, candidate parity, and production/domain/protocol/schema/UI changes
remain separate.

`legacy-compound-lower-nonzero-same-lower-second-group-after-single-layout.test.ts`
then pins a second consecutive plain-R whole-group action on the same lower
card after checkpoint twenty-four. Forty-eight independent ordinary/top-BREAK
histories cross middle/base selection, original q1/q2/q3 group state, both
physical sides, and active/sole-bench placement. Every pre-state and trace
prefix equals the matching checkpoint-twenty-four post-state exactly. The
selected lower advances q1→q2, both siblings advance once, and all BREAK flags
remain unchanged.

Active remains at `1%`/`0%`. Every bench changes `3%`/`2%`→`1%`/`0%`, moving
the wrapper and authored cards `+0.015625px` frame-local x. Painted rectangles
and all ten probes are captured fresh because every card changes parity. Q1/q3
post geometry collides internally despite different raw turns; q2 collides
with checkpoint eighteen's matching pre-divergence geometry, with the explicit
top-BREAK bench displacement. The fixture pins exact turns/flags, action and
trace, authored/painted rectangles, physical-frame mappings, stable wrapper/
card identifiers, three-observer/no-refresh lifecycle, cleanup, and recursive
provenance. Third/later repeats, top/different-lower followups, intervening
operations, alternate origins, attachments, candidate parity, and production/
domain/protocol/schema/UI/UX changes remain separate.

`legacy-compound-lower-nonzero-different-lower-second-group-after-single-layout.test.ts`
then pins an immediate second whole-group action by checkpoint twenty-five's
same other lower initiator. Forty-eight independent ordinary/top-BREAK
histories cross prior middle/base divergence, original q1/q2/q3, both physical
sides, and active/sole-bench placement. Every pre-state and trace prefix equals
checkpoint twenty-five exactly. The selected other lower advances q2→q3,
q3→q0, or q0→q1, both siblings advance once, and every BREAK flag is preserved.

Active remains `1%`/`0%`. Bench q1/q3 changes compact→spread with a
`-0.015625px` frame-local wrapper/authored x displacement; q2 changes
spread→compact with `+0.015625px`. Painted rectangles and all ten probes are
captured fresh because every card flips parity. All post turn/flag vectors equal
checkpoint twenty-six: active and bench q2 geometry collide exactly, while
bench q1/q3 differs by `-0.015625px`. Q1/q3 also collide internally despite
different raw turns, and q2 retains the bounded checkpoint-eighteen reference.
The fixture pins cross-role action indices, exact inheritance and collisions,
traces, authored/painted rectangles, physical-frame mappings, stable wrapper/
card identifiers, three-observer/no-refresh lifecycle, cleanup, and recursive
provenance. Different second initiators, third/later actions, intervening
operations, alternate origins, attachments, candidate parity, and production/
domain/protocol/schema/UI/UX changes remain separate.

`legacy-compound-lower-nonzero-top-second-group-after-single-layout.test.ts`
then pins an immediate second whole-group action by checkpoint twenty-two's same
top/index-zero initiator. Forty-eight independent ordinary/top-BREAK histories
cross prior middle/base divergence, original q1/q2/q3, both physical sides, and
active/sole-bench placement. Every pre-state and trace prefix equals checkpoint
twenty-two exactly. The selected top and both siblings advance once, while all
BREAK flags are preserved, including the measured top's true→true top-BREAK
transition.

Active remains `1%`/`0%`. Ordinary bench q1/q3 changes compact→spread with a
`-0.015625px` wrapper/authored x displacement and q2 changes spread→compact with
`+0.015625px`; top-BREAK uses the inverse branches and deltas. Painted rectangles
and all ten probes are captured fresh because every card flips parity. Every post
turn/flag vector equals checkpoint twenty-seven: ordinary geometry is exact;
top-BREAK active geometry is exact and bench carries its explicit signed
`0.015625px` delta. Q1/q3 collide internally despite different turns, and q2
collides exactly with checkpoint eighteen's pre-divergence phase. The fixture
pins top action indices, exact inheritance and bounded collisions, traces,
authored/painted rectangles, physical mappings, stable identifiers, three-
observer/no-refresh lifecycle, cleanup, and recursive provenance. Lower/different
initiators, third/later actions, intervening operations, alternate origins,
attachments, candidate parity, and production/domain/protocol/schema/UI/UX paths
remain excluded.

`legacy-compound-lower-nonzero-top-then-prior-lower-group-after-single-layout.test.ts`
then pins the mixed sequence in which checkpoint twenty-two's top initiator acts
first and the prior divergent lower acts second. Forty-eight independent
ordinary/top-BREAK histories cross original q1/q2/q3, prior middle/base, both
physical sides, and active/sole-bench placement. The measured lower is always
q1/non-BREAK at logical index 1/2 and DOM ordinal 2/1; its `single=false` q1→q2
action advances every card once without changing any BREAK flag.

Every post wrapper is compact. Ordinary bench q2 and top-BREAK bench q1/q3 move
`+0.015625px` frame-local wrapper/authored x, while the complementary cases do
not move. Painted rectangles and all ten probes are captured fresh because all
parities flip. Every pre-state and trace prefix equals checkpoint twenty-two;
every post turn, flag, margin, geometry, and probe tuple equals checkpoint
twenty-six despite the different history. The fixture also pins its bounded
checkpoint-twenty-eight comparison and internal q1/q3 collision, lower action
indices, physical mappings, stable identifiers, three-observer/no-refresh
lifecycle, cleanup, and recursive provenance. Top/other-lower second initiators,
third/later and intervening actions, alternate origins, attachments, candidate
parity, and production/domain/protocol/schema/UI/UX paths remain excluded.

`legacy-compound-lower-nonzero-top-then-other-lower-group-after-single-layout.test.ts`
then pins the complementary mixed sequence in which checkpoint twenty-two's top
initiator acts first and the other lower sibling acts second. Forty-eight
independent ordinary/top-BREAK histories cross original q1/q2/q3, prior
middle/base divergence, both physical sides, and active/sole-bench placement.
Prior-middle histories measure base at logical index 2 / DOM ordinal 1;
prior-base histories measure middle at logical index 1 / DOM ordinal 2. The
selected non-BREAK card advances q2→q3, q3→q0, or q0→q1, every sibling advances
once, and all BREAK flags persist.

Active stays compact. Ordinary bench q1/q3 changes compact→spread by
`-0.015625px` frame-local wrapper/authored x and q2 changes spread→compact by
`+0.015625px`; top-BREAK margins stay unchanged. Painted rectangles and all ten
probes are captured fresh because every parity flips. Every pre-state and trace
prefix equals checkpoint twenty-two, and every post tuple equals checkpoint
twenty-seven. The fixture also pins its bounded checkpoint-twenty-nine
comparison, internal q1/q3 collision, cross-role indices, physical mappings,
stable identifiers, three-observer/no-refresh lifecycle, cleanup, and recursive
provenance. Top/prior-lower second initiators, third/later or intervening actions,
alternate origins, attachments, candidate parity, and production/domain/
protocol/schema/UI/UX paths remain excluded.

`legacy-compound-lower-nonzero-top-third-group-after-single-layout.test.ts`
then extends checkpoint twenty-eight with an immediate third whole-group action
by the same top at logical/DOM index zero. Forty-eight independent ordinary/
top-BREAK histories cross original q1/q2/q3, prior middle/base divergence, both
physical sides, and active/sole-bench placement. Every pre-state and trace
prefix equals checkpoint twenty-eight exactly. The measured top and both
siblings advance once without changing any BREAK flag, including top's
true→true top-BREAK transition.

Active stays compact. Ordinary bench q1/q3 changes spread→compact by
`+0.015625px` frame-local wrapper/authored x and q2 changes compact→spread by
`-0.015625px`; top-BREAK takes the inverse branches and displacements. Painted
rectangles and all ten probes are captured fresh across every parity flip. Every
post margin/geometry/probe tuple and BREAK vector equals checkpoint twenty-two,
while every raw turn is two quarter-turns ahead modulo four. Q1/q3 also collide
internally despite raw turns differing by 180 degrees. The fixture pins exact
inheritance, top action indices, traces, physical mappings, stable identifiers,
source fulfillment, three-observer/no-refresh lifecycle, cleanup, and recursive
provenance. Fourth/later or lower-initiated measured actions, intervening
operations, alternate origins, attachments, candidate parity, and production/
domain/protocol/schema/UI/UX paths remain excluded.

`legacy-compound-lower-nonzero-top-fourth-group-after-single-layout.test.ts`
then extends checkpoint thirty-one with an immediate fourth whole-group action
by the same top at logical/DOM index zero. Forty-eight independent ordinary/
top-BREAK histories cross original q1/q2/q3, prior middle/base divergence, both
physical sides, and active/sole-bench placement. Every pre-state and trace
prefix equals checkpoint thirty-one exactly. The measured top and both siblings
advance once without changing any BREAK flag, including top's true→true
transition.

Active stays compact. Ordinary bench q1/q3 changes compact→spread by
`-0.015625px` frame-local wrapper/authored x and q2 changes spread→compact by
`+0.015625px`; top-BREAK takes the inverse branches and displacements. Painted
rectangles and all ten probes are captured fresh across every parity flip. Every
post margin/geometry/probe tuple equals checkpoint twenty-eight while every raw
turn is two quarter-turns ahead modulo four. Post turns and flags complete a
full cycle back to checkpoint eighteen. Top-BREAK bench geometry closes too;
ordinary bench geometry retains the bounded q1/q3 `-0.015625px` and q2
`+0.015625px` history displacement. Q1/q3 also collide internally. The fixture
pins exact inheritance, top action indices, traces, physical mappings, stable
identifiers, source fulfillment, three-observer/no-refresh lifecycle, cleanup,
and recursive provenance. Later/lower-initiated actions, intervening operations,
alternate origins, attachments, candidate parity, and production/domain/
protocol/schema/UI/UX paths remain excluded.

`legacy-compound-lower-nonzero-same-lower-third-group-after-single-layout.test.ts`
then extends checkpoint twenty-six with an immediate third whole-group action by
the same divergent middle/base card at logical index 1/2 and DOM ordinal 2/1.
Forty-eight independent ordinary/top-BREAK histories cross original q1/q2/q3,
both physical sides, and active/sole-bench placement. Every pre-state and trace
prefix equals checkpoint twenty-six. The selected lower advances q2→q3, both
siblings advance once, and all BREAK flags persist.

Active stays compact; every bench changes compact→spread with a `-0.015625px`
frame-local wrapper/authored x displacement. Painted rectangles and all ten
probes are captured fresh across the parity flip. Every post margin, geometry,
probe tuple, and BREAK vector equals checkpoint twenty-four while every raw turn
is two quarter-turns ahead modulo four. Post turns and flags also equal
checkpoint thirty-one, but ordinary q1/q3 and top-BREAK q2 bench geometry differs.
Q1/q3 collide internally as well. The fixture pins exact inheritance, lower
action indices, traces, physical mappings, stable identifiers, source
fulfillment, three-observer/no-refresh lifecycle, cleanup, and recursive
provenance. Fourth/later, top/different-lower, intervening, alternate-origin,
attachment, candidate-parity, and production/domain/protocol/schema/UI/UX paths
remain excluded.

`legacy-compound-lower-nonzero-different-lower-third-group-after-single-layout.test.ts`
then extends checkpoint twenty-seven with an immediate third whole-group action
by the same other lower card at logical index 2/1 and DOM ordinal 1/2.
Forty-eight independent ordinary/top-BREAK histories cross original q1/q2/q3,
both physical sides, and active/sole-bench placement. Every pre-state and trace
prefix equals checkpoint twenty-seven. The selected lower advances q3→q0,
q0→q1, or q1→q2, both siblings advance once, and all BREAK flags persist.

Active stays compact. Bench q1/q3 changes spread→compact with a `+0.015625px`
frame-local wrapper/authored x displacement; q2 changes compact→spread with
`-0.015625px`. Painted rectangles and all ten probes are captured fresh across
each parity flip. Every post margin, geometry, probe tuple, and BREAK vector
equals checkpoint twenty-five while every raw turn is two quarter-turns ahead
modulo four. Post turns and flags also equal checkpoint thirty-two; active and
q2 geometry is exact, while q1/q3 bench geometry differs by `+0.015625px` due
to initiator history. Q1/q3 collide internally as well. The fixture pins exact
inheritance, other-lower action indices, traces, physical mappings, stable
identifiers, source fulfillment, three-observer/no-refresh lifecycle, cleanup,
and recursive provenance. Fourth/later, top/prior-lower, intervening,
alternate-origin, attachment, candidate-parity, and production/domain/protocol/
schema/UI/UX paths remain excluded.
