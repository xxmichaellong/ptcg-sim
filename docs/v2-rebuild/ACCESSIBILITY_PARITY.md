# First-release accessibility parity record

This document is the auditable evidence template for
[ADR-024](./ADR-024-FIRST-RELEASE-ACCESSIBILITY-PARITY.md). It verifies that the
under-the-hood rebuild preserves characterized accessibility behavior. It is
not a WCAG conformance report or a promise that every game operation is
available through every assistive technology.

## Contract boundary

Release-blocking behavior includes the characterized native-control semantics,
keyboard shortcuts and editable-target suppression, menu/dialog focus behavior,
recipient-safe activity and announcements, reduced-motion consumer behavior,
and non-disclosure of hidden information.

Formal WCAG 2.2 AA conformance, a named assistive-technology support matrix,
complete keyboard alternatives for pointer drag/drop, contrast redesign, and a
separate 200% zoom/reflow guarantee are deferred. The supported layout boundary
continues to be the CSS-pixel viewport in ADR-023. Findings in those deferred
areas should be recorded; they must not be represented as passing conformance
evidence.

## Automated evidence map

| Concern                                              | Current executable evidence                                                                                                                                                         | Release expectation                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Board roles, names, states, and zone activation      | `packages/renderer-dom/src/ReactDomBoardRenderer.test.tsx` and `apps/web/src/session/RemoteSessionBoard.test.tsx`                                                                   | Native card/zone semantics and recipient-safe labels remain green                                                      |
| Shortcut eligibility and editable-target suppression | `apps/web/src/board/LegacyBoardKeyboardShortcuts.test.tsx`, `tests/browser/react-dom-protected-input.spec.ts`, and paired `tests/browser/legacy-runtime-*-shortcut.spec.ts` cases   | Characterized live/replay/spectator/selection rules remain equal and fail closed                                       |
| Menu/dialog keyboard and focus behavior              | `apps/web/src/board/overlays/LegacyBoardOverlays.test.tsx`, `apps/web/src/features/deck/LegacyDeckBuilderWorkspace.test.tsx`, and `tests/browser/react-dom-protected-input.spec.ts` | Initial focus, traversal, Escape, containment, and opener return remain green                                          |
| Ordered accessible activity                          | `apps/web/src/presentation/AccessibilityAnnouncementDrain.test.ts` and `apps/web/src/presentation/LegacyPresentationSurface.test.tsx`                                               | Polite FIFO delivery, bounds, replacement, cancellation, and failure isolation remain green                            |
| Reduced-motion consumer contract                     | `apps/web/src/presentation/PresentationAnimationExecutor.test.ts` and `apps/web/src/presentation/PresentationConsumerRuntime.test.ts`                                               | Enabled preference bypasses/cancels motion without changing the resolved result                                        |
| Hidden-information non-disclosure                    | `tests/browser/renderer-private-asset-privacy.spec.ts` plus projection and recipient-safe presentation tests                                                                        | No hidden identity, URL, canonical ID, or private fact appears in the DOM/accessibility surface or network request set |
| Supported browser engines                            | `tests/browser/remote-room-solo-full-stack.spec.ts` through the Chromium and Firefox/WebKit configurations                                                                          | The focused real-room path remains functional with retries disabled; actual product smoke remains governed by ADR-023  |

This map is a maintained index, not permission to remove other applicable unit,
integration, browser, privacy, or parity tests. A replacement test must preserve
at least the same observable contract and be linked here in the same change.

## Manual release record

Complete one copy of this section for the first public v2 release candidate and
attach or link it from the release evidence. Repeat it after any later
accessibility-relevant change required by ADR-024.

| Field                                  | Recorded value                                           |
| -------------------------------------- | -------------------------------------------------------- |
| UTC date                               |                                                          |
| Commit/build/deployment                |                                                          |
| Operating system and version           |                                                          |
| Browser product and version            |                                                          |
| Screen reader and version              |                                                          |
| Content viewport in CSS pixels and DPR |                                                          |
| Input devices used                     | Keyboard and pointer; record any additional device       |
| Reviewer                               |                                                          |
| Result                                 | `PASS`, `BLOCKED`, or `PASS WITH RECORDED DEFERRED GAPS` |
| Linked defects/evidence                |                                                          |

### Setup

- Use a non-production test room and synthetic card/deck data.
- Exercise a player perspective and, where practical, a spectator or opposing
  perspective. Never place a real credential or private deck in the evidence.
- Keep the content viewport at or above 1280×720 CSS pixels for the binding
  desktop-layout pass. Record any zoom or smaller-viewport observation
  separately as best-effort evidence.
- Capture the browser accessibility tree or screen-reader transcript only when
  it contains synthetic, recipient-safe data.

### Keyboard and focus checklist

- Reach the characterized application sections and native controls by keyboard;
  visible focus is not lost, trapped outside a modal, or moved behind an open
  modal.
- Use representative characterized board shortcuts in valid and invalid modes.
  Focused text inputs retain native typing and do not submit a board command.
- Open an interactive zone with Enter or Space. Close its dialog with Escape and
  verify focus returns to the opener.
- Open a card context menu. Traverse top-level and nested actions with the
  characterized arrow, Home, and End keys; dismiss it and verify focus return.
- Open and close the characterized card, stack, deck, and custom-card dialogs.
  Verify their announced names, modal boundary, dismissal, and opener return.
- Record pointer-only operations encountered during the smoke. An unchanged
  pointer-only drag is a deferred gap under ADR-024, not evidence that the
  entire product is keyboard accessible.

### Screen-reader and announcement checklist

- Board cards and interactive zones expose only the current recipient-safe
  names, counts, and control states. Concealed cards have neutral labels.
- Activity is exposed as a named game log without independently re-announcing
  every visual rerender.
- Representative accepted actions produce one understandable polite status
  announcement in the same order as their activity facts.
- Replay entry, seek/restart, exit, reconnect, and teardown do not announce stale
  future activity or duplicate a completed announcement.
- Menus, dialogs, buttons, checkboxes, and text fields announce useful names,
  roles, and states. Record omissions or misleading state as defects.
- No concealed card name, private image URL, opaque canonical identifier,
  credential, or opponent-private fact is announced or visible in captured
  accessibility data.

### Motion and layout observations

- Keep the automated reduced-motion consumer tests attached. If the release
  exposes a caller or UI that enables `reducedMotion`, verify that enabling it
  cancels/bypasses animation and leaves the same resolved game result.
- Confirm the binding pass at the recorded supported CSS viewport. Optional 200%
  zoom, forced-colors, high-contrast, or smaller-viewport observations are
  recorded as non-binding findings, not silently treated as contract proof.

## Disposition rules

`BLOCKED` is required for a regression from characterized keyboard, focus,
semantic, announcement, reduced-motion, or privacy behavior; loss of a protected
required workflow; hidden-data exposure; unauthorized mutation; or state/data
corruption.

A demonstrably pre-existing gap outside ADR-024's explicit contract may be
recorded as deferred with reproduction steps, impact, and an owner or follow-up
decision. It may not be labeled fixed, accessible, or conformant. Ambiguous
baseline differences are treated as regressions until the parity owner resolves
them with evidence.
