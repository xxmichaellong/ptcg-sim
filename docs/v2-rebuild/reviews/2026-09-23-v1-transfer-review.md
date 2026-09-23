# V1 → V2 transfer review — 2026-09-23

## Result

**145 / 145 tracked files under `client/` and `server/` individually accounted
for. The transfer is not ready for an unconditional parity signoff.**

The [file inventory](2026-09-23-v1-file-inventory.md) records each file's purpose,
rendered behavior or interaction, v2 implementation, disposition, and evidence.
The [JSON inventory](2026-09-23-v1-file-inventory.json) additionally records each
source SHA-256 and complete target paths. No directory wildcard substitutes for
individual files. Baseline: `0264d859d05a0b027aaca80e31ffb36568ab8b97`.

Seven transfer findings remain open, and browser verification has an additional
unexpected-navigation blocker (B-01, below).

Two concrete defects were fixed during this review: an empty-deck turn revealed
hidden cards, and the bundled background choices depended on the old site's
asset URLs. Other differences below remain explicit follow-up work. This review
supersedes broad SAME claims in the earlier `V1_FILE_AUDIT.md`.

## Disposition since this review

Recorded after the review was written; the findings above are left as the
reviewer stated them.

- **F-01 closed.** The projection now discloses a display-only `decklistRank`
  on cards the viewer may read, taken from the owner's deck baseline, and both
  the hand sort and the zone browser paint that order. Every copy of a name
  shares the rank of its first declaration, so no new way to tell two copies
  apart is disclosed. Evidence: `decklist-rank-projection.test.ts`,
  `hand-sort-display.test.ts`, `LegacyBoardOverlays.test.tsx`.
- **F-02 closed.** `installLeaveGuard` restores v1's application-wide
  `beforeunload` prompt at startup. Evidence: `leave-guard.test.ts`, plus the
  navigation-heavy browser specs passing with it installed.
- **F-05 closed.** The compound move the finding asked for is implemented: a
  host dragged into a popup takes its stack with it and stages the dependents,
  as `relocateAttachedCards` does. What remains is v2's one-open-window rule,
  which already governs every other stack departure. Evidence:
  `work-area-arrival-commands.test.ts`.
- **F-03 closed.** The loose board now reproduces `#board`: images 70% of the
  content height with `.25vw` margins, lines centred and bottom-aligned, and
  `overflow-y: auto` once a second line appears, which it always does because
  70% twice is more than the box. The renderer scrolls to the bottom when
  cards arrive, as `board-observer.js` does. Measured against the real v1
  runtime at 1440x900 (94.5px cards, 73.05px step, rows 99.94px apart) and
  pinned in `scene.test.ts`.
- **F-07, prize half closed.** Prizes are laid out as v1's inline block: two
  per line, `margin-left: .1vw`, `max-width: calc(50% - .1vw)`, and the prize
  observer's 33%/23% maximum height, whichever binds first. Measured against
  the real v1 runtime (31.5 x 44.016 cards at x 6.078/38.656, lines 48.016
  apart -- the 4px inline baseline gap) and pinned in `scene.test.ts`. Above
  six prizes the extra lines overflow the box, as the source block does.
- **F-07, default background half: not a difference.** `styles.css` puts v1's
  wallpaper, its `-200px` offset, its 75% white gradient and the 85% `#cover`
  sheet on the room route. The radial gradient the finding cites is the outer
  app shell behind that route. The prize-sizing half stands.
- **F-10 closed.** The three ephemeral paths now carry the seat the sender is
  acting for -- v1's `systemState.initiator`, which a flipped board moves to
  the other seat -- for chat lines, mulligan declarations and deck-view
  declarations. The room authenticates the request against the sender's own
  seat and v1's flip rules (Solo, or a room where both players enabled board
  flip) and falls back to the sender's seat otherwise, so it asks for
  attribution rather than asserting it; a name that is not a seat in the room
  is refused the same way. Evidence: `session-acting-seat.test.ts`,
  `room-chat.test.ts`, `session-hub.test.ts`,
  `RemoteRoomLiveControls.test.tsx`. v1's other deck-view wording, where the
  deck owner differs from the actor, belongs to its deck-cover click; v2's
  `V` keybind opens the acting seat's own deck, which is v1's keybind path.
- **`.vscode/launch.json` corrected.** It launched Chrome against the legacy
  `localhost:4000`; it now points at the v2 dev server.
- **F-09 closed.** `scripts/generate-legacy-old-card-types.mjs` replaces v1's
  `find-old-type-database_updater.py`: same upstream corpus, same key and
  run-length shape, run with `--data <clone>`, plus a `--check` mode that
  reports every committed threshold a newer corpus would contradict and counts
  the keys it adds. The provenance comment in `legacy-card-type-lookup.ts`
  now points at it. Evidence: `generate-legacy-old-card-types.test.mjs`.
- **B-01 explained.** The renderer-churn spec navigates to the lobby when the
  Vite dev server hot-reloads mid-run, which is what concurrent edits to the
  workspace during the review caused. The same spec passes on a quiet tree:
  205/205 in the renderer lane at `4e9c251`, and an isolated rerun of
  `remote-room-solo-renderer-churn.spec.ts` passed in 5.9 minutes. Do not run
  the browser gate while editing the workspace.

## How the review was performed

- Read the legacy action, initialization, event, deck, image, settings, sizing,
  networking and server implementations, including dormant helpers and tests.
- Trace responsibility through v2 command decisions, event application,
  recipient projection, session routing, interaction resolution, scene layout,
  React controls, styles and existing regression tests.
- Review visible controls and their access paths: mouse, keyboard, context
  menus, prompts, confirmation dialogs, drag targets, popup resolution, replay,
  solo acting seat, room role, reconnect and teardown.
- Review markup and styles separately from command semantics. A working button
  does not establish matching geometry, overflow or interaction behavior.
- Compare complete static data structures and binary assets, rather than
  sample entries. Validate inventory coverage, source hashes and target paths.
- Run the repository quality gate and browser characterization suites. Tests
  that intentionally encode a changed behavior are evidence of implementation,
  not evidence that the change matches v1.

`Mapped` in the inventory means a traced implementation and named regression
evidence exist. It does not claim every possible state or every pixel was tested.
Tests named in rows are evidence locations; execution results are below.
The source of truth for this pass is the checked-in legacy tree, not a remotely
hosted version which may have changed independently.

## Findings

### F-01 — Medium — OPEN: Sort changes the user's decklist order

Trace: [V1 sorting](../../../client/src/actions/zones/general.js) · [V2 hand sorting](../../../apps/web/src/session/hand-sort-display.ts) · [V2 zone browser](../../../apps/web/src/board/overlays/LegacyBoardOverlays.tsx).

**Legacy:** `client/src/actions/zones/general.js` iterates the deck's declared
card names and appends matching images in that order. Sorting affects the
display, without rewriting the underlying game order.

**V2:** `apps/web/src/session/hand-sort-display.ts` and the zone browser in
`apps/web/src/board/overlays/LegacyBoardOverlays.tsx` sort alphabetically.
Current tests explicitly expect alphabetical order. A deck declared with Z
before A is sufficient to expose the difference. The affected UI includes hand,
deck, discard and lost-zone sorting.

**Required closure:** preserve declared decklist rank in display-only metadata,
including duplicate-name handling. Only disclose metadata for cards the viewer
may know; do not expose hidden deck composition to restore a display feature.
Add a nonalphabetical source/candidate comparison. The earlier audit called this
SAME while describing the changed behavior in the same row.

### F-02 — High — OPEN: Leaving a live game has lost its warning

Trace: [V1 leave guard](../../../client/src/initialization/document-event-listeners/window/window.js) · [V2 lobby lifecycle](../../../apps/web/src/session/RemoteRoomLobby.tsx) · [Draft guard](../../../apps/web/src/features/deck/deck-browser-io.ts).

**Legacy:** `initialization/document-event-listeners/window/window.js` registers
a `beforeunload` warning for leaving the page.

**V2:** the only `beforeunload` registration found is the dirty deck-builder
guard in `features/deck/deck-browser-io.ts`. Session routes do not install an
equivalent live-game warning. `RemoteRoomLobby.tsx` disposes room ownership on
nonpersisted `pagehide`; that cleanup is not a leave confirmation.

**Impact:** accidental reload/close/navigation can discard the current session
without the source warning. Continuation support does not itself restore this
UX or prove automatic recovery of every unsaved session.

**Required closure:** a session-owned guard covering active and parked live
games, with route cleanup and browser confirmation tests. Define behavior for
replay and intentionally finished sessions explicitly. The deck-draft guard
alone does not close this finding.

### F-03 — Medium — OPEN: Loose-board sizing and append scrolling differ

Trace: [V1 append observer](../../../client/src/initialization/mutation-observers/board-observer.js) · [V1 frame styles](../../../client/src/css/self-containers.css) · [V2 layout](../../../packages/renderer-contract/src/scene.ts).

**Legacy:** `self-containers.css` gives loose-board cards 70% height with .25vw
margins in a wrapping, vertically scrollable region.
`mutation-observers/board-observer.js` scrolls to the bottom when cards arrive.

**V2:** `layoutBoardGrid` in `packages/renderer-contract/src/scene.ts` chooses a
count-dependent grid with up to six columns and scales cards into cells.
`BoardSurface.tsx` provides hand scrolling, but no equivalent loose-board scroll
owner. New arrivals shrink/reflow the grid rather than retaining card size and
scrolling into view.

**Required closure:** reproduce source sizing, wrapping, scroll position and
append behavior, including flipped coordinates and drop hit testing. Compare
one-card and dense-board states, not just empty zone bounds.

### F-04 — High — FIXED: Empty-deck StartTurn revealed hidden in-play cards

Trace: [V1 turn](../../../client/src/actions/general/take-turn.js) · [V2 decision](../../../packages/game-core/src/decide-command.ts) · [Regression](../../../packages/game-core/src/table-action-commands.test.ts).

**Legacy:** `actions/general/take-turn.js` reveals cards only inside the
nonempty-deck branch. Cleanup still occurs when the deck is empty.

**V2 before this review:** `decideTableAction` emitted `InPlayCardsRevealed`
before checking the deck. An unsuccessful draw could publicly expose face-down
in-play card identities. Its unit test expected that incorrect behavior.

**Change:** move reveal-event construction after the empty-deck return; retain
cleanup and `TurnStartFailedNoDeck`. Update the regression to require a still
face-down card and no reveal event. Existing successful-turn coverage still
requires revealing and drawing. No event schema or historical replay mutation
is needed. See `packages/game-core/src/table-action-commands.test.ts`.

### F-05 — Medium — OPEN: Popup ingress is only partially restored

Trace: [V1 dependent staging](../../../client/src/actions/move-card-bundle/relocate-attached-cards.js) · [V2 decision](../../../packages/game-core/src/decide-command.ts) · [V2 drop routing](../../../apps/web/src/board/resolveBoardDrop.ts).

**Legacy:** table `zones.js` registers `viewCards` and `attachedCards` as drop
targets. A card can be dragged into an already open set being resolved, as well
as dragged out. This is the pre-existing PX-013 gap.

**Reviewed baseline:** `resolveBoardDrop.ts` rejected these destinations.
Independent working-tree edits during this review added `MoveCardToWorkArea`
across domain/events, protocol, authority, prediction and drop resolution. Credit
that restoration separately from this review's changes.

**Remaining concrete difference:** `workAreaArrivalSource` in
`packages/game-core/src/decide-command.ts` refuses the top evolution card if its
stack still has lower stages or attachments, requiring the user to detach first.
Legacy `move-card.js` calls `relocateAttachedCards` after moving that top card;
for a destination outside active/bench, `relocate-attached-cards.js` moves the
dependents into `attachedCards`. For example, moving an active host with an
Energy into `viewCards` moves the host and stages its Energy in the source.
The new command rejects that workflow.

The concurrently updated exception register calls PX-013 closed and explicitly
mentions this remaining refusal. **This review does not count that as full
parity:** restore the compound departure, with atomic work-area ownership and
visibility, or record a scoped product decision for the extra detach step.
Add a source/candidate regression for this host-plus-dependent case. Existing
simple-card ingress tests alone cannot close it.

### F-06 — Medium — FIXED: Theme assets depended on the retired v1 origin

Trace: [V2 backgrounds](../../../apps/web/src/session/browser-room-background.ts) · [Regression](../../../apps/web/src/session/browser-room-background.test.ts).

**Legacy:** theme backgrounds are `background1.jpg` and `background2.webp`.

**V2 before this review:** card back, logo and favicon were bundled, but theme
selection still returned `https://ptcgsim.online/src/assets/...` URLs. Retiring
or reorganizing the old host could break these choices.

**Change:** copy both original images to `apps/web/public/v2/assets/` and return
local `/v2/assets/` URLs in `browser-room-background.ts`. Update its tests.
All five original binary assets now compare byte-for-byte with the v2 copies.
Custom URL validation, blank backgrounds and random theme choice are preserved.

### F-07 — Medium — OPEN: Prize sizing and default background are not identical

Trace: [V1 prize observer](../../../client/src/initialization/mutation-observers/prizes-observer.js) · [V1 defaults](../../../client/src/initialization/global-variables/global-variables.js) · [V2 styles](../../../apps/web/src/styles.css).

**Prize sizing:** the source prize observer uses a 33% maximum card height up
to six prizes and 23% above six, with source padding/width constraints. V2
`layoutPrizeGrid` uses two columns, a variable row count and `fitCard(..., 0.96)`.
This is a different sizing function, especially around seven through nine cards
and dense overflow. Checking the region's outer rectangle does not establish
card geometry parity.

**Default background:** source `global-variables.js` and `index.css` establish
the wallpaper image, offset and white cover treatment. V2 `styles.css` starts
with a radial gradient. Bundling the two selectable themes in F-06 does not
restore the separate default backdrop.

**Required closure:** source/candidate screenshots and geometry at the count
transitions and across resize/flip, plus either restoration or an explicit
product decision accepting each visual change. No such acceptance was found
in the existing exception register.

### F-08 — DOCUMENTED CORRECTION: StartTurn clears both loose boards

Trace: [V1 turn](../../../client/src/actions/general/take-turn.js) · [Existing decision record](../../../docs/v2-rebuild/LEGACY_ACTION_MAP.md).

Legacy `take-turn.js` calls `discardBoard(initiator, ...)` twice, varying only
the message initiator. V2 clears both players' loose boards. This is already
explicitly documented as an intentional source defect correction in
`LEGACY_ACTION_MAP.md`, under the implemented table-action subset, and covered
by table-action tests. Keep that explanation attached to the migration;
describing it as identical behavior would be misleading. This is separate from
the empty-deck reveal defect fixed in F-04.

### F-09 — Low — OPEN: Historical type-data maintenance has no v2 workflow

Trace: [V1 generator](../../../client/src/setup/deck-constructor/find-old-type-database_updater.py) · [V2 data](../../../packages/deck-core/src/legacy-old-card-types.json).

`find-old-type-database_updater.py` is the offline source-data generator. Its
runtime output has been preserved exactly in `legacy-old-card-types.json`,
but no v2 regeneration command/procedure was found. The retained Python tool
still targets the legacy layout and depends on a separately cloned corpus.

**Required closure:** document reproducible conversion, source provenance and
validation, or supply a v2 generator. This is a maintenance/knowledge-transfer
gap, not a current card-type-data mismatch.

### F-10 — Low — OPEN: Flipped-seat ephemeral announcements retain connected identity

Trace: [V1 Solo chat](../../../client/src/initialization/document-event-listeners/sidebox/p1/chat-buttons.js) · [V2 announcement identity](../../../apps/server/src/session-hub.ts) · [V2 formatting](../../../apps/web/src/presentation/PresentationEffects.ts).

This was already noted in the earlier audit and remains unresolved. Legacy
Solo chat and mulligan declarations use `systemState.initiator`; deck-view
messages distinguish the acting player from the inspected deck owner.

V2 `RemoteSessionBoard.tsx` calls argument-free `declareMulligan()` and
`declareDeckView()`. In `apps/server/src/session-hub.ts`, the resulting
announcements use `session.viewer.playerId`, regardless of the flipped acting
seat. `PresentationEffects.ts` formats deck-view messages using that same player
for both actor and deck owner. Seat-bound game commands now carry the acting
seat, so their correct narration does not prove these ephemeral paths match.

**Required closure:** carry and authorize the intended acting seat (and deck
owner where applicable), while preserving authenticated chat attribution in
multiplayer. Compare flipped Solo chat/mulligan/deck-view messages to the source.
Do not allow an arbitrary sender-name field to bypass role checks.

## Decisions and dormant code checked

- V1 positional saved-game files and `/import?key=` links are deferred by
  ADR-021. That does not defer deck import, v2 replay, or v2 continuation flows.
- Weak save keys and default admin credentials are replaced by the security
  boundaries recorded in PX-007 through PX-009. Client action broadcasts become
  authoritative commands, events and recipient projections. This is a traced
  architecture change, not a claim that synchronization bugs are impossible.
- Solo undo uses the bounded authoritative history in ADR-014 / PX-010.
  Opponent private inspection follows the consent rules in ADR-017.
- `add-action-data.js` and `native-deck-builder-load-feedback.js` have no source
  call sites. Their absence as standalone v2 modules does not remove a live
  user interaction. Their individual inventory rows explain the replacements.
- `pop-up-message.js` is used for own-hand reveal confirmation. The previous
  audit incorrectly described it as deck-import error UI; that row is corrected.
- EJS injection, iframe documents, CDN Socket.IO bootstrapping and DOM mutation
  observers are replaced by explicit route/render/lifecycle ownership. The old
  analytics beacon is not carried; it is an operational difference, not game
  state. Matching controls alone is insufficient to mark all CSS as SAME.

## Shared root support files

The complete frozen application tree is the 145-file inventory. These shared
repository files have no independent game UI and were checked separately:

| File                           | Responsibility and current handling                                                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitattributes`               | Shared text handling remains in place.                                                                                                                                      |
| `.gitignore`                   | Shared generated/dependency/local artifacts exclusion; retained.                                                                                                            |
| `.prettierignore`              | Formatting exclusions; legacy/generated sources remain separate from v2 formatting gates.                                                                                   |
| `.prettierrc`                  | Shared format policy; retained and used by v2 checks.                                                                                                                       |
| `.vscode/extensions.json`      | Editor extension suggestions; retained developer support.                                                                                                                   |
| `.vscode/settings.json`        | Editor preferences; retained developer support.                                                                                                                             |
| `.vscode/launch.json`          | Chrome launcher still targets legacy localhost:4000; not a v2 launcher. Follow v2 README commands for v2 development.                                                       |
| `.github/workflows/deploy.yml` | Explicit dispatch of v2 Worker deployment/rollback with quality gate and health check; old server deployment mechanics are retired. No deployment performed in this review. |
| `.github/workflows/ci.yml`     | V2 quality gates plus legacy characterization; behavior confidence remains bounded by test coverage.                                                                        |
| `package.json`                 | Workspace orchestration, retained legacy tests and v2 validation/build commands. Legacy client/server manifests are separately inventoried.                                 |
| `pnpm-lock.yaml`               | Shared dependency resolution for both application generations; retained legacy manifests are inventoried separately. Lockfile bytes are not a behavior-parity contract.     |
| `README.md`                    | Shared entry point and development commands; app/package documentation now carries v2 architecture and operation.                                                           |
| `LICENSE`                      | MIT license and copyright retained at repository root.                                                                                                                      |

## Verification

Complete corpus equality checks passed:

- All **22** popular-decklist groups, including complete deck texts, equal the
  v2 JSON data after evaluating the source data declaration.
- All **106** card-type set groups equal `legacy-card-types.json`.
- All **243** historical type groups equal `legacy-old-card-types.json`.
- All **five** original binary assets equal their bundled v2 counterparts.
- The complete changelog has identical normalized visible text (**22,030**
  characters), including all retained release entries.
- Inventory paths exactly equal `git ls-files client server`: 145 unique rows,
  no missing/extra source files, matching source hashes and existing target paths.
  Every named test evidence filename resolves in the repository.

`corepack pnpm run check:ci` passed on the final implementation tree:

- **79 / 79** legacy tests.
- **245 / 245** v2 test files, **2,457 / 2,457** tests.
- **30 / 30** runtime tests across the 26 + 2 + 2 suites.
- Formatting, lint, source/API boundaries, cycle checks, type checks, tooling
  tests, builds and bundle boundaries.
- The two fixes also passed a focused rerun: **10 / 10** tests.

The initial full gate also passed (243 files / 2,448 v2 tests). Intermediate
reruns stopped at a formatting issue in concurrently edited `apply-events.ts`;
formatting was corrected before the successful final gate. Concurrent popup
implementation accounts for the added test files/cases; passing them does not
resolve the remaining compound-move difference in F-05.

The default browser binary could not launch in this Nix environment because of
missing shared libraries. A compatible installed Chromium was selected through
`PTCGSIM_CHROMIUM_PATH`. Its first run passed 159 tests before the preview server
became unavailable: three connection-refused failures and 43 tests not run. Those
results do not establish three product regressions or a clean full browser pass.

The full Chromium rerun completed with **204 passed / 1 failed**. The remaining
failure is `remote-room-solo-renderer-churn.spec.ts:505`: during the measured
setup/reset loop, the page navigated from live revision 386 to the empty lobby
at revision 1 instead of reaching expected revision 388. It failed before the
final memory assertions. The log also contains WebSocket proxy EPIPE messages;
these do not establish the navigation's cause. This run overlapped concurrent
workspace activity, so neither a product regression nor an environmental cause
has been established. The browser gate is not marked clean on this evidence.
An isolated rerun also failed, after 19.2 seconds during warmup: closing a deck
browser was expected to restore focus to its deck zone, but the page navigated
to the same lobby URL and the original zone disappeared. The failure was at
`churnDeckZoneBrowsers`, line 161, rather than the first run's revision assertion.
This reproduces the unexpected-navigation symptom outside the full test suite.
It still does not identify the root cause or prove a retained-memory defect.

**Verification blocker B-01:** investigate the navigation trigger and rerun the
full 40-warmup / 100-measured-cycle test successfully before calling the browser
gate clean. Keep this separate from the seven established transfer findings.
The test has tracing disabled to avoid distorting its memory measurement; the
failed screenshot and context are under
`test-results/remote-room-solo-renderer--7c412-n-converges-route-resources-chromium/`.

Reproduction command (with a working Chromium installation):

```sh
corepack pnpm exec playwright test tests/browser/remote-room-solo-renderer-churn.spec.ts --project=chromium
```

No new exhaustive all-state/pixel equivalence claim is made. Release closure
requires resolving the open findings above or recording an explicit, scoped
product decision for each intended change.
