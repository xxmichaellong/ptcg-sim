# V2 parity exceptions

- Status: **accepted seed register; expand when a newly discovered behavior is
  classified**
- Last reviewed: 2026-09-23
- Scope: intentional v2 departures from observable v1 behavior

## Rule

V2 preserves the existing UI, controls, gestures, and outcomes unless a row here
or a dedicated ADR authorizes a difference. `APPROVED_FIX` applies only when the
legacy result is a demonstrable correctness or lifecycle defect and the intended
visible workflow remains unchanged. `SECURITY_EXCEPTION` applies only when
preserving v1 would disclose or grant unauthorized state. Deferred compatibility
must have product-owner approval.

Every new exception requires reproducible v1 evidence, a v2 regression test,
security and persistence review where relevant, and release-note disposition.

## Accepted exceptions

| ID     | V1 behavior                                                                                                                                 | V2 disposition                                                                                                                                               | Class                | Evidence                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| PX-001 | A replay/lifecycle shortcut guard references the Alt helper rather than invoking it, allowing historical state to reach mutation routing.   | Replay remains read-only; the affected shortcuts submit nothing while replaying.                                                                             | `APPROVED_FIX`       | `ADR-004-BOARD-RENDERER.md`; shortcut bridge and browser replay tests                                           |
| PX-002 | A drag self-target check compares an element with `draggedImage[0]`, so a logically inert self/same-container drop can enter mutation code. | Semantic drop resolution rejects self, same-zone, and unsupported-source no-ops before command submission.                                                   | `APPROVED_FIX`       | `packages/interaction-controller`; `tests/multiplayer/client-server-session.test.ts`; native drag browser tests |
| PX-003 | Preview/counter paths can install repeated global and resize listeners.                                                                     | One route/lifecycle owner installs bounded listeners and removes them deterministically, including StrictMode remount and active-gesture teardown.           | `APPROVED_FIX`       | `packages/interaction-controller`; `apps/web/src`; lifecycle, churn, and browser teardown tests                 |
| PX-004 | Failed image preloads can leave stale nodes or requests coupled to the board.                                                               | Native image failure is contained in a stable neutral surface; stale asynchronous completion cannot change logical state or retarget a reused node.          | `APPROVED_FIX`       | `packages/renderer-dom/src/ReactDomBoardRenderer.test.tsx`; asset lifecycle/browser tests; ADR-013              |
| PX-005 | `refreshBoard()` can reorder/move logical arrays to repair visual hierarchy.                                                                | Layout and refresh are pure projections. They preserve characterized geometry without mutating domain state, identity, or order.                             | `APPROVED_FIX`       | ARCH-003; `packages/renderer-contract`; `LEGACY_BOARD_LAYOUT_ORACLE.md`; renderer parity suites                 |
| PX-006 | UI, package, action-export, and saved data versions can disagree.                                                                           | Build, wire protocol, authority snapshot, match state, event/replay, and file formats use separate explicit versions and migrations.                         | `APPROVED_FIX`       | Protocol constants; durable/file migrations; health endpoint; schema compatibility tests                        |
| PX-007 | V1 save import applies positional actions incrementally and has unreliable version gating.                                                  | The quarantined converter is bounded, allowlisted, version-selected, invariant-checked, and all-or-nothing; ADR-021 keeps it unwired in the first release.   | `SECURITY_EXCEPTION` | `packages/legacy-import`; `LEGACY_IMPORT.md`; ADR-021                                                           |
| PX-008 | Four-character save keys can collide and overwrite data.                                                                                    | V2 never preserves this key space or overwrite behavior. Future continuation uses distinct high-entropy, digest-stored, expiring capabilities under ADR-012. | `SECURITY_EXCEPTION` | PERSIST-004; ADR-012; collision and credential-boundary tests                                                   |
| PX-009 | A default administrative password can create a production authority boundary.                                                               | V2 inherits no default admin credential and fails closed when required deployment configuration is absent or invalid.                                        | `SECURITY_EXCEPTION` | SEC-001/SEC-003; server configuration, bundle-boundary, and telemetry redaction tests                           |
| PX-010 | Solo undo derives from two client-side action histories, so interleaved shared changes have no single reliable last-command order.          | V2 keeps the same visible Undo control but uses authoritative whole-match order and exact resolved outcomes, reading the bounded replay history (ADR-026).   | `APPROVED_FIX`       | ADR-014; ADR-026; game-core and room-authority undo tests                                                       |

## Product-requested departures

These change v1's look or behaviour on purpose, at the owner's request during
play testing. Each one sits behind a single named constant or guard, so
restoring v1 exactly is a one-line change.

| ID     | V1 behavior                                                                                                                                    | V2 disposition                                                                                                                                                                                              | Class             | Evidence                                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------- |
| PX-014 | `#bench div { margin-right: 1% }` sets the whole gap between bench groups.                                                                     | `LEGACY_BENCH_GROUP_GAP_BONUS_RATIO` adds half of itself to each side of every bench container, so the gap between neighbours grows by that ratio of the bench row while a centred row keeps v1's position. | `PRODUCT_REQUEST` | `layout.test.ts` pins v1's own spacing with the bonus off and the delta on                                  |
| PX-015 | `.full-view img { height: 24% }` paints every card of a stack expansion at one size, leaving a short stack adrift in an otherwise empty popup. | `legacyStackPreviewCardHeightRatio` picks the largest size that still fits the set, capped so one card cannot fill the panel and floored at v1's 24%, past which rows spill exactly as v1's do.             | `PRODUCT_REQUEST` | `layout.test.ts` covers the fit, the monotonic shrink and the v1 floor                                      |
| PX-016 | Undo exists only in Solo; v1 removed `p2UndoButton` and the two-player `u` keybind.                                                            | A multiplayer player has `#p2UndoButton` and `u`, and instantly takes back their own move while it is still the newest one standing. Restoring v1 is one guard in `resolveWireCommand`.                     | `PRODUCT_REQUEST` | ADR-026; `process-command.test.ts`; `client-server-session.test.ts`; `remote-room-lobby-full-stack.spec.ts` |

## Open differences awaiting a product decision

The [2026-09-23 file review](reviews/2026-09-23-v1-transfer-review.md) records
differences beyond PX-013. These are **open findings, not approved
exceptions**, and the review's inventory supersedes earlier broad SAME claims.
Carried since it was written: decklist-versus-alphabetical sorting (F-01),
live-session leave warnings (F-02), popup ingress (PX-013/F-05), loose-board
sizing and append scrolling (F-03) and prize card sizing (F-07, whose
default-background half turned out not to be a difference) are implemented and
closed, as are the flipped-seat ephemeral announcements (F-10) and the
source-data maintenance gap (F-09). No finding from that review is open.

PX-013 was the only row in this section and is now closed. The review keeps
the original findings and records their later resolution separately.

## Resolved after the 2026-09-23 review

PX-013 is closed. `zones.js` registers the open `viewCards` / `attachedCards`
popups as drop targets, and v2 now does the same: `MoveCardToWorkArea` takes a
card from a zone, a play stack, or the other popup into the open work area,
restoring its out-of-play look (original category, face up, upright, marker
cleared) and inheriting the inspection's viewers, and the battle log prints
v1's line ("moved X from hand to deck", "to attached cards"). A loaded host
takes its stack with it exactly as v1's `relocateAttachedCards` does. Its
dependents open the attached-card window or join that window when it is already
open, whether the host moves into either popup or an ordinary zone. Evidence:
`work-area-arrival-commands.test.ts`, `movement-departures.test.ts`,
`resolve-work-area-arrival.test.ts`, `resolveBoardDrop.test.ts`,
`predictWireCommand.test.ts`, `narration-events.test.ts`.

Review qualification: [F-05](reviews/2026-09-23-v1-transfer-review.md#f-05--medium--open-popup-ingress-is-only-partially-restored)
raised the top-card-with-dependents refusal as an open parity gap, because
legacy `relocateAttachedCards` stages those dependents. That compound move is
now implemented and covered by `work-area-arrival-commands.test.ts`. A later
review also removed the remaining occupied-window refusal; source departures
append to the existing attached-card work area and preserve its ID. F-10 was
also closed after the original review.

## Resolved after the 2026-09-17 audit

The two behaviours the file-by-file audit left open were carried on the
owner's decision the same day: a flipped board now acts for the seat at the
bottom (Solo, or a room where both players enabled board flip), with the
actor-bound wire commands naming that seat; and an overflowing hand keeps its
cards full size and scrolls, as v1's `#hand { overflow-x: auto }` does.

## Approved compatibility deferral

ADR-021 defers v1 saved-game/action-history files and old `/import?key=` share
links from the first v2 release. Deck import and v2 perspective replay import
remain in scope. This deferral is not permission to drop any other workflow.

## Rollback and review

An exception can be removed by restoring parity only when doing so does not
reintroduce the recorded correctness, security, or lifecycle failure. If a fix
changes a visible workflow beyond the row above, pause that slice and obtain a
new product decision rather than broadening the exception in implementation.
