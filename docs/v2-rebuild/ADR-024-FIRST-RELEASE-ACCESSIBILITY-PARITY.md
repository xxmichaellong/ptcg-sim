# ADR-024: preserve characterized accessibility behavior without a conformance claim

- Status: **ACCEPTED**
- Decision date: 2026-09-14
- Scope: first v2 release accessibility contract and evidence boundary

## Context

The rebuild is intended to replace internals without redesigning the existing UI
or UX. The current product and the implemented v2 route already have meaningful
accessibility behavior: native buttons and form controls, keyboard shortcuts,
protected text-entry targets, keyboard-operable menus and dialogs, focus return,
recipient-safe activity text, a polite live region, and an internal reduced-
motion consumer contract.

Those behaviors do not amount to a completed accessibility conformance audit.
The project has not established a WCAG 2.2 AA claim, a formal assistive-
technology/browser support matrix, complete keyboard alternatives for every
pointer operation, or a 200% zoom/reflow contract. Promising those in the first
release would introduce new product and UI work whose scope and evidence are not
part of the under-the-hood rebuild.

## Decision

The first v2 release must preserve every accessibility behavior that is
explicitly characterized by the v1 parity evidence or already forms part of the
accepted v2 surface. This is a parity commitment, not a formal conformance
claim.

The binding first-release behavior is:

- Existing native buttons, links, inputs, and labels remain native controls with
  their current accessible names, roles, enabled state, expanded/current state,
  and pressed/selected state. Recipient-safe board cards remain buttons, and
  interactive zones retain their button semantics and Enter/Space activation.
- Every characterized board shortcut preserves its exact eligibility rules,
  mode and selection preconditions, and editable-target suppression. Replay,
  spectator, stale, empty, and unauthorized cases continue to fail closed.
- Characterized menus preserve initial focus, arrow/Home/End navigation,
  submenu behavior, Escape dismissal, and focus return. Characterized dialogs
  preserve their names, modal semantics, focus boundary, keyboard dismissal,
  and opener focus return.
- The game activity surface remains a named log. Accessibility announcements
  remain polite, atomic, ordered, bounded, cancellable, and independent from
  visible animation. Replay replacement or teardown cannot announce stale
  future activity.
- The existing `BoardPreferences.reducedMotion` and presentation-consumer
  contract remains binding: when a caller enables reduced motion, active visual
  work is cancelled, future animated callbacks are bypassed, and the already-
  resolved result is presented without changing command timing or authoritative
  state. The first release does not claim automatic operating-system preference
  detection or a new user-facing motion setting where neither is currently
  characterized.
- No accessible name, description, log row, live announcement, diagnostic, or
  DOM state may reveal a concealed card identity, private image URL, canonical
  identifier, or other information absent from that recipient's projection.
  This privacy rule is release-blocking on every device, including best-effort
  clients.

The following are explicitly outside the first-release claim:

- formal WCAG 2.2 AA conformance, certification, or a conformance report;
- a guaranteed screen-reader, magnifier, switch-control, speech-input, or other
  assistive-technology product/version matrix;
- a comprehensive keyboard equivalent for every pointer gesture, including
  free-form board drag and drop, unless that workflow is separately
  characterized as keyboard-operable;
- a separate 200% browser-zoom or small-viewport reflow guarantee; and
- a contrast redesign or formal high-contrast/forced-colors guarantee.

ADR-023's CSS-pixel boundary still applies under browser zoom. A zoomed viewport
that reports at least 1280×720 CSS pixels remains inside the desktop layout
matrix; a zoomed viewport below that size is best effort. Security, privacy,
authorization, and data correctness never become best effort.

## Required evidence

Automated accessibility-parity evidence is release-blocking. It must continue to
cover:

- native roles, names, states, and board-zone keyboard activation;
- global shortcut ownership and suppression in editable controls;
- menu/dialog navigation, focus containment, dismissal, and focus return;
- ordered/bounded live announcements and cancellation across replay or teardown;
- the reduced-motion consumer path and state-independent result; and
- accessible-DOM and asset-request non-disclosure for hidden information.

Before the first public v2 cutover, perform a recorded manual keyboard and
screen-reader smoke using at least one current desktop browser, operating system,
and screen reader. Record the exact environment, build, viewport, reviewer,
results, and defects using
[`ACCESSIBILITY_PARITY.md`](./ACCESSIBILITY_PARITY.md). Repeat that smoke for a
later release candidate when accessibility-relevant controls, focus behavior,
semantics, announcements, or renderer ownership change.

A regression from a characterized behavior blocks release. A pre-existing gap
that is outside the explicit first-release contract is recorded and may be
deferred; it does not silently become proof of conformance. Any gap that causes
hidden-data disclosure, unauthorized action, state corruption, or loss of a
protected required workflow remains release-blocking regardless of whether it
also existed in v1.

## Consequences

- The rebuild cannot remove working keyboard, focus, semantic, announcement, or
  reduced-motion behavior merely because the visual UI looks unchanged.
- Release evidence is concrete and auditable without making an unsupported legal
  or standards-conformance statement.
- Existing gaps remain visible in the audit record rather than being mistaken
  for new v2 regressions or silently expanded into release scope.
- Formal WCAG conformance, complete pointer alternatives, zoom/reflow work,
  forced-colors support, and a named assistive-technology matrix remain valid
  future projects, but each needs its own baseline, design scope, and approval.

## Revisit triggers

Replace or extend this ADR before claiming formal standards conformance,
publishing an assistive-technology support matrix, making smaller CSS viewports
release-blocking, adding visible accessibility settings, or accepting a UI
change whose purpose is to close an accessibility gap.

This is a documentation and release-policy decision. It changes no protocol,
canonical state, stored data, or rollback behavior.
