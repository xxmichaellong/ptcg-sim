# Experience completion and release review

This follow-up closes the implementation and repeatable-test gaps from the board-depth review. It keeps the application a manual sandbox; game authority, ownership, recipient disclosure, and command preconditions remain with the existing controller and server.

## Interaction primitives

- Open piles and work areas now use `BoardDragController`, the same gesture contract as both board renderers. Pointer capture and a five-pixel threshold cover mouse, pen, and touch. Escape, cancellation, lost capture, resizing, visibility changes, changed permissions, and an invalidated source retire the gesture and its temporary image.
- Touching artwork scrolls a pile. A visible grip starts touch dragging. Native buttons and a destination select provide an equivalent select-and-move path; Read and Actions are visible alongside it. Keyboard activation remains available after a cancelled drag.
- Assemble / attach in the card menu invokes existing target selection. View individual cards exposes Separate this card to hand. These controls use the same revalidated actions as keyboard shortcuts, including foreign Tool ownership.
- Browser-local parallax is optional and initially off. A bounded camera eye offset feeds the shared projection used by DOM, Pixi, chrome, and overlay picking. It settles at a maximum 30 updates per second, stops at rest, and freezes before pointer capture. Touch, reduced/instant motion, dialogs, and ongoing board animation suspend it.

The single-pointer alternative follows [WCAG dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements); release/cancel behavior follows [pointer cancellation](https://www.w3.org/WAI/WCAG21/Understanding/pointer-cancellation). [Pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture) and explicit `touch-action` keep a gesture's owner clear while allowing normal pile scrolling.

## Card materials and Pixi

`CardPresentation` can describe `finish` (`matte`, `sheen`, `holo`, `rainbow`) and `foilRegion` (`artwork`, `full`, `none`). These optional fields are strictly validated, participate in presentation identity, and follow the existing definition through CSV, wire projection, replay, and saves. The custom-card form exposes them. Without explicit metadata the established cosmetic fallback remains; it is not an assertion about a print's rarity. Artwork-window coverage uses the standard portrait scan rectangle, not an exact mask for every historical printing.

DOM cards, previews, the inspector, panel drags, and Pixi consume the disclosed material. Concealed cards and deck covers use a neutral sleeve treatment. Reading mode removes preview reflections.

Both renderers and the WebGL fallback use the same table controls and resize input. Pixi card textures generate mip levels once per leased image, improving fine-print minification without an animation-time filter. Mipmaps add roughly one third to the base texture allocation; physical-device texture-budget measurements remain required before promoting Pixi to the default.

Pixi adds one reusable light graphic for the handled face, bounded face turns toward disclosed artwork, and counter pulses. Temporary face textures have their own leases and are released on completion, replacement, reduced motion, suspension, and destruction. The existing on-demand animation clock runs these effects; an idle board schedules no continuing work. The implementation uses ordinary Pixi geometry rather than a filter covering the entire canvas; [Pixi's scene object guidance](https://pixijs.com/8.x/guides/components/scene-objects) and [custom filter example](https://pixijs.com/8.x/examples/filters-advanced/custom) informed that choice.

## Regressions found by the expanded review

- Restoring a saved game used to attach the retained deck editor as a fresh session, automatically sending `LoadDeck` and replacing the restored board. Restored sessions now retain drafts without automatic installation. The production-browser journey verifies exact saved revision and all four assembled faces for both restored participants.
- Pixi's automatic renderer selection could silently choose Canvas when WebGL was unavailable, but Canvas has no perspective-mesh render pipe. Board mounting now selects the DOM renderer on those devices; Pixi itself requires WebGL. Diagnostics report the actual renderer, and performance observations assert that the requested backend really ran. This fallback preserves Tabletop mode and play controls.
- Reading a selected pile card previously cleared its selection and disabled its action row. The selection now survives preview/menu round trips, allowing keyboard focus to return to the opener.
- The real-artwork review also found that Pixi silently accepted extensionless image URLs without a texture parser. Card images now explicitly select the image parser (preserving SVG handling); a GPU browser regression verifies decoded texture dimensions rather than trusting a successful load promise.
- Off-centre panel pickups now settle from the held face's centre while picking destinations under the pointer. Browser checks also collect caught renderer console errors, not only uncaught exceptions.

## Repeatable coverage

The checked-in Firefox/WebKit suite now includes experience controls, special formats, live depth, the depth lab, optimistic feedback, and two-client recovery in addition to the original Solo journey. Chromium's broad gate includes the same cases.

New or expanded checks cover:

- Pointer panel-to-board drops under projection; touch/pen cancellation; native keyboard movement; optional parallax freeze and idle behavior.
- Real durable-room rejection of a deliberately stale optimistic play, delayed accepted play, two-client convergence, reconnect, and absence of private opponent-art requests before public play.
- V-UNION assembly through visible controls, recipient replay, and separating an individual piece; production continuation save/restore of a four-piece custom print with explicit finish metadata.
- Undo during a shuffle; repeated renderer view changes; cleanup of transient geometry, texture leases, and callbacks.
- A 720×450 CSS viewport at DPR 2, equivalent in available CSS space to a 1440×900 desktop at 200% zoom. This supplements, rather than replaces, a real browser zoom check.

## Performance evidence

The production renderer observation now uses **120 distinct decoded card images**, ten warmups and 100 measured single/full reconciliation samples, in Flat, Raised, and Tabletop modes for both renderers. It records image count, texture references, failures, idle work, environment, and raw timings. The normal command remains `corepack pnpm run measure:v2:renderer`; its headful Chrome, two viewport/DPR profiles, and three repetitions are the release observation protocol.

A headless diagnostic run at 1366×768/DPR 1 passed all six combinations with zero texture failures and zero idle commits. Full-scene submission-to-commit p95 was approximately 5.2/13.9/11.2 ms for DOM and 1.9/3.4/3.3 ms for Pixi (Flat/Raised/Tabletop). The recorded GPU was **SwiftShader**, so these numbers do not measure physical GPU frame rate or input-to-photon latency. The compact environment/result record is in `2026-10-11-distinct-art-diagnostic.json`; the harness emits raw samples with its Playwright attachment.

## Validation record

- `check:ci` passed: formatting, lint, dependency boundaries, public API, cycle checks, all TypeScript targets, 79 legacy tests, 49 tooling tests, 2,707 unit tests in 279 files, 32 worker-runtime tests, and production web/worker builds.
- Firefox: 34 scenarios passed. This local Firefox environment has no usable WebGL, so requested Pixi journeys exercised the explicit DOM fallback; these results do not claim Firefox GPU coverage.
- WebKit: 34 scenarios passed using the local Linux runtime with software Mesa. Its initially missing TLS module was installed before the successful complete run; console-error checks remain enabled. Each renderer-specific scenario records the requested and actual backend.
- The local resource gate passed all 140 setup/reset cycles and 560 pile openings, plus its animated churn case.
- A final focused Chromium run passed all 44 scenarios covering the new journeys and the complete protected-input suite.
- Production continuation journey passed with exact revision, four-piece artwork/material restoration for both participants, fresh credentials, and bearer revocation.
- Dependency audit passed with the repository's existing `GHSA-vfj7-8cjw-p6xm` exception: one unpatched high-severity advisory in the legacy development watcher dependency tree. No dependency exception was added by this work.
- Visual review used real Charizard ex and Iono artwork at 1440×900 to inspect board placement, pile density, and the full reading view. It caught unwanted native image selection and unclear disabled controls, both corrected in the overlay primitive styles.
- The original hosted baseline had 233 Chromium cases pass and two failures: a pointer helper sampled a lower card while the hovered face covered it, and the 140-cycle resource soak exceeded ten minutes. The helper now leaves the hovered face and waits for an exposed hit point; the soak retains all 140 cycles with a twenty-minute budget. The Chromium job has sixty minutes for the full gate.

Hosted release validation is dispatched on the pushed branch through `.github/workflows/ci.yml`; its run result is reported with the final delivery.

## Physical and human acceptance still required

Automation cannot establish the feel of an actual device or certify accessibility. Before treating this as a release-quality physical-device sign-off:

1. Run the checked-in headful performance protocol on an integrated-GPU laptop and a discrete-GPU desktop; include a full game, rapid draw/shuffle/undo, 120 distinct images, and both DPR profiles. Record frame pacing, texture memory, and any thermal throttling.
2. Play on current Safari/macOS and iPadOS, touch hardware, and a pen device. Check scrolling versus pickup, edge releases, lost capture, resize/orientation changes, and reading in portrait and landscape.
3. Exercise actual 200% and 400% browser zoom, keyboard-only navigation, a screen reader, high contrast, reduced motion, and image failure. Check announcements, focus order/return, and every destination control; the automated equivalents are not a certification.
4. Have two people play complete games including ordinary decks, LEGEND, V-UNION, BREAK, paired Stadiums, and an opponent-attached Tool. Include a disconnect, rejection, replay, and save/restore. Record misclicks, reading friction, and distracting motion.

DOM remains the default renderer. No deployment or merge is part of this review.
