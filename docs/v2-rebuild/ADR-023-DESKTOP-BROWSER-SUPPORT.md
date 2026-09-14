# ADR-023: support current desktop browsers at a 1280×720 minimum viewport

- Status: **ACCEPTED**
- Decision date: 2026-09-14
- Scope: first v2 release browser, device, and viewport support

## Context

The first v2 release preserves a desktop tabletop whose board, side panels,
menus, deck tools, and pointer interactions need enough simultaneous screen
space to retain the existing UI and UX. Calling every browser and device
"supported" without a named release matrix would make parity and release
approval subjective. Requiring phone and tablet layouts now would also expand
the project into a UI/UX redesign, contrary to the under-the-hood rebuild goal.

Playwright can continuously exercise the Chromium, Firefox, and WebKit engines,
but its bundled engines are not substitutes for the exact vendor browser and
operating-system combinations users receive. In particular, WebKit automation
is a useful Safari compatibility gate, not a claim that Safari itself ran in
Linux CI.

## Decision

The first v2 release officially supports:

- the current stable desktop releases of Google Chrome, Microsoft Edge,
  Mozilla Firefox, and Apple Safari;
- those browsers on desktop or laptop operating systems currently supported by
  their browser vendor; and
- a browser content viewport of at least 1280×720 CSS pixels.

"Current stable" is a rolling window: the release available in the browser's
ordinary stable channel when a PTCG Sim release candidate is approved. Beta,
developer, extended-support, and superseded stable releases are not part of the
first-release commitment unless separately recorded.

Phones, tablets, touch-only interaction, and viewports below 1280×720 CSS pixels
are best effort and not release-blocking for the first v2 release. This is a
support boundary, not permission to intentionally break those clients. It also
does not weaken security, privacy, authorization, or stored-data correctness:
those properties must fail safely on every client.

Automated pull-request evidence is split by purpose:

- the full Chromium lane remains the quantitative, visual-parity, legacy-oracle,
  topology, and resource-lifecycle gate;
- a focused Firefox and WebKit lane runs the same real Solo-room journey at
  1280×720/DPR 1, including authority creation, WebSocket session, DOM render,
  pointer drag, arbitrary image URL loading, replay export/import/exit, and
  runtime-error detection; and
- Playwright Chromium covers the shared Chrome/Edge engine, while Playwright
  WebKit is only an automated Safari proxy.

Each production release candidate must additionally receive a foreground manual
smoke on the named current stable Chrome, Edge, Firefox, and Safari products.
The release record captures browser and operating-system versions and checks
room creation/join, visible board layout, pointer and keyboard input, custom
images, reconnect, storage, replay entry/exit, full screen, and clean leave.
Safari must run on macOS; Edge must run as the released Edge product. Any
browser-specific release blocker fails the matrix even if its corresponding CI
engine passed.

The minimum viewport is measured in CSS pixels reported to the page. Larger
viewports and higher device-pixel ratios remain supported, but the existing
provisional 1366×768/DPR 1 and 1920×1080/DPR 2 quantitative targets still need
their separate reference-hardware evidence. ADR-024 separately defines the
first-release accessibility-parity and zoom boundary. The named performance
reference hardware is not decided by this ADR.

## Consequences

- The release claim is explicit without redesigning the tabletop for mobile.
- Firefox/WebKit regressions become pull-request failures on one representative
  end-to-end path rather than being deferred entirely to manual release testing.
- Chrome versus Edge and WebKit versus Safari product differences remain
  visible in the mandatory release-candidate record.
- A newly released stable browser can expose a regression after a PTCG Sim
  release; a failing supported browser pauses the next release and is triaged as
  a compatibility defect.
- Supporting older browsers, a longer browser window, mobile/tablet layouts, or
  smaller viewports requires a separately scoped product decision and evidence.

## Required evidence

- Keep the Chromium regression and production-topology jobs green without
  retrying test failures.
- Keep the focused Firefox/WebKit real-room job green without retrying test
  failures.
- For each release candidate, archive the four-product manual smoke record with
  browser/OS versions, viewport, result, defects, and reviewer.
- Record the reference device and physical-GPU measurements before claiming the
  quantitative renderer budgets.
- Keep ADR-024's automated accessibility-parity gates green and complete its
  recorded manual first-release smoke before public cutover.

If a supported browser fails, do not silently relabel it best effort. Fix the
defect, hold the release, or replace this ADR through explicit product approval.
