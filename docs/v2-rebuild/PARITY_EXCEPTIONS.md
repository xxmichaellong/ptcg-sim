# V2 parity exceptions

- Status: **accepted seed register; expand when a newly discovered behavior is
  classified**
- Last reviewed: 2026-09-14
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
| PX-010 | Solo undo derives from two client-side action histories, so interleaved shared changes have no single reliable last-command order.          | V2 keeps the same visible Solo-only Undo control but uses authoritative whole-match order, exact resolved outcomes, and a bounded 128-checkpoint tail.       | `APPROVED_FIX`       | ADR-014; game-core and room-authority solo-undo tests                                                           |

## Open differences awaiting a product decision

| ID     | V1 behavior                                                                                                                                               | V2 today                                                                                                                                            | Status | Evidence                                             |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------- |
| PX-011 | In Solo, flipping the board makes the other seat the "self view": its deck menu gains Draw card(s), its hand menu the discard/shuffle entries, and so on. | The flip only turns the table; wire `DrawCards` and the hand commands act on the submitting seat, so the other seat's own-only entries stay hidden. | `OPEN` | `V1_FILE_AUDIT.md`; `keybinds.js`, `click-events.js` |
| PX-012 | A hand wider than its row keeps every card full size and scrolls horizontally (`#hand { overflow-x: auto }`, `adjustAlignment`).                          | The row compresses the cards to fit.                                                                                                                | `OPEN` | `V1_FILE_AUDIT.md`; measured 27-card hands on both   |

## Approved compatibility deferral

ADR-021 defers v1 saved-game/action-history files and old `/import?key=` share
links from the first v2 release. Deck import and v2 perspective replay import
remain in scope. This deferral is not permission to drop any other workflow.

## Rollback and review

An exception can be removed by restoring parity only when doing so does not
reintroduce the recorded correctness, security, or lifecycle failure. If a fix
changes a visible workflow beyond the row above, pause that slice and obtain a
new product decision rather than broadening the exception in implementation.
