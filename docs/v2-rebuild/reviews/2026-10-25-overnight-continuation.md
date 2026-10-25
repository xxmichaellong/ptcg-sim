# Overnight continuation and review

Blueprint revision/commit: continuation from `bd4bbf2cb26499ad6102b92c4b196ababe55459a` on `codex/v2-experience`.

Review lane: implementation, manual-tabletop correctness, recipient disclosure, browser interaction, and preview operations.

Reviewer: Codex, three independent review lanes, and repeated Codex CLI reviews.

Date: 2026-10-25.

Files/requirements reviewed: game core, room authority, client session, native Worker persistence, deck library/editor, table input, tutorial, and their tests; PX-041 and ADR-016/034/038.

Repo evidence inspected: accepted commits, real Durable Object storage tests, native authority probes, browser traces/geometry, hosted CI, and managed-preview diagnostics.

Overall verdict: accept-with-changes; automated acceptance and remaining release evidence are distinguished below.

## Scope and continuity

Recovered the interrupted work and its product/operational context before making
further changes. The simulator remains a manual tabletop. Pixi remains available,
and the existing renderer selection policy is preserved. Deployment is limited to
`ptcgsim-v2-preview`; `DECK_INDEX_SOURCE=off` remains required until the account's
Workers Paid prerequisite is resolved.

The continued work is on [PR #39](https://github.com/xxmichaellong/ptcg-sim/pull/39). It does not authorize a merge or production
rollout. All rooms, card names, artwork markers, invitations, and snapshots used
for these checks were synthetic test data; credentials and full protocol frames
were excluded from the managed diagnostics.

## Accepted findings and changes

- **Deck-library writes across tabs:** automatic catalog/fact refreshes now use an
  IndexedDB compare-and-swap, preserving a newer rename, edit, or deletion from
  another tab, including failed-write/retry races (`c5251d5f`).
- **Session and tutorial lifetime:** a pending Leave confirmation belongs to its
  original session; restore or mode changes cancel it. Replay/continuation owners
  dispose on unmount. Tutorial Undo handles a late, same-revision UndoApplied
  publication without crossing the lesson's undo floor (`a6567ebd`, `85069026`).
- **Card identifiers and artwork:** interrupted Unown identifier work was completed
  and the provider's actual question-mark image path was verified. The Poisoned
  lesson checks Poisoned specifically (`036f1b87`, `759b934f`).
- **Painted card geometry:** rotated/composed Bench cards fit using their painted
  envelope, preserving picking and layout geometry (`3277cb39`).
- **Phone and landscape editing:** names, format/tools, settings choices, and
  translated actions stay reachable. Short landscape editors retain usable card
  panes and scroll controls without horizontal overflow (`8b5a2bb9`, `1bd06620`).
- **Dialog and viewer focus:** custom-card and sleeve prompts return to stable
  controls without opening a tooltip that consumes the next Escape. Menu-based
  rename/delete dialogs have persistent return targets. Hidden Show board
  controls are inert and absent from the accessibility tree (`1bd06620`,
  `eecc77b2`, `2a5932d0`).
- **Hover lifetime:** removing or refreshing a hovered result retires its pending
  or shown preview. A fresh hover remains available; no observer, polling loop,
  or persistent global listener was added to the card previews (`bb2a43d8`).
- **Tutorial placement:** translated coach actions wrap with usable targets;
  highlighted card actions and Prize gestures remain reachable. Filtering the
  command palette updates coach placement when the palette changes size, while
  preserving done-step hold, focus, and outside-close behavior (`995d5267`,
  `d8b021b8`).
- **Inherited object references:** native commands naming inherited object keys
  receive a terminal, deduplicated stale_reference rejection. They no longer
  enter an internal retry loop. Legitimate own entries remain valid (`bc7e2dc8`).
- **Public-pile ordering — feature:** explicit Top/Bottom actions arrange one
  physical discard/Lost Zone copy, with live-top concurrency, exact Undo, and
  preserved metadata/disclosure. Ordinary same-pile drops remain local no-ops.
  This is an added capability, not a defect finding (`b52669b1`).
- **Hand/loose-board arrangement — privacy defect:** indexed reorders change only
  order. Previously a hidden loose card could turn face up and disclose its
  artwork; a revealed/inspected hand card could lose its grant and alias.
  Internal versioned events preserve historical unflagged replay and converter
  behavior (`e6dc37ac`).
- **Queued physical targets:** indexed arrangements do not create provisional
  arrivals. Further accepted-completion and ambiguity checks protect queued card
  and stack targets across missed results, reconnect, peer replacement, and idle
  completion. Genuine arrival chains and ordinary multi-card draws remain
  supported (`680f2e44`). Final provenance validation is recorded below.
- **Visibility-only alias changes:** a fast Hide → Hand chain now uses the same
  physical card after the hide changes its alias. Command-scoped source/order
  checks bind only fresh known results at the exact accepted view. Reordered,
  concealed, refused, or later replacement results remain stale. A native browser
  regression holds the actual publications/results while both keys are pressed
  (`d8c47919`).
- **Restored stacks and replayed cards:** restoration binds every evolution and
  attachment role to the accepted physical cards, using the native attachment
  order. Exact completion and revision checks preserve queued staging/restoration
  chains without guessing after a replacement. Both the original queued Play
  key and its rebased sent key settle together. Bounded alias history supports a
  legal 200-card stack through staging, restoration, hand return, and replay
  (`9c67a9a1`).
- **Native radio traversal:** the empty editor's checked view radio is its actual
  Tab endpoint. Both directions wrap correctly, separate forms stay separate,
  and native arrow selection remains available (`b50514f4`).
- **Quick viewer drops:** a card already carried by the pointer now flies from
  its painted release position. A fresh menu/key action still starts from its
  new viewer position, including during an older landing animation. Original
  viewer face and above-window metadata remain intact. Source lookup uses the
  carried card's render identity; a recycled cover key can supply a fallback
  only for the same card (`604e8719`, `614e9b5c`, `a1ee5e18`).
- **Other Solo seat's queued arrivals:** moving a known card to the board,
  discard, or Lost Zone binds its new public alias at exact accepted completion.
  Original and rebased sent aliases both reach the same physical card; stable
  own-seat aliases, identical-copy ambiguity, and later replacements retain
  their prior safe behavior (`5a6e6477`).
- **Pending save storage:** a conservative aggregate ledger budget refuses new
  reservations through the existing capacity response before one storage value
  becomes oversized. Same-operation retry, completion, expiry, and valid older
  ledger recovery remain available. The save/continuation feature stays disabled
  (`b5682d9b`).
- **Large room storage:** complete authority snapshots that exceed one native
  storage value now use bounded binary chunks, with generation, length, index,
  and SHA-256 validation. State, retry caches, frontier updates, cleanup, and
  ambiguous-write recovery remain atomic. Ordinary heads keep their native
  object representation; old v1–v6 state remains readable. Rollback binaries
  must retain the new chunk reader; see
  [the storage contract](../../../apps/server/SNAPSHOT_STORAGE.md)
  (`b5682d9b`).

The event contracts are recorded in
[the domain/persistence blueprint](../03-domain-network-and-persistence.md) and
[PX-041](../PARITY_EXCEPTIONS.md). Neither ordering mode changes the wire or
snapshot version. A rollback reader must understand retained event modes under
ADR-016; old unflagged events retain their prior reducer behavior.

## Validation

The final source is `a1ee5e18eec5fa4697c37a1c05e0f5c8e6ce6d12`.
[Hosted CI](https://github.com/xxmichaellong/ptcg-sim/actions/runs/40218457803)
passed all 14 jobs. It reported one Pixi theme/readability retry, with the
timing investigation recorded below. The two final Codex reviews returned no
actionable findings against this same source.

The complete local `check:ci` gate at `a1ee5e18` passed: 3,831 unit tests in
386 files, 53 native Durable Object runtime tests, legacy and tooling tests,
formatting, lint, translation sync, types, dependency boundaries, 818 public API
symbols, and web/Worker production builds. The new restore regression file has
19 cases, with baseline failures reproduced before their corresponding fixes.
Six separate native authority probe groups independently checked physical card
identity, stale replacements, original/sent keys, and the near-limit stack chain.
The final five viewer-drop, arrangement-privacy, and visibility-queue scenarios
passed in 15 executions across Chromium, Firefox, and GTK WebKit at `a1ee5e18`
in 2.6 minutes, with no retries. The preceding wider 61-case suite passed at
`d8c47919` in 8.7 minutes,
also without retries; hosted CI below supplies the final full-suite result.

Storage-specific verification enforced the documented
[platform value limit](https://developers.cloudflare.com/durable-objects/platform/limits/)
instead of relying on local workerd, which accepts oversized values. A native
V8 measurement reproduced a 2,540,706-byte pending ledger below count quotas;
the fixed admission path preserves the existing reservations. A valid room
above 2 MB round-trips with all 34 sessions' complete outcome caches. Native
SQLite probes cover concurrent writer rejection, migration, alarm and deletion
rollback, obsolete-part cleanup, and committed-then-threw recovery. The final
branch dependency audit reports no known vulnerabilities.

Earlier Codex CLI reviews at `b5682d9b` returned no actionable findings: the
completed overnight delta from `bd4bbf2c`, and an independent review of the
storage delta from `9c67a9a1`. The first reran all 3,803 unit tests and the 49
main Worker runtime cases; the second reran 507 server tests, 14 focused native
SQLite cases, and relevant type/API/boundary checks. Both review checkouts
remained clean. Earlier whole-PR review findings are closed by the recorded
fixes and native counterexamples.

The final two Codex CLI reviews at `a1ee5e18` returned no actionable findings:
the render-identity correction from `614e9b5c`, and the complete late change set
from `b5682d9b`. The first ran all 350 renderer/renderer-contract tests; the
second ran all 3,831 Vitest tests and browser TypeScript checking. Both clean
checkouts reviewed the same frozen final source.

The original quick viewer-drop regression reproduced on unchanged source five
times and passed five times after its fix; the full five-case viewer suite also passed
without retries. Motion unit tests cover quick touch release, alias/target
changes, and a fresh viewer action during an old landing. Twenty-one new client
runtime cases plus a separate 21-case native authority matrix cover public
arrivals and wrong-copy controls. Fresh-cache touch behavior has deterministic
unit coverage; supplemental CDP attempts established neither fresh-cache
native-browser touch coverage nor physical-device touch acceptance for this
viewer-drop path.
Additional permanent controls cover top/buried cards and successive moves into
recycled deck/discard covers. Independent matrices check 12 cover/gesture cases
and 16 successive-move cases, preserving explicit source keys, card identity,
fresh-menu behavior, and peer-publication paths.

The completed locale work covers all 20 languages: 40 tutorial geometry cases,
40 complete gesture/return flows, and 40 filtered Commands flows. These used
Chromium emulated mobile/touch at 320×740 and 812×375, the DOM renderer, and a
flat table. The geometry matrix alone inspected 1,920 settled coach frames using
Skip/Next; OS keyboards were not exercised. Focused permanent cases retain
actual taps, drags, keyboard traversal, and recipient artwork/alias checks.

The final source was built from a clean detached checkout and deployed only to
[the managed preview](https://ptcgsim-v2-preview.xx-michael-long.workers.dev),
Worker version `3f550b78-6585-419e-9a4d-c9065f854d4d`. Five health requests
confirmed the exact source build ID, protocol 2, authority schema 8, match schema
3, and continuation closed. Public catalog/feed/assets and the page returned
200; the hashed JavaScript retained immutable caching. The complete versioned
catalog contained 22,938 cards in 220 sets. Desktop name editing and single-Escape
close, Russian 320-pixel phone settings/editor layout (234-pixel name field),
physical discard Top ordering, and terminal inherited-reference rejection
followed by an accepted command all passed without application exceptions.
All four endpoint/UI/pile/reference processes exited cleanly. The final-head
two-peer resume check also completed with clean browser/process exit: recoveries
of 1,258 and 1,259 ms, then 13 further UI commands converging at revision 19 over
120 seconds, with no exceptions or opponent-hand disclosure. The final-head
queued-card window completed 48 native hand → board → Hide → Hand cycles in
191 seconds, with 146 accepted commands including setup, exact revision 146,
unique physical-card return on each cycle, no exceptions, and one socket with
no closes during the window. It recorded completion after browser shutdown and
the process exited zero. This short final-head check supplements the earlier
longer windows; it is not a new multi-hour soak.

Managed-preview evidence on the earlier CI-green `b52669b1` build:

- **Active two-peer window:** 14,418 seconds, 1,401 accepted UI coin flips, exact
  revision progression to 1,405, no application exceptions, and no opponent-hand
  disclosure. One simultaneous socket loss recovered both peers at the same
  revision in about four seconds; the cause was not observed. Forty-seven
  post-GC samples showed heaps between 38.74 and 41.92 MiB, with stable DOM and
  listener counts after warmup. The completion assertions were reached, but the
  tool returned process exit 143 afterward. This is completed assertion-window
  evidence with a teardown anomaly, not a clean-process or uninterrupted-run
  claim.
- **True idle two-peer window:** 3,603 seconds without gameplay input, with normal
  heartbeats and diagnostic polling: 240 convergence checks, unchanged revision 4,
  no exceptions or socket closes, stable post-GC resources, and clean browser
  shutdown/process exit. This does not certify background/suspend behavior.
- **Controlled resume:** each peer was separately taken offline and abnormally
  disconnected while its partner accepted a command. Recovery took 1,266 and
  1,264 ms; both peers then accepted 13 further UI commands and converged at
  revision 19, with no exceptions or opponent-hand disclosure.

## Review dispositions

- The first continuation review's duplicate-target-init concern was rejected
  after a real Worker probe: the pristine-target guard rejects the retry while
  the admitted hub remains live. Permanent runtime tests retain that proof.
- Shared local room-rate limits caused browser fixture failures; isolated test
  budgets corrected the harness without relaxing application limits.
- Landscape WebKit name tests required a native tap before typing into a
  scrolled field. Full-visibility assertions remain enabled.
- Firefox's replacement result reused the pointer's coordinates. The fresh-hover
  step now crosses a real boundary; pending/shown preview disposal assertions
  remain unchanged. The radio Tab stall was separately proved to be a product
  defect and fixed in the product.
- Hosted CI at `b5682d9b` passed all 14 jobs with one reported retry in the
  lifted-card test. Its trace and a controlled pause of actual lift-copy frames
  proved that copy existence did not establish current geometry. The test now
  polls the same strict containment predicate; identity, layer, drop, and cleanup
  checks remain unchanged (`08b2b7af`). This is separate from the genuine quick
  viewer-drop origin defect, which was fixed without relaxing its assertion.
- Final hosted CI at `a1ee5e18` reported one Pixi theme/readability timeout at
  its 45-second whole-test limit, then passed in 36.638 seconds. The trace shows
  time distributed across browser setup and UI actions; the final color poll
  failed immediately as the test budget expired, before its callback ran.
  Three isolated native Chromium repeats passed with the original 45-second
  limit and no retries (12.263, 11.867, and 11.693 seconds). No source assertion
  or timeout was relaxed. This is a recorded CI timing flake, not evidence of
  physical GPU performance acceptance.
- The new two-peer test explicitly waits for the guest's installed scene, since
  a ready session can precede renderer mounting. Its drag and disclosure
  assertions are unchanged.
- A first managed soak attempt coincided with deployment and had insufficient
  harness diagnostics. It is inconclusive, not a product regression. A clean
  WebSocket close was also an unsuitable reconnect fixture; the controlled probe
  uses an abnormal close. Recorded accepted results use the corrected harnesses.
- An initial own-seat queued-card run on `b5682d9b` stopped after 31 successful
  cycles when a Hide keypress sent no command. It observed neither a rejected
  command nor an application exception, but lacked enough pre-input diagnostics
  to explain the missed input. Instrumented follow-ups passed 47 cycles in
  188 seconds and 57 cycles in 615 seconds, both with clean process/browser exit.
  The first attempt remains inconclusive; the separate other-seat alias fix is
  not presented as its cause or cure. Final-head checks record explicit selected
  state before key input, avoiding a blind toggle of an already selected card.

## Remaining release evidence

Remaining release checks include current stable Chrome, Edge, Firefox, and Safari
smokes, Safari/iPadOS and physical touch/pen play, qualifying integrated/discrete
GPU performance, assistive-technology and visual acceptance, and an independent
security review. The managed preview observations
are not physical-device performance certification. Existing production routing,
rollout, continuation activation, and paid deck-index prerequisites remain
separate release decisions; this continuation does not waive them.
GitHub's default-branch dependency alerts are separate from this work branch's
clean audit; this work does not merge or change the default branch.
Remaining acceptance and coverage gaps stay recorded in
[QUALITY_GATES.md](../QUALITY_GATES.md).
